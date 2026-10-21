import { useId, type ReactNode } from 'react';
import { STRINGS } from '../../../lib/strings.generated';

export type ChartColor = 'claude' | 'codex' | 'accent';
export type ChartPoint = { label: string; value: number | null };
export type ChartSeries = { key: string; label: string; color: ChartColor };
export type BarChartProps = {
  title: string;
  data: ChartPoint[];
  series: ChartColor;
  formatValue: (value: number) => string;
  max?: number;
};
export type StackedBarChartProps = Omit<BarChartProps, 'data' | 'series'> & {
  data: { label: string; values: Record<string, number | null> }[];
  series: ChartSeries[];
};
export type LineChartProps = BarChartProps & { min?: number };

const left = 8;
const top = 24;
const width = 304;
const height = 128;
const bottom = top + height;
const colors = { claude: 'var(--ob-claude)', codex: 'var(--ob-codex)', accent: 'var(--ob-accent)' };
const known = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);
const x = (index: number, count: number) => left + (index + 0.5) * width / count;

function ChartFrame({ title, labels, columns, rows, maximum, children, formatValue }: {
  title: string;
  labels: string[];
  columns: string[];
  rows: (number | null)[][];
  maximum: string | null;
  children: ReactNode;
  formatValue: (value: number) => string;
}) {
  const id = useId();
  const stride = Math.max(1, Math.ceil(labels.length / 12), Math.ceil(labels.length * Math.min(16, Math.max(1, ...labels.map(label => label.length))) * 7 / width));
  return (
    <figure className="ob-chart">
      {/* Inline SVG needs an image role to expose its title as one graphic */}
      {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role */}
      <svg viewBox="0 0 320 180" width="100%" role="img" aria-labelledby={id}>
        <title id={id}>{title}</title>
        <path className="ob-chart-frame" d={`M${left} ${top}V${bottom}H${left + width}`} />
        {maximum !== null && <>
          <text x={left} y={14}>{maximum}</text>
          {children}
          {labels.map((label, index) => {
            if (index % stride !== 0) return null;
            const labelX = x(index, labels.length);
            const labelLimit = Math.max(1, Math.floor(Math.min(stride * width / labels.length, left + width - labelX) / 7));
            return <text key={index} x={labelX} y={170} textAnchor="start">
              {label.length > labelLimit ? `${label.slice(0, Math.max(0, labelLimit - 1))}…` : label}
            </text>;
          })}
        </>}
      </svg>
      <figcaption>
        <span>{title}</span>
        {maximum === null && <span>{STRINGS.formats.separator}{STRINGS.status.unknown}</span>}
        <label className="ob-chart-reveal"><input type="checkbox" />{STRINGS.charts.showValues}</label>
        <div className="ob-visually-hidden"><table>
          <thead><tr><th scope="col">{STRINGS.charts.item}</th>{columns.map((column, index) => <th scope="col" key={index}>{column}</th>)}</tr></thead>
          <tbody>{rows.map((row, index) => <tr key={index}><th scope="row">{labels[index]}</th>{row.map((value, column) => <td key={column}>{value === null ? STRINGS.status.unknown : formatValue(value)}</td>)}</tr>)}</tbody>
        </table></div>
      </figcaption>
    </figure>
  );
}

function UnknownSlot({ index, count }: { index: number; count: number }) {
  const slotWidth = width / count * 0.7;
  return <rect data-unknown={index} className="ob-chart-unknown" x={x(index, count) - slotWidth / 2} y={top} width={slotWidth} height={height} />;
}

export function BarChart({ title, data, series, formatValue, max }: BarChartProps) {
  const values = data.map(item => known(item.value) ? item.value : null);
  const available = values.filter(known);
  const maximum = Math.max(0, ...available, known(max) ? max : 0);
  const scale = height / (maximum || 1);
  const barWidth = width / Math.max(1, data.length) * 0.7;
  return <ChartFrame title={title} labels={data.map(item => item.label)} columns={[STRINGS.charts.value]} rows={values.map(value => [value])} maximum={available.length ? formatValue(maximum) : null} formatValue={formatValue}>
    {values.map((value, index) => value === null ? <UnknownSlot key={index} index={index} count={data.length} /> : (
      <rect key={index} data-bar={index} x={x(index, data.length) - barWidth / 2} y={bottom - Math.max(0, value) * scale} width={barWidth} height={Math.max(0, value) * scale} rx={Math.min(2, barWidth / 4)} style={{ fill: colors[series] }} />
    ))}
  </ChartFrame>;
}

export function StackedBarChart({ title, data, series, formatValue, max }: StackedBarChartProps) {
  const rows = data.map(item => series.map(part => known(item.values[part.key]) ? item.values[part.key] : null));
  const totals = rows.map(row => row.length && row.every(known) ? row.reduce((sum, value) => sum + Math.max(0, value), 0) : null);
  const available = totals.filter(known);
  const maximum = Math.max(0, ...available, known(max) ? max : 0);
  const scale = height / (maximum || 1);
  const barWidth = width / Math.max(1, data.length) * 0.7;
  return <ChartFrame title={title} labels={data.map(item => item.label)} columns={series.map(part => part.label)} rows={rows} maximum={available.length ? formatValue(maximum) : null} formatValue={formatValue}>
    {rows.map((row, index) => {
      if (totals[index] === null) return <UnknownSlot key={index} index={index} count={data.length} />;
      let offset = 0;
      return <g key={index} data-stack={index}>{row.map((value, part) => {
        const partHeight = Math.max(0, value ?? 0) * scale;
        offset += partHeight;
        return <rect key={part} data-bar={index} data-series={series[part].key} x={x(index, data.length) - barWidth / 2} y={bottom - offset} width={barWidth} height={partHeight} style={{ fill: colors[series[part].color] }} />;
      })}</g>;
    })}
  </ChartFrame>;
}

export function LineChart({ title, data, series, formatValue, min, max }: LineChartProps) {
  const values = data.map(item => known(item.value) ? item.value : null);
  const available = values.filter(known);
  const minimum = Math.min(...available, known(min) ? min : 0);
  const maximum = Math.max(...available, known(max) ? max : minimum);
  const y = (value: number) => bottom - (value - minimum) / (maximum - minimum || 1) * height;
  const segments: string[] = [];
  let segment = '';
  values.forEach((value, index) => {
    if (value === null) {
      if (segment) segments.push(segment);
      segment = '';
    } else segment += `${segment ? 'L' : 'M'}${x(index, data.length)} ${y(value)}`;
  });
  if (segment) segments.push(segment);
  return <ChartFrame title={title} labels={data.map(item => item.label)} columns={[STRINGS.charts.value]} rows={values.map(value => [value])} maximum={available.length ? formatValue(maximum) : null} formatValue={formatValue}>
    {segments.map((path, index) => <path key={index} className="ob-chart-line" d={path} style={{ stroke: colors[series] }} />)}
    {values.map((value, index) => value !== null && <circle key={index} data-point={index} cx={x(index, data.length)} cy={y(value)} r={2.5} style={{ fill: colors[series] }} />)}
  </ChartFrame>;
}
