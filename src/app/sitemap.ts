import type { MetadataRoute } from 'next';
import { getPublicContext } from '@/lib/site-fallback';
import { listSitemapEntries } from '@/lib/vehicles';

// Gerado a cada acesso para refletir o estoque atual e o domínio da empresa.
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { companyId, siteUrl } = await getPublicContext();
  const vehicles = companyId ? await listSitemapEntries(companyId) : [];
  return [
    { url: `${siteUrl}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${siteUrl}/veiculos`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${siteUrl}/politica-de-privacidade`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${siteUrl}/politica-de-cookies`, changeFrequency: 'yearly', priority: 0.2 },
    ...vehicles.map((vehicle) => ({
      url: `${siteUrl}/veiculos/${vehicle.slug}`,
      lastModified: vehicle.updated_at,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
  ];
}
