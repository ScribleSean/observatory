import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { STRINGS } from '../../../lib/strings.generated';
import { format } from '../../../lib/panel-data.mjs';
import { windowColumns, dailyColumns, paceGuide } from '../../../lib/view-limit-history.mjs';

type Point = { host: string; t: number; r: number; x: number; source: string };
type Series = { host: string; name: string; points: Point[]; segments: Point[][] };
export type HistoryData = { provider: string; window: string; range: string; from: number; to: number; series: Series[]; resets: number[]; firstAt: number | null; startsHere: boolean; empty: boolean };
type Column = { start: number; end: number; low: number; readings: number; lastAt: number };
// One thing the pointer or keyboard can land on: a reading in line mode, a window in column mode.
type Item = { t: number; rows: { host: string; label: string; value: number }[]; start?: number; end?: number };

const PAD = { left: 36, right: 34, top: 22, bottom: 22 };
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

// Short computer names match the menu bar panel.
export const shortName = (series: { host: string; name: string }) => series.host === 'Windows' ? 'PC' : series.host === 'Mac' ? 'Mac' : series.name;
const stamp = (t: number) => new Date(t).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const hour = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// Ticks fall on calendar boundaries: hours today, midnights over a week, Mondays over a month, months beyond.
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

export function LimitHistoryChart({ data, color, title, window }: { data: HistoryData; color: 'claude' | 'codex'; title: string; window: '5h' | 'week' }) {
  const { ref, width } = useWidth();
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  // The 5-hour window over days reads best as one column per window. Today stays a line.
  const columns = window === '5h' && data.range !== 'today';
  const height = width < 480 ? 140 : 164;
  const plotWidth = width - PAD.left - PAD.right, plotHeight = height - PAD.top - PAD.bottom;
  const span = Math.max(1, data.to - data.from);
  const sx = (t: number) => PAD.left + (Math.min(Math.max(t, data.from), data.to) - data.from) / span * plotWidth;
  const sy = (r: number) => PAD.top + (1 - r / 100) * plotHeight;
  const base = sy(0);
  const series = data.series;
  const many = series.length > 1;
  const tone = (index: number) => index === 0 ? 'primary' : 'secondary';

  // A window column needs a few pixels. Over long ranges the windows are grouped by day instead.
  const daily = columns && 5 * HOUR / span * plotWidth < 6;
  const columnSets = series.map(item => {
    const windows = windowColumns(item.points, window) as Column[];
    const shown = daily ? dailyColumns(windows) as Column[] : windows;
    // Only columns whose middle is in view, so nothing piles up at the edges.
    return shown.filter(column => { const middle = (column.start + column.end) / 2; return middle >= data.from && middle <= data.to; });
  });
  // The guide answers one question: will this week last? So only each computer's current window gets one,
  // from its own reset. Computers that share a window draw it once.
  const guide = window === 'week' ? series.flatMap(item => paceGuide(item.points, 'week', data.from, data.to).slice(-1).filter(segment => segment.used))
    .filter((segment, index, list) => list.findIndex(other => Math.abs(other.end - segment.end) <= 5 * 60000) === index) : [];

  // In column mode one item is one window (or day): the computers' columns that overlap it, together.
  const items: Item[] = columns
    ? columnSets.flatMap((set, index) => set.map(column => ({ column, index })))
      .sort((a, b) => (a.column.start + a.column.end) - (b.column.start + b.column.end))
      .reduce<{ start: number; end: number; parts: { column: Column; index: number }[] }[]>((groups, part) => {
        const last = groups.at(-1);
        const middle = (part.column.start + part.column.end) / 2;
        if (last && middle < last.end && !last.parts.some(other => other.index === part.index)) { last.parts.push(part); last.end = Math.max(last.end, part.column.end); }
        else groups.push({ start: part.column.start, end: part.column.end, parts: [part] });
        return groups;
      }, [])
      .map(group => ({ t: (group.start + group.end) / 2, start: group.start, end: group.end,
        rows: group.parts.sort((a, b) => a.index - b.index).map(({ column, index }) => ({ host: series[index].host, label: shortName(series[index]), value: column.low })) }))
    : series.flatMap(item => item.points.map(point => ({ t: point.t, rows: [{ host: item.host, label: shortName(item), value: point.r }] })))
      .sort((a, b) => a.t - b.t);
  const shown = active !== null ? items[active] ?? null : null;
  const ticks = calendarTicks(data.from, data.to, data.range, plotWidth).filter(tick => sx(tick.t) - PAD.left > 16 && PAD.left + plotWidth - sx(tick.t) > 16);

  const describe = (item: Item | null | undefined) => !item ? STRINGS.limitHistory.noReadings
    : `${item.start !== undefined ? format(STRINGS.limitHistory.windowSpan, { start: stamp(item.start), end: hour(item.end!) }) : stamp(item.t)}: ${
      item.rows.map(row => `${row.label} ${format(columns ? STRINGS.limitHistory.lowest : STRINGS.limitHistory.left, { value: Math.round(row.value) })}`).join(', ')}`;
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
      // Keyboard movement starts from the reading that is announced: the newest one.
      setActive(current => Math.max(0, Math.min(last, (current ?? last) + step)));
    }
    if (event.key === 'Escape') setActive(null);
  };

  // Direct labels at the end of each line, nudged apart when they would overlap.
  // They sit in the right-hand gutter, clear of the lines.
  const ends = !columns && many ? series.map((item, index) => {
    const last = item.points.at(-1);
    return last ? { label: shortName(item), x: PAD.left + plotWidth + 6, y: sy(last.r), index } : null;
  }).filter(Boolean) as { label: string; x: number; y: number; index: number }[] : [];
  ends.sort((a, b) => a.y - b.y).forEach((end, index, list) => { if (index > 0 && end.y - list[index - 1].y < 12) end.y = list[index - 1].y + 12; });

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
          {!columns && data.resets.map(t => <line key={t} className="ob-history-reset" x1={sx(t)} x2={sx(t)} y1={PAD.top} y2={base} />)}
          {guide.map(segment => <line key={segment.end} className="ob-history-guide" x1={sx(segment.t1)} y1={sy(segment.r1)} x2={sx(segment.t2)} y2={sy(segment.r2)}><title>{STRINGS.limitHistory.paceGuide}</title></line>)}
          {columns && columnSets.map((set, index) => set.map(column => {
            // Slim columns at the middle of each window or day, one per computer side by side.
            const room = Math.max(1.5, (column.end - column.start) / span * plotWidth - 1);
            const w = Math.max(1.5, Math.min(5, room / series.length - 1));
            const x = sx((column.start + column.end) / 2) - (series.length * (w + 1)) / 2 + index * (w + 1);
            // A window that ran out is a short stub on the baseline, so it reads as empty, not missing.
            const state = column.low <= 0.5 ? 'empty' : '';
            const top = state ? base - 3 : sy(column.low);
            return <rect key={`${index}-${column.end}`} className={`ob-history-column ${color} ${tone(index)} ${state}`}
              x={x} y={top} width={w} height={Math.max(1, base - top)} rx={Math.min(1.5, w / 2)} />;
          }))}
          {!columns && series.map((item, index) => item.segments.map((segment, part) => segment.length === 1
            ? <circle key={`${item.host}${part}`} cx={sx(segment[0].t)} cy={sy(segment[0].r)} r={2.25} className={`ob-history-dot ${color} ${tone(index)}`} />
            : <polyline key={`${item.host}${part}`} className={`ob-history-line ${color} ${tone(index)}`}
              points={segment.map(point => `${sx(point.t).toFixed(1)},${sy(point.r).toFixed(1)}`).join(' ')} />))}
          {ends.map(end => <text key={end.label} className={`ob-history-end ${color} ${tone(end.index)}`} x={end.x} y={end.y + 3.5}>{end.label}</text>)}
          {shown && <line className="ob-history-cursor" x1={sx(shown.t)} x2={sx(shown.t)} y1={PAD.top} y2={base} />}
          {data.empty && <text className="ob-history-empty" x={PAD.left + plotWidth / 2} y={PAD.top + plotHeight / 2} textAnchor="middle">{STRINGS.limitHistory.noReadings}</text>}
        </svg>
        {columns && many && <div className="ob-history-key" aria-hidden="true">
          {series.map((item, index) => <span key={item.host}><i className={`${color} ${tone(index)}`} />{shortName(item)}</span>)}
        </div>}
        {shown && <div className="ob-history-tip" style={{ left: Math.min(Math.max(sx(shown.t) - 80, 0), width - 160) }} aria-live="polite">
          <span>{shown.start !== undefined ? format(STRINGS.limitHistory.windowSpan, { start: stamp(shown.start), end: hour(shown.end!) }) : stamp(shown.t)}</span>
          {shown.rows.map(row => <div key={row.host} className="ob-history-tip-row">
            <span>{row.label}</span><strong>{format(columns ? STRINGS.limitHistory.lowest : STRINGS.limitHistory.left, { value: Math.round(row.value) })}</strong>
          </div>)}
        </div>}
      </div>
      <table className="ob-visually-hidden">
        <caption>{title}</caption>
        <thead><tr><th scope="col">{STRINGS.limitHistory.time}</th>{series.map(item => <th key={item.host} scope="col">{shortName(item)}</th>)}</tr></thead>
        <tbody>{items.slice(-200).reverse().map((item, index) => <tr key={index}>
          <th scope="row">{item.start !== undefined ? format(STRINGS.limitHistory.windowSpan, { start: stamp(item.start), end: hour(item.end!) }) : stamp(item.t)}</th>
          {series.map(entry => { const row = item.rows.find(part => part.host === entry.host); return <td key={entry.host}>{row ? format(columns ? STRINGS.limitHistory.lowest : STRINGS.limitHistory.left, { value: Math.round(row.value) }) : STRINGS.status.unknown}</td>; })}
        </tr>)}</tbody>
      </table>
    </figure>
  );
}
