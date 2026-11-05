import { formatPrice } from '@/lib/format';

export type MonthTotals = { month: string; label: string; income: number; expense: number };

const WIDTH = 460;
const HEIGHT = 230;
const LEFT = 72;
const TOP = 16;
const BOTTOM = 26;
const BAR = 20;
const GAP = 2;

// Topo do eixo em número redondo: 1, 2 ou 5 vezes uma potência de dez.
function roundedTop(max: number) {
  if (max <= 0) return 100_000;
  const power = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 5, 10].find((factor) => factor * power >= max) ?? 10;
  return step * power;
}

const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const axisLabel = (cents: number) => `R$ ${compact.format(cents / 100)}`;

// Barra com o topo arredondado e a base apoiada no eixo.
function barPath(x: number, y: number, height: number) {
  const radius = Math.min(4, height);
  return `M${x},${y + height}V${y + radius}Q${x},${y} ${x + radius},${y}H${x + BAR - radius}Q${x + BAR},${y} ${x + BAR},${y + radius}V${y + height}Z`;
}

export function FinanceChart({ data }: { data: MonthTotals[] }) {
  const top = roundedTop(Math.max(...data.flatMap((item) => [item.income, item.expense])));
  const plotHeight = HEIGHT - TOP - BOTTOM;
  const band = (WIDTH - LEFT) / data.length;
  const baseline = TOP + plotHeight;
  const toHeight = (value: number) => (value / top) * plotHeight;

  return (
    <figure className="a-chart">
      <figcaption className="a-chart-legend">
        <span><i className="a-swatch a-swatch-income" aria-hidden="true" />Faturamento</span>
        <span><i className="a-swatch a-swatch-expense" aria-hidden="true" />Custos e despesas</span>
      </figcaption>
      <div className="a-chart-scroll">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Faturamento e custos dos últimos seis meses. Os valores estão na tabela abaixo.">
          {[0, 0.5, 1].map((fraction) => {
            const y = baseline - fraction * plotHeight;
            return (
              <g key={fraction} className="a-chart-grid">
                <line x1={LEFT} x2={WIDTH} y1={y} y2={y} />
                <text x={LEFT - 8} y={y + 4} textAnchor="end">{axisLabel(top * fraction)}</text>
              </g>
            );
          })}
          {data.map((item, index) => {
            const start = LEFT + index * band;
            const center = start + band / 2;
            const incomeX = center - BAR - GAP / 2;
            const expenseX = center + GAP / 2;
            const tipWidth = 196;
            const tipX = Math.min(Math.max(center - tipWidth / 2, LEFT), WIDTH - tipWidth);
            return (
              <g key={item.month} className="a-chart-month" tabIndex={0} aria-label={`${item.label}: faturamento ${formatPrice(item.income)}, custos e despesas ${formatPrice(item.expense)}`}>
                <rect className="a-chart-hit" x={start} y={TOP} width={band} height={plotHeight + BOTTOM} />
                {item.income > 0 && <path className="a-bar-income" d={barPath(incomeX, baseline - toHeight(item.income), toHeight(item.income))} />}
                {item.expense > 0 && <path className="a-bar-expense" d={barPath(expenseX, baseline - toHeight(item.expense), toHeight(item.expense))} />}
                <text className="a-chart-axis" x={center} y={HEIGHT - 8} textAnchor="middle">{item.label}</text>
                <g className="a-chart-tip" transform={`translate(${tipX}, 0)`}>
                  <rect width={tipWidth} height={50} rx={6} />
                  <text x={10} y={21}>Faturamento: {formatPrice(item.income)}</text>
                  <text x={10} y={39}>Custos: {formatPrice(item.expense)}</text>
                </g>
              </g>
            );
          })}
        </svg>
      </div>
      <details className="a-chart-table">
        <summary>Ver em tabela</summary>
        <table className="a-table">
          <thead>
            <tr><th>Mês</th><th>Faturamento</th><th>Custos e despesas</th><th>Resultado</th></tr>
          </thead>
          <tbody>
            {data.map((item) => (
              <tr key={item.month}>
                <td>{item.label}</td>
                <td>{formatPrice(item.income)}</td>
                <td>{formatPrice(item.expense)}</td>
                <td>{formatPrice(item.income - item.expense)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
