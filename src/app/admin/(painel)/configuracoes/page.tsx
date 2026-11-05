import type { Metadata } from 'next';
import { InstagramPostsForm, SiteSettingsForm } from '@/components/admin/SettingsForms';
import { requireAdminPage } from '@/lib/auth/guards';
import type { InstagramPost, SiteSettings } from '@/lib/types';

export const metadata: Metadata = { title: 'Informações da loja' };

export default async function SettingsPage() {
  const { supabase, site } = await requireAdminPage();
  const [{ data: settings }, { data: posts }] = await Promise.all([
    supabase.from('site_settings').select('*').eq('company_id', site.company.id).single(),
    supabase.from('instagram_posts').select('id, permalink, position, is_active, video_path').eq('company_id', site.company.id).order('position'),
  ]);

  return (
    <>
      <header className="a-head"><h1>Informações da loja</h1></header>
      <p className="muted a-lede">O que você salvar aqui aparece no site na hora.</p>
      <SiteSettingsForm settings={settings as SiteSettings} />
      <InstagramPostsForm posts={(posts ?? []) as InstagramPost[]} />
    </>
  );
}
