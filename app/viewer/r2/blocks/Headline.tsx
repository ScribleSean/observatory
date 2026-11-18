import { useContext, useState } from 'react';
import type { ComponentRenderProps } from '@json-render/react';
import { DIM_LABELS, METRIC_LABELS, SPEND_METRICS, StripContext, count, metric, patchScope, share, useR2, type Dim, type MetricId, type Num, type ScopePatch } from '../data';
import { BarList, dimsOf } from './Breakdown';

type Props = import('../../../../lib/r2-blocks.mjs').HeadlineProps;

/** The number as the strip shows it: the lead figure, then a small unit. */
function figure(num: Num): { main: string; unit: string | null } {
  if (num.value === null) return { main: num.text, unit: null };
  if (num.metric === 'onMain' && num.of !== null) return { main: count(num.value), unit: `of ${count(num.of)}` };
  if (num.metric === 'churn') return { main: count(num.value), unit: 'commits' };
  if (num.metric === 'noCommitSpend' && num.of) return { main: share(100 * num.value / num.of) || '0%', unit: 'of spend' };
  return { main: num.text, unit: null };
}

/** The breakdown that opens under a strip, or under a headline standing alone. */
export function Drawer({ id, patch, wanted }: { id: MetricId; patch: ScopePatch | undefined; wanted: Dim[] | undefined }) {
  const { snapshot, scope, now, frame, toggleMetric } = useR2();
  const [chosen, setChosen] = useState<Dim | null>(null);
  const num = metric(snapshot, id, patchScope(scope, patch), { now });
  const dims = dimsOf(num, wanted, scope.devices.length, frame.sources.filter(source => source.on && source.hasData && source.id !== 'grok').length);
  const active = chosen && dims.includes(chosen) ? chosen : dims[0];
  const parts = active ? num.breakdowns[active] ?? [] : [];
  return (
    <div className="drawer">
      <div className="dh">
        <b>{METRIC_LABELS[id]}</b><span className="fa">by</span>
        <span className="tabs">{dims.map(dim => <button key={dim} type="button" className={dim === active ? 'on' : ''} aria-pressed={dim === active} onClick={() => setChosen(dim)}>{DIM_LABELS[dim]}</button>)}</span>
        <span style={{ flex: 1 }} />
        {num.note && <span className="fa">{num.note}</span>}
        <button type="button" className="fa" onClick={() => toggleMetric(id)}>Close</button>
      </div>
      {parts.length ? <BarList parts={parts} accent={SPEND_METRICS.includes(id)} limit={9} /> : <div className="empty"><b>Nothing to split</b>{frame.period.label} has no records for this number.</div>}
      {num.atLeast && <p className="sum">The total is Unknown, {num.atLeast.text}.</p>}
      {active === 'device' && num.sumLabel && <p className="sum">The total adds these computers and is {num.sumLabel}.</p>}
    </div>
  );
}

export function Headline({ element }: ComponentRenderProps<Props>) {
  const { snapshot, scope, now, openMetric, toggleMetric } = useR2();
  const inStrip = useContext(StripContext);
  const { metric: id, compare = true } = element.props;
  const num = metric(snapshot, id, patchScope(scope, element.props.scope), { now });
  const { main, unit } = figure(num);
  // An Unknown sum still says what was read: "at least $642, 1 day not read on Tower".
  const context = num.atLeast ? num.atLeast.text : id === 'noCommitSpend' ? num.note : compare ? num.deltaText ?? num.note : num.note;
  const open = openMetric === id;
  const cell = (
    <button type="button" className={open ? 'kpi on' : 'kpi'} aria-expanded={open} title={`${METRIC_LABELS[id]}. Open the breakdown.`} onClick={() => toggleMetric(id)}>
      <span className="l">{id === 'spend' && <i className="mark" />}{METRIC_LABELS[id]}</span>
      <span className={num.value === null ? 'v unk' : 'v'}>{main}{unit && <small>{unit}</small>}</span>
      <span className="c">{context || ' '}</span>
    </button>
  );
  if (inStrip) return cell;
  return <section className="blk kpi-blk">{cell}{open && <Drawer id={id} patch={element.props.scope} wanted={element.props.breakdowns} />}</section>;
}
