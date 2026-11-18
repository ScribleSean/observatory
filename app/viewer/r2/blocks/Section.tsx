import type { CSSProperties, ReactNode } from 'react';
import { useContext } from 'react';
import type { ComponentRenderProps } from '@json-render/react';
import { SpecContext, StripContext, buildOverview, dayLabel, useR2, type Dim, type MetricId, type ScopePatch } from '../data';
import { Drawer } from './Headline';

type Props = import('../../../../lib/r2-blocks.mjs').SectionProps;
type HeadlineProps = { metric: MetricId; breakdowns?: Dim[]; scope?: ScopePatch };

/** Days a computer could not read, and computers whose history starts inside the period. */
function CoverageNote() {
  const { snapshot, scope, now } = useR2();
  const { coverage } = buildOverview(snapshot, scope, { now });
  const unknown = coverage.unknownDays.map(row => `${row.name} could not be read on ${row.dates.slice(0, 3).map(date => dayLabel(date)).join(', ')}${row.dates.length > 3 ? ` and ${row.dates.length - 3} more days` : ''}`);
  const later = coverage.startsLater.map(row => `${row.name} has history from ${dayLabel(row.before)}`);
  if (unknown.length + later.length === 0) return null;
  return <div className="foot"><span className="dot stale" /><span>{[...unknown.map(line => `${line}, so totals that include it are Unknown`), ...later].join('. ')}.</span></div>;
}

/** A section of headlines draws as one strip of numbers, with the open breakdown under it. */
function Strip({ cells, children }: { cells: HeadlineProps[]; children: ReactNode }) {
  const { openMetric } = useR2();
  const open = cells.find(cell => cell.metric === openMetric);
  return (
    <section className="blk">
      <div className={cells.length === 4 ? 'strip n4' : 'strip'} style={{ '--n': cells.length - 1 } as CSSProperties}>
        <StripContext value={true}>{children}</StripContext>
      </div>
      {open && <Drawer id={open.metric} patch={open.scope} wanted={open.breakdowns} />}
      <CoverageNote />
    </section>
  );
}

/** The one container: a 12 column grid where each child spans `columns`. */
export function Section({ element, children }: ComponentRenderProps<Props>) {
  const spec = useContext(SpecContext);
  const kids = (element.children ?? []).map(key => spec?.elements[key]);
  if (kids.length > 0 && kids.every(kid => kid?.type === 'Headline')) return <Strip cells={kids.map(kid => kid?.props as HeadlineProps)}>{children}</Strip>;
  const { title, columns } = element.props;
  // In a section of thirds, a column that holds a chart or a table takes two of them.
  const wide = kids.some(kid => kid?.type === 'SpendLandedChart' || (kid?.type === 'SessionsTable' && !kid.props.running));
  const grid = <div className={`grid c${columns}${wide ? ' wide' : ''}`}>{children}</div>;
  return title ? <div className="sect"><h2>{title}</h2>{grid}</div> : grid;
}
