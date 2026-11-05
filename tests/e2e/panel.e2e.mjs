// Teste de ponta a ponta contra o emulador local (tests/e2e/supabase-emulator.mjs), em Chrome real.
// Cobre os fluxos pedidos na validação do projeto. Uso: node tests/e2e/panel.e2e.mjs
import { createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_URL, collectProblems, CONSENT_REJECTED, launch } from './lib/browser.mjs';

const EMULATOR = process.env.E2E_EMULATOR_URL ?? 'http://127.0.0.1:54321';
const OUT = 'test-results/e2e';
mkdirSync(OUT, { recursive: true });

const run = randomBytes(3).toString('hex');
const results = [];

async function check(group, name, fn) {
  try {
    await fn();
    results.push({ group, name, ok: true });
    console.log(`  ok   [${group}] ${name}`);
  } catch (error) {
    results.push({ group, name, ok: false, error: String(error.message ?? error).split('\n')[0] });
    console.log(`  FALHA [${group}] ${name}: ${String(error.message ?? error).split('\n')[0]}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const sql = async (query, params = []) => {
  const response = await fetch(`${EMULATOR}/__qa/sql`, { method: 'POST', body: JSON.stringify({ sql: query, params }) });
  const body = await response.json();
  if (!response.ok) throw new Error(`SQL: ${body.message}`);
  return body;
};

const createQaUser = async (email, password, role, company, name = 'Teste') =>
  (await fetch(`${EMULATOR}/__qa/user`, { method: 'POST', body: JSON.stringify({ email, password, role, company, name }) })).json();

function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of secret) bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const offset = digest[19] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

const plain = (text) => text.replace(/\u00a0/g, ' ');
const publicHtml = async (path, headers = {}) => {
  const response = await fetch(`${BASE_URL}${path}`, { headers, redirect: 'manual' });
  return { status: response.status, html: await response.text(), headers: response.headers };
};

await sql('delete from private.rate_limits');
const [{ id: companyA }] = await sql(`select id from public.companies where slug = 'forte-veiculos'`);
await sql(`insert into public.companies (slug, name) values ($1, 'Loja B') on conflict do nothing`, [`loja-b-${run}`]);
const [{ id: companyB }] = await sql(`select id from public.companies where slug = $1`, [`loja-b-${run}`]);
await sql(`insert into public.site_settings (company_id, display_name, whatsapp) values ($1, 'Loja B', '5511999990000')`, [companyB]);
await sql(`insert into public.technical_settings (company_id) values ($1)`, [companyB]);
await sql(`insert into public.company_domains (hostname, company_id) values ($1, $2)`, [`loja-b-${run}.test`, companyB]);
const [{ id: vehicleB }] = await sql(
  `insert into public.vehicles (company_id, slug, brand, model, model_year, price_cents, status) values ($1, 'carro-da-loja-b', 'Fiat', 'Argo', 2022, 7000000, 'available') returning id`,
  [companyB],
);
await sql(`insert into public.leads (company_id, type, name, phone, consent_version) values ($1, 'contact', 'Cliente Loja B', '11999990000', 'v1')`, [companyB]);

const OWNER = { email: `dono-${run}@forte.test`, password: 'senha-do-dono-2026' };
const MASTER = { email: `master-${run}@forte.test`, password: 'senha-do-master-2026' };
const OWNER_B = { email: `dono-b-${run}@lojab.test`, password: 'senha-da-loja-b-2026' };
await createQaUser(OWNER.email, OWNER.password, 'owner', companyA, 'Dono Teste');
await createQaUser(MASTER.email, MASTER.password, 'master', companyA, 'Master Teste');
await createQaUser(OWNER_B.email, OWNER_B.password, 'owner', companyB, 'Dono B');

const browser = await launch();

async function newPanelContext(viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport });
  await context.addCookies([CONSENT_REJECTED()]);
  const page = await context.newPage();
  page.on('dialog', (dialog) => dialog.accept());
  return { context, page, problems: collectProblems(page) };
}

async function submitLogin(page, user) {
  await page.goto(`${BASE_URL}/admin/login`);
  await page.fill('input[name=email]', user.email);
  await page.fill('input[name=password]', user.password);
  await page.click('button.a-btn-primary');
}

async function fullLogin(page, user) {
  await submitLogin(page, user);
  await page.waitForURL('**/admin/mfa');
  const secretNode = page.locator('.mfa-secret code');
  await Promise.race([secretNode.waitFor({ state: 'attached' }), page.locator('input[name=factor_id]').waitFor({ state: 'attached' })]);
  if (await secretNode.count()) user.secret = (await secretNode.textContent()).trim();
  await page.fill('input[name=code]', totp(user.secret));
  await page.click('form.auth-form button.a-btn-primary');
  await page.waitForURL(/\/admin$/);
}

// 3. Proteção das rotas -------------------------------------------------------------

console.log('\nRotas administrativas');
for (const path of ['/admin', '/admin/veiculos', '/admin/veiculos/novo', '/admin/leads', '/admin/usuarios', '/admin/tecnico', '/admin/historico', '/admin/mfa']) {
  await check('Rotas', `sem sessão, ${path} vai para o login`, async () => {
    const { status, headers } = await publicHtml(path);
    assert(status === 307 && headers.get('location').includes('/admin/login'), `status ${status}, destino ${headers.get('location')}`);
  });
}
await check('Rotas', 'painel envia noindex e no-store', async () => {
  const { headers } = await publicHtml('/admin/login');
  assert(headers.get('x-robots-tag')?.includes('noindex'), 'sem X-Robots-Tag');
  assert(headers.get('cache-control')?.includes('no-store'), `cache-control ${headers.get('cache-control')}`);
});
await check('Rotas', 'upload sem sessão é recusado', async () => {
  const form = new FormData();
  form.append('file', new Blob([readFileSync('public/images/fachada.jpg')], { type: 'image/jpeg' }), 'a.jpg');
  const response = await fetch(`${BASE_URL}/api/admin/vehicles/${vehicleB}/photos`, { method: 'POST', body: form, headers: { Origin: BASE_URL } });
  assert(response.status === 401, `status ${response.status}`);
});

// 1. Login, logout e MFA ---------------------------------------------------------------

console.log('\nLogin e MFA');
const owner = await newPanelContext();

await check('Login', 'senha errada mostra erro genérico', async () => {
  await submitLogin(owner.page, { email: OWNER.email, password: 'errada-123456' });
  await owner.page.locator('.alert-error').waitFor();
  assert((await owner.page.locator('.alert-error').textContent()).includes('E-mail ou senha incorretos'), 'mensagem inesperada');
});
await check('Login', 'e-mail inexistente recebe a mesma mensagem (sem enumeração)', async () => {
  await submitLogin(owner.page, { email: `nao-existe-${run}@forte.test`, password: 'errada-123456' });
  await owner.page.locator('.alert-error').waitFor();
  assert((await owner.page.locator('.alert-error').textContent()).includes('E-mail ou senha incorretos'), 'mensagem inesperada');
});
await check('Login', 'tentativas excessivas são bloqueadas', async () => {
  const target = { email: `alvo-${run}@forte.test`, password: 'errada-123456' };
  let blocked = false;
  for (let attempt = 0; attempt < 7 && !blocked; attempt += 1) {
    await submitLogin(owner.page, target);
    await owner.page.locator('.alert-error').waitFor();
    blocked = (await owner.page.locator('.alert-error').textContent()).includes('Muitas tentativas');
  }
  assert(blocked, 'não bloqueou depois de 7 tentativas');
});
await check('Login', 'depois da senha, sem MFA, o painel continua fechado', async () => {
  await submitLogin(owner.page, OWNER);
  await owner.page.waitForURL('**/admin/mfa');
  await owner.page.goto(`${BASE_URL}/admin/veiculos`);
  await owner.page.waitForURL('**/admin/mfa');
});
await check('Login', 'cadastro de MFA com código errado é recusado', async () => {
  await owner.page.goto(`${BASE_URL}/admin/mfa`);
  await owner.page.locator('.mfa-secret code').waitFor({ state: 'attached' });
  await owner.page.fill('input[name=code]', '000000');
  await owner.page.click('form.auth-form button.a-btn-primary');
  await owner.page.locator('.alert-error').waitFor();
});
await check('Login', 'MFA correto libera o painel', async () => {
  await owner.context.clearCookies();
  await owner.context.addCookies([CONSENT_REJECTED()]);
  await fullLogin(owner.page, OWNER);
  await owner.page.locator('.a-tiles-stock').waitFor();
});
await check('Login', 'cookies de sessão são HttpOnly e SameSite=Lax', async () => {
  const cookies = (await owner.context.cookies()).filter((cookie) => cookie.name.includes('auth-token'));
  assert(cookies.length > 0, 'sem cookie de sessão');
  for (const cookie of cookies) {
    assert(cookie.httpOnly, `${cookie.name} sem HttpOnly`);
    assert(cookie.sameSite === 'Lax', `${cookie.name} SameSite ${cookie.sameSite}`);
  }
  const visible = await owner.page.evaluate(() => document.cookie);
  assert(!visible.includes('auth-token'), 'sessão visível para JavaScript');
});

// 4. Permissões -------------------------------------------------------------------------

console.log('\nPermissões');
await check('Permissões', 'proprietário não vê nem abre Usuários e Ajustes técnicos', async () => {
  assert((await owner.page.locator('.a-side nav a[href="/admin/usuarios"]').count()) === 0, 'link de usuários visível');
  await owner.page.goto(`${BASE_URL}/admin/usuarios`);
  await owner.page.waitForURL(/\/admin$/);
  await owner.page.goto(`${BASE_URL}/admin/tecnico`);
  await owner.page.waitForURL(/\/admin$/);
});
await check('Permissões', 'Histórico fica escondido e fechado para o proprietário', async () => {
  await owner.page.goto(`${BASE_URL}/admin`);
  assert((await owner.page.locator('.a-side nav a[href="/admin/historico"]').count()) === 0, 'link visível');
  await owner.page.goto(`${BASE_URL}/admin/historico`);
  await owner.page.waitForURL(/\/admin$/);
});
await check('Permissões', 'indicadores do dashboard trazem números reais', async () => {
  await owner.page.goto(`${BASE_URL}/admin`);
  const tiles = await owner.page.locator('.a-tiles-stock .a-tile').allTextContents();
  assert(tiles.length === 7, `${tiles.length} indicadores`);
  const [{ total }] = await sql(`select count(*)::int as total from public.vehicles where company_id = $1`, [companyA]);
  assert(tiles[0].includes(String(total)), `total ${tiles[0]} esperado ${total}`);
});

// 5 a 11. Estoque --------------------------------------------------------------------------

console.log('\nEstoque');
const modelName = `Civic Teste ${run}`;
let vehicleId;
let vehicleSlug;

await check('Cadastro', 'marcas e modelos vêm da lista, com nomes do site, e a FIPE aparece', async () => {
  await owner.page.goto(`${BASE_URL}/admin/veiculos/novo`);
  await owner.page.locator('select[name=brand] option[value="Chevrolet"]').waitFor({ state: 'attached' });
  assert((await owner.page.locator('select[name=brand] option[value="GM - Chevrolet"]').count()) === 0, 'nome cru da FIPE');
  await owner.page.selectOption('select[name=brand]', 'Honda');
  await owner.page.locator('select[name=model] option[value="Civic"]').waitFor({ state: 'attached' });
  assert((await owner.page.locator('select[name=model] option[value="City"]').count()) === 1, 'modelo em maiúsculas não normalizou');
  await owner.page.selectOption('select[name=model]', 'Civic');
  await owner.page.locator('select[name=version] option').nth(2).waitFor({ state: 'attached' });
  await owner.page.selectOption('select[name=version]', 'Sedan EXL 2.0 Flex 16V Aut.');
  assert((await owner.page.inputValue('select[name=transmission]')) === 'automatic', 'câmbio não veio da versão');
  await owner.page.fill('input[name=model_year]', '2021');
  await owner.page.locator('.a-fipe', { hasText: 'R$ 101.234' }).waitFor({ timeout: 10000 });
  assert((await owner.page.locator('.a-fipe').textContent()).includes('014075-1'), 'sem código FIPE');
  await owner.page.locator('.a-fipe button').click();
  assert((await owner.page.inputValue('input[name=price]')) === '101234', 'não usou o valor como preço');
});
await check('Cadastro', 'colar a página do Placa FIPE preenche o formulário', async () => {
  await owner.page.goto(`${BASE_URL}/admin/veiculos/novo`);
  await owner.page.fill('.a-plate input', 'int8c36');
  assert((await owner.page.locator('.a-plate a').getAttribute('href')) === 'https://placafipe.com/placa/INT8C36', 'link da placa');
  await owner.page.fill('.a-plate textarea', 'texto qualquer');
  await owner.page.locator('.a-plate .a-field-error').waitFor();
  await owner.page.fill('.a-plate textarea', [
    'Marca: VOLKSWAGEN', 'Genérico: Crossfox', 'Modelo: CROSSFOX', 'Ano: 2007', 'Ano Modelo: 2007', 'Cor: Prata', 'Combustível: Álcool / Gasolina',
    'Tabela FIPE de Novembro 2026', 'Código FIPE\tModelo\tValor', '005225-6\tCROSSFOX 1.6 Mi Total Flex 8V 5p\tR$ 29.285,00',
  ].join('\n'));
  await owner.page.locator('.a-plate-ok').waitFor();
  assert((await owner.page.inputValue('[name=brand]')) === 'Volkswagen', 'marca');
  assert((await owner.page.inputValue('[name=model]')) === 'Crossfox', 'modelo');
  assert((await owner.page.inputValue('[name=version]')) === '1.6 Mi Total Flex 8V 5p', 'versão');
  assert((await owner.page.inputValue('input[name=model_year]')) === '2007', 'ano');
  assert((await owner.page.inputValue('input[name=color]')) === 'Prata', 'cor');
  assert((await owner.page.inputValue('select[name=fuel]')) === 'flex', 'combustível');
  assert(plain(await owner.page.locator('.a-fipe').textContent()).includes('R$ 29.285'), 'FIPE');
});
await check('Cadastro', 'busca automática usa o token só no servidor e descarta dados do documento', async () => {
  await owner.page.goto(`${BASE_URL}/admin/veiculos/novo`);
  const responses = [];
  owner.page.on('response', async (response) => { if (response.url().includes('/api/admin/placa')) responses.push(await response.text()); });
  await owner.page.fill('.a-plate input', 'ABC1D23');
  await owner.page.locator('.a-plate button', { hasText: 'Buscar automático' }).click();
  await owner.page.locator('.a-plate-ok', { hasText: 'Sem restrição' }).waitFor({ timeout: 10000 });
  assert((await owner.page.inputValue('[name=brand]')) === 'Volkswagen', 'marca');
  assert((await owner.page.locator('.a-fipe').textContent()).includes('005225-6'), 'não usou o maior score');
  assert((await owner.page.inputValue('select[name=category]')) === 'hatch', 'categoria');
  owner.page.removeAllListeners('response');
  assert(!/token-de-teste|chassi|municipio|10137/i.test(responses.join()), 'resposta vazou dado');
  await owner.page.fill('.a-plate input', 'ZZZ9Z99');
  await owner.page.locator('.a-plate button', { hasText: 'Buscar automático' }).click();
  await owner.page.locator('.a-plate .a-field-error', { hasText: 'Nenhum veículo' }).waitFor();
});
await check('Cadastro', 'FIPE e placa são recusadas sem sessão', async () => {
  assert((await fetch(`${BASE_URL}/api/admin/fipe`)).status === 401, 'fipe');
  const placa = await fetch(`${BASE_URL}/api/admin/placa`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE_URL }, body: '{"placa":"ABC1D23"}' });
  assert(placa.status === 401, `placa ${placa.status}`);
});
await check('Veículos', 'campos obrigatórios são validados', async () => {
  await owner.page.goto(`${BASE_URL}/admin/veiculos/novo`);
  await owner.page.evaluate(() => document.querySelector('form.a-form').setAttribute('novalidate', ''));
  await owner.page.locator('select[name=brand] option[value="Volkswagen"]').waitFor({ state: 'attached' });
  await owner.page.selectOption('select[name=brand]', 'Honda');
  await owner.page.locator('select[name=model] option[value="Civic"]').waitFor({ state: 'attached' });
  await owner.page.selectOption('select[name=model]', '__outro__');
  await owner.page.fill('input[name=model]', modelName);
  await owner.page.fill('input[name=model_year]', '2021');
  await owner.page.fill('input[name=price]', 'abc');
  await owner.page.click('form.a-form button.a-btn-primary');
  await owner.page.locator('.a-field-error').first().waitFor();
});
await check('Veículos', 'cadastro cria o veículo', async () => {
  await owner.page.fill('input[name=price]', '98.500,00');
  await owner.page.fill('input[name=version]', 'Touring');
  await owner.page.fill('input[name=color]', 'Prata');
  await owner.page.fill('input[name=mileage_km]', '45000');
  await owner.page.selectOption('select[name=transmission]', 'automatic');
  await owner.page.selectOption('select[name=fuel]', 'flex');
  await owner.page.fill('textarea[name=description]', `Descrição real. <script>window.__xss = 1</script><img src=x onerror="window.__xss = 2">`);
  await owner.page.fill('textarea[name=features]', 'Câmera de ré\nBancos de couro');
  await owner.page.click('form.a-form button.a-btn-primary');
  await owner.page.waitForURL(/\/admin\/veiculos\/[0-9a-f-]{36}\?novo=1/);
  vehicleId = owner.page.url().match(/veiculos\/([0-9a-f-]{36})/)[1];
  const [row] = await sql(`select slug, price_cents, created_by from public.vehicles where id = $1`, [vehicleId]);
  vehicleSlug = row.slug;
  assert(Number(row.price_cents) === 9850000, `preço ${row.price_cents}`);
  assert(row.created_by, 'sem autor');
});
await check('Catálogo', 'novo veículo aparece no site na hora', async () => {
  const { html } = await publicHtml(`/veiculos?q=${encodeURIComponent(modelName)}`);
  assert(html.includes(modelName), 'não apareceu na busca');
  const detail = await publicHtml(`/veiculos/${vehicleSlug}`);
  assert(detail.status === 200 && detail.html.includes('R$ 98.500'), 'detalhe sem o preço');
});
await check('Fotos', 'upload de várias fotos pelo painel', async () => {
  await owner.page.setInputFiles('#fotos-input', ['public/images/fachada.jpg', 'public/images/og-forte.jpg']);
  await owner.page.waitForFunction(() => document.querySelectorAll('.a-photos li').length === 2, null, { timeout: 30000 });
  const rows = await sql(`select storage_path, thumb_path, is_primary, width from public.vehicle_photos where vehicle_id = $1 order by position`, [vehicleId]);
  assert(rows.length === 2, `${rows.length} fotos`);
  assert(rows[0].is_primary && !rows[1].is_primary, 'primeira foto deveria ser a principal');
  assert(rows[0].storage_path.startsWith(`${companyA}/${vehicleId}/`) && rows[0].storage_path.endsWith('.webp'), rows[0].storage_path);
});
await check('Fotos', 'define outra foto como principal', async () => {
  await owner.page.locator('.a-photos li:not(.is-primary) button', { hasText: 'Principal' }).click();
  await owner.page.waitForFunction(() => document.querySelector('.a-photos li:nth-child(2)')?.classList.contains('is-primary'));
  await owner.page.waitForTimeout(600);
  const rows = await sql(`select is_primary from public.vehicle_photos where vehicle_id = $1 order by position`, [vehicleId]);
  assert(!rows[0].is_primary && rows[1].is_primary, 'principal não mudou');
});
const postPhoto = async (context, targetVehicle, bytes, type = 'image/jpeg', name = 'x.jpg') => {
  const cookie = (await context.cookies()).map((item) => `${item.name}=${item.value}`).join('; ');
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), name);
  return fetch(`${BASE_URL}/api/admin/vehicles/${targetVehicle}/photos`, { method: 'POST', body: form, headers: { Cookie: cookie, Origin: BASE_URL } });
};
await check('Fotos', 'arquivo falso com extensão de imagem é recusado', async () => {
  const response = await postPhoto(owner.context, vehicleId, Buffer.from('<html><script>alert(1)</script></html>'));
  assert(response.status === 415, `status ${response.status}`);
});
await check('Fotos', 'SVG disfarçado é recusado', async () => {
  const response = await postPhoto(owner.context, vehicleId, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'image/svg+xml', 'x.svg');
  assert(response.status === 415, `status ${response.status}`);
});
await check('Fotos', 'arquivo acima de 8 MB é recusado', async () => {
  const response = await postPhoto(owner.context, vehicleId, Buffer.alloc(9 * 1024 * 1024, 0xff));
  assert(response.status === 413, `status ${response.status}`);
});
await check('Fotos', 'imagem corrompida é recusada', async () => {
  const response = await postPhoto(owner.context, vehicleId, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(2000)]));
  assert(response.status === 415, `status ${response.status}`);
});
await check('Fotos', 'exclui foto e a próxima assume como principal', async () => {
  await owner.page.locator('.a-photos li.is-primary button', { hasText: 'Excluir' }).click();
  await owner.page.waitForFunction(() => document.querySelectorAll('.a-photos li').length === 1, null, { timeout: 15000 });
  const rows = await sql(`select is_primary from public.vehicle_photos where vehicle_id = $1`, [vehicleId]);
  assert(rows.length === 1 && rows[0].is_primary, 'principal não foi promovida');
});
const siteImages = async () => (await sql(`select images from public.site_settings where company_id = $1`, [companyA]))[0].images;
const siteImageFiles = async () => (await sql(`select name from storage.objects where name like $1`, [`${companyA}/site/%`])).map((row) => row.name);
const postSiteImage = async (context, slot, bytes, origin = BASE_URL) => {
  const cookie = context ? (await context.cookies()).map((item) => `${item.name}=${item.value}`).join('; ') : '';
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'image/jpeg' }), 'x.jpg');
  return fetch(`${BASE_URL}/api/admin/site-images/${slot}`, { method: 'POST', body: form, headers: { Cookie: cookie, Origin: origin } });
};
await check('Fotos do site', 'proprietário troca a foto de um cartão e o site muda', async () => {
  await owner.page.goto(`${BASE_URL}/admin/fotos`);
  await owner.page.setInputFiles('#foto-comprar', 'public/images/fachada.jpg');
  await owner.page.locator('[data-slot=comprar] .a-photo-badge', { hasText: 'Foto da loja' }).waitFor({ timeout: 30000 });
  const images = await siteImages();
  assert(images.comprar?.startsWith(`${companyA}/site/comprar-`) && images.comprar.endsWith('.webp'), JSON.stringify(images));
  const { html } = await publicHtml('/');
  assert(html.includes(images.comprar), 'home sem a foto nova');
  assert(!html.includes('/images/comprar.webp'), 'home ainda com a foto original');
  assert(html.includes('/images/vender.webp'), 'os outros cartões deveriam continuar iguais');
  await owner.page.screenshot({ path: join(OUT, 'fotos-do-site.png'), fullPage: true });
});
await check('Fotos do site', 'trocar de novo apaga o arquivo anterior', async () => {
  const before = (await siteImages()).comprar;
  await owner.page.setInputFiles('#foto-comprar', 'public/images/og-forte.jpg');
  await owner.page.waitForFunction((old) => !document.querySelector('[data-slot=comprar] img').src.includes(old), before, { timeout: 30000 });
  const files = await siteImageFiles();
  assert(files.length === 1 && files[0] === (await siteImages()).comprar, files.join(', '));
});
await check('Fotos do site', 'arquivo falso e espaço inexistente são recusados', async () => {
  assert((await postSiteImage(owner.context, 'comprar', Buffer.from('<html></html>'))).status === 415, 'arquivo falso');
  assert((await postSiteImage(owner.context, 'comprar', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(2000)]))).status === 415, 'imagem corrompida');
  const real = readFileSync('public/images/og-forte.jpg');
  assert((await postSiteImage(owner.context, 'invasao', real)).status === 404, 'espaço inexistente');
  assert((await postSiteImage(owner.context, '__proto__', real)).status === 404, 'espaço __proto__');
});
await check('Fotos do site', 'sem sessão e de outra origem é recusado', async () => {
  const real = readFileSync('public/images/og-forte.jpg');
  assert((await postSiteImage(null, 'comprar', real)).status === 401, 'sem sessão');
  assert((await postSiteImage(owner.context, 'comprar', real, 'https://invasor.example')).status === 403, 'outra origem');
});
await check('Fotos do site', 'abertura trocada substitui o vídeo, no computador e no celular', async () => {
  await owner.page.setInputFiles('#foto-abertura', 'public/images/fachada.jpg');
  await owner.page.locator('[data-slot=abertura] .a-photo-badge', { hasText: 'Foto da loja' }).waitFor({ timeout: 30000 });
  for (const [name, viewport] of [['pc', { width: 1440, height: 900 }], ['celular', { width: 375, height: 812 }]]) {
    const visitor = await newPanelContext(viewport);
    const videos = [];
    visitor.page.on('request', (request) => { if (request.url().includes('hero-scrub')) videos.push(request.url()); });
    await visitor.page.goto(BASE_URL, { waitUntil: 'networkidle' });
    assert((await visitor.page.locator('.hero-track').count()) === 0, `${name}: vídeo continua na página`);
    assert(videos.length === 0, `${name}: baixou o vídeo`);
    assert(await visitor.page.locator('.hero-static h1').isVisible(), `${name}: título invisível`);
    assert((await visitor.page.locator('h1').count()) === 1, `${name}: mais de um h1`);
    const background = await visitor.page.locator('.hero-static-image').evaluate((el) => getComputedStyle(el).backgroundImage);
    assert(background.includes('/site/abertura-'), `${name}: ${background}`);
    assert(await visitor.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: rolagem lateral`);
    await visitor.page.screenshot({ path: join(OUT, `abertura-trocada-${name}.png`) });
    await visitor.context.close();
  }
});
await check('Fotos do site', 'rodapé só avisa de imagem de IA enquanto houver alguma', async () => {
  assert((await publicHtml('/')).html.includes('geradas por inteligência artificial'), 'ainda há fotos originais');
});
await check('Fotos do site', 'voltar à original restaura o site e apaga os arquivos', async () => {
  for (const slot of ['abertura', 'comprar']) {
    await owner.page.locator(`[data-slot=${slot}] button`, { hasText: 'Voltar à original' }).click();
    await owner.page.locator(`[data-slot=${slot}] .a-photo-badge`, { hasText: 'Original' }).waitFor({ timeout: 15000 });
  }
  assert(Object.keys(await siteImages()).length === 0, 'fotos continuam no banco');
  assert((await siteImageFiles()).length === 0, 'arquivos continuam no Storage');
  const { html } = await publicHtml('/');
  assert(html.includes('/images/comprar.webp') && html.includes('hero-track'), 'site não voltou ao original');
});
await check('Fotos do site', 'alteração fica no histórico com nome legível', async () => {
  const rows = await sql(`select actor_email from public.audit_logs where company_id = $1 and action = 'site_settings.update' and after ? 'images'`, [companyA]);
  assert(rows.some((row) => row.actor_email === OWNER.email), 'sem registro');
});
const instagramForm = () => owner.page.locator('.a-card', { hasText: 'Publicações do Instagram' }).locator('form');
await check('Instagram', 'vídeo enviado roda sozinho na moldura, sem cookies de marketing', async () => {
  await owner.page.goto(`${BASE_URL}/admin/configuracoes`);
  await instagramForm().locator('input[name=permalink]').fill('https://www.instagram.com/forteveiculoscachoeiro/reel/TESTE1/?igsh=abc');
  await instagramForm().locator('input[name=video]').setInputFiles('public/hero/hero-scrub.mp4');
  await instagramForm().locator('button').click();
  await owner.page.locator('.a-list-plain li', { hasText: 'reel/TESTE1/' }).waitFor({ timeout: 60000 });
  const [post] = await sql(`select permalink, video_path from public.instagram_posts where company_id = $1`, [companyA]);
  assert(post.permalink === 'https://www.instagram.com/reel/TESTE1/', post.permalink);
  assert(post.video_path.startsWith(`${companyA}/instagram/`), post.video_path);
  assert((await owner.page.locator('.a-list-plain li', { hasText: 'reel/TESTE1/' }).textContent()).includes('Com vídeo'), 'painel não mostrou que tem vídeo');

  const guest = await newPanelContext({ width: 1280, height: 900 });
  const fromInstagram = [];
  guest.page.on('request', (request) => { if (request.url().includes('instagram.com')) fromInstagram.push(request.url()); });
  await guest.page.goto(BASE_URL, { waitUntil: 'load' });
  await guest.page.locator('.ig-frame video').scrollIntoViewIfNeeded();
  await guest.page.waitForFunction(() => { const video = document.querySelector('.ig-frame video'); return video && !video.paused && video.currentTime > 0; }, null, { timeout: 30000 });
  const look = await guest.page.locator('.ig-frame').evaluate((el) => {
    const box = el.getBoundingClientRect();
    return { border: getComputedStyle(el).borderTopWidth, ratio: box.height / box.width, muted: el.querySelector('video').muted, controls: el.querySelector('video').controls };
  });
  assert(look.border === '2px' && look.muted && !look.controls, JSON.stringify(look));
  assert(Math.abs(look.ratio - 16 / 9) < 0.05, `proporção ${look.ratio}`);
  assert(fromInstagram.length === 0, 'carregou algo do Instagram');
  assert((await guest.page.locator('.ig-frame-link').getAttribute('href')) === post.permalink, 'link da publicação');
  await guest.page.locator('.instagram').screenshot({ path: join(OUT, 'instagram-video.png') });
  await guest.context.close();
});
await check('Instagram', 'só com o link, nada carrega do Instagram antes do consentimento', async () => {
  await instagramForm().locator('input[name=permalink]').fill('https://www.instagram.com/reel/TESTE2/');
  await instagramForm().locator('button').click();
  await owner.page.locator('.a-list-plain li', { hasText: 'reel/TESTE2/' }).waitFor({ timeout: 15000 });
  const guest = await newPanelContext({ width: 1280, height: 900 });
  await guest.page.goto(BASE_URL, { waitUntil: 'load' });
  assert((await guest.page.locator('.ig-gate').count()) === 1, 'sem aviso de consentimento');
  assert((await guest.page.locator('.ig-frame iframe').count()) === 0, 'iframe carregou sem consentimento');
  await guest.context.close();
});
await check('Instagram', 'envio de vídeo recusa formato errado, tamanho e quem não está logado', async () => {
  const ask = (body, cookie = '') => fetch(`${BASE_URL}/api/admin/instagram-video`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE_URL, Cookie: cookie }, body: JSON.stringify(body) });
  const cookie = (await owner.context.cookies()).map((item) => `${item.name}=${item.value}`).join('; ');
  assert((await ask({ type: 'video/mp4', size: 1000 })).status === 401, 'sem sessão');
  assert((await ask({ type: 'text/html', size: 1000 }, cookie)).status === 415, 'formato');
  assert((await ask({ type: 'video/mp4', size: 60 * 1024 * 1024 }, cookie)).status === 413, 'tamanho');
});
await check('Instagram', 'caminho de vídeo de outra empresa é recusado, e remover apaga o arquivo', async () => {
  for (const text of ['reel/TESTE2/', 'reel/TESTE1/']) {
    await owner.page.locator('.a-list-plain li', { hasText: text }).locator('button').click();
    await owner.page.locator('.a-list-plain li', { hasText: text }).waitFor({ state: 'detached', timeout: 15000 });
  }
  assert((await sql(`select name from storage.objects where bucket_id = 'site-videos'`)).length === 0, 'arquivo ficou no Storage');
});
await check('Rodapé', 'botão escondido no © leva ao painel', async () => {
  const page = await owner.context.newPage();
  await page.goto(BASE_URL, { waitUntil: 'load' });
  const door = page.locator('.owner-door');
  assert((await door.innerText()).trim() === '©', 'o botão deveria parecer só o símbolo');
  assert((await door.getAttribute('aria-label')) === 'Entrar no painel da loja', 'sem nome acessível');
  await door.click();
  await page.waitForURL('**/admin');
  await page.close();
  const anonymous = await newPanelContext();
  await anonymous.page.goto(BASE_URL, { waitUntil: 'load' });
  await anonymous.page.locator('.owner-door').click();
  await anonymous.page.waitForURL('**/admin/login');
  await anonymous.context.close();
});
await check('Veículos', 'edição salva e reflete no site', async () => {
  await owner.page.goto(`${BASE_URL}/admin/veiculos/${vehicleId}`);
  await owner.page.fill('input[name=color]', 'Grafite');
  await owner.page.click('form.a-form button.a-btn-primary');
  await owner.page.locator('form.a-form .alert-ok').waitFor();
  const { html } = await publicHtml(`/veiculos/${vehicleSlug}`);
  assert(html.includes('Grafite'), 'cor não atualizou');
});
await check('Segurança', 'XSS na descrição não executa e sai escapado', async () => {
  const page = await owner.context.newPage();
  await page.goto(`${BASE_URL}/veiculos/${vehicleSlug}`, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  assert((await page.evaluate(() => window.__xss)) === undefined, 'script injetado executou');
  await page.close();
  const { html } = await publicHtml(`/veiculos/${vehicleSlug}`);
  assert(!html.includes('<script>window.__xss'), 'tag crua no HTML');
  assert(!html.includes('</script><img src=x'), 'JSON-LD não escapou o conteúdo');
});
const rowFor = () => owner.page.locator('tr', { hasText: modelName });
await check('Preço', 'altera o preço direto na lista', async () => {
  await owner.page.goto(`${BASE_URL}/admin/veiculos?q=${encodeURIComponent(modelName)}`);
  await rowFor().locator('.a-price').click();
  await rowFor().locator('input[name=price]').fill('91990');
  await rowFor().locator('.a-price-edit .a-btn-primary').click();
  await rowFor().locator('.a-price').waitFor();
  await owner.page.waitForTimeout(400);
  const { html } = await publicHtml(`/veiculos/${vehicleSlug}`);
  assert(html.includes('R$ 91.990'), 'site não mostra o preço novo');
});
await check('Status', 'reservado aparece marcado no catálogo', async () => {
  await rowFor().locator('select.a-status').selectOption('reserved');
  await owner.page.waitForTimeout(800);
  const { html } = await publicHtml(`/veiculos?q=${encodeURIComponent(modelName)}`);
  assert(html.includes('status-reserved'), 'sem marca de reservado');
});
await check('Status', 'destaque aparece na página inicial', async () => {
  await rowFor().locator('.a-switch input').check();
  await owner.page.waitForTimeout(800);
  const [row] = await sql(`select is_featured from public.vehicles where id = $1`, [vehicleId]);
  assert(row.is_featured, 'destaque não salvou');
});
await check('Status', 'vendido sai do catálogo, sai dos destaques e a página avisa', async () => {
  await rowFor().locator('select.a-status').selectOption('sold');
  await owner.page.waitForTimeout(800);
  const [row] = await sql(`select status, is_featured, sold_at from public.vehicles where id = $1`, [vehicleId]);
  assert(row.status === 'sold' && !row.is_featured && row.sold_at, JSON.stringify(row));
  const list = await publicHtml(`/veiculos?q=${encodeURIComponent(modelName)}`);
  assert(!list.html.includes(`/veiculos/${vehicleSlug}`), 'vendido continua no catálogo');
  const detail = await publicHtml(`/veiculos/${vehicleSlug}`);
  // A frase curta também existe na página 404 embutida no HTML, então a busca precisa ser a do aviso.
  assert(detail.html.includes('Este carro já foi vendido'), 'página não avisa');
});
await check('Status', 'disponível volta ao catálogo', async () => {
  await rowFor().locator('select.a-status').selectOption('available');
  await owner.page.waitForTimeout(800);
  const { html } = await publicHtml(`/veiculos?q=${encodeURIComponent(modelName)}`);
  assert(html.includes(`/veiculos/${vehicleSlug}`), 'não voltou');
});
await check('Status', 'rascunho não aparece para visitantes', async () => {
  await rowFor().locator('select.a-status').selectOption('draft');
  await owner.page.waitForTimeout(800);
  const { status } = await publicHtml(`/veiculos/${vehicleSlug}`);
  assert(status === 404, `status ${status}`);
  await rowFor().locator('select.a-status').selectOption('available');
  await owner.page.waitForTimeout(800);
});
await check('Histórico', 'alterações ficam registradas com autor', async () => {
  const rows = await sql(`select action, actor_email from public.audit_logs where entity_id = $1 order by id`, [vehicleId]);
  assert(rows.some((row) => row.action === 'vehicles.insert' && row.actor_email === OWNER.email), 'sem registro do cadastro');
  assert(rows.some((row) => row.action === 'vehicles.update'), 'sem registro de alteração');
});

// Ofertas e financeiro --------------------------------------------------------------------------

console.log('\nOfertas e financeiro');
await check('Ofertas', 'oferta aparece no cartão, na página, na home e no filtro', async () => {
  await owner.page.goto(`${BASE_URL}/admin/veiculos/${vehicleId}`);
  await owner.page.fill('input[name=offer_price]', '200000');
  await owner.page.click('form.a-form button.a-btn-primary');
  await owner.page.locator('form.a-form .a-field-error', { hasText: 'menor que o preço' }).waitFor();
  await owner.page.fill('input[name=offer_price]', '90000');
  await owner.page.fill('input[name=offer_until]', '2099-12-31');
  await owner.page.fill('input[name=purchase_cost]', '70000');
  await owner.page.click('form.a-form button.a-btn-primary');
  await owner.page.locator('form.a-form .alert-ok').waitFor();
  const home = await publicHtml('/');
  assert(home.html.includes('id="ofertas"') && home.html.includes(vehicleSlug), 'sem seção de ofertas');
  const filtered = await publicHtml('/veiculos?oferta=1');
  assert(filtered.html.includes(vehicleSlug) && !filtered.html.includes('corolla-xei-2023'), 'filtro de ofertas');
  const html = plain((await publicHtml(`/veiculos/${vehicleSlug}`)).html);
  assert(html.includes('R$ 90.000') && html.includes('R$ 91.990') && html.includes('31/12/2099'), 'página sem a oferta');
  assert(html.includes('"price":"90000.00"'), 'dados estruturados sem o preço de oferta');
  assert(!html.includes('70000') && !html.includes('purchase_cost'), 'custo vazou no site');
});
await check('Ofertas', 'oferta vencida volta ao preço normal sozinha', async () => {
  await sql(`update public.vehicles set offer_until = '2020-01-01' where id = $1`, [vehicleId]);
  const html = plain((await publicHtml(`/veiculos/${vehicleSlug}`)).html);
  assert(!html.includes('R$ 90.000') && html.includes('R$ 91.990'), 'oferta vencida ainda aparece');
  assert(!(await publicHtml('/')).html.includes('id="ofertas"'), 'seção de ofertas com oferta vencida');
  await sql(`update public.vehicles set offer_until = null where id = $1`, [vehicleId]);
});
await check('Financeiro', 'confirmar venda tira o carro do site e entra no resultado', async () => {
  await owner.page.goto(`${BASE_URL}/admin?vender=${vehicleId}`);
  assert((await owner.page.inputValue('select[name=vehicle_id]')) === vehicleId, 'carro não veio escolhido');
  assert((await owner.page.inputValue('form#confirmar-venda input[name=amount]')) === '90000', 'valor sugerido devia ser a oferta');
  assert((await owner.page.inputValue('form#confirmar-venda input[name=cost]')) === '70000', 'custo sugerido');
  await owner.page.fill('form#confirmar-venda input[name=amount]', '88000');
  await owner.page.selectOption('form#confirmar-venda select[name=payment_method]', 'financing');
  await owner.page.click('form#confirmar-venda button');
  await owner.page.locator('form#confirmar-venda .alert-ok').waitFor({ timeout: 15000 });
  const [vehicle] = await sql(`select status, offer_price_cents from public.vehicles where id = $1`, [vehicleId]);
  assert(vehicle.status === 'sold' && vehicle.offer_price_cents === null, JSON.stringify(vehicle));
  await owner.page.goto(`${BASE_URL}/admin`);
  const money = plain(await owner.page.locator('.a-tiles-money').textContent());
  assert(money.includes('R$ 88.000') && money.includes('R$ 70.000') && money.includes('R$ 18.000') && money.includes('Lucro'), money);
  const sales = plain(await owner.page.locator('#vendas-do-mes').textContent());
  assert(sales.includes('Financiamento') && sales.includes('R$ 18.000'), sales);
  assert((await publicHtml(`/veiculos/${vehicleSlug}`)).html.includes('Este carro já foi vendido'), 'site não marcou como vendido');
  await owner.page.screenshot({ path: join(OUT, 'dashboard-venda.png'), fullPage: true });
  await owner.page.setViewportSize({ width: 390, height: 844 });
  await owner.page.reload({ waitUntil: 'networkidle' });
  const overflow = await owner.page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  await owner.page.setViewportSize({ width: 1280, height: 900 });
  assert(overflow <= 0, `rolagem lateral no celular: ${overflow}px`);
});
await check('Financeiro', 'despesa entra no resultado, e sair do lançamento devolve', async () => {
  const form = owner.page.locator('#lancamentos form');
  await form.locator('input[name=description]').fill('Lavagem e polimento');
  await form.locator('input[name=amount]').fill('3.000,00');
  await form.locator('button').click();
  await owner.page.locator('#lancamentos tbody tr', { hasText: 'Lavagem e polimento' }).waitFor({ timeout: 15000 });
  assert(plain(await owner.page.locator('.a-tiles-money').textContent()).includes('R$ 15.000'), 'resultado sem a despesa');
  await owner.page.locator('#lancamentos tbody tr', { hasText: 'Lavagem e polimento' }).locator('button').click();
  await owner.page.locator('#lancamentos tbody tr', { hasText: 'Lavagem e polimento' }).waitFor({ state: 'detached', timeout: 15000 });
});
await check('Financeiro', 'gráfico tem legenda, tabela e detalhe ao passar o mouse', async () => {
  await owner.page.goto(`${BASE_URL}/admin`);
  const chart = owner.page.locator('.a-chart');
  assert((await chart.locator('.a-chart-legend').textContent()).includes('Faturamento'), 'sem legenda');
  assert((await chart.locator('table tbody tr').count()) === 6, 'tabela sem os seis meses');
  await chart.locator('.a-chart-month').last().locator('.a-chart-axis').hover();
  await owner.page.waitForTimeout(250);
  const opacity = await chart.locator('.a-chart-month').last().locator('.a-chart-tip').evaluate((el) => getComputedStyle(el).opacity);
  assert(Number(opacity) === 1, `opacidade ${opacity}`);
  assert(await owner.page.evaluate(() => { const s = document.querySelector('.a-chart svg'); return s.getBoundingClientRect().height > 100; }), 'gráfico sem altura');
});
await check('Financeiro', 'desfazer a venda devolve o carro ao estoque', async () => {
  await owner.page.locator('#vendas-do-mes button', { hasText: 'Desfazer' }).click();
  await owner.page.locator('#vendas-do-mes tbody').waitFor({ state: 'detached', timeout: 15000 });
  const [vehicle] = await sql(`select status from public.vehicles where id = $1`, [vehicleId]);
  assert(vehicle.status === 'available', vehicle.status);
  assert((await sql(`select id from public.financial_entries where vehicle_id = $1`, [vehicleId])).length === 0, 'lançamento ficou');
});
await check('Financeiro', 'marcado como vendido na lista fica pendente de confirmar', async () => {
  await sql(`update public.vehicles set status = 'sold' where id = $1`, [vehicleId]);
  await owner.page.goto(`${BASE_URL}/admin`);
  assert((await owner.page.locator('.a-card-head', { hasText: 'Confirmar venda' }).textContent()).includes('1 para confirmar'), 'sem aviso');
  await sql(`update public.vehicles set status = 'available' where id = $1`, [vehicleId]);
});

// Leads -------------------------------------------------------------------------------------

console.log('\nLeads e formulários');
async function fillContact(page, name) {
  // Um parâmetro novo força a recarga: ir só para a mesma âncora manteria a mensagem de sucesso anterior.
  await page.goto(`${BASE_URL}/?t=${Date.now()}#contato`);
  const form = page.locator('#contato form.lead-form');
  await form.locator('input[name=name]').fill(name);
  await form.locator('input[name=phone]').fill('(28) 99999-1234');
  await form.locator('textarea[name=message]').fill('Quero saber do estoque.');
  return form;
}
const visitor = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await visitor.addCookies([CONSENT_REJECTED()]);
const visitorPage = await visitor.newPage();
const leadName = `Cliente ${run}`;

await check('Leads', 'sem aceitar a política, não envia', async () => {
  const form = await fillContact(visitorPage, `${leadName} sem aceite`);
  await visitorPage.waitForTimeout(2700);
  await form.locator('button[type=submit]').click();
  await form.locator('.field-check .field-error').waitFor();
});
await check('Leads', 'robô no campo armadilha recebe sucesso, mas nada é gravado', async () => {
  const form = await fillContact(visitorPage, `${leadName} robo`);
  await form.locator('input[name=consent]').check();
  await form.locator('input[name=empresa_site]').evaluate((node) => {
    node.value = 'http://spam.test';
  });
  await visitorPage.waitForTimeout(2700);
  await form.locator('button[type=submit]').click();
  await visitorPage.locator('#contato .form-success').waitFor();
  const rows = await sql(`select id from public.leads where name = $1`, [`${leadName} robo`]);
  assert(rows.length === 0, 'robô gravou lead');
});
await check('Leads', 'formulário de contato grava o lead', async () => {
  const form = await fillContact(visitorPage, leadName);
  await form.locator('input[name=consent]').check();
  await visitorPage.waitForTimeout(2700);
  await form.locator('button[type=submit]').click();
  await visitorPage.locator('#contato .form-success').waitFor();
  const [row] = await sql(`select phone, consent_version, ip_hash, source_path from public.leads where name = $1`, [leadName]);
  assert(row.phone === '28999991234' && row.consent_version && row.ip_hash, JSON.stringify(row));
  assert(!row.ip_hash.includes('127.0.0.1') && !row.ip_hash.includes('::1'), 'IP original gravado');
});
await check('Leads', 'avaliação de usado grava os dados do carro', async () => {
  await visitorPage.goto(`${BASE_URL}/#avaliacao`);
  const form = visitorPage.locator('#avaliacao form.lead-form');
  await form.locator('input[name=brand]').fill('Fiat');
  await form.locator('input[name=model]').fill('Uno');
  await form.locator('input[name=year]').fill('2018');
  await form.locator('input[name=mileage_km]').fill('80000');
  await form.locator('input[value=trocar]').check();
  await form.locator('input[name=name]').fill(`${leadName} Avaliacao`);
  await form.locator('input[name=phone]').fill('28988887777');
  await form.locator('input[name=consent]').check();
  await visitorPage.waitForTimeout(2700);
  await form.locator('button[type=submit]').click();
  await visitorPage.locator('#avaliacao .form-success').waitFor();
  const [row] = await sql(`select type, evaluation from public.leads where name = $1`, [`${leadName} Avaliacao`]);
  assert(row.type === 'evaluation' && row.evaluation.intent === 'trocar', JSON.stringify(row));
});
await check('Leads', 'interesse no veículo vincula o carro e o WhatsApp leva a mensagem pronta', async () => {
  await visitorPage.goto(`${BASE_URL}/veiculos/${vehicleSlug}`);
  const href = await visitorPage.locator('.vehicle-summary a[href*="wa.me"]').getAttribute('href');
  assert(href.startsWith('https://wa.me/5528999097412?text='), href);
  assert(decodeURIComponent(href).includes(modelName), 'mensagem sem o veículo');
  const form = visitorPage.locator('#interesse form.lead-form');
  await form.locator('input[name=name]').fill(`${leadName} Interesse`);
  await form.locator('input[name=phone]').fill('28977776666');
  await form.locator('input[name=consent]').check();
  await visitorPage.waitForTimeout(2700);
  await form.locator('button[type=submit]').click();
  await visitorPage.locator('#interesse .form-success').waitFor();
  const [row] = await sql(`select vehicle_id, vehicle_label from public.leads where name = $1`, [`${leadName} Interesse`]);
  assert(row.vehicle_id === vehicleId && row.vehicle_label.includes(modelName), JSON.stringify(row));
});
await check('Leads', 'excesso de envios é limitado', async () => {
  let limited = false;
  for (let attempt = 0; attempt < 5 && !limited; attempt += 1) {
    const form = await fillContact(visitorPage, `${leadName} limite ${attempt}`);
    await form.locator('input[name=consent]').check();
    await visitorPage.waitForTimeout(2700);
    await form.locator('button[type=submit]').click();
    await Promise.race([visitorPage.locator('#contato .form-success').waitFor(), visitorPage.locator('#contato .form-error').waitFor()]);
    limited = (await visitorPage.locator('#contato .form-error').count()) > 0;
  }
  assert(limited, 'não limitou');
  await sql('delete from private.rate_limits');
});
await check('Leads', 'proprietário vê, atende e exclui', async () => {
  await owner.page.goto(`${BASE_URL}/admin/leads`);
  const lead = owner.page.locator('details.a-lead').filter({ has: owner.page.getByText(leadName, { exact: true }) });
  const status = async () => (await sql(`select status from public.leads where name = $1`, [leadName]))[0].status;
  assert((await status()) === 'new', 'lead devia chegar como novo');
  await lead.locator('summary').click();
  await lead.locator('.a-lead-status', { hasText: 'Em andamento' }).waitFor();
  await owner.page.waitForTimeout(700);
  assert((await status()) === 'in_progress', 'abrir não pôs em andamento');
  assert((await lead.locator('a[href*="wa.me"]').count()) === 1, 'sem botão de resposta');
  const [popup] = await Promise.all([owner.context.waitForEvent('page'), lead.locator('a[href*="wa.me"]').click()]);
  await popup.close();
  await lead.locator('.a-lead-status', { hasText: 'Atendimento concluído' }).waitFor();
  await owner.page.waitForTimeout(700);
  assert((await status()) === 'answered', 'responder não concluiu');
  await owner.page.reload();
  const reopened = owner.page.locator('details.a-lead').filter({ has: owner.page.getByText(leadName, { exact: true }) });
  await reopened.locator('summary').click();
  await owner.page.waitForTimeout(500);
  assert((await status()) === 'answered', 'abrir de novo mudou a situação');
  const target = owner.page.locator('details.a-lead', { hasText: `${leadName} Avaliacao` }).first();
  await target.locator('summary').click();
  await target.locator('button', { hasText: 'Excluir contato' }).click();
  await owner.page.waitForTimeout(800);
  const removed = await sql(`select id from public.leads where name = $1`, [`${leadName} Avaliacao`]);
  assert(removed.length === 0, 'não excluiu');
});

// 13. Isolamento -----------------------------------------------------------------------------

console.log('\nIsolamento entre empresas');
await check('Isolamento', 'o painel da empresa A não mostra leads da empresa B', async () => {
  await owner.page.goto(`${BASE_URL}/admin/leads?pagina=1`);
  assert(!(await owner.page.content()).includes('Cliente Loja B'), 'lead da empresa B visível');
});
await check('Isolamento', 'não abre veículo de outra empresa no painel', async () => {
  const response = await owner.page.goto(`${BASE_URL}/admin/veiculos/${vehicleB}`);
  assert(response.status() === 404, `status ${response.status()}`);
});
await check('Isolamento', 'não envia foto para veículo de outra empresa', async () => {
  const response = await postPhoto(owner.context, vehicleB, readFileSync('public/images/fachada.jpg'));
  assert(response.status === 404, `status ${response.status}`);
});
await check('Isolamento', 'site público da empresa B mostra só o estoque dela', async () => {
  const host = `loja-b-${run}.test`;
  const list = await publicHtml('/veiculos', { 'x-forwarded-host': host });
  assert(list.html.includes('carro-da-loja-b'), 'estoque de B não apareceu');
  assert(!list.html.includes('corolla-xei-2023'), 'estoque de A vazou para B');
  const direct = await publicHtml('/veiculos/corolla-xei-2023', { 'x-forwarded-host': host });
  assert(direct.status === 404, `veículo de A abriu no domínio de B: ${direct.status}`);
});
await check('Isolamento', 'usuário da empresa B não entra no painel da empresa A', async () => {
  const other = await newPanelContext();
  await submitLogin(other.page, OWNER_B);
  await other.page.locator('.alert-error').waitFor();
  assert(!other.page.url().includes('/admin/mfa'), 'avançou para o MFA');
  await other.context.close();
});

// Master e ciclo de usuários ----------------------------------------------------------------------

console.log('\nUsuários (master)');
const master = await newPanelContext();
const INVITED = { email: `novo-${run}@forte.test`, password: 'senha-do-convidado-2026' };
let invitedLink;
await check('Usuários', 'master entra e vê Usuários e Ajustes técnicos', async () => {
  await fullLogin(master.page, MASTER);
  assert((await master.page.locator('.a-side nav a[href="/admin/usuarios"]').count()) === 1, 'sem link');
  await master.page.goto(`${BASE_URL}/admin/tecnico`);
  await master.page.locator('input[name=ga4_id]').waitFor();
});
await check('Usuários', 'ajustes técnicos validam o formato', async () => {
  await master.page.fill('input[name=ga4_id]', 'errado');
  await master.page.click('form.a-form button.a-btn-primary');
  await master.page.locator('.a-field-error').first().waitFor();
});
const emailTo = async (address) => {
  const list = await (await fetch(`${EMULATOR}/__qa/emails`)).json();
  return list.filter((email) => email.to[0] === address).at(-1);
};
const linkIn = (email) => email.text.match(/https?:\/\/\S+/)[0];
await check('Usuários', 'master vê o Histórico', async () => {
  await master.page.goto(`${BASE_URL}/admin/historico`);
  assert((await master.page.locator('.a-table tbody tr').count()) > 0, 'tela vazia');
  assert((await master.page.locator('main').innerText()).includes('Mudou: fotos do site'), 'histórico sem o nome legível');
});
await check('Usuários', 'criar acesso envia o e-mail na hora, sem mostrar o link', async () => {
  await master.page.goto(`${BASE_URL}/admin/usuarios`);
  await master.page.fill('input[name=full_name]', 'Pessoa <b>Convidada</b>');
  await master.page.fill('input[name=email]', INVITED.email);
  await master.page.click('form.a-form button.a-btn-primary');
  await master.page.locator('form.a-form ~ .alert-ok', { hasText: INVITED.email }).waitFor();
  assert((await master.page.locator('.a-access-link input').count()) === 0, 'link não devia aparecer');
  const email = await emailTo(INVITED.email);
  assert(email, 'e-mail não enviado');
  assert(email.subject.includes('Seu acesso ao painel'), email.subject);
  assert(email.from.includes('Forte Veículos') && email.from.includes('@forteveiculoscachoeiro.com.br'), email.from);
  assert(email.html.includes('&lt;b&gt;') && !email.html.includes('<b>Convidada'), 'nome sem escape no HTML');
  invitedLink = linkIn(email);
  assert(invitedLink.includes('/auth/callback?token_hash='), invitedLink);
});
await check('Usuários', 'se o e-mail falhar, o acesso é criado e o link aparece para enviar à mão', async () => {
  const address = `falha-email-${run}@forte.test`;
  await master.page.goto(`${BASE_URL}/admin/usuarios`);
  await master.page.fill('input[name=full_name]', 'Pessoa Sem Email');
  await master.page.fill('input[name=email]', address);
  await master.page.click('form.a-form button.a-btn-primary');
  await master.page.locator('.a-access-link input').waitFor();
  assert((await master.page.locator('form.a-form ~ .alert').textContent()).includes('não foi enviado'), 'sem aviso da falha');
  assert((await master.page.locator('.a-access-link input').inputValue()).includes('token_hash='), 'sem link');
  await sql(`delete from public.company_members where user_id in (select id from public.profiles where email = $1)`, [address]);
});
const invited = await newPanelContext();
await check('Senha', 'link abre a criação de senha, com política de senha forte', async () => {
  await invited.page.goto(invitedLink);
  await invited.page.waitForURL('**/admin/nova-senha');
  await invited.page.fill('input[name=password]', 'curta');
  await invited.page.fill('input[name=confirm]', 'curta');
  await invited.page.evaluate(() => document.querySelector('form.auth-form').setAttribute('novalidate', ''));
  await invited.page.click('form.auth-form button');
  await invited.page.locator('.alert-error').waitFor();
});
await check('Senha', 'nova senha leva ao cadastro do MFA e ao painel', async () => {
  await invited.page.fill('input[name=password]', INVITED.password);
  await invited.page.fill('input[name=confirm]', INVITED.password);
  await invited.page.click('form.auth-form button');
  await invited.page.waitForURL('**/admin/mfa');
  await invited.page.locator('.mfa-secret code').waitFor({ state: 'attached' });
  INVITED.secret = (await invited.page.locator('.mfa-secret code').textContent()).trim();
  await invited.page.fill('input[name=code]', totp(INVITED.secret));
  await invited.page.click('form.auth-form button.a-btn-primary');
  await invited.page.waitForURL(/\/admin$/);
});
await check('Senha', 'o mesmo link não funciona duas vezes', async () => {
  const again = await newPanelContext();
  await again.page.goto(invitedLink);
  await again.page.waitForURL('**/admin/login?erro=link-invalido');
  await again.context.close();
});
await check('Senha', 'recuperar senha responde igual para qualquer e-mail', async () => {
  const page = await visitor.newPage();
  await page.goto(`${BASE_URL}/admin/recuperar-senha`);
  await page.fill('input[name=email]', `nao-existe-${run}@forte.test`);
  await page.click('form.auth-form button');
  await page.locator('.alert-ok').waitFor();
  await page.close();
});
await check('Senha', 'esqueci minha senha chega por e-mail e o link abre em outro navegador', async () => {
  const page = await visitor.newPage();
  await page.goto(`${BASE_URL}/admin/recuperar-senha`);
  assert(!(await page.locator('main').innerText()).includes('neste mesmo navegador'), 'aviso antigo continua');
  await page.fill('input[name=email]', INVITED.email);
  await page.click('form.auth-form button');
  await page.locator('.alert-ok').waitFor();
  await page.close();
  const message = await emailTo(INVITED.email);
  assert(message?.subject.includes('Nova senha'), 'e-mail de nova senha não saiu');
  const elsewhere = await newPanelContext();
  await elsewhere.page.goto(linkIn(message));
  await elsewhere.page.waitForURL('**/admin/nova-senha');
  await elsewhere.context.close();
});
await check('Senha', 'link de recuperação exige o código do MFA antes de trocar a senha', async () => {
  const card = master.page.locator('.a-member', { hasText: INVITED.email });
  await master.page.goto(`${BASE_URL}/admin/usuarios`);
  await card.locator('button', { hasText: 'Link para nova senha' }).click();
  await card.locator('.alert-ok', { hasText: INVITED.email }).waitFor();
  const message = await emailTo(INVITED.email);
  assert(message.subject.includes('Nova senha'), message.subject);
  const link = linkIn(message);
  const recovery = await newPanelContext();
  await recovery.page.goto(link);
  await recovery.page.waitForURL('**/admin/nova-senha');
  await recovery.page.locator('input[name=code]').waitFor();
  INVITED.password = 'senha-trocada-do-convidado-2026';
  await recovery.page.fill('input[name=password]', INVITED.password);
  await recovery.page.fill('input[name=confirm]', INVITED.password);
  await recovery.page.fill('input[name=code]', totp(INVITED.secret));
  await recovery.page.click('form.auth-form button');
  await recovery.page.waitForURL(/\/admin(\/mfa)?$/);
  await recovery.context.close();
});
await check('Sessões', 'desativar usuário derruba o acesso na hora', async () => {
  const session = await newPanelContext();
  await fullLogin(session.page, INVITED);
  const card = master.page.locator('.a-member', { hasText: INVITED.email });
  await master.page.goto(`${BASE_URL}/admin/usuarios`);
  await card.locator('button', { hasText: 'Desativar' }).click();
  await card.locator('button', { hasText: 'Reativar' }).waitFor();
  await session.page.goto(`${BASE_URL}/admin/veiculos`);
  await session.page.waitForURL(/\/admin\/login/);
  await session.context.close();
});
await check('Usuários', 'não remove o último master', async () => {
  const card = master.page.locator('.a-member', { hasText: MASTER.email });
  await card.locator('button', { hasText: 'Remover' }).click();
  await card.locator('.alert-error').waitFor();
  const rows = await sql(`select is_active from public.company_members where company_id = $1 and role = 'master'`, [companyA]);
  assert(rows.length >= 1 && rows.some((row) => row.is_active), 'perdeu o master');
});
await check('Usuários', 'redefinir MFA obriga novo cadastro', async () => {
  const card = master.page.locator('.a-member', { hasText: INVITED.email });
  await card.locator('button', { hasText: 'Redefinir MFA' }).click();
  await card.locator('.alert-ok').waitFor();
});

// Configurações ----------------------------------------------------------------------------------

console.log('\nConfigurações');
await check('Configurações', 'proprietário altera dados comerciais e o site atualiza', async () => {
  await owner.page.goto(`${BASE_URL}/admin/configuracoes`);
  await owner.page.fill('input[name=phone_display]', '(28) 99909-7412 ramal 2');
  await owner.page.click('form.a-form button.a-btn-primary');
  await owner.page.locator('form.a-form .alert-ok').first().waitFor();
  const { html } = await publicHtml('/');
  assert(html.includes('ramal 2'), 'site não atualizou');
  await owner.page.fill('input[name=phone_display]', '(28) 99909-7412');
  await owner.page.click('form.a-form button.a-btn-primary');
  await owner.page.waitForTimeout(600);
});

// 14. Cookies ---------------------------------------------------------------------------------------

console.log('\nCookies e LGPD');
await sql(`update public.technical_settings set ga4_id = 'G-TESTE12345', meta_pixel_id = '123456789' where company_id = $1`, [companyA]);

async function consentPage() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const trackers = [];
  await page.route(/googletagmanager|google-analytics|connect\.facebook|facebook\.com\/tr|instagram\.com/, (route) => {
    trackers.push(route.request().url());
    return route.abort();
  });
  return { context, page, trackers };
}
await check('Cookies', 'primeira visita: banner aberto e nenhum rastreador', async () => {
  const { context, page, trackers } = await consentPage();
  await page.goto(BASE_URL, { waitUntil: 'load' });
  await page.locator('.consent').waitFor();
  await page.waitForTimeout(800);
  assert(trackers.length === 0, `carregou ${trackers[0]}`);
  const names = (await context.cookies()).map((cookie) => cookie.name);
  assert(!names.some((name) => /^_ga|^_fb/.test(name)), names.join());
  for (const label of ['Aceitar todos', 'Rejeitar não essenciais', 'Personalizar']) {
    assert((await page.locator('.consent button', { hasText: label }).count()) === 1, `sem botão ${label}`);
  }
  await context.close();
});
await check('Cookies', 'rejeitar: nada carrega, decisão registrada e banner some', async () => {
  const { context, page, trackers } = await consentPage();
  await page.goto(BASE_URL, { waitUntil: 'load' });
  await page.locator('.consent button', { hasText: 'Rejeitar' }).click();
  await page.locator('.consent').waitFor({ state: 'detached' });
  await page.waitForTimeout(800);
  assert(trackers.length === 0, 'rastreador carregou');
  const consent = (await context.cookies()).find((cookie) => cookie.name === 'fv_consent');
  const state = JSON.parse(decodeURIComponent(consent.value));
  assert(!state.analytics && !state.marketing, 'estado errado');
  const rows = await sql(`select action from public.cookie_consents where subject_id = $1`, [state.id]);
  assert(rows[0]?.action === 'reject_all', JSON.stringify(rows));
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(500);
  assert((await page.locator('.consent').count()) === 0, 'banner voltou');
  assert(trackers.length === 0, 'carregou depois de recarregar');
  await context.close();
});
await check('Cookies', 'personalizar: só analíticos ativa só o GA', async () => {
  const { context, page, trackers } = await consentPage();
  await page.goto(BASE_URL, { waitUntil: 'load' });
  await page.locator('.consent button', { hasText: 'Personalizar' }).click();
  const options = page.locator('.consent-option input');
  assert(await options.nth(0).isDisabled(), 'necessários deveria estar travado');
  assert(!(await options.nth(1).isChecked()) && !(await options.nth(2).isChecked()), 'veio marcado');
  await options.nth(1).check();
  await page.locator('.consent button', { hasText: 'Salvar escolhas' }).click();
  await page.waitForTimeout(800);
  assert(trackers.some((url) => url.includes('googletagmanager')), 'GA não carregou');
  assert(!trackers.some((url) => url.includes('facebook')), 'Pixel carregou sem consentimento');
  await context.close();
});
await check('Cookies', 'aceitar todos e depois revogar pelo rodapé', async () => {
  const { context, page, trackers } = await consentPage();
  await page.goto(BASE_URL, { waitUntil: 'load' });
  await page.locator('.consent button', { hasText: 'Aceitar todos' }).click();
  await page.waitForTimeout(800);
  assert(trackers.some((url) => url.includes('googletagmanager')) && trackers.some((url) => url.includes('facebook')), 'rastreadores não carregaram');
  await context.addCookies([{ name: '_ga', value: 'GA1.1.123', url: BASE_URL }]);
  await page.locator('.site-footer button', { hasText: 'Preferências de cookies' }).click();
  await page.locator('.consent-option input').nth(1).uncheck();
  await page.locator('.consent-option input').nth(2).uncheck();
  await page.locator('.consent button', { hasText: 'Salvar escolhas' }).click();
  await page.waitForLoadState('load');
  await page.waitForTimeout(800);
  const names = (await context.cookies()).map((cookie) => cookie.name);
  assert(!names.includes('_ga'), 'cookie _ga continuou');
  const state = JSON.parse(decodeURIComponent((await context.cookies()).find((cookie) => cookie.name === 'fv_consent').value));
  const rows = await sql(`select action from public.cookie_consents where subject_id = $1 order by id`, [state.id]);
  assert(rows.at(-1).action === 'revoke', JSON.stringify(rows));
  await context.close();
});
await check('Cookies', 'mapa do Google só carrega depois do clique', async () => {
  const { context, page } = await consentPage();
  await context.addCookies([CONSENT_REJECTED()]);
  await page.goto(`${BASE_URL}/#localizacao`, { waitUntil: 'load' });
  assert((await page.locator('iframe.map-frame').count()) === 0, 'mapa carregou sozinho');
  await page.locator('button', { hasText: 'Mostrar mapa' }).click();
  await page.locator('iframe.map-frame').waitFor({ state: 'attached' });
  await context.close();
});
await sql(`update public.technical_settings set ga4_id = null, meta_pixel_id = null where company_id = $1`, [companyA]);
await check('LGPD', 'políticas de privacidade e cookies publicadas', async () => {
  const privacy = await publicHtml('/politica-de-privacidade');
  assert(privacy.status === 200 && privacy.html.includes('art. 18'), 'privacidade');
  const cookies = await publicHtml('/politica-de-cookies');
  assert(cookies.status === 200 && cookies.html.includes('fv_consent'), 'cookies');
});

