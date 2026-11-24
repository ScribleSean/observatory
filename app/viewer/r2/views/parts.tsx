// Small pieces the Limits, Tokens, Screen time, Drift and Settings views share: a block frame, a strip of
// numbers, a bar list, grey columns and the empty and Unknown states. Class names follow the design spec
// (SPEC-UI.md), so the tokens and base rules in r2.css style them.
import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
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

export type Column = { key: string; label: string; brief?: string; value: number | null; full: string; now?: boolean; future?: boolean; partial?: boolean; n?: number };

/** The bar plot's drawing box before the plot is measured, as on the server. After that it is the plot's size in px. */
export const PLOT = { width: 1000, height: 100 } as const;
const MAX_BAR_PX = 46; // 2.9rem: the widest bar once the plot is measured
const MAX_BAR = 50; // the same in PLOT units, about 46 px at desktop width
const CORNER_PX = 2;
const LABEL_CHAR_PX = 6.4, LABEL_GAP_PX = 6; // a value or axis label is 10.5 px type with tabular figures

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

/**
 * A plot's value scale. `format` writes a tick ("$200", "1.5B", "4h"). `unit` is what one step counts in, given the
 * plot's max: 3600 for hours of seconds, so ticks fall on whole hours. `whole` keeps ticks on whole numbers (counts).
 * `few` draws one tick near the top for a short plot, where more would crowd.
 */
export type Axis = { format: (value: number) => string; unit?: (max: number) => number; whole?: boolean; few?: boolean };

/**
 * The values a scale marks between the baseline (0, always first) and the data's max: round steps of 1, 2, 2.5 or 5
 * times a power of ten, two to five of them, or the one roundest value near the top when `few`. The plot's top is
 * the data's max, never a rounded-up number, so the tallest bar always fills the plot.
 */
export function axisTicks(max: number, { whole = false, few = false }: { whole?: boolean; few?: boolean } = {}): number[] {
  if (!(max > 0) || !Number.isFinite(max)) return [0];
  const target = few ? max : max / 2.5;
  const power = 10 ** Math.floor(Math.log10(target));
  const lead = (few ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : [1, 2, 2.5, 5]).findLast(each => each * power <= target * (1 + 1e-9)) ?? 1;
  let step = lead * power;
  if (whole) step = Math.max(1, Math.floor(step));
  const ticks = [0];
  for (let tick = step; tick <= max * (1 + 1e-9) && ticks.length < 7; tick += step) { ticks.push(Number(tick.toPrecision(12))); if (few) break; }
  return ticks;
}

/** 1.5B, 500M, 25K, 300, 2.5: a short number for a scale. */
export function short(value: number) {
  const cut = (amount: number, unit: string) => `${Number(amount.toPrecision(3))}${unit}`;
  return value >= 1e9 ? cut(value / 1e9, 'B') : value >= 1e6 ? cut(value / 1e6, 'M') : value >= 1e4 ? cut(value / 1e3, 'K') : Number(value.toPrecision(3)).toLocaleString('en-US');
}
export const moneyAxis: Axis = { format: value => `$${short(value)}` };
export const countAxis: Axis = { format: short, whole: true };
export const tokenAxis: Axis = { format: short, whole: true };
/** Seconds on a scale of whole hours, or of minutes when the largest column is under two hours. */
export const timeAxis: Axis = {
  unit: max => max >= 7200 ? 3600 : 60,
  format: value => value === 0 ? '0' : value % 3600 === 0 ? `${value / 3600}h` : value >= 3600 ? `${Number((value / 3600).toFixed(1))}h` : `${Math.round(value / 60)}m`,
};

export type PlotColumn = {
  key: string; segments: Segment[] | null; future?: boolean; title?: string; peak?: boolean;
  /** The value over the column. Every column may carry one: the plot shows them all when they fit, else the peak's only. */
  label?: string;
  /** A column that opens something is a button. */
  button?: { onClick: () => void; ariaLabel: string };
  hover?: { onEnter: () => void; onLeave: () => void };
  className?: string;
};

