import { useEffect, useId, useRef, useState } from 'react';
import { STRINGS } from '../../../lib/strings.generated';
import './charts.css';

export type ChartColor = 'claude' | 'codex' | 'accent';
/** `date` is a calendar day (YYYY-MM-DD). When every point has one, the x labels follow the calendar. */
// value: a number, null when the day was recorded with an unknown total, undefined when there is no record of it.
export type ChartPoint = { label: string; value?: number | null; date?: string };
export type BarChartProps = {
  title: string;
  data: ChartPoint[];
  series: ChartColor;
  formatValue: (value: number) => string;
  max?: number;
};

const TOP = 18;
const AXIS = 22;
const STUB = 6;
const colors = { claude: 'var(--ob-claude)', codex: 'var(--ob-codex)', accent: 'var(--ob-accent)' };
const known = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);
const day = (date: string) => new Date(`${date}T00:00:00Z`);
const valid = (date: string | undefined): date is string => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(day(date).getTime());
const monthDay = (date: string) => day(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const weekday = (date: string) => day(date).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(200, Math.round(entries[0].contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/** At most six labels. Thirty days label Mondays, a week labels weekdays, anything else is spaced evenly. */
export function axisLabels(data: ChartPoint[]): { index: number; text: string }[] {
  const dates = data.map(point => point.date);
  if (dates.length && dates.every(valid)) {
    if (dates.length <= 7) return dates.map((date, index) => ({ index, text: weekday(date) }));
    const mondays = dates.flatMap((date, index) => day(date).getUTCDay() === 1 ? [index] : []);
    const stride = Math.ceil(mondays.length / 6);
    return mondays.filter((_, order) => order % stride === 0).map(index => ({ index, text: monthDay(dates[index]) }));
  }
  const stride = Math.max(1, Math.ceil(data.length / 6));
  return data.flatMap((point, index) => index % stride === 0 ? [{ index, text: point.label }] : []);
}

/** A bar with only its top corners rounded. */
function bar(x: number, y: number, width: number, height: number) {
  const r = Math.min(2, width / 2, height);
  return `M${x} ${y + height}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + width - r}Q${x + width} ${y} ${x + width} ${y + r}V${y + height}Z`;
}

export function BarChart({ title, data, series, formatValue, max, quietTitle = false }: BarChartProps & { quietTitle?: boolean }) {
  const id = useId();
  const { ref, width } = useWidth();
  const values = data.map(item => item.value === undefined ? undefined : known(item.value) ? item.value : null);
  const available = values.filter(known);
  const maximum = Math.max(0, ...available, known(max) ? max : 0);
  const height = width < 480 ? 150 : 180;
  const baseline = height - AXIS;
  const plot = baseline - TOP;
  const band = width / Math.max(1, data.length);
  const barWidth = Math.max(1, Math.min(28, band * 0.6));
  const center = (index: number) => (index + 0.5) * band;
  const names = data.map(point => valid(point.date) ? monthDay(point.date) : point.label);
  const shown = (value: number | null | undefined) => value === undefined ? STRINGS.charts.notRecorded : value === null ? STRINGS.status.unknown : formatValue(value);
  return (
    <figure className="ob-bars">
      <div className="ob-bars-head">
        {/* Where the card already names the chart, the title is for screen readers only. */}
        <h3 id={id} className={quietTitle ? 'ob-visually-hidden' : undefined}>{title}</h3>
        {!available.length && <span className="ob-meta">{STRINGS.status.unknown}</span>}
      </div>
      <div ref={ref} className="ob-bars-plot">
        {/* Inline SVG needs an image role to expose its title as one graphic */}
        {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role */}
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={id}>
          {available.length > 0 && <>
            <line className="ob-bars-top" x1={0} x2={width} y1={TOP + 0.5} y2={TOP + 0.5} />
            <text className="ob-bars-max" x={0} y={TOP - 6}>{formatValue(maximum)}</text>
          </>}
          {values.map((value, index) => {
            const x = center(index) - barWidth / 2;
            if (value === undefined) return null;
            if (value === null) return <rect key={index} data-unknown={index} className="ob-bars-unknown" x={x + 0.5} y={baseline - STUB + 0.5} width={Math.max(0, barWidth - 1)} height={STUB - 1} rx={1}><title>{`${names[index]}: ${STRINGS.status.unknown}`}</title></rect>;
            const barHeight = Math.max(0, value) / (maximum || 1) * plot;
            if (barHeight <= 0) return null;
            return <path key={index} data-bar={index} d={bar(x, baseline - barHeight, barWidth, barHeight)} style={{ fill: colors[series] }}><title>{`${names[index]}: ${formatValue(value)}`}</title></path>;
          })}
          <line className="ob-bars-baseline" x1={0} x2={width} y1={baseline + 0.5} y2={baseline + 0.5} />
          {axisLabels(data).map(({ index, text }) => {
            const x = center(index);
            const half = text.length * 3.3;
            const anchor = x - half < 0 ? 'start' : x + half > width ? 'end' : 'middle';
            return <text key={index} className="ob-bars-label" x={anchor === 'start' ? 0 : anchor === 'end' ? width : x} y={height - 6} textAnchor={anchor}>{text}</text>;
          })}
        </svg>
      </div>
      {/* Exact values: each bar's hover title, and this table for screen readers. */}
      <div className="ob-visually-hidden">
        <table>
          <thead><tr><th scope="col">{STRINGS.charts.item}</th><th scope="col">{STRINGS.charts.value}</th></tr></thead>
          <tbody>{values.map((value, index) => <tr key={index}><th scope="row">{names[index]}</th><td>{shown(value)}</td></tr>)}</tbody>
        </table>
      </div>
    </figure>
  );
}
