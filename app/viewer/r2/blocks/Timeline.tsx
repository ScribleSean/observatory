import type { ComponentRenderProps } from '@json-render/react';
import { UNKNOWN, buildOverview, patchScope, resolveBlock, useR2, type Num } from '../data';
import { Columns, bucketColumns, hours, money, tokens } from '../views/parts';

type Props = import('../../../../lib/r2-blocks.mjs').TimelineProps;
type TimelineVM = import('../../../../lib/view-r2.mjs').TimelineVM;
const TITLES: Record<Props['series'], string> = { spend: 'Spend over time', tokens: 'Tokens over time', screenTime: 'Hours at the screen', grokRequests: 'Grok requests', subagents: 'Subagents started' };
const FORMATS: Record<Props['series'], (value: number | null) => string> = {
  spend: money, tokens, screenTime: hours, subagents: value => value === null ? UNKNOWN : value.toLocaleString('en-US'),
  grokRequests: value => value === null ? UNKNOWN : value.toLocaleString('en-US'),
};

/**
 * One series over the period as columns, from the Timeline view-model (lib/view-r2.mjs), so its buckets are the
 * ones every other chart uses: days, months for a year, weeks from Monday for all time. Spend is terracotta,
 * every other series is grey.
 */
export function Timeline({ element }: ComponentRenderProps<Props>) {
  const { snapshot, scope, now } = useR2();
  const { series } = element.props;
  const overview = buildOverview(snapshot, patchScope(scope, element.props.scope), { now });
  const { period } = overview.frame;
  const read = series !== 'subagents' && (series !== 'grokRequests' || overview.grok !== null);
  const vm = read ? resolveBlock('Timeline', element.props, snapshot, scope, { now }) as TimelineVM : null;
  const values = new Map((vm?.points ?? []).map(point => [point.date, (point.value as Num).value]));
  const columns = bucketColumns(period, period.current ? period.last : '9999-12-31', bucket => values.has(bucket.key) ? values.get(bucket.key)! : null);
  return (
    <section className="blk">
      <div className="bh"><h3>{TITLES[series]}</h3><span className="fa">{period.label}</span></div>
      {vm === null ? <div className="empty"><b className="unk">{UNKNOWN}</b>This series has not been read for {period.label}.</div>
        : vm.points.every(point => (point.value as Num).value === 0) ? <div className="empty"><b>Nothing recorded</b>{period.label} has no values for this series.</div>
        : <Columns columns={columns} format={FORMATS[series]} className={series === 'spend' ? 'mac' : 'grey'} />}
    </section>
  );
}
