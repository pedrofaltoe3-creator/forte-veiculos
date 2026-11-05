import 'server-only';
import { headers } from 'next/headers';
import { cache } from 'react';
import { env, isSupabaseConfigured } from '@/lib/env';
import { createPublicClient } from '@/lib/supabase/public';
import type { SiteData } from '@/lib/types';

// Descobre a empresa pelo domínio acessado. Cada domínio em company_domains aponta para uma empresa,
// o que permite atender várias revendas com o mesmo código e o mesmo banco.
export const getSite = cache(async (): Promise<SiteData | null> => {
  const headerList = await headers();
  if (!isSupabaseConfigured()) return null;
  const host = (headerList.get('x-forwarded-host') ?? headerList.get('host') ?? '').split(':')[0].toLowerCase();
  const { data, error } = await createPublicClient().rpc('get_public_site', {
    p_host: host,
    p_fallback_slug: env.defaultCompanySlug,
  });
  if (error) {
    console.error('Falha ao carregar dados do site', error.message);
    return null;
  }
  return (data as SiteData | null) ?? null;
});

export const getNonce = cache(async () => (await headers()).get('x-nonce') ?? undefined);
