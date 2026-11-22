// Small pieces the Limits, Tokens, Screen time, Drift and Settings views share: a block frame, a strip of
// numbers, a bar list, grey columns and the empty and Unknown states. Class names follow the design spec
// (SPEC-UI.md), so the tokens and base rules in r2.css style them.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Num, Part } from '../../../../lib/view-r2.mjs';
import { chartBuckets, type Bucket } from '../../../../lib/scope.mjs';

export const UNKNOWN = 'Unknown';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function money(value: number | null | undefined) {
  if (!finite(value)) return UNKNOWN;
  if (value >= 100) return `$${Math.round(value).toLocaleString('en-US')}`;
  return `$${value.toFixed(2)}`;
}

/** 1.98B, 61.2M, 25K. */
export function tokens(value: number | null | undefined) {
  if (!finite(value)) return UNKNOWN;
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${Math.round(value / 1e3)}K`;
  return String(Math.round(value));
}

/** 18h 8m, 42m. */
export function hours(seconds: number | null | undefined) {
  if (!finite(seconds)) return UNKNOWN;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** A share of a whole: one decimal under 10%, else whole. */
export function share(part: number | null | undefined, whole: number | null | undefined) {
  if (!finite(part) || !finite(whole) || whole <= 0) return UNKNOWN;
  const value = 100 * part / whole;
  if (value > 0 && value < 0.05) return '<0.1%';
  return `${value > 0 && value < 10 ? value.toFixed(1) : Math.round(value)}%`;
}

export const plural = (count: number, word: string) => `${count.toLocaleString('en-US')} ${word}${count === 1 ? '' : 's'}`;

export { clock, dayClock } from '../data';

/** YYYY-MM-DD in a time zone. */
export function dateIn(at: number, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

const utc = (date: string) => new Date(`${date}T00:00:00Z`);
/** "Nov 18" from a YYYY-MM-DD date. */
export function shortDate(date: string) { const day = utc(date); return `${MONTHS[day.getUTCMonth()]} ${day.getUTCDate()}`; }
/** "Wed 18" or "Wed Nov 18". */
export function weekday(date: string, long = false) {
  const day = utc(date);
  return long ? `${WEEKDAYS[day.getUTCDay()]} ${shortDate(date)}` : `${WEEKDAYS[day.getUTCDay()]} ${day.getUTCDate()}`;
}
export const monthLabel = (date: string) => MONTHS[utc(date).getUTCMonth()];
export function addDays(date: string, count: number) {
  const day = utc(date); day.setUTCDate(day.getUTCDate() + count); return day.toISOString().slice(0, 10);
}
/** "Nov 13 to 19", "Oct 30 to Nov 5". */
export function dateSpan(first: string, last: string) {
  if (first === last) return shortDate(first);
  return first.slice(0, 7) === last.slice(0, 7) ? `${shortDate(first)} to ${utc(last).getUTCDate()}` : `${shortDate(first)} to ${shortDate(last)}`;
}
/** "2d 10h", "5h 12m", "40m". */
export function span(milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return UNKNOWN;
  const minutes = Math.round(milliseconds / 60000);
  if (minutes < 60) return `${minutes}m`;
  const total = Math.floor(minutes / 60);
  return total < 48 ? `${total}h ${minutes % 60}m` : `${Math.floor(total / 24)}d ${total % 24}h`;
}

/** Device names joined for prose: "Studio", "Studio and Tower", "Studio, Tower and Lab". */
export function names(list: string[]) {
  return list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
}

type Span = 4 | 6 | 8 | 12;

/** A span 4 column beside a span 8 block: its blocks share the spare height, so both bottoms meet. */
export const Side = ({ children }: { children: ReactNode }) => <div className="side">{children}</div>;
/** The span 4 blocks that close a view, in one row of equal parts, so no cell is left empty. */
export const Tail = ({ children }: { children: ReactNode }) => <div className="tail">{children}</div>;

export function Block({ span = 4, title, sub, right, foot, className = '', children, label }: {
  span?: Span; title?: ReactNode; sub?: ReactNode; right?: ReactNode; foot?: ReactNode; className?: string; children?: ReactNode; label?: string;
}) {
  return (
    <section className={`blk s${span}${className ? ` ${className}` : ''}`} aria-label={label}>
      {title !== undefined && <div className="bh"><h3>{title}</h3>{sub !== undefined && <span className="fa">{sub}</span>}
        {right !== undefined && <><span className="fill" />{right}</>}</div>}
      {children}
      {foot !== undefined && <div className="foot">{foot}</div>}
    </section>
  );
}

export function Empty({ title, line }: { title: string; line: ReactNode }) {
  return <div className="empty"><b>{title}</b>{line}</div>;
}

/** A view that is one state block: off, Unknown or empty. */
export function StateView({ title, line }: { title: string; line: ReactNode }) {
  return <div className="grid more"><Block span={12}><Empty title={title} line={line} /></Block></div>;
}

export type Cell = { label: string; value: string; unit?: string; context?: ReactNode; mark?: boolean; unknown?: boolean; accent?: boolean };

/** A strip of numbers. The first cell is the lead, the rest step back. */
export function Strip({ cells, foot, four = false }: { cells: Cell[]; foot?: ReactNode; four?: boolean }) {
  return (
    <Block span={12} label="Headline numbers" foot={foot}>
      <div className={`strip${four ? ' n4' : ''}`} style={{ '--n': cells.length - 1 } as CSSProperties}>
        {cells.map((cell, index) => {
          const unknown = cell.unknown || cell.value === UNKNOWN;
          return (
            <div key={cell.label} className={`kpi${index === 0 ? ' lead' : ''}`}>
              <span className="l">{cell.mark && <i className="mark" aria-hidden="true" />}{cell.label}</span>
              <span className={`v${unknown ? ' unk' : ''}${cell.accent && !unknown ? ' acc' : ''}`}>{cell.value}{cell.unit && !unknown && <small>{cell.unit}</small>}</span>
              <span className="c">{cell.context ?? ' '}</span>
            </div>
          );
        })}
      </div>
    </Block>
  );
}

export type Bar = { key: string; label: string; value: number | null; text?: string; title?: string };

/** A ranked bar list: label, bar, amount and share of the list's total. Top `limit` rows, then "N more". */
export function BarList({ items, format, accent = false, limit = 0, max, shares = true }: {
  items: Bar[]; format: (value: number | null) => string; accent?: boolean; limit?: number; max?: number; shares?: boolean;
}) {
  let rows = [...items].sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  const total = rows.some(row => row.value === null) ? null : rows.reduce((sum, row) => sum + row.value!, 0);
  if (limit && rows.length > limit) {
    const rest = rows.slice(limit - 1);
    const value = rest.some(row => row.value === null) ? null : rest.reduce((sum, row) => sum + row.value!, 0);
    rows = [...rows.slice(0, limit - 1), { key: 'more', label: `${rest.length} more`, value }];
  }
  // zero-ok: bar length scale only
  const top = max ?? Math.max(...rows.map(row => row.value ?? 0), 0.0001);
  return (
    <div className="bl">
      {rows.map((row, index) => (
        <div key={row.key} style={{ display: 'contents' }}>
          <span className={`t${index === 0 ? ' t1' : ''}`} title={row.title ?? row.label}>{row.label}</span>
          <span className="bar"><i className={accent ? 'a' : undefined} style={{ width: `${row.value ? Math.max(1.5, 100 * row.value / top) : 0}%` }} /></span>
          <span className={`n${row.value === null ? ' fa' : ''}`}>{row.text ?? format(row.value)}</span>
          <span className="p">{shares && row.value !== null && total !== null ? share(row.value, total) : ''}</span>
        </div>
      ))}
    </div>
  );
}

/** Breakdown parts from a Num as bars. */
export const partBars = (parts: Part[] | undefined): Bar[] => (parts ?? []).map(part => ({ key: part.key, label: part.label, value: part.value }));

export type Column = { key: string; label: string; value: number | null; full: string; now?: boolean; future?: boolean; partial?: boolean };

/** The bar plot's drawing box before the plot is measured, as on the server. After that it is the plot's size in px. */
export const PLOT = { width: 1000, height: 100 } as const;
const MAX_BAR_PX = 46; // 2.9rem: the widest bar once the plot is measured
const MAX_BAR = 50; // the same in PLOT units, about 46 px at desktop width
const CORNER_PX = 2;

export type Segment = { value: number; className: string };
export type BarBox = { x: number; y: number; width: number; height: number; className: string };

/**
 * Where each column's bars sit in a `width` by `height` box. A column is a stack of segments drawn from the
 * baseline (y = height) up, each segment's height its value over `max` times the plot height. `max` comes from the
 * data: the largest column total by default. A null column (Unknown) and a column with no segments draw no bar.
 */
export function plotBoxes(columns: (Segment[] | null)[], max?: number, { width = PLOT.width as number, height = PLOT.height as number, maxBar = MAX_BAR }: { width?: number; height?: number; maxBar?: number } = {}): { slot: number; barWidth: number; top: number; bars: BarBox[][] } {
  // zero-ok: an Unknown column sets no scale
  const top = max ?? Math.max(...columns.map(column => (column ?? []).reduce((sum, part) => sum + part.value, 0)), 0);
  const slot = width / Math.max(columns.length, 1), barWidth = Math.min(slot * 0.78, maxBar);
  const bars = columns.map((column, index) => {
    let base = height;
    return (column ?? []).filter(part => part.value > 0 && top > 0).map(part => {
      const size = height * part.value / top;
      base -= size;
      return { x: index * slot + (slot - barWidth) / 2, y: base, width: barWidth, height: size, className: part.className };
    });
  });
  return { slot, barWidth, top, bars };
}

const n = (value: number) => Number(value.toFixed(3));
/** A bar with its top corners rounded (radius `rx` across, `ry` down) and a square foot on the baseline. Its bounding box is the bar. */
export function barPath({ x, y, width, height }: BarBox, rx: number, ry: number) {
  const a = Math.min(rx, width / 2), b = Math.min(ry, height);
  return `M${n(x)},${n(y + height)} L${n(x)},${n(y + b)} Q${n(x)},${n(y)} ${n(x + a)},${n(y)} L${n(x + width - a)},${n(y)} Q${n(x + width)},${n(y)} ${n(x + width)},${n(y + b)} L${n(x + width)},${n(y + height)} Z`;
}

export type PlotColumn = {
  key: string; segments: Segment[] | null; future?: boolean; title?: string; label?: ReactNode; peak?: boolean;
  /** A column that opens something is a button. */
  button?: { onClick: () => void; ariaLabel: string };
  hover?: { onEnter: () => void; onLeave: () => void };
  className?: string;
};

/**
 * Columns as one SVG of bars that grow from the baseline, with an HTML layer over it for the value labels, the
 * hover titles and clicks. The bar geometry is SVG coordinates, so it never depends on how a browser resolves a
 * percentage height inside a flex or grid cell. On the server the SVG is drawn in PLOT units and stretched. In the
 * browser the plot is measured, so bars are drawn in px with a fixed maximum width and round top corners.
 * An Unknown column draws a dashed outline (`unknown: 'outline'`, `unknownHeight` percent of the plot tall) or a
 * flat line on the baseline (`unknown: 'line'`), never a bar of 0.
 */
export function BarPlot({ columns, max, className = 'spend', unknown = 'outline', unknownHeight }: {
  columns: PlotColumn[]; max?: number; className?: string; unknown?: 'outline' | 'line'; unknownHeight?: number;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize(last => last && last.width === width && last.height === height ? last : { width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const width = size?.width ?? PLOT.width, height = size?.height ?? PLOT.height;
  const { slot, barWidth, top, bars } = plotBoxes(columns.map(column => column.future ? [] : column.segments), max, { width, height, maxBar: size ? MAX_BAR_PX : MAX_BAR });
  // Round corners of CORNER_PX on screen. Before the plot is measured, one unit across and down is not one px.
  const rx = size ? CORNER_PX : CORNER_PX * PLOT.width / 900, ry = size ? CORNER_PX : CORNER_PX * PLOT.height / 176;
  const unknownTall = height * (unknownHeight ?? (unknown === 'outline' ? 14 : 2)) / 100;
  return (
    <div className={`plot ${className}`}>
      <svg ref={ref} className="bars" viewBox={`0 0 ${n(width)} ${n(height)}`} preserveAspectRatio="none" aria-hidden="true" data-max={top}>
        {columns.map((column, index) => column.segments === null && !column.future
          ? <rect key={column.key} className={`unk ${unknown}`} x={n(index * slot + (slot - barWidth) / 2)} y={n(height - unknownTall)} width={n(barWidth)} height={n(unknownTall)} />
          : <g key={column.key} className={[column.className, hovered === column.key ? 'on' : ''].filter(Boolean).join(' ') || undefined}
              data-value={column.future ? undefined : (column.segments ?? []).reduce((sum, part) => sum + part.value, 0)}>
              {bars[index].map((bar, part) => <path key={part} className={`bar ${bar.className}`} d={barPath(bar, part === bars[index].length - 1 ? rx : 0, part === bars[index].length - 1 ? ry : 0)} />)}
            </g>)}
      </svg>
      <div className="hits">
        {columns.map((column, index) => {
          const reach = bars[index].length ? height - Math.min(...bars[index].map(bar => bar.y)) : column.segments === null && !column.future ? unknownTall : 0;
          const body = column.label ? <em className={column.peak ? 'peak' : undefined} style={{ bottom: `${100 * reach / height}%` }}>{column.label}</em> : null;
          const name = `col${column.future || !column.button ? ' empty' : ''}${column.className ? ` ${column.className}` : ''}`;
          const enter = () => { setHovered(column.key); column.hover?.onEnter(); }, leave = () => { setHovered(null); column.hover?.onLeave(); };
          const read = column.future ? {} : { onMouseEnter: enter, onMouseLeave: leave, onFocus: enter, onBlur: leave };
          return column.button
            ? <button key={column.key} type="button" className={name} aria-label={column.button.ariaLabel} title={column.title} onClick={column.button.onClick} {...read}>{body}</button>
            : <div key={column.key} className={name} title={column.title} role={column.title ? 'img' : undefined} aria-label={column.title} {...read}>{body}</div>;
        })}
      </div>
    </div>
  );
}

/** Grey columns with value labels: on every column when there are 12 or fewer, else on the peak only. */
export function Columns({ columns, format, hint, className }: { columns: Column[]; format: (value: number | null) => string; hint?: string; className?: string }) {
  // zero-ok: column height scale only
  const top = Math.max(...columns.map(column => column.value ?? 0), 0);
  const peak = top > 0 ? columns.findIndex(column => column.value === top) : -1;
  return (
    <div className="chart">
      <BarPlot columns={columns.map((column, index) => ({
        key: column.key, future: column.future, peak: index === peak,
        segments: column.value === null ? null : [{ value: column.value, className: className ?? 'grey' }],
        title: column.future ? undefined : `${column.full}: ${format(column.value)}`,
        label: column.value && (index === peak || columns.length <= 12) ? format(column.value) : undefined,
      }))} />
      <div className="xl">{columns.map((column, index) => <span key={column.key} className={column.now ? 'now' : undefined}>{thinLabel(columns, index)}</span>)}</div>
      {hint !== undefined && <div className="read">{hint}</div>}
    </div>
  );
}

/** Every label when they fit, else every few, always keeping the current one. */
export function thinLabel(columns: { label: string; now?: boolean }[], index: number) {
  const every = columns.length <= 14 ? 1 : columns.length <= 31 ? 3 : Math.ceil(columns.length / 10);
  return index % every === 0 || columns[index].now ? columns[index].label : '';
}

export const numText = (num: Num | null | undefined) => num ? num.value === null ? UNKNOWN : num.text : UNKNOWN;

type PeriodLike = { unit: 'day' | 'week' | 'month' | 'year' | 'all'; first: string; last: string; dates: string[] };

/**
 * A bucket's short label under its column and its full name for the title. A part week says where it starts
 * ("Jul 22+") and its title gives its dates ("Jul 22 to 26, part of a week"), so it never reads as a whole week.
 */
export function bucketText(unit: PeriodLike['unit'], { key, dates, partial }: Bucket): { label: string; full: string } {
  if (unit === 'year') return { label: monthLabel(key), full: `${monthLabel(key)} ${key.slice(0, 4)}` };
  if (unit === 'all') return partial
    ? { label: `${shortDate(dates[0])}+`, full: `${dateSpan(dates[0], dates.at(-1)!)}, part of a week` }
    : { label: shortDate(key), full: `Week of ${shortDate(key)}` };
  return { label: unit === 'month' ? String(Number(key.slice(8))) : weekday(key).split(' ')[0], full: weekday(key, true) };
}

/**
 * Chart columns, one per bucket of lib/scope.mjs chartBuckets: days for a week or month, months for a year,
 * calendar weeks from Monday for all time. `valueOf` gets the bucket and its dates up to today. Buckets after today
 * draw empty.
 */
export function bucketColumns(period: PeriodLike, today: string, valueOf: (bucket: Bucket, past: string[]) => number | null): Column[] {
  return chartBuckets(period).map(bucket => {
    const past = bucket.dates.filter(date => date <= today);
    return { key: bucket.key, ...bucketText(period.unit, bucket), value: past.length ? valueOf(bucket, past) : 0, partial: bucket.partial, now: bucket.dates.includes(today), future: past.length === 0 };
  });
}

/** Daily values as chart columns. A bucket with an Unknown day is Unknown. A date with no value was not read, so it is Unknown, never 0. */
export function dayColumns(period: PeriodLike, values: Map<string, number | null>, today: string): Column[] {
  return bucketColumns(period, today, (_, past) => {
    const known = past.map(date => values.has(date) ? values.get(date)! : null);
    return known.some(item => item === null) ? null : (known as number[]).reduce((sum, item) => sum + item, 0);
  });
}

/** "per day", "per month" and so on, for a chart header. */
export const bucketWord = (unit: PeriodLike['unit']) => ({ day: 'hour', week: 'day', month: 'day', year: 'month', all: 'week' })[unit];
