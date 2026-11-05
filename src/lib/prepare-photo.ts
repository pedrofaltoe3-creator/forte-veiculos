export const ACCEPTED_PHOTOS = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_INPUT_BYTES = 40 * 1024 * 1024;
const MAX_SIDE = 2400;
const UPLOAD_LIMIT = 4 * 1024 * 1024;

// Reduz fotos grandes no navegador para caber no limite de envio. O servidor valida e reprocessa de qualquer forma.
export async function prepareForUpload(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= UPLOAD_LIMIT) {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
  if (!blob) throw new Error('Não foi possível processar a foto.');
  return blob;
}
