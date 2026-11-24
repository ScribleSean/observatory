import { useState } from 'react';
import { BarChart, bucketText, countAxis, labelSteps, moneyAxis, type PlotColumn, type Segment, type XLabel } from '../views/parts';
import type { ComponentRenderProps } from '@json-render/react';
import { HOST_TINTS, UNKNOWN, buildOverview, chartBuckets, count, dayLabel, patchScope, useR2, type DayPoint, type Period, type RangeUnit } from '../data';
import type { Bucket } from '../../../../lib/scope.mjs';

type Props = import('../../../../lib/r2-blocks.mjs').SpendLandedChartProps;
const TINT_VARS: Record<string, string> = { mac: '--accent', pc: '--accent-2', ubuntu: '--accent-3' };

/** A bucket's label under its column: the same words and the same thinning as every other chart (views/parts.tsx). */
export function bucketLabel(period: Period, bucket: Bucket): XLabel {
  const { label, brief } = bucketText(period.unit, bucket);
  return { key: bucket.key, label, brief, ...(period.unit === 'month' ? { n: Number(bucket.key.slice(8)) } : {}) };
}
/** A bucket's full name for its title: "Wed Nov 18", "Nov 2026", "Week of Oct 5", "Oct 2 to 4, part of a week". */
export const bucketName = (period: Period, bucket: Bucket) => period.unit === 'year' || period.unit === 'all' ? bucketText(period.unit, bucket).full : dayLabel(bucket.key, true);
/** The range a click on a bucket opens. A day does not open further. */
export const drillUnit = (unit: RangeUnit): RangeUnit | null => unit === 'week' || unit === 'month' ? 'day' : unit === 'year' ? 'month' : unit === 'all' ? 'week' : null;
/** The bucket word for a chart header: "per day", "per month" for a year, "per week" for all time. */
export const bucketUnit = (unit: RangeUnit) => unit === 'year' ? 'month' : unit === 'all' ? 'week' : 'day';

export function SpendLandedChart({ element }: ComponentRenderProps<Props>) {
  const { snapshot, scope, now, setScope } = useR2();
  const [hover, setHover] = useState<string | null>(null);
  const inner = patchScope(scope, element.props.scope);
  const { chart, frame } = buildOverview(snapshot, inner, { now });
  const { period } = frame;
  const points = new Map(chart.map(point => [point.date, point]));
  const buckets = chartBuckets(period), dates = buckets.map(bucket => bucket.key);
  const byKey = new Map(buckets.map(bucket => [bucket.key, bucket]));
  const mostSpend = Math.max(...chart.map(point => point.spend.value ?? 0), 0); // zero-ok: an Unknown bucket draws no bar and sets no scale
  const mostCommits = Math.max(...chart.map(point => point.onMain.of ?? 0), 0); // zero-ok: an Unknown bucket draws no bar and sets no scale
  const peak = mostSpend > 0 ? chart.find(point => point.spend.value === mostSpend)?.date : undefined;
  const hosts = element.props.stack === 'device' ? [...new Set(chart.flatMap(point => (point.spend.breakdowns.device ?? []).filter(part => part.value).map(part => part.key)))] : [];
  const stacked = hosts.length > 1;
  const names = new Map(chart.flatMap(point => (point.spend.breakdowns.device ?? []).map(part => [part.key, part.label] as const)));
  const drill = drillUnit(period.unit);
  const today = period.current ? period.last : null;
  const name = (date: string) => bucketName(period, byKey.get(date)!);
  const tip = (point: DayPoint) => point.spend.value === null
    ? `${name(point.date)}: ${UNKNOWN}, a computer could not be read`
    : `${name(point.date)}: ${point.spend.text} spent, ${count(point.onMain.value)} of ${count(point.onMain.of)} commits on main`;
  const hint = !chart.length ? '' : drill ? `Click a bar to open that ${drill}` : 'Hover a bar for its numbers';
  const open = (date: string) => { if (drill && points.has(date)) setScope({ ...scope, range: { unit: drill, anchor: date } }); };
  const shown = hover && points.get(hover);
  const labels = buckets.map(bucket => ({ ...bucketLabel(period, bucket), now: today !== null && bucket.dates.includes(today) }));
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
  const spendLabel = (point: DayPoint) => point.spend.value !== null && point.spend.value >= 0.5 ? `$${count(point.spend.value)}` : '';
  // Commits not read are Unknown, drawn as the Unknown mark, never as an empty column that reads as none.
  const commitSegments = (point: DayPoint): Segment[] | null => point.onMain.value === null || point.onMain.of === null ? null
    : [{ value: point.onMain.value, className: 'land' }, { value: point.onMain.of - point.onMain.value, className: 'churn' }];
  const spendKey = stacked ? hosts.map(host => ({ key: host, label: names.get(host) ?? host, color: `var(${TINT_VARS[HOST_TINTS[host]] ?? '--accent'})` }))
    : undefined;
  return (
    <section className="blk wide">
      <div className="bh"><h3>Spend and what landed</h3><span className="fa">per {bucketUnit(period.unit)}</span></div>
      {chart.length === 0 ? <div className="empty"><b>No spend</b>Nothing was recorded in {period.label}.</div> : (
        <BarChart labels={labels} steps={labelSteps(period.unit)}
          read={<span style={shown ? { color: 'var(--text)' } : undefined}>{shown ? tip(shown) : hint}</span>}
          bands={[
            { key: 'spend', caption: 'Spend', legend: spendKey, axis: moneyAxis, max: mostSpend, columns: dates.map(date => columnOf(date, spendSegments, spendLabel)) },
            { key: 'commits', caption: 'Commits', axis: { ...countAxis, few: true }, max: mostCommits, unknownLabel: false, columns: dates.map(date => columnOf(date, commitSegments)),
              legend: [{ key: 'land', label: 'On main', color: 'var(--g0)' }, { key: 'churn', label: 'Not yet on main', color: 'var(--g3)' }] },
          ]} />
      )}
    </section>
  );
}
