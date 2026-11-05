import type { Metadata } from 'next';
import Link from 'next/link';
import { LeadDetail } from '@/components/admin/LeadDetail';
import { requireAdminPage } from '@/lib/auth/guards';
import { LEAD_STATUS_LABEL, LEAD_TYPE_LABEL } from '@/lib/format';
import type { Lead } from '@/lib/types';

export const metadata: Metadata = { title: 'Leads' };

const PAGE_SIZE = 50;

type SearchParams = Promise<{ status?: string; tipo?: string; lead?: string; pagina?: string }>;

export default async function LeadsPage({ searchParams }: { searchParams: SearchParams }) {
  const { supabase, site } = await requireAdminPage();
  const params = await searchParams;
  const status = params.status && params.status in LEAD_STATUS_LABEL ? params.status : null;
  const type = params.tipo && params.tipo in LEAD_TYPE_LABEL ? params.tipo : null;
  const page = Math.max(1, Math.min(10_000, Number(params.pagina) || 1));

  let query = supabase
    .from('leads')
    .select('id, company_id, type, status, name, phone, email, message, vehicle_id, vehicle_label, evaluation, source_path, notes, created_at', { count: 'exact' })
    .eq('company_id', site.company.id)
    .order('created_at', { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (status) query = query.eq('status', status);
  if (type) query = query.eq('type', type);

  const { data, count } = await query;
  const leads = (data ?? []) as Lead[];
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  const pageHref = (target: number) => {
    const search = new URLSearchParams();
    if (status) search.set('status', status);
    if (type) search.set('tipo', type);
    if (target > 1) search.set('pagina', String(target));
    const text = search.toString();
    return text ? `/admin/leads?${text}` : '/admin/leads';
  };

  return (
    <>
      <header className="a-head">
        <h1>Leads</h1>
        <span className="muted">{count ?? 0} no total</span>
      </header>

      <form className="a-toolbar" method="get">
        <label className="sr-only" htmlFor="filtro-status">Situação</label>
        <select id="filtro-status" name="status" defaultValue={status ?? ''}>
          <option value="">Todas as situações</option>
          {Object.entries(LEAD_STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <label className="sr-only" htmlFor="filtro-tipo">Tipo</label>
        <select id="filtro-tipo" name="tipo" defaultValue={type ?? ''}>
          <option value="">Todos os tipos</option>
          {Object.entries(LEAD_TYPE_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <button className="a-btn">Filtrar</button>
        {(status || type) && <Link className="a-text-link" href="/admin/leads">Limpar</Link>}
      </form>

      {leads.length === 0 ? (
        <div className="a-card a-empty">
          <h2>Nenhum lead por aqui.</h2>
          <p className="muted">Contatos enviados pelos formulários do site aparecem nesta lista.</p>
        </div>
      ) : (
        <div className="a-leads">
          {leads.map((lead) => (
            <LeadDetail key={lead.id} lead={lead} defaultOpen={lead.id === params.lead} />
          ))}
        </div>
      )}

      {pages > 1 && (
        <nav className="a-pagination" aria-label="Páginas de leads">
          {page > 1 && <Link href={pageHref(page - 1)}>Anterior</Link>}
          <span>Página {page} de {pages}</span>
          {page < pages && <Link href={pageHref(page + 1)}>Próxima</Link>}
        </nav>
      )}
    </>
  );
}
