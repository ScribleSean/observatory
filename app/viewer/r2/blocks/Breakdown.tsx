import { useState } from 'react';
import type { ComponentRenderProps } from '@json-render/react';
import { DIM_LABELS, METRIC_LABELS, SPEND_METRICS, UNKNOWN, metric, patchScope, share, useR2, type Dim, type Num, type Part } from '../data';

type Props = import('../../../../lib/r2-blocks.mjs').BreakdownProps;

// The splits a block offers as tabs, in reading order. A split by session belongs to the table.
const TAB_ORDER: Dim[] = ['role', 'model', 'kind', 'repo', 'device', 'category', 'agent'];

/** A ranked list: label, bar, amount and share. Terracotta marks spend, grey marks everything else. */
export function BarList({ parts, accent, limit }: { parts: Part[]; accent: boolean; limit?: number }) {
  const shown = limit ? parts.slice(0, limit) : parts;
  // An Unknown part draws the part that was read, when there is one.
  const drawn = (part: Part) => part.value ?? part.atLeast;
  const most = Math.max(...shown.map(part => drawn(part) ?? -Infinity), 0.0001);
  return (
    <div className="bl">
      {shown.map((part, index) => [
        <span key={`${part.key} t`} className={index === 0 ? 't t1' : 't'} title={part.label}>{part.label}</span>,
        <span key={`${part.key} b`} className="bar"><i className={accent ? 'a' : ''} style={{ width: `${drawn(part) ? Math.max(1.5, 100 * drawn(part)! / most) : 0}%` }} /></span>,
        <span key={`${part.key} n`} className={part.value === null ? 'n unk' : 'n'}>{part.text}</span>,
        <span key={`${part.key} p`} className="p">{share(part.share)}</span>,
      ])}
    </div>
  );
}

/** The dims worth a tab: the ones the number carries, minus a device split of one device and a source split of one source. */
export function dimsOf(num: Num, wanted: Dim[] | undefined, devices: number, sources: number): Dim[] {
  const carried = Object.keys(num.breakdowns) as Dim[];
  return (wanted ?? carried).filter(dim => carried.includes(dim) && (dim !== 'device' || devices > 1) && (dim !== 'tool' || sources > 1));
}

export function Breakdown({ element }: ComponentRenderProps<Props>) {
  const { snapshot, scope, now, frame } = useR2();
  const { metric: id, dim, limit = 8 } = element.props;
  const [chosen, setChosen] = useState<Dim | null>(null);
  const num = metric(snapshot, id, patchScope(scope, element.props.scope), { now });
  const carried = dimsOf(num, undefined, scope.devices.length, 1);
  const dims = TAB_ORDER.filter(each => carried.includes(each));
  const active = chosen && dims.includes(chosen) ? chosen : dims.includes(dim) ? dim : dims[0];
  const parts = active ? num.breakdowns[active] ?? [] : [];
  return (
    <section className="blk">
      <div className="bh">
        <h3>{id === 'spend' ? 'Where spend went' : METRIC_LABELS[id]}</h3><span className="fill" />
        <span className="tabs">{dims.map(each => <button key={each} type="button" className={each === active ? 'on' : ''} aria-pressed={each === active} onClick={() => setChosen(each)}>{DIM_LABELS[each]}</button>)}</span>
      </div>
      <div className="bb">
        {parts.length ? <BarList parts={parts} accent={SPEND_METRICS.includes(id)} limit={limit} /> : <div className="empty"><b>Nothing to split</b>{frame.period.label} has no {METRIC_LABELS[id].toLowerCase()}.</div>}
      </div>
      {num.value === null && parts.length > 0 && <div className="foot"><span className="dot stale" />{num.atLeast ? `The total is ${UNKNOWN}, ${num.atLeast.text}.` : `The total is ${UNKNOWN} because a day in this range could not be read.`}</div>}
    </section>
  );
}
