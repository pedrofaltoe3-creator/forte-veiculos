import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdminPage } from '@/lib/auth/guards';
import { formatDateTime } from '@/lib/format';

export const metadata: Metadata = { title: 'Histórico' };

const PAGE_SIZE = 50;

const ACTION_LABEL: Record<string, string> = {
  'vehicles.insert': 'Veículo cadastrado',
  'vehicles.update': 'Veículo alterado',
  'vehicles.delete': 'Veículo excluído',
  'vehicle_photos.insert': 'Foto adicionada',
  'vehicle_photos.delete': 'Foto excluída',
  'financial_entries.insert': 'Lançamento no financeiro',
  'financial_entries.delete': 'Lançamento removido do financeiro',
  'leads.update': 'Lead atualizado',
  'leads.delete': 'Lead excluído',
  'site_settings.update': 'Informações da loja alteradas',
  'technical_settings.update': 'Ajustes técnicos alterados',
  'company_members.insert': 'Acesso criado',
  'company_members.update': 'Acesso alterado',
  'company_members.delete': 'Acesso removido',
  'instagram_posts.insert': 'Publicação do Instagram adicionada',
  'instagram_posts.update': 'Publicação do Instagram alterada',
  'instagram_posts.delete': 'Publicação do Instagram removida',
  'auth.login': 'Entrou no painel',
  'auth.logout': 'Saiu do painel',
  'auth.login_failed': 'Tentativa de login recusada',
  'auth.login_denied': 'Login sem acesso a esta empresa',
  'auth.mfa_ok': 'Verificação em duas etapas concluída',
  'auth.mfa_failed': 'Código de verificação incorreto',
  'auth.mfa_reset': 'MFA redefinido por um master',
};

const FIELD_LABEL: Record<string, string> = {
  brand: 'marca',
  model: 'modelo',
  version: 'versão',
  category: 'categoria',
  model_year: 'ano',
  mileage_km: 'quilometragem',
  transmission: 'câmbio',
  fuel: 'combustível',
  color: 'cor',
  price_cents: 'preço',
  offer_price_cents: 'preço de oferta',
  offer_until: 'validade da oferta',
  purchase_cost_cents: 'quanto a loja pagou',
  fipe_price_cents: 'valor FIPE',
  description: 'descrição',
  features: 'itens',
  status: 'situação',
  is_featured: 'destaque',
  slug: 'endereço da página',
  position: 'ordem',
  display_name: 'nome da loja',
  whatsapp: 'WhatsApp',
  phone_display: 'telefone',
  email: 'e-mail',
  address_street: 'endereço',
  address_district: 'bairro',
  address_city: 'cidade',
  address_state: 'estado',
  address_zip: 'CEP',
  hours: 'horário',
  instagram_url: 'Instagram',
  facebook_url: 'Facebook',
  about_text: 'texto sobre a loja',
  images: 'fotos do site',
  canonical_url: 'endereço oficial',
  ga4_id: 'Google Analytics',
  meta_pixel_id: 'Meta Pixel',
  legal_name: 'razão social',
  cnpj: 'CNPJ',
  dpo_name: 'encarregado de dados',
  dpo_email: 'e-mail do encarregado',
  role: 'permissão',
  is_active: 'ativação',
  permalink: 'link da publicação',
};

function describe(action: string, after: unknown): string {
  if (!after || typeof after !== 'object') return '';
  const changes = after as Record<string, unknown>;
  if (typeof changes.price_cents === 'number' && Object.keys(changes).length === 1) {
    return `Novo preço: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(changes.price_cents / 100)}`;
  }
  const label = [changes.brand, changes.model, changes.model_year].filter(Boolean).join(' ');
  if (label) return label;
  if (!action.endsWith('.update')) return '';
  const fields = Object.keys(changes).flatMap((key) => FIELD_LABEL[key] ?? []);
  return fields.length ? `Mudou: ${fields.join(', ')}` : '';
}

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ pagina?: string }> }) {
  const { supabase, site } = await requireAdminPage('master');
  const page = Math.max(1, Math.min(10_000, Number((await searchParams).pagina) || 1));
  const { data, count } = await supabase
    .from('audit_logs')
    .select('id, actor_email, action, entity, after, before, created_at', { count: 'exact' })
    .eq('company_id', site.company.id)
    .order('id', { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  return (
    <>
      <header className="a-head"><h1>Histórico</h1></header>
      <p className="muted a-lede">Registro automático das atividades do painel. Ninguém consegue alterar ou apagar estas linhas.</p>
      {!data?.length ? (
        <div className="a-card a-empty"><p className="muted">Nada registrado ainda.</p></div>
      ) : (
        <div className="a-table-wrap">
          <table className="a-table">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Quem</th>
                <th>O quê</th>
                <th>Detalhe</th>
              </tr>
            </thead>
            <tbody>
              {data.map((entry) => (
                <tr key={entry.id}>
                  <td className="a-nowrap">{formatDateTime(entry.created_at)}</td>
                  <td>{entry.actor_email ?? 'Sistema'}</td>
                  <td>{ACTION_LABEL[entry.action] ?? entry.action}</td>
                  <td className="a-row-sub">{describe(entry.action, entry.after ?? entry.before)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <nav className="a-pagination" aria-label="Páginas do histórico">
          {page > 1 && <Link href={`/admin/historico?pagina=${page - 1}`}>Anterior</Link>}
          <span>Página {page} de {pages}</span>
          {page < pages && <Link href={`/admin/historico?pagina=${page + 1}`}>Próxima</Link>}
        </nav>
      )}
    </>
  );
}
