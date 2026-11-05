import type { VehicleCategory, VehicleFuel, VehicleTransmission } from './types';

// A tabela FIPE escreve nomes de um jeito próprio. Aqui eles viram os nomes usados no site e nos filtros.
const BRAND_NAMES: Record<string, string> = {
  'gm - chevrolet': 'Chevrolet',
  'vw - volkswagen': 'Volkswagen',
  'kia motors': 'Kia',
  'caoa chery/chery': 'Chery',
  ssangyong: 'SsangYong',
  mclaren: 'McLaren',
  smart: 'Smart',
  vw: 'Volkswagen',
  gm: 'Chevrolet',
  citroen: 'Citroën',
  'mercedes benz': 'Mercedes-Benz',
  'm.benz': 'Mercedes-Benz',
};
const KEEP_UPPERCASE = new Set(['BMW', 'BYD', 'GAC', 'GWM', 'JAC', 'JPX', 'MG', 'MINI', 'RAM', 'TAC', 'BRM', 'DFSK']);

const titleCase = (text: string) =>
  text.toLowerCase().replace(/(^|[\s/-])(\p{L})/gu, (_, start: string, letter: string) => `${start}${letter.toUpperCase()}`);

export function brandDisplayName(raw: string): string {
  // Registros de importados vêm como "I/KIA".
  const name = raw.trim().replace(/^I\//i, '');
  const known = BRAND_NAMES[name.toLowerCase()];
  if (known) return known;
  if (KEEP_UPPERCASE.has(name) || name !== name.toUpperCase()) return name;
  return titleCase(name);
}

// Modelos de duas palavras, como Grand Siena e Land Cruiser. O resto do nome é a versão.
const TWO_WORD_MODELS = new Set(['grand', 'gran', 'new', 'novo', 'nova', 'land', 'range', 'santa', 'town', 'serie', 'série', 'classe', 'model']);

export function splitModelName(fullName: string): { model: string; version: string } {
  const words = fullName.trim().split(/\s+/);
  const size = words.length > 1 && TWO_WORD_MODELS.has(words[0].toLowerCase()) && /^\p{L}/u.test(words[1]) ? 2 : 1;
  const first = words.slice(0, size).join(' ').replace(/[/,]+$/, '');
  const model = first.length > 3 && /^[\p{Lu} ]+$/u.test(first) ? titleCase(first) : first;
  return { model, version: words.slice(size).join(' ') };
}

export type FipeModelOption = { code: string; version: string };

// Agrupa os nomes completos da FIPE por modelo, para a escolha acontecer em dois passos.
export function groupFipeModels(models: { code: string; name: string }[]): Map<string, FipeModelOption[]> {
  const groups = new Map<string, FipeModelOption[]>();
  const display = new Map<string, string>();
  for (const { code, name } of models) {
    const { model, version } = splitModelName(name);
    const key = model.toLowerCase();
    if (!display.has(key)) display.set(key, model);
    const label = display.get(key)!;
    groups.set(label, [...(groups.get(label) ?? []), { code, version }]);
  }
  return new Map([...groups].sort(([a], [b]) => a.localeCompare(b, 'pt-BR', { numeric: true })));
}

export function fuelFromText(...texts: (string | null | undefined)[]): VehicleFuel | null {
  const text = texts.filter(Boolean).join(' ').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  if (!text) return null;
  if (/flex|alcool\s*\/\s*gasolina|gasolina\s*\/\s*alcool/.test(text)) return 'flex';
  if (/hibrid/.test(text)) return 'hybrid';
  if (/eletric/.test(text)) return 'electric';
  if (/diesel/.test(text)) return 'diesel';
  if (/alcool|etanol/.test(text)) return 'ethanol';
  if (/gasolina/.test(text)) return 'gasoline';
  return null;
}

export function transmissionFromText(text: string | null | undefined): VehicleTransmission | null {
  if (!text) return null;
  if (/\bcvt\b/i.test(text)) return 'cvt';
  if (/dualogic|easytronic|i-motion|automatizad/i.test(text)) return 'automated';
  if (/\baut\b|autom[aá]tic|tiptronic/i.test(text)) return 'automatic';
  if (/\bmec\b|manual/i.test(text)) return 'manual';
  return null;
}

export function categoryFromSegment(segment: string | null | undefined): VehicleCategory | null {
  if (!segment) return null;
  if (/hatch/i.test(segment)) return 'hatch';
  if (/sedan/i.test(segment)) return 'sedan';
  if (/picape|pick-?up/i.test(segment)) return 'pickup';
  if (/suv|utilit/i.test(segment)) return 'suv';
  return null;
}

// "R$ 28.799,00" vira 2879900.
export function brlTextToCents(text: string | null | undefined): number | null {
  const digits = text?.replace(/\D/g, '');
  return digits ? Number(digits) : null;
}

export type PastedVehicle = {
  brand: string;
  model: string;
  version: string;
  year: number | null;
  color: string | null;
  fuel: VehicleFuel | null;
  transmission: VehicleTransmission | null;
  fipe: { code: string; priceCents: number | null; reference: string | null } | null;
  fipeOptions: number;
};

// Lê o texto que a pessoa copiou da página do Placa FIPE. O site é grátis para quem usa o navegador,
// mas não tem API e recusa consultas de servidor, então a consulta acontece na aba da própria pessoa.
export function parsePlacaFipeText(text: string): PastedVehicle | null {
  const field = (label: string) => text.match(new RegExp(`^[ \\t]*${label}:[ \\t]*(.+)$`, 'im'))?.[1]?.trim() ?? null;
  const brand = field('Marca');
  if (!brand) return null;

  const rows = [...text.matchAll(/([0-9]{6}-[0-9])\s+([^\n\t]+?)\s+(R\$\s*[0-9.,]+)/g)];
  const fullName = rows[0]?.[2] ?? null;
  const fromTable = fullName ? splitModelName(fullName) : null;
  const generic = field('Genérico') ?? field('Modelo') ?? '';

  return {
    brand: brandDisplayName(brand),
    model: fromTable?.model ?? splitModelName(generic).model,
    version: fromTable?.version ?? '',
    year: Number(field('Ano Modelo') ?? field('Ano')) || null,
    color: field('Cor'),
    fuel: fuelFromText(field('Combustível'), fullName),
    transmission: transmissionFromText(fullName),
    fipe: rows[0]
      ? {
          code: rows[0][1],
          priceCents: brlTextToCents(rows[0][3]),
          reference: text.match(/Tabela FIPE de ([\p{L}]+ [0-9]{4})/u)?.[1] ?? null,
        }
      : null,
    fipeOptions: rows.length,
  };
}

