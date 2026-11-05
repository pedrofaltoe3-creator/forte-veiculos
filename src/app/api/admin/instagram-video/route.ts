import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AdminAccessError, requireAdminAction } from '@/lib/auth/guards';
import { isSameOrigin, isWithinRateLimit } from '@/lib/request';

const MAX_BYTES = 50 * 1024 * 1024;
const EXTENSION: Record<string, string> = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };

const fail = (status: number, message: string) => NextResponse.json({ message }, { status });

const requestSchema = z.object({ type: z.string(), size: z.number().int().positive() });

// Vídeo não cabe no limite de corpo da hospedagem. O servidor valida e entrega uma URL assinada de uso único,
// e o navegador envia o arquivo direto para o Storage, na pasta desta empresa.
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return fail(403, 'Origem não permitida.');

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

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, 'Arquivo inválido.');
  const extension = EXTENSION[parsed.data.type];
  if (!extension) return fail(415, 'Use um vídeo MP4, WebM ou MOV.');
  if (parsed.data.size > MAX_BYTES) return fail(413, 'O vídeo deve ter até 50 MB.');

  const path = `${ctx.site.company.id}/instagram/${randomUUID()}.${extension}`;
  const { data, error } = await ctx.supabase.storage.from('site-videos').createSignedUploadUrl(path);
  if (error || !data) {
    console.error('Falha ao preparar envio do vídeo', error?.message);
    return fail(500, 'Não foi possível enviar o vídeo.');
  }
  return NextResponse.json({ url: data.signedUrl, path });
}
