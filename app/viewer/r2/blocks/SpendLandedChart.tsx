import { useState } from 'react';
import { BarPlot, type PlotColumn, type Segment } from '../views/parts';
import type { ComponentRenderProps } from '@json-render/react';
import { HOST_TINTS, UNKNOWN, bucketDates, buildOverview, count, dayLabel, monthLabel, patchScope, useR2, weekdayLabel, type DayPoint, type Period, type RangeUnit } from '../data';

type Props = import('../../../../lib/r2-blocks.mjs').SpendLandedChartProps;
const TINT_VARS: Record<string, string> = { mac: '--accent', pc: '--accent-2', ubuntu: '--accent-3' };

export function bucketLabel(period: Period, date: string): string {
  if (period.unit === 'year' || period.unit === 'all') return monthLabel(date);
  if (period.unit === 'month') { const day = Number(date.slice(8)); return day === 1 || day % 5 === 0 ? String(day) : ''; }
  return weekdayLabel(date);
}
export const bucketName = (period: Period, date: string) => period.unit === 'year' || period.unit === 'all' ? `${monthLabel(date)} ${date.slice(0, 4)}` : dayLabel(date, true);
/** The range a click on a bucket opens. A day does not open further. */
export const drillUnit = (unit: RangeUnit): RangeUnit | null => unit === 'week' || unit === 'month' ? 'day' : unit === 'year' || unit === 'all' ? 'month' : null;

export function SpendLandedChart({ element }: ComponentRenderProps<Props>) {
  const { snapshot, scope, now, setScope } = useR2();
  const [hover, setHover] = useState<string | null>(null);
  const inner = patchScope(scope, element.props.scope);
  const { chart, frame } = buildOverview(snapshot, inner, { now });
  const { period } = frame;
  const points = new Map(chart.map(point => [point.date, point]));
  const dates = bucketDates(period);
  const monthly = period.unit === 'year' || period.unit === 'all';
  const mostSpend = Math.max(...chart.map(point => point.spend.value ?? 0), 0.01); // zero-ok: an Unknown bucket draws no bar and sets no scale
  const mostCommits = Math.max(...chart.map(point => point.onMain.of ?? 0), 0.01); // zero-ok: an Unknown bucket draws no bar and sets no scale
  const peak = chart.find(point => point.spend.value === mostSpend)?.date;
  const hosts = element.props.stack === 'device' ? [...new Set(chart.flatMap(point => (point.spend.breakdowns.device ?? []).filter(part => part.value).map(part => part.key)))] : [];
  const stacked = hosts.length > 1;
  const names = new Map(chart.flatMap(point => (point.spend.breakdowns.device ?? []).map(part => [part.key, part.label] as const)));
  const drill = drillUnit(period.unit);
  const today = period.current ? period.last : null;
  const tip = (point: DayPoint) => point.spend.value === null
    ? `${bucketName(period, point.date)}: ${UNKNOWN}, a computer could not be read`
    : `${bucketName(period, point.date)}: ${point.spend.text} spent, ${count(point.onMain.value)} of ${count(point.onMain.of)} commits on main`;
  const hint = !chart.length ? '' : drill ? `Click a bar to open that ${drill}` : 'Hover a bar for its numbers';
  const open = (date: string) => { if (drill && points.has(date)) setScope({ ...scope, range: { unit: drill, anchor: date } }); };
  const shown = hover && points.get(hover);
  const columnOf = (date: string, segments: (point: DayPoint) => Segment[] | null, label?: (point: DayPoint) => string): PlotColumn => {
    const point = points.get(date);
    if (!point) return { key: date, segments: [], future: true };
    const hover = { onEnter: () => setHover(date), onLeave: () => setHover(null) };
    return {
      key: date, segments: segments(point), label: label?.(point), peak: date === peak, hover,
      ...(drill ? { button: { onClick: () => open(date), ariaLabel: `${tip(point)}. Open this ${drill}.` } } : { title: tip(point) }),
    };
  };
  // A computer with no part in a bucket draws no segment.
  const spendSegments = (point: DayPoint): Segment[] | null => point.spend.value === null ? null
    : stacked ? hosts.map(host => ({ value: (point.spend.breakdowns.device ?? []).find(each => each.key === host)?.value ?? 0, className: HOST_TINTS[host] ?? 'mac' })) // zero-ok: a segment height, not a reading
    : [{ value: point.spend.value, className: 'mac' }];
  const spendLabel = (point: DayPoint) => point.spend.value === null ? dates.length <= 12 ? UNKNOWN : ''
    : point.spend.value >= 0.5 && (point.date === peak || dates.length <= 12) ? `$${count(point.spend.value)}` : '';
  const commitSegments = (point: DayPoint): Segment[] => point.onMain.value === null || point.onMain.of === null ? []
    : [{ value: point.onMain.value, className: 'land' }, { value: point.onMain.of - point.onMain.value, className: 'churn' }];
  return (
    <section className="blk wide">
      <div className="bh">
        <h3>Spend and what landed</h3><span className="fa">per {monthly ? 'month' : 'day'}</span><span className="fill" />
        <span className="lg">
          {stacked ? hosts.map(host => <span key={host}><i style={{ background: `var(${TINT_VARS[HOST_TINTS[host]] ?? '--accent'})` }} />{names.get(host)} spend</span>) : <span><i style={{ background: 'var(--accent)' }} />Spend</span>}
          <span><i style={{ background: 'var(--g0)' }} />On main</span><span><i style={{ background: 'var(--g3)' }} />Not yet on main</span>
        </span>
      </div>
      {chart.length === 0 ? <div className="empty"><b>No spend</b>Nothing was recorded in {period.label}.</div> : (
        <div className="chart">
          <BarPlot columns={dates.map(date => columnOf(date, spendSegments, spendLabel))} max={mostSpend} unknown="line" />
          <BarPlot className="cm" columns={dates.map(date => columnOf(date, commitSegments))} max={mostCommits} />
          <div className="xl">{dates.map(date => <span key={date} className={date === today || (monthly && today?.slice(0, 7) === date.slice(0, 7)) ? 'now' : ''}>{bucketLabel(period, date)}</span>)}</div>
          <div className="read" style={shown ? { color: 'var(--text)' } : undefined}>{shown ? tip(shown) : hint}</div>
        </div>
      )}
    </section>
  );
}
