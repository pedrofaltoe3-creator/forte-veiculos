import { NextResponse, type NextRequest } from 'next/server';
import { AdminAccessError, requireAdminAction } from '@/lib/auth/guards';
import { getFipePrice, listFipeBrands, listFipeModels, listFipeYears } from '@/lib/fipe';

const fail = (status: number, message: string) => NextResponse.json({ message }, { status });
const CODE = /^[0-9]{1,8}$/;
const YEAR = /^[0-9]{4,5}-[0-9]$/;

// Sem parâmetros: marcas. Com marca: modelos. Com marca e modelo: anos. Com os três: valor FIPE.
export async function GET(request: NextRequest) {
  try {
    await requireAdminAction();
  } catch (error) {
    if (error instanceof AdminAccessError) return fail(401, error.message);
    throw error;
  }

  const { searchParams } = request.nextUrl;
  const brand = searchParams.get('marca');
  const model = searchParams.get('modelo');
  const year = searchParams.get('ano');
  if ((brand && !CODE.test(brand)) || (model && !CODE.test(model)) || (year && !YEAR.test(year))) {
    return fail(400, 'Consulta inválida.');
  }

  const data = await (brand && model && year
    ? getFipePrice(brand, model, year)
    : brand && model
      ? listFipeYears(brand, model)
      : brand
        ? listFipeModels(brand)
        : listFipeBrands());

  if (!data) return fail(502, 'A tabela FIPE não respondeu. Tente de novo ou preencha à mão.');
  return NextResponse.json(data, { headers: { 'Cache-Control': 'private, max-age=3600' } });
}
