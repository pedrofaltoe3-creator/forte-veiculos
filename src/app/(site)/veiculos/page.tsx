import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { CatalogFilters } from '@/components/site/CatalogFilters';
import { JsonLd } from '@/components/site/JsonLd';
import { VehicleCard } from '@/components/site/VehicleCard';
import { breadcrumbSchema } from '@/lib/seo';
import { getPublicContext } from '@/lib/site-fallback';
import type { Vehicle } from '@/lib/types';
import { getFacets, PAGE_SIZE, searchCatalog, type CatalogFacets, type CatalogFilters as Filters } from '@/lib/vehicles';
import { GENERAL_MESSAGE, whatsappLink } from '@/lib/whatsapp';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// Parâmetros da URL são entrada de usuário: inválidos são ignorados, nunca chegam à consulta.
const optionalNumber = z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().int().min(0).max(100_000_000).optional()).catch(undefined);
const filterSchema = z.object({
  q: z.string().trim().max(60).optional().catch(undefined),
  marca: z.string().trim().max(60).optional().catch(undefined),
  categoria: z.enum(['suv', 'sedan', 'hatch', 'pickup', 'premium', 'other']).optional().catch(undefined),
  cambio: z.enum(['automatic', 'manual', 'cvt', 'automated']).optional().catch(undefined),
  combustivel: z.enum(['flex', 'gasoline', 'ethanol', 'diesel', 'hybrid', 'electric']).optional().catch(undefined),
  ano_min: optionalNumber,
  ano_max: optionalNumber,
  preco_max: optionalNumber,
  km_max: optionalNumber,
  oferta: z.literal('1').optional().catch(undefined),
  ordem: z.enum(['recentes', 'menor-preco', 'maior-preco', 'menor-km', 'mais-novos']).optional().catch(undefined),
  pagina: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
});

function parseFilters(params: Record<string, string | string[] | undefined>) {
  const flat = Object.fromEntries(Object.entries(params).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value || undefined]));
  return filterSchema.parse(flat);
}

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const { settings } = await getPublicContext();
  const filters = parseFilters(await searchParams);
  const city = settings.address_city ?? 'Cachoeiro de Itapemirim';
  const subject = filters.marca ? `${filters.marca} seminovos` : 'Carros seminovos e usados';
  const hasFilters = Object.entries(filters).some(([key, value]) => key !== 'pagina' && value !== undefined);
  return {
    title: `${subject} em ${city}`,
    description: `Veja o estoque da ${settings.display_name} em ${city}: fotos, preço, ano e quilometragem de cada carro. Fale pelo WhatsApp.`,
    alternates: { canonical: '/veiculos' },
    robots: hasFilters ? { index: false, follow: true } : undefined,
  };
}

export default async function CatalogPage({ searchParams }: { searchParams: SearchParams }) {
  const { companyId, settings, siteUrl } = await getPublicContext();
  const filters = parseFilters(await searchParams);
  const whatsappHref = whatsappLink(settings.whatsapp, GENERAL_MESSAGE);

  const query: Filters = {
    q: filters.q,
    marca: filters.marca,
    categoria: filters.categoria,
    cambio: filters.cambio,
    combustivel: filters.combustivel,
    anoMin: filters.ano_min,
    anoMax: filters.ano_max,
    precoMax: filters.preco_max,
    kmMax: filters.km_max,
    oferta: filters.oferta === '1',
    ordem: filters.ordem,
    pagina: filters.pagina,
  };

  const emptyFacets: CatalogFacets = { brands: [], categories: [], total: 0 };
  const [{ vehicles, total }, facets]: [{ vehicles: Vehicle[]; total: number }, CatalogFacets] = companyId
    ? await Promise.all([searchCatalog(companyId, query), getFacets(companyId)])
    : [{ vehicles: [], total: 0 }, emptyFacets];

  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (key !== 'pagina' && value !== undefined) values[key] = String(value);
  }
  const hasFilters = Object.keys(values).some((key) => key !== 'ordem');
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const pageHref = (page: number) => {
    const params = new URLSearchParams(values);
    if (page > 1) params.set('pagina', String(page));
    const search = params.toString();
    return search ? `/veiculos?${search}` : '/veiculos';
  };

  return (
    <div className="catalog-page">
      <JsonLd
        data={breadcrumbSchema([
          { name: 'Início', url: `${siteUrl}/` },
          { name: 'Estoque', url: `${siteUrl}/veiculos` },
        ])}
      />
      <header className="catalog-head">
        <p className="kicker kicker-ink mono">Estoque</p>
        <h1>Carros seminovos e usados em {settings.address_city ?? 'Cachoeiro de Itapemirim'}</h1>
        <p className="catalog-count" aria-live="polite">
          {total === 1 ? '1 carro encontrado' : `${total} carros encontrados`}
        </p>
      </header>

      <CatalogFilters values={values} brands={facets.brands} categories={facets.categories} hasFilters={hasFilters} />

      {vehicles.length > 0 ? (
        <div className="stock-grid">
          {vehicles.map((vehicle) => (
            <VehicleCard key={vehicle.id} vehicle={vehicle} />
          ))}
        </div>
      ) : (
        <div className="catalog-empty">
          <h2>{hasFilters ? 'Nenhum carro com esses filtros.' : 'O estoque está sendo atualizado.'}</h2>
          <p>Conte o que você procura. Muitas vezes o carro está chegando ou ainda não foi anunciado.</p>
          <a className="btn btn-ink" href={whatsappHref} target="_blank" rel="noopener noreferrer">Perguntar no WhatsApp</a>
        </div>
      )}

      {pages > 1 && (
        <nav className="pagination" aria-label="Páginas do estoque">
          {filters.pagina > 1 && <Link rel="prev" href={pageHref(filters.pagina - 1)}>Anterior</Link>}
          <span className="mono">Página {filters.pagina} de {pages}</span>
          {filters.pagina < pages && <Link rel="next" href={pageHref(filters.pagina + 1)}>Próxima</Link>}
        </nav>
      )}
    </div>
  );
}
