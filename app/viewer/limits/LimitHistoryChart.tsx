import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { STRINGS } from '../../../lib/strings.generated';
import { format, deviceLabel } from '../../../lib/panel-data.mjs';

type Point = { host: string; t: number; r: number; x: number; source: string };
type Series = { host: string; name: string; points: Point[]; segments: Point[][] };
export type HistoryData = { provider: string; window: string; range: string; from: number; to: number; series: Series[]; resets: number[]; firstAt: number | null; startsHere: boolean; empty: boolean };
type Item = { t: number; rows: { host: string; label: string; value: number }[]; start?: number; end?: number };

const PAD = { left: 36, right: 12, top: 22, bottom: 22 };
const HOUR = 3600000, DAY = 24 * HOUR;

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

export const shortName = (series: { host: string; name: string }) => ['Mac', 'Windows'].includes(series.host) ? deviceLabel(series.host) : series.name;
const hostOrder = (host: string) => ['Mac', 'Windows'].indexOf(host) < 0 ? 2 : ['Mac', 'Windows'].indexOf(host);
const stamp = (t: number) => new Date(t).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const hour = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function calendarTicks(from: number, to: number, range: string, plotWidth: number) {
  const ticks: { t: number; label: string }[] = [];
  const cursor = new Date(from);
  const narrow = plotWidth < 360;
  if (range === 'today') {
    const step = narrow ? 6 : 3;
    cursor.setMinutes(0, 0, 0);
    cursor.setHours(Math.ceil(cursor.getHours() / step) * step);
    for (; cursor.getTime() <= to; cursor.setHours(cursor.getHours() + step))
      ticks.push({ t: cursor.getTime(), label: cursor.toLocaleTimeString([], { hour: 'numeric' }) });
  } else if (range === 'week') {
    cursor.setHours(24, 0, 0, 0);
    for (let index = 0; cursor.getTime() <= to; cursor.setDate(cursor.getDate() + 1), index++)
      if (!narrow || index % 2 === 0) ticks.push({ t: cursor.getTime(), label: cursor.toLocaleDateString([], { weekday: 'short' }) });
  } else if (range === 'month') {
    cursor.setHours(24, 0, 0, 0);
    while (cursor.getDay() !== 1) cursor.setDate(cursor.getDate() + 1);
    for (; cursor.getTime() <= to; cursor.setDate(cursor.getDate() + 7))
      ticks.push({ t: cursor.getTime(), label: cursor.toLocaleDateString([], { month: 'short', day: 'numeric' }) });
  } else if (to - from < 10 * DAY) {
    return calendarTicks(from, to, 'week', plotWidth);
  } else if (to - from < 90 * DAY) {
    return calendarTicks(from, to, 'month', plotWidth);
  } else {
    cursor.setDate(1); cursor.setHours(0, 0, 0, 0); cursor.setMonth(cursor.getMonth() + 1);
    const months = Math.max(1, Math.ceil((to - from) / (30 * DAY) / (narrow ? 3 : 6)));
    for (; cursor.getTime() <= to; cursor.setMonth(cursor.getMonth() + months))
      ticks.push({ t: cursor.getTime(), label: cursor.toLocaleDateString([], { month: 'short' }) });
  }
  return ticks;
}