// 16. Segurança --------------------------------------------------------------------------------------

console.log('\nSegurança');
await check('Segurança', 'cabeçalhos: CSP com nonce, HSTS, nosniff e bloqueio de iframe', async () => {
  const { headers, html } = await publicHtml('/');
  const csp = headers.get('content-security-policy');
  const nonce = csp?.match(/'nonce-([^']+)'/)?.[1];
  assert(nonce, 'CSP sem nonce');
  assert(html.includes(`nonce="${nonce}"`), 'scripts sem o nonce da resposta');
  assert(csp.includes("frame-ancestors 'none'") && csp.includes("object-src 'none'"), csp);
  assert(headers.get('strict-transport-security')?.includes('max-age'), 'sem HSTS');
  assert(headers.get('x-content-type-options') === 'nosniff', 'sem nosniff');
  assert(headers.get('x-frame-options') === 'DENY', 'sem X-Frame-Options');
  assert(!headers.get('x-powered-by'), 'expõe x-powered-by');
});
await check('Segurança', 'CSP bloqueia script injetado no HTML, como numa falha de XSS', async () => {
  const page = await owner.context.newPage();
  const violations = [];
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) violations.push(message.text());
  });
  await page.route(`${BASE_URL}/politica-de-cookies`, async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace('</body>', '<script>window.__inline = 1</script><script src="https://site-malicioso.test/x.js"></script></body>');
    await route.fulfill({ response, body });
  });
  await page.goto(`${BASE_URL}/politica-de-cookies`, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  assert((await page.evaluate(() => window.__inline)) === undefined, 'script inline executou');
  assert(violations.length >= 2, `${violations.length} violações registradas`);
  await page.close();
});
await check('Segurança', 'CSRF: API recusa outra origem', async () => {
  const cookie = (await owner.context.cookies()).map((item) => `${item.name}=${item.value}`).join('; ');
  const form = new FormData();
  form.append('file', new Blob([readFileSync('public/images/fachada.jpg')], { type: 'image/jpeg' }), 'a.jpg');
  const evil = await fetch(`${BASE_URL}/api/admin/vehicles/${vehicleId}/photos`, { method: 'POST', body: form, headers: { Cookie: cookie, Origin: 'https://site-malicioso.test' } });
  assert(evil.status === 403, `upload ${evil.status}`);
  const consent = await fetch(`${BASE_URL}/api/consent`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://site-malicioso.test' }, body: '{}' });
  assert(consent.status === 403, `consent ${consent.status}`);
});
await check('Segurança', 'CSRF: Server Action recusa outra origem', async () => {
  const cookie = (await owner.context.cookies()).map((item) => `${item.name}=${item.value}`).join('; ');
  const response = await fetch(`${BASE_URL}/admin/veiculos`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: 'https://site-malicioso.test', 'Next-Action': '0'.repeat(40), 'Content-Type': 'text/plain;charset=UTF-8' },
    body: '[]',
    redirect: 'manual',
  });
  assert(response.status >= 400 && response.status !== 200, `status ${response.status}`);
});
await check('Segurança', 'injeção de SQL na busca não altera o resultado', async () => {
  for (const attack of [`' OR '1'='1`, `'; DROP TABLE vehicles; --`, `%' OR 1=1 --`, `)(or=status.eq.draft`]) {
    const { status, html } = await publicHtml(`/veiculos?q=${encodeURIComponent(attack)}`);
    assert(status === 200, `status ${status}`);
    assert(html.includes('0 carros encontrados'), `resultado inesperado para ${attack}`);
  }
  const [{ total }] = await sql('select count(*)::int as total from public.vehicles');
  assert(total > 0, 'tabela sumiu');
});
await check('Segurança', 'curinga % na busca não lista o estoque inteiro', async () => {
  const { html } = await publicHtml(`/veiculos?q=${encodeURIComponent('%')}`);
  assert(html.includes('0 carros encontrados'), 'curinga não foi escapado');
});
await check('Segurança', 'parâmetros inválidos na URL são ignorados', async () => {
  const { status } = await publicHtml('/veiculos?categoria=xxx&ano_min=abc&pagina=-5&ordem=drop');
  assert(status === 200, `status ${status}`);
});
await check('Segurança', 'redirecionamento aberto é bloqueado no callback', async () => {
  const { status, headers } = await publicHtml('/auth/callback?next=https://site-malicioso.test');
  assert(status === 307 && !headers.get('location').includes('malicioso'), headers.get('location'));
});
await check('Segurança', 'nenhuma chave secreta no JavaScript entregue ao navegador', async () => {
  const secrets = ['emulador-service-key', 'emulador-anon-key', 'segredo-somente-para-teste-local', 'SUPABASE_SERVICE_ROLE', 'IP_HASH_SECRET'];
  const page = await owner.context.newPage();
  const bodies = [];
  page.on('response', async (response) => {
    if (/\.(js|css)(\?|$)/.test(response.url()) || response.url().endsWith('/')) bodies.push(await response.text().catch(() => ''));
  });
  await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });
  bodies.push(await page.content());
  await page.close();
  for (const secret of secrets) {
    assert(!bodies.some((body) => body.includes(secret)), `vazou ${secret}`);
  }
});
await check('SEO', 'endereços do site antigo redirecionam para os novos', async () => {
  const vehicle = await publicHtml('/corolla-xei-2023');
  assert(vehicle.status === 308 && vehicle.headers.get('location') === '/veiculos/corolla-xei-2023', `${vehicle.status} ${vehicle.headers.get('location')}`);
  const about = await publicHtml('/nos.php');
  assert(about.status === 308, `nos.php ${about.status}`);
  const missing = await publicHtml('/endereco-que-nao-existe');
  assert(missing.status === 404, `inexistente ${missing.status}`);
});
await check('SEO', 'metadados, dados estruturados e endereço amigável por veículo', async () => {
  const { html } = await publicHtml('/veiculos/corolla-xei-2023');
  assert(/<title>[^<]*Corolla[^<]*Cachoeiro de Itapemirim/.test(html), 'título sem modelo e cidade');
  assert(html.includes('rel="canonical"') && html.includes('/veiculos/corolla-xei-2023'), 'sem canonical');
  assert(html.includes('property="og:image"'), 'sem og:image');
  assert(html.includes('"@type":"Car"') && html.includes('"priceCurrency":"BRL"'), 'sem JSON-LD do veículo');
  const home = await publicHtml('/');
  assert(home.html.includes('"@type":"AutoDealer"'), 'sem JSON-LD da loja');
  assert(/<title>[^<]*Seminovos em Cachoeiro de Itapemirim/.test(home.html), 'título da home');
});
await check('Segurança', 'sitemap e robots não expõem o painel', async () => {
  const robots = await publicHtml('/robots.txt');
  assert(robots.html.includes('Disallow: /admin'), 'robots');
  const sitemap = await publicHtml('/sitemap.xml');
  assert(sitemap.html.includes('/veiculos/') && !sitemap.html.includes('/admin'), 'sitemap');
});

