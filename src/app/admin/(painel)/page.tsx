import type { Metadata } from 'next';
import Link from 'next/link';
import { FinanceChart, type MonthTotals } from '@/components/admin/FinanceChart';
import { EntryForm, RemoveEntryButton, SaleForm, type SaleCandidate } from '@/components/admin/FinanceForms';
import { activeOfferCents, currentPriceCents, formatDateTime, formatDay, formatPrice, LEAD_TYPE_LABEL, PAYMENT_LABEL, todayInBrazil, vehicleTitle } from '@/lib/format';
import { requireAdminPage } from '@/lib/auth/guards';
import type { FinancialEntry, Lead, LeadType, VehicleStatus } from '@/lib/types';

export const metadata: Metadata = { title: 'Início' };

const MONTH_NAMES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const CHART_MONTHS = 6;

function shiftMonth(month: string, delta: number) {
  const [year, number] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, number - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

const monthLabel = (month: string) => `${MONTH_NAMES[Number(month.slice(5)) - 1]}/${month.slice(2, 4)}`;

// Faturamento soma vendas e outras entradas. Custo soma o que a loja pagou nos carros vendidos e as despesas.
function totalsOf(entries: FinancialEntry[]) {
  let income = 0;
  let expense = 0;
  for (const entry of entries) {
    if (entry.kind === 'expense') {
      expense += entry.amount_cents;
    } else {
      income += entry.amount_cents;
      expense += entry.cost_cents ?? 0;
    }
  }
  return { income, expense };
}

type SearchParams = Promise<{ mes?: string; vender?: string }>;

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const { supabase, site } = await requireAdminPage();
  const companyId = site.company.id;
  const params = await searchParams;

  const today = todayInBrazil();
  const currentMonth = today.slice(0, 7);
  const month = /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(params.mes ?? '') && params.mes! <= currentMonth ? params.mes! : currentMonth;
  const chartMonths = Array.from({ length: CHART_MONTHS }, (_, index) => shiftMonth(month, index - CHART_MONTHS + 1));

  const [vehiclesResult, entriesResult, soldResult, leads, newLeads, recentLeads, incomplete] = await Promise.all([
    supabase
      .from('vehicles')
      .select('id, brand, model, version, model_year, status, is_featured, price_cents, offer_price_cents, offer_until, purchase_cost_cents')
      .eq('company_id', companyId)
      .limit(2000),
    supabase
      .from('financial_entries')
      .select('id, kind, description, amount_cents, cost_cents, occurred_on, vehicle_id, payment_method')
      .eq('company_id', companyId)
      .gte('occurred_on', `${chartMonths[0]}-01`)
      .lt('occurred_on', `${shiftMonth(month, 1)}-01`)
      .order('occurred_on', { ascending: false })
      .limit(5000),
    supabase.from('financial_entries').select('vehicle_id').eq('company_id', companyId).eq('kind', 'sale').not('vehicle_id', 'is', null).limit(5000),
    supabase.from('leads').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
    supabase.from('leads').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('status', 'new'),
    supabase
      .from('leads')
      .select('id, type, name, vehicle_label, created_at, status')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(6),
    supabase
      .from('vehicles')
      .select('id, brand, model, version, model_year, mileage_km, fuel, transmission, vehicle_photos(id)')
      .eq('company_id', companyId)
      .in('status', ['available', 'reserved'])
      .or('mileage_km.is.null,fuel.is.null,transmission.is.null')
      .limit(50),
  ]);

  const vehicles = (vehiclesResult.data ?? []).map((vehicle) => ({
    ...vehicle,
    status: vehicle.status as VehicleStatus,
    price_cents: Number(vehicle.price_cents),
    offer_price_cents: vehicle.offer_price_cents == null ? null : Number(vehicle.offer_price_cents),
    purchase_cost_cents: vehicle.purchase_cost_cents == null ? null : Number(vehicle.purchase_cost_cents),
  }));
  const entries = (entriesResult.data ?? []).map((entry) => ({
    ...entry,
    amount_cents: Number(entry.amount_cents),
    cost_cents: entry.cost_cents == null ? null : Number(entry.cost_cents),
  })) as FinancialEntry[];

  const inMonth = (target: string) => entries.filter((entry) => entry.occurred_on.startsWith(target));
  const monthEntries = inMonth(month);
  const sales = monthEntries.filter((entry) => entry.kind === 'sale');
  const others = monthEntries.filter((entry) => entry.kind !== 'sale');
  const totals = totalsOf(monthEntries);
  const result = totals.income - totals.expense;
  const salesWithoutCost = sales.filter((sale) => sale.cost_cents == null).length;

  const chartData: MonthTotals[] = chartMonths.map((item) => ({ month: item, label: monthLabel(item), ...totalsOf(inMonth(item)) }));
  const hasChartData = chartData.some((item) => item.income > 0 || item.expense > 0);

  const inStock = vehicles.filter((vehicle) => vehicle.status === 'available' || vehicle.status === 'reserved');
  const count = (status: VehicleStatus) => vehicles.filter((vehicle) => vehicle.status === status).length;
  const stockValue = inStock.reduce((sum, vehicle) => sum + currentPriceCents(vehicle), 0);
  const stockCost = inStock.reduce((sum, vehicle) => sum + (vehicle.purchase_cost_cents ?? 0), 0);
  const stockWithoutCost = inStock.filter((vehicle) => vehicle.purchase_cost_cents == null).length;
  const offers = inStock.filter((vehicle) => activeOfferCents(vehicle, today) !== null).length;

  const confirmedSales = new Set((soldResult.data ?? []).map((row) => row.vehicle_id));
  const candidates: SaleCandidate[] = vehicles
    .filter((vehicle) => vehicle.status !== 'draft' && !confirmedSales.has(vehicle.id))
    .map((vehicle) => ({
      id: vehicle.id,
      label: `${vehicleTitle(vehicle)} · ${formatPrice(currentPriceCents(vehicle))}`,
      group: vehicle.status === 'sold' ? ('pending' as const) : vehicle.status === 'reserved' ? ('reserved' as const) : ('available' as const),
      priceCents: currentPriceCents(vehicle),
      costCents: vehicle.purchase_cost_cents,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  const pendingSales = candidates.filter((candidate) => candidate.group === 'pending').length;

  const moneyTiles = [
    { label: 'Vendas no mês', value: String(sales.length), href: '#vendas-do-mes' },
    { label: 'Faturamento', value: formatPrice(totals.income), href: '#vendas-do-mes' },
    { label: 'Custos e despesas', value: formatPrice(totals.expense), href: '#lancamentos' },
    {
      label: 'Resultado',
      value: formatPrice(result),
      href: '#vendas-do-mes',
      note: salesWithoutCost ? `${salesWithoutCost} sem custo informado` : result > 0 ? 'Lucro' : result < 0 ? 'Prejuízo' : undefined,
    },
    { label: 'Valor do estoque', value: formatPrice(stockValue), href: '/admin/veiculos', note: `${inStock.length} carros à venda` },
    { label: 'Investido no estoque', value: formatPrice(stockCost), href: '/admin/veiculos', note: stockWithoutCost ? `${stockWithoutCost} sem custo informado` : undefined },
  ];

  const stockTiles = [
    { label: 'Total de veículos', value: vehicles.length, href: '/admin/veiculos' },
    { label: 'Disponíveis', value: count('available'), href: '/admin/veiculos?status=available' },
    { label: 'Reservados', value: count('reserved'), href: '/admin/veiculos?status=reserved' },
    { label: 'Vendidos', value: count('sold'), href: '/admin/veiculos?status=sold' },
    { label: 'Em destaque', value: vehicles.filter((vehicle) => vehicle.is_featured).length, href: '/admin/veiculos?destaque=1' },
    { label: 'Em oferta', value: offers, href: '/admin/veiculos?oferta=1' },
    { label: 'Leads recebidos', value: leads.count ?? 0, href: '/admin/leads', note: newLeads.count ? `${newLeads.count} novos` : undefined },
  ];

  const recent = (recentLeads.data ?? []) as Pick<Lead, 'id' | 'type' | 'name' | 'vehicle_label' | 'created_at' | 'status'>[];
  const missing = incomplete.data ?? [];

  return (
    <>
      <header className="a-head">
        <h1>Início</h1>
        <div className="a-head-actions">
          <a className="a-btn" href="#confirmar-venda">Confirmar venda</a>
          <Link className="a-btn a-btn-primary" href="/admin/veiculos/novo">Cadastrar veículo</Link>
        </div>
      </header>

      <div className="a-month-nav">
        <Link className="a-btn a-btn-small" href={`/admin?mes=${shiftMonth(month, -1)}`} aria-label="Mês anterior">‹</Link>
        <strong>{monthLabel(month)}</strong>
        {month < currentMonth && <Link className="a-btn a-btn-small" href={`/admin?mes=${shiftMonth(month, 1)}`} aria-label="Próximo mês">›</Link>}
      </div>

      <section aria-label="Financeiro do mês" className="a-tiles a-tiles-money">
        {moneyTiles.map((tile) => (
          <a href={tile.href} className="a-tile" key={tile.label}>
            <span className="a-tile-label">{tile.label}</span>
            <span className="a-tile-value">{tile.value}</span>
            {tile.note && <span className="a-tile-note">{tile.note}</span>}
          </a>
        ))}
      </section>

      <section aria-label="Estoque e contatos" className="a-tiles a-tiles-stock">
        {stockTiles.map((tile) => (
          <Link href={tile.href} className="a-tile" key={tile.label}>
            <span className="a-tile-label">{tile.label}</span>
            <span className="a-tile-value">{tile.value}</span>
            {tile.note && <span className="a-tile-note">{tile.note}</span>}
          </Link>
        ))}
      </section>

      <div className="a-columns">
        <section className="a-card">
          <div className="a-card-head">
            <h2>Confirmar venda</h2>
            {pendingSales > 0 && <span className="a-tile-note">{pendingSales} para confirmar</span>}
          </div>
          <p className="muted">O carro sai do site e o valor entra no financeiro.</p>
          <SaleForm vehicles={candidates} preselected={params.vender} today={today} />
        </section>

        <section className="a-card">
          <div className="a-card-head"><h2>Últimos seis meses</h2></div>
          {hasChartData ? (
            <FinanceChart data={chartData} />
          ) : (
            <p className="muted">O gráfico aparece depois da primeira venda confirmada ou do primeiro lançamento.</p>
          )}
        </section>
      </div>

      <section className="a-card a-section-gap" id="vendas-do-mes">
        <div className="a-card-head"><h2>Vendas de {monthLabel(month)}</h2></div>
        {sales.length === 0 ? (
          <p className="muted">Nenhuma venda confirmada neste mês.</p>
        ) : (
          <div className="a-table-wrap">
            <table className="a-table">
              <thead>
                <tr><th>Data</th><th>Carro</th><th>Venda</th><th>Custo</th><th>Lucro</th><th>Pagamento</th><th><span className="sr-only">Ações</span></th></tr>
              </thead>
              <tbody>
                {sales.map((sale) => (
                  <tr key={sale.id}>
                    <td className="a-nowrap">{formatDay(sale.occurred_on)}</td>
                    <td>{sale.description}</td>
                    <td className="a-nowrap">{formatPrice(sale.amount_cents)}</td>
                    <td className="a-nowrap">{sale.cost_cents == null ? 'Não informado' : formatPrice(sale.cost_cents)}</td>
                    <td className="a-nowrap">{sale.cost_cents == null ? '-' : formatPrice(sale.amount_cents - sale.cost_cents)}</td>
                    <td>{sale.payment_method ? PAYMENT_LABEL[sale.payment_method] : '-'}</td>
                    <td className="a-cell-actions"><RemoveEntryButton entryId={sale.id} isSale label={sale.description} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="a-card a-section-gap" id="lancamentos">
        <div className="a-card-head"><h2>Despesas e outras entradas</h2></div>
        <EntryForm today={today} />
        {others.length > 0 && (
          <div className="a-table-wrap">
            <table className="a-table">
              <thead>
                <tr><th>Data</th><th>Descrição</th><th>Tipo</th><th>Valor</th><th><span className="sr-only">Ações</span></th></tr>
              </thead>
              <tbody>
                {others.map((entry) => (
                  <tr key={entry.id}>
                    <td className="a-nowrap">{formatDay(entry.occurred_on)}</td>
                    <td>{entry.description}</td>
                    <td>{entry.kind === 'expense' ? 'Despesa' : 'Entrada'}</td>
                    <td className="a-nowrap">{formatPrice(entry.amount_cents)}</td>
                    <td className="a-cell-actions"><RemoveEntryButton entryId={entry.id} isSale={false} label={entry.description} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="a-columns a-section-gap">
        <section className="a-card">
          <div className="a-card-head">
            <h2>Últimos leads</h2>
            <Link href="/admin/leads">Ver todos</Link>
          </div>
          {recent.length === 0 ? (
            <p className="muted">Nenhum lead ainda. Os contatos enviados pelo site aparecem aqui.</p>
          ) : (
            <ul className="a-list">
              {recent.map((lead) => (
                <li key={lead.id}>
                  <Link href={`/admin/leads?lead=${lead.id}`}>
                    <strong>{lead.name}</strong>
                    <span>{lead.vehicle_label ?? LEAD_TYPE_LABEL[lead.type as LeadType]}</span>
                    <time dateTime={lead.created_at}>{formatDateTime(lead.created_at)}</time>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="a-card">
          <div className="a-card-head">
            <h2>Anúncios para completar</h2>
          </div>
          {missing.length === 0 ? (
            <p className="muted">Todos os veículos à venda estão com quilometragem, câmbio e combustível informados.</p>
          ) : (
            <>
              <p className="muted">Faltam dados nestes anúncios. O site mostra &quot;sob consulta&quot; até você preencher.</p>
              <ul className="a-list">
                {missing.slice(0, 8).map((vehicle) => (
                  <li key={vehicle.id}>
                    <Link href={`/admin/veiculos/${vehicle.id}`}>
                      <strong>{vehicleTitle(vehicle)}</strong>
                      <span>
                        {[
                          vehicle.mileage_km == null ? 'quilometragem' : null,
                          vehicle.transmission == null ? 'câmbio' : null,
                          vehicle.fuel == null ? 'combustível' : null,
                        ]
                          .filter(Boolean)
                          .join(', ')}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </>
  );
}
