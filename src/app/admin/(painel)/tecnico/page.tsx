import type { Metadata } from 'next';
import { TechnicalSettingsForm } from '@/components/admin/SettingsForms';
import { requireAdminPage } from '@/lib/auth/guards';
import type { TechnicalSettings } from '@/lib/types';

export const metadata: Metadata = { title: 'Ajustes técnicos' };

export default async function TechnicalPage() {
  const { supabase, site } = await requireAdminPage('master');
  const { data } = await supabase.from('technical_settings').select('*').eq('company_id', site.company.id).single();
  return (
    <>
      <header className="a-head"><h1>Ajustes técnicos</h1></header>
      <p className="muted a-lede">Área do administrador master. Chaves secretas nunca ficam aqui: elas vivem só nas variáveis de ambiente do servidor.</p>
      <TechnicalSettingsForm technical={data as TechnicalSettings} />
    </>
  );
}