/** The size of an element's content box in px once it is laid out, and null before that (and on the server). */
function useSize<T extends Element>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
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
  return [ref, size] as const;
}

/**
 * Columns as one SVG of bars that grow from the baseline, with an HTML layer over it for the value labels, the
 * hover titles and clicks. The bar geometry is SVG coordinates, so it never depends on how a browser resolves a
 * percentage height inside a flex or grid cell. On the server the SVG is drawn in PLOT units and stretched. In the
 * browser the plot is measured, so bars are drawn in px with a fixed maximum width and round top corners.
 *
 * Every plot has the same parts. The baseline is the plot's bottom edge, and every bar stands on it. With `axis`
 * the plot has a value scale: a rule across the plot at each tick and the tick's value in a `.ticks` column drawn
 * before the plot (a BarChart lines these columns up across its bands). An Unknown column is a dashed outline
 * (`unknownHeight` percent of the plot tall), never a bar of 0, and says Unknown over it when the labels fit. A
 * column after today draws nothing. Value labels show on every column when the widest fits its column, else on
 * the peak only.
 */
export function BarPlot({ columns, max, className = 'spend', unknownHeight = 14, axis, unknownLabel = true }: {
  columns: PlotColumn[]; max?: number; className?: string; unknownHeight?: number; axis?: Axis; unknownLabel?: boolean;
}) {
  const [ref, size] = useSize<SVGSVGElement>();
  const [hovered, setHovered] = useState<string | null>(null);
  const width = size?.width ?? PLOT.width, height = size?.height ?? PLOT.height;
  const { slot, barWidth, top, bars } = plotBoxes(columns.map(column => column.future ? [] : column.segments), max, { width, height, maxBar: size ? MAX_BAR_PX : MAX_BAR });
  // Round corners of CORNER_PX on screen. Before the plot is measured, one unit across and down is not one px.
  const rx = size ? CORNER_PX : CORNER_PX * PLOT.width / 900, ry = size ? CORNER_PX : CORNER_PX * PLOT.height / 176;
  const isUnknown = (column: PlotColumn) => column.segments === null && !column.future;
  // An Unknown mark is tall enough to see in a short plot.
  const unknownTall = Math.min(height, Math.max(height * unknownHeight / 100, size ? 10 : 0));
  const labelOf = (column: PlotColumn) => column.future ? '' : isUnknown(column) ? unknownLabel ? UNKNOWN : '' : column.label ?? '';
  // Every label when the widest fits a column (12 columns or fewer before the plot is measured), else the peak's only.
  const widest = Math.max(...columns.map(column => labelOf(column).length), 0);
  const allFit = size ? widest * LABEL_CHAR_PX + LABEL_GAP_PX <= slot : columns.length <= 12;
  const step = axis?.unit?.(top) ?? 1;
  const ticks = axis && top > 0 ? axisTicks(top / step, axis).map(tick => tick * step) : [];
  return (
    <>
      {axis && <div className={`ticks ${className}`} aria-hidden="true">
        {/* The widest value, in flow and unseen, gives the column its width. The values themselves hang at their heights. */}
        <b>{ticks.map(tick => axis.format(tick)).reduce((longest, text) => text.length > longest.length ? text : longest, '0')}</b>
        {ticks.map(tick => <span key={tick} style={{ bottom: `${n(100 * tick / top)}%` }}>{axis.format(tick)}</span>)}
      </div>}
      <div className={`plot ${className}`}>
        {ticks.filter(tick => tick > 0).map(tick => <i key={tick} className="rule" style={{ bottom: `${n(100 * tick / top)}%` }} />)}
        <svg ref={ref} className="bars" viewBox={`0 0 ${n(width)} ${n(height)}`} preserveAspectRatio="none" aria-hidden="true" data-max={top}>
          {columns.map((column, index) => isUnknown(column)
            ? <rect key={column.key} className="unk outline" x={n(index * slot + (slot - barWidth) / 2)} y={n(height - unknownTall)} width={n(barWidth)} height={n(unknownTall)} />
            : <g key={column.key} className={[column.className, hovered === column.key ? 'on' : ''].filter(Boolean).join(' ') || undefined}
                data-value={column.future ? undefined : (column.segments ?? []).reduce((sum, part) => sum + part.value, 0)}>
                {bars[index].map((bar, part) => <path key={part} className={`bar ${bar.className}`} d={barPath(bar, part === bars[index].length - 1 ? rx : 0, part === bars[index].length - 1 ? ry : 0)} />)}
              </g>)}
        </svg>
        <div className="hits">
          {columns.map((column, index) => {
            const reach = bars[index].length ? height - Math.min(...bars[index].map(bar => bar.y)) : isUnknown(column) ? unknownTall : 0;
            const text = allFit || column.peak ? labelOf(column) : '';
            const body = text ? <em className={column.peak ? 'peak' : undefined} style={{ bottom: `${n(100 * reach / height)}%` }}>{text}</em> : null;
            const name = `col${column.future || !column.button ? ' empty' : ''}${column.className ? ` ${column.className}` : ''}`;
            const enter = () => { setHovered(column.key); column.hover?.onEnter(); }, leave = () => { setHovered(null); column.hover?.onLeave(); };
            const read = column.future ? {} : { onMouseEnter: enter, onMouseLeave: leave, onFocus: enter, onBlur: leave };
            return column.button
              ? <button key={column.key} type="button" className={name} aria-label={column.button.ariaLabel} title={column.title} onClick={column.button.onClick} {...read}>{body}</button>
              : <div key={column.key} className={name} title={column.title} role={column.title ? 'img' : undefined} aria-label={column.title} {...read}>{body}</div>;
          })}
        </div>
      </div>
    </>
  );
}

