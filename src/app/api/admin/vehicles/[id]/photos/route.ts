import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { z } from 'zod';
import { AdminAccessError, requireAdminAction } from '@/lib/auth/guards';
import { isSameOrigin, isWithinRateLimit } from '@/lib/request';
import { detectImageType } from '@/lib/validation';

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PHOTOS_PER_VEHICLE = 40;
const MAX_INPUT_PIXELS = 60_000_000;

const fail = (status: number, message: string) => NextResponse.json({ message }, { status });

// Upload validado no servidor: assinatura real do arquivo, tamanho, limites de pixels e
// reprocessamento com sharp. O arquivo final é sempre WebP novo, sem EXIF (GPS, dados do aparelho).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return fail(403, 'Origem não permitida.');

  const { id: vehicleId } = await params;
  if (!z.uuid().safeParse(vehicleId).success) return fail(400, 'Veículo inválido.');

  let ctx;
  try {
    ctx = await requireAdminAction();
  } catch (error) {
    if (error instanceof AdminAccessError) return fail(401, error.message);
    throw error;
  }

  if (!(await isWithinRateLimit('upload', ctx.userId, 120, 600))) {
    return fail(429, 'Muitos envios em pouco tempo. Aguarde alguns minutos.');
  }

  const companyId = ctx.site.company.id;
  const { data: vehicle } = await ctx.supabase
    .from('vehicles')
    .select('id, brand, model, model_year')
    .eq('id', vehicleId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (!vehicle) return fail(404, 'Veículo não encontrado.');

  const { count } = await ctx.supabase
    .from('vehicle_photos')
    .select('id', { count: 'exact', head: true })
    .eq('vehicle_id', vehicleId);
  if ((count ?? 0) >= MAX_PHOTOS_PER_VEHICLE) return fail(400, `Limite de ${MAX_PHOTOS_PER_VEHICLE} fotos por veículo.`);

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return fail(400, 'Nenhum arquivo enviado.');
  if (file.size === 0 || file.size > MAX_BYTES) return fail(413, 'A foto deve ter até 8 MB.');

  const input = Buffer.from(await file.arrayBuffer());
  if (!detectImageType(input)) return fail(415, 'Formato não aceito. Use JPG, PNG ou WebP.');

  let full: { data: Buffer; info: { width: number; height: number } };
  let thumb: Buffer;
  try {
    const base = () => sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' }).rotate();
    full = await base()
      .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    thumb = await base()
      .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 76 })
      .toBuffer();
  } catch {
    return fail(415, 'Não foi possível ler esta imagem. Tente outra foto.');
  }

  const name = randomUUID();
  const storagePath = `${companyId}/${vehicleId}/${name}.webp`;
  const thumbPath = `${companyId}/${vehicleId}/${name}-800.webp`;
  const bucket = ctx.supabase.storage.from('vehicle-photos');
  const uploadOptions = { contentType: 'image/webp', cacheControl: '31536000', upsert: false };

  const uploadFull = await bucket.upload(storagePath, full.data, uploadOptions);
  if (uploadFull.error) {
    console.error('Falha no upload', uploadFull.error.message);
    return fail(500, 'Não foi possível salvar a foto.');
  }
  const uploadThumb = await bucket.upload(thumbPath, thumb, uploadOptions);
  if (uploadThumb.error) {
    await bucket.remove([storagePath]);
    console.error('Falha no upload da miniatura', uploadThumb.error.message);
    return fail(500, 'Não foi possível salvar a foto.');
  }

  const { data: last } = await ctx.supabase
    .from('vehicle_photos')
    .select('position')
    .eq('vehicle_id', vehicleId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: photo, error } = await ctx.supabase
    .from('vehicle_photos')
    .insert({
      company_id: companyId,
      vehicle_id: vehicleId,
      storage_path: storagePath,
      thumb_path: thumbPath,
      width: full.info.width,
      height: full.info.height,
      position: (last?.position ?? -1) + 1,
      alt: `${vehicle.brand} ${vehicle.model} ${vehicle.model_year}`,
    })
    .select('id, storage_path, thumb_path, width, height, position, is_primary, alt')
    .single();

  if (error) {
    await bucket.remove([storagePath, thumbPath]);
    console.error('Falha ao registrar foto', error.code);
    return fail(500, 'Não foi possível salvar a foto.');
  }

  revalidatePath('/', 'layout');
  return NextResponse.json({ photo }, { status: 201 });
}
