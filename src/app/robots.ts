import type { MetadataRoute } from 'next';
import { getPublicContext } from '@/lib/site-fallback';

export const dynamic = 'force-dynamic';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const { siteUrl } = await getPublicContext();
  if (process.env.SITE_NOINDEX === '1') return { rules: [{ userAgent: '*', disallow: '/' }] };
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/admin', '/api', '/auth'] }],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
