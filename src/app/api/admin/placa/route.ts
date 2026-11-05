import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AdminAccessError, requireAdminAction } from '@/lib/auth/guards';
import { env } from '@/lib/env';
import { brandDisplayName, brlTextToCents, categoryFromSegment, fuelFromText, splitModelName, transmissionFromText } from '@/lib/fipe-names';
import { isSameOrigin, isWithinRateLimit } from '@/lib/request';

const fail = (status: number, message: string) => NextResponse.json({ message }, { status });

const plateSchema = z
  .string()
  .transform((value) => value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
  .refine((value) => /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(value));

const PROVIDER_ERRORS: Record<number, [number, string]> = {
  401: [400, 'Confira a placa. Use o formato ABC1D23 ou ABC1234.'],
  402: [503, 'A consulta por placa está sem autorização. Avise o administrador.'],
  406: [404, 'Nenhum veículo encontrado com esta placa.'],
  429: [503, 'Acabaram as consultas contratadas. Avise o administrador.'],
};

type ProviderFipe = { codigo_fipe?: string; mes_referencia?: string; score?: number; texto_marca?: string; texto_modelo?: string; texto_valor?: string; combustivel?: string };
type ProviderResponse = {
  MARCA?: string;
  marca?: string;
  MODELO?: string;
  modelo?: string;
  VERSAO?: string;
  ano?: string;
  anoModelo?: string;
  cor?: string;
  situacao?: string;
  extra?: { combustivel?: string; caixa_cambio?: string; sub_segmento?: string };
  fipe?: { dados?: ProviderFipe[] };
};

// Só a descrição do carro segue para o painel. Chassi, município e dados do documento são descartados aqui.
function describe(data: ProviderResponse) {
  const fipe = [...(data.fipe?.dados ?? [])].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
  const rawName = fipe?.texto_modelo ?? data.VERSAO ?? data.MODELO ?? data.modelo ?? '';
  const { model, version } = splitModelName(rawName);
  return {
    brand: brandDisplayName(fipe?.texto_marca ?? data.MARCA ?? data.marca ?? ''),
    model,
    version,
    year: Number(data.anoModelo ?? data.ano) || null,
    color: data.cor?.trim() || null,
    fuel: fuelFromText(data.extra?.combustivel, fipe?.combustivel, rawName),
    transmission: transmissionFromText(`${data.extra?.caixa_cambio ?? ''} ${rawName}`),
    category: categoryFromSegment(data.extra?.sub_segmento),
    situation: data.situacao?.trim() || null,
    fipe: fipe
      ? { code: fipe.codigo_fipe ?? null, priceCents: brlTextToCents(fipe.texto_valor), reference: fipe.mes_referencia?.trim() ?? null }
      : null,
  };
}

// A consulta é paga pela loja: só roda no clique, com limite por pessoa, e o token nunca sai do servidor.
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return fail(403, 'Origem não permitida.');

  let ctx;
  try {
    ctx = await requireAdminAction();
  } catch (error) {
    if (error instanceof AdminAccessError) return fail(401, error.message);
    throw error;
  }

  if (!env.plateApiToken) return fail(503, 'A consulta por placa ainda não foi ativada.');
  if (!(await isWithinRateLimit('placa', ctx.userId, 40, 3600))) {
    return fail(429, 'Muitas consultas em pouco tempo. Aguarde alguns minutos.');
  }

  const body = (await request.json().catch(() => null)) as { placa?: unknown } | null;
  const plate = plateSchema.safeParse(body?.placa);
  if (!plate.success) return fail(400, 'Confira a placa. Use o formato ABC1D23 ou ABC1234.');

  let response: Response;
  try {
    response = await fetch(`${env.plateApiBase}/consulta/${plate.data}/${env.plateApiToken}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    console.error('Consulta de placa sem resposta');
    return fail(502, 'O serviço de placa não respondeu. Tente de novo ou preencha à mão.');
  }

  if (!response.ok) {
    console.error('Consulta de placa recusada', response.status);
    const [status, message] = PROVIDER_ERRORS[response.status] ?? [502, 'O serviço de placa não respondeu. Tente de novo ou preencha à mão.'];
    return fail(status, message);
  }

  const data = (await response.json().catch(() => null)) as ProviderResponse | null;
  if (!data) return fail(502, 'O serviço de placa não respondeu. Tente de novo ou preencha à mão.');
  return NextResponse.json(describe(data));
}
