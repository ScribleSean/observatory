// Small pieces the Limits, Tokens, Screen time, Drift and Settings views share: a block frame, a strip of
// numbers, a bar list, grey columns and the empty and Unknown states. Class names follow the design spec
// (SPEC-UI.md), so the tokens and base rules in r2.css style them.
import type { CSSProperties, ReactNode } from 'react';
import type { Num, Part } from '../../../../lib/view-r2.mjs';

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

export type Column = { key: string; label: string; value: number | null; full: string; now?: boolean; future?: boolean };

/** Grey columns with value labels: on every column when there are 12 or fewer, else on the peak only. */
export function Columns({ columns, format, hint }: { columns: Column[]; format: (value: number | null) => string; hint: string }) {
  // zero-ok: column height scale only
  const top = Math.max(...columns.map(column => column.value ?? 0), 0);
  const peak = top > 0 ? columns.findIndex(column => column.value === top) : -1;
  return (
    <div className="chart">
      <div className="cols spend">
        {columns.map((column, index) => (
          <div key={column.key} className={`col${column.future ? ' empty' : ''}`} title={column.future ? undefined : `${column.full}: ${format(column.value)}`}>
            <em className={index === peak ? 'peak' : undefined}>{column.value && (index === peak || columns.length <= 12) ? format(column.value) : ''}</em>
            {/* zero-ok: a future column draws empty */}
            {column.value === null && !column.future ? <i className="unk" style={{ height: '14%' }} title="Unknown" /> : <i className="grey" style={{ height: `${top ? 100 * (column.value ?? 0) / top : 0}%` }} />}
          </div>
        ))}
      </div>
      <div className="xl">{columns.map((column, index) => <span key={column.key} className={column.now ? 'now' : undefined}>{label(columns, index)}</span>)}</div>
      <div className="read">{hint}</div>
    </div>
  );
}

// Every label when they fit, else every few, always keeping the current one.
function label(columns: Column[], index: number) {
  const every = columns.length <= 14 ? 1 : columns.length <= 31 ? 3 : Math.ceil(columns.length / 10);
  return index % every === 0 || columns[index].now ? columns[index].label : '';
}

export const numText = (num: Num | null | undefined) => num ? num.value === null ? UNKNOWN : num.text : UNKNOWN;

type PeriodLike = { unit: 'day' | 'week' | 'month' | 'year' | 'all'; first: string; last: string; dates: string[] };

/** The last date of the period's span, past today when the period is current, so future buckets draw empty. */
export function periodEnd(period: PeriodLike) {
  if (period.unit === 'week') return addDays(period.first, 6);
  if (period.unit === 'month') { const day = new Date(`${period.first}T00:00:00Z`); day.setUTCMonth(day.getUTCMonth() + 1, 0); return day.toISOString().slice(0, 10); }
  if (period.unit === 'year') return `${period.first.slice(0, 4)}-12-31`;
  return period.last;
}

/**
 * Daily values as chart columns: days for a week or month, months for a year, weeks (from Monday) for all
 * time. A bucket with an Unknown day is Unknown. Buckets after today draw empty.
 */
export function dayColumns(period: PeriodLike, values: Map<string, number | null>, today: string): Column[] {
  const end = periodEnd(period), dates: string[] = [];
  for (let date = period.first; date <= end && dates.length < 4000; date = addDays(date, 1)) dates.push(date);
  const keyOf = (date: string) => {
    if (period.unit === 'year') return date.slice(0, 7);
    if (period.unit === 'all') { const day = new Date(`${date}T00:00:00Z`).getUTCDay(); return addDays(date, -((day + 6) % 7)); }
    return date;
  };
  const groups = new Map<string, string[]>();
  for (const date of dates) groups.set(keyOf(date), [...groups.get(keyOf(date)) ?? [], date]);
  return [...groups].map(([key, list]) => {
    const past = list.filter(date => date <= today);
    const known = past.map(date => values.has(date) ? values.get(date)! : 0);
    const value = past.length === 0 ? 0 : known.some(item => item === null) ? null : (known as number[]).reduce((sum, item) => sum + item, 0);
    const label = period.unit === 'year' ? monthLabel(list[0]) : period.unit === 'all' ? shortDate(list[0]) : period.unit === 'month' ? String(Number(list[0].slice(8))) : weekday(list[0]).split(' ')[0];
    const full = period.unit === 'year' ? `${monthLabel(list[0])} ${list[0].slice(0, 4)}` : period.unit === 'all' ? `Week of ${shortDate(list[0])}` : weekday(list[0], true);
    return { key, label, value, full, now: list.includes(today), future: past.length === 0 };
  });
}

/** "per day", "per month" and so on, for a chart header. */
export const bucketWord = (unit: PeriodLike['unit']) => ({ day: 'hour', week: 'day', month: 'day', year: 'month', all: 'week' })[unit];