// 7. Exclusão, 2. logout e sessão -----------------------------------------------------------------------

console.log('\nExclusão e saída');
await check('Veículos', 'excluir remove registro, fotos e página pública', async () => {
  await owner.page.goto(`${BASE_URL}/admin/veiculos?q=${encodeURIComponent(modelName)}`);
  await rowFor().locator('button', { hasText: 'Excluir' }).click();
  await rowFor().waitFor({ state: 'detached' });
  const rows = await sql(`select id from public.vehicles where id = $1`, [vehicleId]);
  assert(rows.length === 0, 'registro continuou');
  const objects = await sql(`select name from storage.objects where name like $1`, [`%${vehicleId}%`]);
  assert(objects.length === 0, `${objects.length} arquivos órfãos`);
  const { status } = await publicHtml(`/veiculos/${vehicleSlug}`);
  assert(status === 404, `status ${status}`);
});
const stolenCookies = await owner.context.cookies();
await check('Sessões', 'sair volta ao login e fecha o painel', async () => {
  await owner.page.goto(`${BASE_URL}/admin`);
  await owner.page.locator('.a-side-button').click();
  await owner.page.waitForURL('**/admin/login');
  await owner.page.goto(`${BASE_URL}/admin/veiculos`);
  await owner.page.waitForURL('**/admin/login');
});
await check('Sessões', 'cookie antigo não reabre a sessão depois de sair', async () => {
  const context = await browser.newContext();
  await context.addCookies(stolenCookies);
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/admin`);
  await page.waitForURL('**/admin/login**');
  await context.close();
});

// Capturas do painel para revisão ---------------------------------------------------------------------

const shots = await newPanelContext();
await fullLogin(shots.page, MASTER).catch(() => undefined);
for (const [name, path] of [['dashboard', '/admin'], ['veiculos', '/admin/veiculos'], ['leads', '/admin/leads'], ['configuracoes', '/admin/configuracoes'], ['usuarios', '/admin/usuarios'], ['historico', '/admin/historico']]) {
  await shots.page.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle' });
  await shots.page.screenshot({ path: join(OUT, `admin-${name}-1280.png`), fullPage: true });
}
const [firstVehicle] = await sql(`select id from public.vehicles where company_id = $1 and slug = 'pajero-sport-2024'`, [companyA]);
await shots.page.goto(`${BASE_URL}/admin/veiculos/${firstVehicle.id}`, { waitUntil: 'networkidle' });
await shots.page.screenshot({ path: join(OUT, 'admin-editar-1280.png'), fullPage: true });
await shots.page.setViewportSize({ width: 390, height: 844 });
for (const [name, path] of [['dashboard', '/admin'], ['veiculos', '/admin/veiculos'], ['leads', '/admin/leads']]) {
  await shots.page.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle' });
  const overflow = await shots.page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  await check('Responsivo', `painel em 390px sem rolagem lateral: ${name}`, async () => assert(overflow <= 0, `${overflow}px`));
  await shots.page.screenshot({ path: join(OUT, `admin-${name}-390.png`), fullPage: true });
}

await browser.close();

const failed = results.filter((item) => !item.ok);
writeFileSync(join(OUT, 'resultado.json'), JSON.stringify({ total: results.length, failed: failed.length, results }, null, 1));
console.log(`\n${results.length - failed.length} de ${results.length} verificações passaram.`);
if (failed.length) {
  for (const item of failed) console.log(`FALHA [${item.group}] ${item.name}: ${item.error}`);
  process.exitCode = 1;
}
void readdirSync;
void statSync;
