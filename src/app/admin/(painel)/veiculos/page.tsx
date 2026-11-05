import type { Metadata } from 'next';
import Link from 'next/link';
import { VehicleRow } from '@/components/admin/VehicleRow';
import { requireAdminPage } from '@/lib/auth/guards';
import { STATUS_LABEL } from '@/lib/format';
import type { VehiclePhoto, VehicleStatus } from '@/lib/types';
import { escapeLike, photoUrl, sortPhotos } from '@/lib/vehicles';

export const metadata: Metadata = { title: 'Veículos' };

type SearchParams = Promise<{ q?: string; status?: string; destaque?: string; oferta?: string }>;

export default async function VehiclesPage({ searchParams }: { searchParams: SearchParams }) {
  const { supabase, site } = await requireAdminPage();
  const params = await searchParams;
  const term = (params.q ?? '').trim().slice(0, 60);
  const status = params.status && params.status in STATUS_LABEL ? (params.status as VehicleStatus) : null;

  let query = supabase
    .from('vehicles')
    .select('id, slug, brand, model, version, model_year, mileage_km, price_cents, offer_price_cents, offer_until, status, is_featured, updated_at, vehicle_photos(id, storage_path, thumb_path, width, height, position, is_primary, alt)')
    .eq('company_id', site.company.id)
    .order('updated_at', { ascending: false })
    .limit(300);
  if (term) query = query.ilike('search_text', `%${escapeLike(term.toLowerCase())}%`);
  if (status) query = query.eq('status', status);
  if (params.destaque === '1') query = query.eq('is_featured', true);
  if (params.oferta === '1') query = query.not('offer_price_cents', 'is', null);

  const { data: vehicles } = await query;

  return (
    <>
      <header className="a-head">
        <h1>Veículos</h1>
        <Link className="a-btn a-btn-primary" href="/admin/veiculos/novo">Cadastrar veículo</Link>
      </header>

      <form className="a-toolbar" method="get" role="search">
        <label className="sr-only" htmlFor="busca">Buscar veículo</label>
        <input id="busca" type="search" name="q" defaultValue={term} placeholder="Buscar por marca, modelo ou ano" maxLength={60} />
        <label className="sr-only" htmlFor="filtro-status">Situação</label>
        <select id="filtro-status" name="status" defaultValue={status ?? ''}>
          <option value="">Todas as situações</option>
          {Object.entries(STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <button className="a-btn">Filtrar</button>
        {(term || status || params.destaque || params.oferta) && <Link className="a-text-link" href="/admin/veiculos">Limpar</Link>}
      </form>

      {!vehicles?.length ? (
        <div className="a-card a-empty">
          <h2>{term || status ? 'Nenhum veículo encontrado.' : 'Nenhum veículo cadastrado ainda.'}</h2>
          <Link className="a-btn a-btn-primary" href="/admin/veiculos/novo">Cadastrar o primeiro</Link>
        </div>
      ) : (
        <div className="a-table-wrap">
          <table className="a-table a-table-veiculos">
            <thead>
              <tr>
                <th><span className="sr-only">Foto</span></th>
                <th>Veículo</th>
                <th>Preço</th>
                <th>Situação</th>
                <th>Destaque</th>
                <th><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {vehicles.map((vehicle) => {
                const photos = sortPhotos(vehicle.vehicle_photos as VehiclePhoto[]);
                return (
                  <VehicleRow
                    key={vehicle.id}
                    vehicle={{
                      id: vehicle.id,
                      slug: vehicle.slug,
                      brand: vehicle.brand,
                      model: vehicle.model,
                      version: vehicle.version,
                      model_year: vehicle.model_year,
                      mileage_km: vehicle.mileage_km,
                      price_cents: Number(vehicle.price_cents),
                      offer_price_cents: vehicle.offer_price_cents == null ? null : Number(vehicle.offer_price_cents),
                      offer_until: vehicle.offer_until,
                      status: vehicle.status as VehicleStatus,
                      is_featured: vehicle.is_featured,
                      thumb: photos[0] ? photoUrl(photos[0].thumb_path) : null,
                      photoCount: photos.length,
                    }}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