/** A label under a column. `brief` is a shorter form ("Mon" for "Mon 23"). `n` is what a stride counts in (the day of the month, the hour); the column's place by default. */
export type XLabel = { key: string; label: string; brief?: string; now?: boolean; n?: number };

/** The strides a row of labels may thin to: every label, every second and so on. A month keeps the 1st and every 5th or 10th, a day every 3rd, 6th or 12th hour. */
const STRIDES = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 80, 100];

/** Which labels a stride keeps: each whose `n` it divides, and the first. */
const strideKeeps = (labels: XLabel[], stride: number) => labels.map((label, index) => label.label !== '' && (index === 0 || (label.n ?? index) % stride === 0));

/**
 * Which labels to show in a row `width` px wide, given each label's measured width, and whether in the brief form.
 * All of them when no two touch; else all in the brief form when that fits; else every few, the smallest stride of
 * `steps` at which none touch. The current column's label always shows, and a label that would touch it steps aside.
 */
export function fitLabels(labels: XLabel[], width: number, full: number[], brief: number[], steps: number[] = STRIDES): { shown: boolean[]; brief: boolean } {
  const slot = width / Math.max(labels.length, 1);
  const current = labels.findIndex(label => label.now && label.label !== '');
  const fit = (widths: number[], stride: number) => {
    const box = (index: number) => ({ left: (index + 0.5) * slot - widths[index] / 2, right: (index + 0.5) * slot + widths[index] / 2 });
    const apart = (a: number, b: number) => box(a).right + LABEL_GAP_PX <= box(b).left;
    let shown = strideKeeps(labels, stride);
    // The first label is extra to the stride (the 1st of a month before the 5th), so it alone may step aside.
    const second = shown.findIndex((keep, index) => keep && index > 0), first = labels[0]?.n;
    if (shown[0] && second > 0 && !apart(0, second) && first !== undefined && first % stride !== 0) shown[0] = false;
    if (current >= 0) { shown = shown.map((keep, index) => keep && (index === current || apart(index, current) || apart(current, index))); shown[current] = true; }
    const kept = shown.flatMap((keep, index) => keep && index !== current ? [index] : []);
    return { shown, clear: kept.every((index, place) => place === 0 || apart(kept[place - 1], index)) };
  };
  const whole = fit(full, 1);
  if (whole.clear && whole.shown.every((keep, index) => keep || labels[index].label === '')) return { shown: whole.shown, brief: false };
  if (labels.some(label => label.brief !== undefined)) {
    const short = fit(brief, 1);
    if (short.clear && short.shown.every((keep, index) => keep || labels[index].label === '')) return { shown: short.shown, brief: true };
  }
  for (const stride of steps) { const thinned = fit(full, stride); if (thinned.clear) return { shown: thinned.shown, brief: false }; }
  return { shown: labels.map((label, index) => index === current), brief: false };
}

