// Importa o estoque publicado no site atual da Forte Veículos para o banco novo: dados e fotos reais.
// Pode ser executado mais de uma vez: veículos com o mesmo slug são ignorados.
// Uso: npm run stock:import
// Conferência sem tocar no banco: npm run stock:import -- --conferir [arquivo.md]
// Rode antes de apontar o domínio para o site novo: os dados e as fotos vêm do site antigo, nesse mesmo domínio.
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { loadEnv, requireEnv } from './lib/env.mjs';

const CHECK_ONLY = process.argv.includes('--conferir');

loadEnv();
if (!CHECK_ONLY) requireEnv('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY');

const SOURCE = 'https://www.forteveiculoscachoeiro.com.br';
const USER_AGENT = 'Mozilla/5.0 (migracao de estoque Forte Veiculos)';
const COMPANY_SLUG = process.env.DEFAULT_COMPANY_SLUG ?? 'forte-veiculos';

// Marca e categoria não constam nos dados de cada anúncio do site atual; vêm do próprio modelo anunciado.
const CATALOG = {
  'bmw-320i-2014': { brand: 'BMW', model: '320i', version: null, category: 'premium' },
  'city-sedan-exl-2025': { brand: 'Honda', model: 'City Sedan', version: 'EXL', category: 'sedan' },
  'civic-exr-2014': { brand: 'Honda', model: 'Civic', version: 'EXR', category: 'sedan' },
  'corolla-gli-2024': { brand: 'Toyota', model: 'Corolla', version: 'GLi', category: 'sedan' },
  'corolla-xei-2019': { brand: 'Toyota', model: 'Corolla', version: 'XEi', category: 'sedan' },
  'corolla-xei-2023': { brand: 'Toyota', model: 'Corolla', version: 'XEi', category: 'sedan' },
  'corolla-xei-2024': { brand: 'Toyota', model: 'Corolla', version: 'XEi', category: 'sedan' },
  'ecosport-freestyle-at-1-5-2019': { brand: 'Ford', model: 'EcoSport', version: 'Freestyle AT 1.5', category: 'suv' },
  'fox-xtreme-2020': { brand: 'Volkswagen', model: 'Fox', version: 'Xtreme', category: 'hatch' },
  'hr-v-ex-2021': { brand: 'Honda', model: 'HR-V', version: 'EX', category: 'suv' },
  'hr-v-exl-2019': { brand: 'Honda', model: 'HR-V', version: 'EXL', category: 'suv' },
  'pajero-sport-2024': { brand: 'Mitsubishi', model: 'Pajero Sport', version: null, category: 'suv' },
  'ranger-xls-2019': { brand: 'Ford', model: 'Ranger', version: 'XLS', category: 'pickup' },
  'spacefox-1-6-2008': { brand: 'Volkswagen', model: 'SpaceFox', version: '1.6', category: 'other' },
  'strada-freedom-1-3-cd-2024': { brand: 'Fiat', model: 'Strada', version: 'Freedom 1.3 CD', category: 'pickup' },
  'wr-v-exl-2018': { brand: 'Honda', model: 'WR-V', version: 'EXL', category: 'suv' },
  'yaris-hatch-xl-2019': { brand: 'Toyota', model: 'Yaris Hatch', version: 'XL', category: 'hatch' },
};

// Destaques atuais do site da loja.
const FEATURED = new Set(['ranger-xls-2019', 'ecosport-freestyle-at-1-5-2019', 'city-sedan-exl-2025', 'corolla-xei-2023']);

const strip = (value) => value.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

