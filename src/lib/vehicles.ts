import 'server-only';
import { env } from '@/lib/env';
import { todayInBrazil } from '@/lib/format';
import { createPublicClient } from '@/lib/supabase/public';
import type { Vehicle, VehicleCategory, VehicleFuel, VehiclePhoto, VehicleTransmission } from '@/lib/types';

export const PUBLIC_VEHICLE_COLUMNS =
  'id, company_id, slug, brand, model, version, category, model_year, mileage_km, transmission, fuel, color, price_cents, offer_price_cents, offer_until, description, features, status, is_featured, sold_at, created_at, updated_at, vehicle_photos(id, storage_path, thumb_path, width, height, position, is_primary, alt)';

export const PAGE_SIZE = 12;

export type CatalogFilters = {
  q?: string;
  marca?: string;
  categoria?: VehicleCategory;
  cambio?: VehicleTransmission;
  combustivel?: VehicleFuel;
  anoMin?: number;
  anoMax?: number;
  precoMax?: number;
  kmMax?: number;
  oferta?: boolean;
  ordem?: 'recentes' | 'menor-preco' | 'maior-preco' | 'menor-km' | 'mais-novos';
  pagina: number;
};

export function photoUrl(path: string): string {
  return `${env.supabaseUrl}/storage/v1/object/public/vehicle-photos/${path}`;
}

export function siteVideoUrl(path: string): string {
  return `${env.supabaseUrl}/storage/v1/object/public/site-videos/${path}`;
}

export function sortPhotos(photos: VehiclePhoto[]): VehiclePhoto[] {
  return [...photos].sort(
    (a, b) => Number(b.is_primary) - Number(a.is_primary) || a.position - b.position,
  );
}

// Curingas do ILIKE vêm escapados para a busca do visitante nunca virar padrão de consulta.
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function listFeatured(companyId: string, limit = 6): Promise<Vehicle[]> {
  const { data, error } = await createPublicClient()
    .from('vehicles')
    .select(PUBLIC_VEHICLE_COLUMNS)
    .eq('company_id', companyId)
    .eq('is_featured', true)
    .in('status', ['available', 'reserved'])
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) console.error('Falha ao listar destaques', error.message);
  return (data as unknown as Vehicle[]) ?? [];
}

const offerStillValid = () => `offer_until.is.null,offer_until.gte.${todayInBrazil()}`;

export async function listOffers(companyId: string, limit = 5): Promise<Vehicle[]> {
  const { data, error } = await createPublicClient()
    .from('vehicles')
    .select(PUBLIC_VEHICLE_COLUMNS)
    .eq('company_id', companyId)
    .in('status', ['available', 'reserved'])
    .not('offer_price_cents', 'is', null)
    .or(offerStillValid())
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) console.error('Falha ao listar ofertas', error.message);
  return (data as unknown as Vehicle[]) ?? [];
}

export async function listRecent(companyId: string, limit = 8): Promise<Vehicle[]> {
  const { data, error } = await createPublicClient()
    .from('vehicles')
    .select(PUBLIC_VEHICLE_COLUMNS)
    .eq('company_id', companyId)
    .in('status', ['available', 'reserved'])
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) console.error('Falha ao listar estoque', error.message);
  return (data as unknown as Vehicle[]) ?? [];
}

export async function searchCatalog(companyId: string, filters: CatalogFilters) {
  let query = createPublicClient()
    .from('vehicles')
    .select(PUBLIC_VEHICLE_COLUMNS, { count: 'exact' })
    .eq('company_id', companyId)
    .in('status', ['available', 'reserved']);

  if (filters.q) query = query.ilike('search_text', `%${escapeLike(filters.q.toLowerCase())}%`);
  if (filters.marca) query = query.ilike('brand', escapeLike(filters.marca));
  if (filters.categoria) query = query.eq('category', filters.categoria);
  if (filters.cambio) query = query.eq('transmission', filters.cambio);
  if (filters.combustivel) query = query.eq('fuel', filters.combustivel);
  if (filters.anoMin) query = query.gte('model_year', filters.anoMin);
  if (filters.anoMax) query = query.lte('model_year', filters.anoMax);
  if (filters.precoMax) query = query.lte('price_cents', filters.precoMax * 100);
  if (filters.kmMax) query = query.lte('mileage_km', filters.kmMax);
  if (filters.oferta) query = query.not('offer_price_cents', 'is', null).or(offerStillValid());

  switch (filters.ordem) {
    case 'menor-preco':
      query = query.order('price_cents', { ascending: true });
      break;
    case 'maior-preco':
      query = query.order('price_cents', { ascending: false });
      break;
    case 'menor-km':
      query = query.order('mileage_km', { ascending: true, nullsFirst: false });
      break;
    case 'mais-novos':
      query = query.order('model_year', { ascending: false });
      break;
    default:
      query = query.order('is_featured', { ascending: false }).order('created_at', { ascending: false });
  }

  const from = (filters.pagina - 1) * PAGE_SIZE;
  const { data, count, error } = await query.range(from, from + PAGE_SIZE - 1);
  if (error) console.error('Falha na busca do catálogo', error.code || error.message.slice(0, 120));
  return { vehicles: (data as unknown as Vehicle[]) ?? [], total: count ?? 0 };
}

export type CatalogFacets = {
  brands: { name: string; count: number }[];
  categories: { name: VehicleCategory; count: number }[];
  total: number;
};

export async function getFacets(companyId: string): Promise<CatalogFacets> {
  const { data, error } = await createPublicClient()
    .from('vehicles')
    .select('brand, category')
    .eq('company_id', companyId)
    .in('status', ['available', 'reserved'])
    .limit(1000);
  if (error) console.error('Falha ao carregar filtros', error.message);
  const brands = new Map<string, number>();
  const categories = new Map<VehicleCategory, number>();
  for (const row of data ?? []) {
    brands.set(row.brand, (brands.get(row.brand) ?? 0) + 1);
    categories.set(row.category as VehicleCategory, (categories.get(row.category as VehicleCategory) ?? 0) + 1);
  }
  return {
    brands: [...brands].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    categories: [...categories].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    total: data?.length ?? 0,
  };
}

export async function getVehicleBySlug(companyId: string, slug: string): Promise<Vehicle | null> {
  const { data, error } = await createPublicClient()
    .from('vehicles')
    .select(PUBLIC_VEHICLE_COLUMNS)
    .eq('company_id', companyId)
    .eq('slug', slug)
    .maybeSingle();
  if (error) console.error('Falha ao carregar veículo', error.message);
  return (data as unknown as Vehicle) ?? null;
}

export async function listSimilar(vehicle: Vehicle, limit = 3): Promise<Vehicle[]> {
  const { data } = await createPublicClient()
    .from('vehicles')
    .select(PUBLIC_VEHICLE_COLUMNS)
    .eq('company_id', vehicle.company_id)
    .eq('category', vehicle.category)
    .eq('status', 'available')
    .neq('id', vehicle.id)
    .limit(limit);
  return (data as unknown as Vehicle[]) ?? [];
}

export async function listSitemapEntries(companyId: string) {
  const { data } = await createPublicClient()
    .from('vehicles')
    .select('slug, updated_at')
    .eq('company_id', companyId)
    .in('status', ['available', 'reserved'])
    .limit(5000);
  return data ?? [];
}

export async function listInstagramPosts(companyId: string) {
  const { data } = await createPublicClient()
    .from('instagram_posts')
    .select('id, permalink, position, is_active, video_path')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .order('position')
    .limit(6);
  return data ?? [];
}