/**
 * The labels under a plot, one cell per column, each centred under its column. Which ones show is fitLabels, from
 * their measured widths. Before the row is measured, and on the server, it is the smallest stride that leaves 12 or
 * fewer.
 */
export function XAxis({ labels, steps = STRIDES }: { labels: XLabel[]; steps?: number[] }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const [widths, setWidths] = useState<{ full: number[]; brief: number[] } | null>(null);
  const text = labels.map(label => `${label.label}\t${label.brief ?? ''}`).join('\n');
  useEffect(() => {
    if (!ref.current) return;
    const measure = (name: string) => [...ref.current!.querySelectorAll(name)].map(cell => cell.getBoundingClientRect().width);
    const next = { full: measure('b.full'), brief: measure('b.brief') };
    const same = (a: number[], b: number[]) => a.length === b.length && a.every((width, index) => Math.abs(width - b[index]) < 0.5);
    setWidths(last => last && same(last.full, next.full) && same(last.brief, next.brief) ? last : next);
  }, [ref, text, size?.width]);
  const byCount = () => {
    const count = labels.filter(label => label.label !== '').length;
    const stride = steps.find(each => count / each <= 12) ?? steps.at(-1)!;
    return { shown: strideKeeps(labels, stride).map((keep, index) => keep || Boolean(labels[index].now && labels[index].label !== '')), brief: false };
  };
  const { shown, brief } = size && widths && widths.full.length === labels.length ? fitLabels(labels, size.width, widths.full, widths.brief, steps) : byCount();
  return (
    <div className={`xl${brief ? ' short' : ''}`} ref={ref}>
      {labels.map((label, index) => (
        <span key={label.key} className={[label.now ? 'now' : '', shown[index] ? '' : 'off'].filter(Boolean).join(' ') || undefined}>
          <b className="full">{label.label}</b><b className="brief" aria-hidden="true">{label.brief ?? label.label}</b>
        </span>
      ))}
    </div>
  );
}

/** One plot of a chart: its columns, its scale and, when the chart has more than one, its caption and the key to its colours. */
export type Band = {
  key: string; columns: PlotColumn[]; axis: Axis; max?: number; className?: string;
  caption?: ReactNode; legend?: { key: string; label: string; color: string }[]; unknownLabel?: boolean;
};

/**
 * A bar chart: one or more bands that share their columns and one row of labels under the last. The bands sit in
 * one grid, so every band's plot has the same left and right edge, every scale is right-aligned in one column that
 * is as wide as the widest value, and each label is centred under its column in every band. The first band takes
 * the spare height. The foot holds the reading line and, when a column is Unknown, what its mark means.
 */
export function BarChart({ bands, labels, steps, read }: { bands: Band[]; labels: XLabel[]; steps?: number[]; read?: ReactNode }) {
  const anyUnknown = bands.some(band => band.columns.some(column => column.segments === null && !column.future));
  const rows = bands.map((band, index) => `${band.caption !== undefined ? 'auto ' : ''}${index === 0 ? 'minmax(min-content,1fr)' : 'auto'}`).join(' ');
  return (
    <div className="chart" style={{ gridTemplateRows: `${rows} auto auto` }}>
      {bands.map((band, index) => (
        <Fragment key={band.key}>
          {band.caption !== undefined && <div className="bandh"><b>{band.caption}</b>
            {band.legend && <span className="lg">{band.legend.map(item => <span key={item.key}><i style={{ background: item.color }} />{item.label}</span>)}</span>}</div>}
          <BarPlot className={band.className ?? (index === 0 ? 'spend' : 'cm')} columns={band.columns} max={band.max} axis={band.axis} unknownLabel={band.unknownLabel} />
        </Fragment>
      ))}
      <XAxis labels={labels} steps={steps} />
      {(read !== undefined || anyUnknown) && <div className="read"><span>{read}</span>
        {anyUnknown && <span className="lg"><span><i className="unkkey" />{UNKNOWN}, not read</span></span>}</div>}
    </div>
  );
}

