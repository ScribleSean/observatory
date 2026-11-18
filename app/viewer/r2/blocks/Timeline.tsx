import type { ComponentRenderProps } from '@json-render/react';
import { UNKNOWN, bucketDates, buildOverview, buildScreenTime, buildTokens, orNull, patchScope, useR2 } from '../data';
import { bucketLabel, bucketName } from './SpendLandedChart';

type Props = import('../../../../lib/r2-blocks.mjs').TimelineProps;
type Point = { date: string; value: number | null; text: string };
const TITLES: Record<Props['series'], string> = { spend: 'Spend over time', tokens: 'Tokens over time', screenTime: 'Hours at the screen', grokRequests: 'Grok requests', subagents: 'Subagents started' };

/** One series over the period as columns. Spend is terracotta, every other series is grey. */
export function Timeline({ element }: ComponentRenderProps<Props>) {
  const { snapshot, scope, now } = useR2();
  const inner = patchScope(scope, element.props.scope);
  const { series } = element.props;
  const overview = buildOverview(snapshot, inner, { now });
  const { period } = overview.frame;
  const found: Point[] | null = series === 'spend' ? overview.chart.map(point => ({ date: point.date, value: point.spend.value, text: point.spend.text }))
    : series === 'tokens' ? orNull(() => buildTokens(snapshot, inner, { now }).days.map(day => ({ date: day.date, value: day.tokens.value, text: day.tokens.text })))
    : series === 'screenTime' ? orNull(() => buildScreenTime(snapshot, inner, { now }).days.map(day => ({ date: day.date, value: day.seconds.value, text: day.seconds.text })))
    : series === 'grokRequests' && overview.grok ? overview.grok.days.map(day => ({ date: day.date, value: day.value, text: day.value === null ? UNKNOWN : String(day.value) }))
    : null;
  const points = new Map((found ?? []).map(point => [point.date, point]));
  const dates = bucketDates(period);
  const most = Math.max(...(found ?? []).map(point => point.value ?? 0), 0.01); // zero-ok: an Unknown bucket draws no bar and sets no scale
  return (
    <section className="blk">
      <div className="bh"><h3>{TITLES[series]}</h3><span className="fa">{period.label}</span></div>
      {found === null ? <div className="empty"><b className="unk">{UNKNOWN}</b>This series has not been read for {period.label}.</div>
        : found.length === 0 ? <div className="empty"><b>Nothing recorded</b>{period.label} has no values for this series.</div> : (
          <div className="chart">
            <div className="cols spend">
              {dates.map(date => {
                const point = points.get(date);
                if (!point) return <div key={date} className="col empty" />;
                return (
                  <div key={date} className={point.value === null ? 'col empty unknown' : 'col empty'} title={`${bucketName(period, date)}: ${point.text}`}>
                    <em className={point.value === most ? 'peak' : ''}>{point.value === most || (dates.length <= 8 && point.value) ? point.text : ''}</em>
                    <i className={series === 'spend' ? 'mac' : 'grey'} style={point.value === null ? undefined : { height: `${100 * point.value / most}%` }} />
                  </div>
                );
              })}
            </div>
            <div className="xl">{dates.map(date => <span key={date}>{dates.length > 16 || dates.length <= 8 ? bucketLabel(period, date) : bucketLabel(period, date).slice(0, 1)}</span>)}</div>
          </div>
        )}
    </section>
  );
}
