import 'server-only';
import { brandDisplayName, brlTextToCents, fuelFromText } from '@/lib/fipe-names';
import { CURRENT_YEAR } from '@/lib/validation';

const WEEK = 7 * 24 * 60 * 60;
const DAY = 24 * 60 * 60;
const ZERO_KM_YEAR = '32000';

const base = () => (process.env.FIPE_API_BASE ?? 'https://parallelum.com.br/fipe/api/v1').replace(/\/$/, '');

// O serviço gratuito limita as consultas por dia. Com o cache, cada lista é buscada poucas vezes.
async function get<T>(path: string, revalidate: number): Promise<T | null> {
  try {
    const response = await fetch(`${base()}/carros${path}`, { next: { revalidate }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      console.error('Tabela FIPE respondeu com erro', response.status);
      return null;
    }
    return (await response.json()) as T;
  } catch {
    console.error('Tabela FIPE indisponível');
    return null;
  }
}

type CodeName = { codigo: string | number; nome: string };

export async function listFipeBrands() {
  const data = await get<CodeName[]>('/marcas', WEEK);
  return data?.map((brand) => ({ code: String(brand.codigo), name: brandDisplayName(brand.nome) })) ?? null;
}

export async function listFipeModels(brand: string) {
  const data = await get<{ modelos: CodeName[] }>(`/marcas/${brand}/modelos`, WEEK);
  return data?.modelos.map((model) => ({ code: String(model.codigo), name: model.nome })) ?? null;
}

export async function listFipeYears(brand: string, model: string) {
  const data = await get<CodeName[]>(`/marcas/${brand}/modelos/${model}/anos`, WEEK);
  return (
    data?.map((year) => {
      const [number, ...fuel] = year.nome.split(' ');
      const zeroKm = number === ZERO_KM_YEAR;
      return {
        code: String(year.codigo),
        year: zeroKm ? CURRENT_YEAR : Number(number),
        label: zeroKm ? `Zero km ${fuel.join(' ')}`.trim() : year.nome,
      };
    }) ?? null
  );
}

export async function getFipePrice(brand: string, model: string, year: string) {
  const data = await get<{ Valor: string; CodigoFipe: string; MesReferencia: string; Combustivel: string }>(
    `/marcas/${brand}/modelos/${model}/anos/${year}`,
    DAY,
  );
  if (!data) return null;
  return {
    code: data.CodigoFipe,
    priceCents: brlTextToCents(data.Valor),
    reference: data.MesReferencia.trim(),
    fuel: fuelFromText(data.Combustivel),
  };
}