/** The strides for a period's labels: a month keeps the 1st and every 5th or 10th day. */
export const labelSteps = (unit: PeriodLike['unit']) => unit === 'month' ? [1, 5, 10] : undefined;

/** Columns of one series, grey unless `className` says otherwise, with a value scale and the value over each column. */
export function Columns({ columns, format, hint, className, axis, steps }: {
  columns: Column[]; format: (value: number | null) => string; hint?: string; className?: string; axis?: Axis; steps?: number[];
}) {
  // zero-ok: column height scale only
  const top = Math.max(...columns.map(column => column.value ?? 0), 0);
  const peak = top > 0 ? columns.findIndex(column => column.value === top) : -1;
  return (
    <BarChart read={hint} steps={steps} labels={columns.map(column => ({ key: column.key, label: column.label, brief: column.brief, now: column.now, n: column.n }))} bands={[{
      key: 'values', axis: axis ?? { format: value => format(value) }, className: 'spend',
      columns: columns.map((column, index) => ({
        key: column.key, future: column.future, peak: index === peak,
        segments: column.value === null ? null : [{ value: column.value, className: className ?? 'grey' }],
        title: column.future ? undefined : `${column.full}: ${format(column.value)}`,
        label: column.value ? format(column.value) : undefined,
      })),
    }]} />
  );
}

export const numText = (num: Num | null | undefined) => num ? num.value === null ? UNKNOWN : num.text : UNKNOWN;

type PeriodLike = { unit: 'day' | 'week' | 'month' | 'year' | 'all'; first: string; last: string; dates: string[] };

/**
 * A bucket's short label under its column and its full name for the title. A part week says where it starts
 * ("Jul 22+") and its title gives its dates ("Jul 22 to 26, part of a week"), so it never reads as a whole week.
 */
export function bucketText(unit: PeriodLike['unit'], { key, dates, partial }: Bucket): { label: string; brief?: string; full: string } {
  if (unit === 'year') return { label: monthLabel(key), full: `${monthLabel(key)} ${key.slice(0, 4)}` };
  if (unit === 'all') return partial
    ? { label: `${shortDate(dates[0])}+`, full: `${dateSpan(dates[0], dates.at(-1)!)}, part of a week` }
    : { label: shortDate(key), full: `Week of ${shortDate(key)}` };
  if (unit === 'month') return { label: String(Number(key.slice(8))), full: weekday(key, true) };
  return { label: weekday(key), brief: weekday(key).split(' ')[0], full: weekday(key, true) };
}

/**
 * Chart columns, one per bucket of lib/scope.mjs chartBuckets: days for a week or month, months for a year,
 * calendar weeks from Monday for all time. `valueOf` gets the bucket and its dates up to today. Buckets after today
 * draw empty.
 */
export function bucketColumns(period: PeriodLike, today: string, valueOf: (bucket: Bucket, past: string[]) => number | null): Column[] {
  return chartBuckets(period).map(bucket => {
    const past = bucket.dates.filter(date => date <= today);
    return { key: bucket.key, ...bucketText(period.unit, bucket), value: past.length ? valueOf(bucket, past) : 0, partial: bucket.partial, now: bucket.dates.includes(today), future: past.length === 0,
      ...(period.unit === 'month' ? { n: Number(bucket.key.slice(8)) } : {}) };
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
