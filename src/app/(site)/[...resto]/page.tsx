import { notFound, permanentRedirect } from 'next/navigation';
import { getPublicContext } from '@/lib/site-fallback';
import { getVehicleBySlug } from '@/lib/vehicles';

// Endereços desconhecidos caem aqui para o 404 sair com o layout e o nonce de CSP do site.
// O site antigo publicava veículos em /{slug}: esses links continuam valendo, com redirecionamento permanente.
export default async function CatchAll({ params }: { params: Promise<{ resto: string[] }> }) {
  const { resto } = await params;
  if (resto.length === 1 && /^[a-z0-9-]{1,140}$/.test(resto[0])) {
    const { companyId } = await getPublicContext();
    const vehicle = companyId ? await getVehicleBySlug(companyId, resto[0]) : null;
    if (vehicle) permanentRedirect(`/veiculos/${vehicle.slug}`);
  }
  notFound();
}