function parseVehicle(html) {
  const details = strip((html.match(/<\/h2>([\s\S]{0,1500}?)<h3 class="preco"/i) ?? [])[1] ?? '');
  const parts = details.split('•').map((part) => part.trim()).filter(Boolean);
  const year = Number(parts.find((part) => /^\d{4}$/.test(part)));
  const kmPart = parts.find((part) => /km$/i.test(part));
  const transmissionPart = parts.find((part) => /autom|manual/i.test(part)) ?? '';
  const colorPart = parts.find((part) => /^[A-ZÀ-Ú ]+$/.test(part));
  const price = strip((html.match(/<h3 class="preco">([\s\S]*?)<\/h3>/i) ?? [])[1] ?? '').replace(/\./g, '').replace(',', '.');
  const listBlock = (html.match(/<ul class="caracteristicas">([\s\S]*?)<\/ul>/i) ?? [])[1] ?? '';
  const items = [...listBlock.matchAll(/<li>([\s\S]*?)<\/li>/gi)]
    .map((match) => strip(match[1]).replace(/^[•\-\s]+/, ''))
    .filter(Boolean);
  const photos = [...new Set([...html.matchAll(/uploads\/([^'"\s)]+\.(?:jpe?g|png|webp))/gi)].map((match) => match[1]))];

  const text = items.join(' ').toLowerCase();
  let fuel = null;
  if (/diesel/.test(text)) fuel = 'diesel';
  else if (/h[ií]brid/.test(text)) fuel = 'hybrid';
  else if (/\bflex\b/.test(text)) fuel = 'flex';

  return {
    model_year: year,
    mileage_km: kmPart ? Number(kmPart.replace(/\D/g, '')) : null,
    transmission: /autom/i.test(transmissionPart) ? 'automatic' : /manual/i.test(transmissionPart) ? 'manual' : null,
    fuel,
    color: colorPart ? colorPart.charAt(0) + colorPart.slice(1).toLowerCase() : null,
    price_cents: Math.round(Number(price) * 100),
    features: items.filter((item) => !/^[A-ZÀ-Ú0-9 .-]+$/.test(item)).slice(0, 60),
    photos,
  };
}

async function fetchOk(url) {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`${response.status} em ${url}`);
  return response;
}

if (CHECK_ONLY) {
  const NOT_INFORMED = 'não informado';
  const lines = [
    '| Slug | Marca | Modelo | Versão | Ano | Km | Combustível | Câmbio | Cor | Preço | Fotos | Itens |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  let incomplete = 0;
  for (const [slug, identity] of Object.entries(CATALOG)) {
    const parsed = parseVehicle(await (await fetchOk(`${SOURCE}/${slug}`)).text());
    if (parsed.mileage_km == null || !parsed.fuel || !parsed.transmission || !parsed.color) incomplete += 1;
    const price = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(parsed.price_cents / 100);
    lines.push(
      `| ${slug} | ${identity.brand} | ${identity.model} | ${identity.version ?? NOT_INFORMED} | ${parsed.model_year} | ${parsed.mileage_km ?? NOT_INFORMED} | ${parsed.fuel ?? NOT_INFORMED} | ${parsed.transmission ?? NOT_INFORMED} | ${parsed.color ?? NOT_INFORMED} | ${price} | ${parsed.photos.length} | ${parsed.features.length} |`,
    );
  }
  const report = `${lines.join('\n')}\n\n${Object.keys(CATALOG).length} veículos, ${incomplete} com algum dado não informado.\n`;
  const target = process.argv[process.argv.indexOf('--conferir') + 1];
  if (target && !target.startsWith('--')) writeFileSync(target, report);
  console.log(report);
  process.exit(0);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: company, error: companyError } = await supabase.from('companies').select('id').eq('slug', COMPANY_SLUG).single();
if (companyError) throw new Error(`Empresa não encontrada: ${COMPANY_SLUG}`);

let created = 0;
let skipped = 0;
for (const [slug, identity] of Object.entries(CATALOG)) {
  const { data: existing } = await supabase.from('vehicles').select('id').eq('company_id', company.id).eq('slug', slug).maybeSingle();
  if (existing) {
    skipped += 1;
    console.log(`já existe: ${slug}`);
    continue;
  }

  const html = await (await fetchOk(`${SOURCE}/${slug}`)).text();
  const { photos, ...parsed } = parseVehicle(html);
  const { data: vehicle, error } = await supabase
    .from('vehicles')
    .insert({
      ...identity,
      ...parsed,
      slug,
      company_id: company.id,
      status: 'available',
      is_featured: FEATURED.has(slug),
    })
    .select('id, brand, model, model_year')
    .single();
  if (error) throw new Error(`${slug}: ${error.message}`);

  let position = 0;
  for (const name of photos) {
    const source = Buffer.from(await (await fetchOk(`${SOURCE}/uploads/${encodeURIComponent(name)}`)).arrayBuffer());
    const full = await sharp(source).rotate().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
    const thumb = await sharp(source).rotate().resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true }).webp({ quality: 76 }).toBuffer();
    const fileId = randomUUID();
    const storagePath = `${company.id}/${vehicle.id}/${fileId}.webp`;
    const thumbPath = `${company.id}/${vehicle.id}/${fileId}-800.webp`;
    const bucket = supabase.storage.from('vehicle-photos');
    const options = { contentType: 'image/webp', cacheControl: '31536000' };
    const first = await bucket.upload(storagePath, full.data, options);
    if (first.error) throw new Error(`${slug}: ${first.error.message}`);
    const second = await bucket.upload(thumbPath, thumb, options);
    if (second.error) throw new Error(`${slug}: ${second.error.message}`);
    const insert = await supabase.from('vehicle_photos').insert({
      company_id: company.id,
      vehicle_id: vehicle.id,
      storage_path: storagePath,
      thumb_path: thumbPath,
      width: full.info.width,
      height: full.info.height,
      position,
      alt: `${vehicle.brand} ${vehicle.model} ${vehicle.model_year}`,
    });
    if (insert.error) throw new Error(`${slug}: ${insert.error.message}`);
    position += 1;
  }
  created += 1;
  console.log(`importado: ${slug} (${photos.length} fotos)`);
}

console.log(`\nConcluído. Importados: ${created}. Já existentes: ${skipped}.`);
