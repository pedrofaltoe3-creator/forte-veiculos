import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { AdminAccessError, requireAdminAction } from '@/lib/auth/guards';
import { isSameOrigin, isWithinRateLimit } from '@/lib/request';
import { isSiteImageSlot, SITE_IMAGE_SLOTS } from '@/lib/site-images';
import { detectImageType } from '@/lib/validation';

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_INPUT_PIXELS = 60_000_000;

const fail = (status: number, message: string) => NextResponse.json({ message }, { status });

type Context = Awaited<ReturnType<typeof requireAdminAction>>;

// Mesmas barreiras das outras escritas do painel: origem, sessão com MFA, limite de envios e RLS.
async function authorize(request: Request): Promise<Context | NextResponse> {
  if (!isSameOrigin(request)) return fail(403, 'Origem não permitida.');
  let ctx: Context;
  try {
    ctx = await requireAdminAction();
  } catch (error) {
    if (error instanceof AdminAccessError) return fail(401, error.message);
    throw error;
  }
  if (!(await isWithinRateLimit('upload', ctx.userId, 120, 600))) {
    return fail(429, 'Muitos envios em pouco tempo. Aguarde alguns minutos.');
  }
  return ctx;
}

async function currentImages(ctx: Context) {
  const { data, error } = await ctx.supabase
    .from('site_settings')
    .select('images')
    .eq('company_id', ctx.site.company.id)
    .single();
  if (error) throw new Error(`Falha ao ler as fotos do site: ${error.code}`);
  return (data.images ?? {}) as Record<string, string>;
}

async function saveImages(ctx: Context, images: Record<string, string>) {
  const { error } = await ctx.supabase.from('site_settings').update({ images }).eq('company_id', ctx.site.company.id);
  if (error) console.error('Falha ao salvar as fotos do site', error.code);
  return !error;
}

async function removeFile(ctx: Context, path: string | undefined) {
  if (!path) return;
  const { error } = await ctx.supabase.storage.from('vehicle-photos').remove([path]);
  if (error) console.error('Falha ao apagar foto antiga do site', error.message);
}

// O arquivo final é sempre WebP novo, sem EXIF, como nas fotos dos veículos.
export async function POST(request: Request, { params }: { params: Promise<{ slot: string }> }) {
  const { slot } = await params;
  if (!isSiteImageSlot(slot)) return fail(404, 'Foto não encontrada.');

  const ctx = await authorize(request);
  if (ctx instanceof NextResponse) return ctx;

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return fail(400, 'Nenhum arquivo enviado.');
  if (file.size === 0 || file.size > MAX_BYTES) return fail(413, 'A foto deve ter até 8 MB.');

  const input = Buffer.from(await file.arrayBuffer());
  if (!detectImageType(input)) return fail(415, 'Formato não aceito. Use JPG, PNG ou WebP.');

  const { width, height, fit } = SITE_IMAGE_SLOTS[slot].output;
  let output: Buffer;
  try {
    output = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
      .rotate()
      .resize({ width, height, fit, position: fit === 'cover' ? sharp.strategy.attention : undefined, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    return fail(415, 'Não foi possível ler esta imagem. Tente outra foto.');
  }

  const path = `${ctx.site.company.id}/site/${slot}-${randomUUID()}.webp`;
  const upload = await ctx.supabase.storage
    .from('vehicle-photos')
    .upload(path, output, { contentType: 'image/webp', cacheControl: '31536000', upsert: false });
  if (upload.error) {
    console.error('Falha no upload da foto do site', upload.error.message);
    return fail(500, 'Não foi possível salvar a foto.');
  }

  const images = await currentImages(ctx);
  if (!(await saveImages(ctx, { ...images, [slot]: path }))) {
    await removeFile(ctx, path);
    return fail(500, 'Não foi possível salvar a foto.');
  }
  await removeFile(ctx, images[slot]);

  revalidatePath('/', 'layout');
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ slot: string }> }) {
  const { slot } = await params;
  if (!isSiteImageSlot(slot)) return fail(404, 'Foto não encontrada.');

  const ctx = await authorize(request);
  if (ctx instanceof NextResponse) return ctx;

  const images = await currentImages(ctx);
  const { [slot]: removed, ...rest } = images;
  if (!removed) return NextResponse.json({ ok: true });
  if (!(await saveImages(ctx, rest))) return fail(500, 'Não foi possível voltar à foto original.');
  await removeFile(ctx, removed);

  revalidatePath('/', 'layout');
  return NextResponse.json({ ok: true });
}