export function LimitHistoryChart({ data, color, title }: { data: HistoryData; color: 'claude' | 'codex'; title: string; window: '5h' | 'week' | 'month' }) {
  const { ref, width } = useWidth();
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const height = width < 480 ? 140 : 164;
  const plotWidth = width - PAD.left - PAD.right, plotHeight = height - PAD.top - PAD.bottom;
  const span = Math.max(1, data.to - data.from);
  const sx = (t: number) => PAD.left + (Math.min(Math.max(t, data.from), data.to) - data.from) / span * plotWidth;
  const sy = (r: number) => PAD.top + (1 - r / 100) * plotHeight;
  const base = sy(0);
  const series = [...data.series].sort((a, b) => hostOrder(a.host) - hostOrder(b.host));
  const many = series.length > 1;
  const tone = (index: number) => index === 0 ? 'primary' : 'secondary';
  // Lines only. One column per 5-hour window read as a barcode at week and month scale.
  const items: Item[] = series.flatMap(item => item.points.map(point => ({ t: point.t, rows: [{ host: item.host, label: shortName(item), value: point.r }] })))
    .sort((a, b) => a.t - b.t);
  const shown = active !== null ? items[active] ?? null : null;
  const ticks = calendarTicks(data.from, data.to, data.range, plotWidth).filter(tick => sx(tick.t) - PAD.left > 16 && PAD.left + plotWidth - sx(tick.t) > 16);

  const describe = (item: Item | null | undefined) => !item ? STRINGS.limitHistory.noReadings
    : `${item.start !== undefined ? format(STRINGS.limitHistory.windowSpan, { start: stamp(item.start), end: hour(item.end!) }) : stamp(item.t)}: ${
      item.rows.map(row => `${row.label} ${format(STRINGS.limitHistory.left, { value: Math.round(row.value) })}`).join(', ')}`;
  const nearest = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const t = data.from + (event.clientX - box.left - PAD.left) / plotWidth * span;
    let best = -1, distance = Infinity;
    items.forEach((item, index) => { const d = Math.abs(item.t - t); if (d < distance) { distance = d; best = index; } });
    setActive(best >= 0 ? best : null);
  };
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!items.length) return;
    const last = items.length - 1, page = Math.max(1, Math.round(items.length / 10));
    const steps: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: page, PageDown: -page };
    if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); setActive(event.key === 'Home' ? 0 : last); }
    else if (event.key in steps) {
      event.preventDefault();
      const step = steps[event.key];
      setActive(current => Math.max(0, Math.min(last, (current ?? last) + step)));
    }
    if (event.key === 'Escape') setActive(null);
  };

  return (
    <figure className="ob-history-chart" ref={ref}>
      <span id={id} className="ob-visually-hidden">{title}</span>
      {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a drawn chart cannot be a native range input, so it takes the slider role */}
      <div className="ob-history-plot" role="slider" tabIndex={items.length ? 0 : -1} aria-labelledby={id}
        aria-valuemin={0} aria-valuemax={Math.max(0, items.length - 1)} aria-valuenow={active ?? Math.max(0, items.length - 1)}
        aria-valuetext={describe(shown ?? items.at(-1))}
        onPointerMove={nearest} onPointerLeave={() => setActive(null)} onKeyDown={keys} onBlur={() => setActive(null)}>
        <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
          {([100, 0] as number[]).map(value => <g key={value} className="ob-history-grid">
            <line x1={PAD.left} x2={PAD.left + plotWidth} y1={sy(value)} y2={sy(value)} />
            <text x={PAD.left - 6} y={sy(value) + 3.5} textAnchor="end">{value}%</text>
          </g>)}
          {ticks.map(tick => <text key={tick.t} className="ob-history-tick" x={sx(tick.t)} y={height - 5} textAnchor="middle">{tick.label}</text>)}
          {series.map(item => item.segments.slice(1).map((segment, part) => {
            // A gap in readings inside one window is drawn faint, so the line reads as one window, not fragments.
            const before = item.segments[part].at(-1)!, after = segment[0];
            if (Math.abs(before.x - after.x) > 5 * 60000) return null;
            return <line key={`${item.host}gap${part}`} className={`ob-history-gap ${color}`} x1={sx(before.t)} y1={sy(before.r)} x2={sx(after.t)} y2={sy(after.r)} />;
          }))}
          {series.map((item, index) => item.segments.map((segment, part) => segment.length === 1
            ? <circle key={`${item.host}${part}`} cx={sx(segment[0].t)} cy={sy(segment[0].r)} r={2.25} className={`ob-history-dot ${color} ${tone(index)}`} />
            : <polyline key={`${item.host}${part}`} className={`ob-history-line ${color} ${tone(index)}`}
              points={segment.map(point => `${sx(point.t).toFixed(1)},${sy(point.r).toFixed(1)}`).join(' ')} />))}
          {shown && <line className="ob-history-cursor" x1={sx(shown.t)} x2={sx(shown.t)} y1={PAD.top} y2={base} />}
          {data.empty && <text className="ob-history-empty" x={PAD.left + plotWidth / 2} y={PAD.top + plotHeight / 2} textAnchor="middle">{STRINGS.limitHistory.noReadings}</text>}
        </svg>
        {many && <div className="ob-history-key" aria-hidden="true">
          {series.map((item, index) => <span key={item.host}><i className={`${color} ${tone(index)}`} />{shortName(item)}</span>)}
        </div>}
        {shown && <div className="ob-history-tip" style={{ left: Math.min(Math.max(sx(shown.t) - 80, 0), width - 160) }} aria-live="polite">
          <span>{shown.start !== undefined ? format(STRINGS.limitHistory.windowSpan, { start: stamp(shown.start), end: hour(shown.end!) }) : stamp(shown.t)}</span>
          {shown.rows.map(row => <div key={row.host} className="ob-history-tip-row">
            <span>{row.label}</span><strong>{format(STRINGS.limitHistory.left, { value: Math.round(row.value) })}</strong>
          </div>)}
        </div>}
      </div>
      <div className="ob-visually-hidden"><table>
        <caption>{title}</caption>
        <thead><tr><th scope="col">{STRINGS.limitHistory.time}</th>{series.map(item => <th key={item.host} scope="col">{shortName(item)}</th>)}</tr></thead>
        <tbody>{items.slice(-200).reverse().map((item, index) => <tr key={index}>
          <th scope="row">{item.start !== undefined ? format(STRINGS.limitHistory.windowSpan, { start: stamp(item.start), end: hour(item.end!) }) : stamp(item.t)}</th>
          {series.map(entry => { const row = item.rows.find(part => part.host === entry.host); return <td key={entry.host}>{row ? format(STRINGS.limitHistory.left, { value: Math.round(row.value) }) : STRINGS.status.unknown}</td>; })}
        </tr>)}</tbody>
      </table></div>
    </figure>
  );
}
