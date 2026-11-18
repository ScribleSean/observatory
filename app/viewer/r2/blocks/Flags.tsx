import type { ComponentRenderProps } from '@json-render/react';
import { buildOverview, patchScope, useR2 } from '../data';

type Props = import('../../../../lib/r2-blocks.mjs').FlagsProps;

/** "Needs you": a few data statements, each with a terracotta dot. A line about a session opens its panel. */
export function Flags({ element }: ComponentRenderProps<Props>) {
  const { snapshot, scope, now, openSession } = useR2();
  const { flags, frame } = buildOverview(snapshot, patchScope(scope, element.props.scope), { now });
  const lines = flags.slice(0, element.props.limit ?? 4);
  return (
    <section className="blk">
      <div className="bh">
        <h3>Needs you</h3><span className={lines.length ? 'acc' : 'fa'} style={{ fontWeight: 600 }}>{lines.length}</span><span className="fill" /><span className="fa">{frame.period.label}</span>
      </div>
      {lines.length === 0 && <div className="empty">Nothing flagged in this range.</div>}
      {lines.map(line => line.sessionKey
        ? <button key={line.text} type="button" className="li" onClick={() => openSession(line.sessionKey)}><span className="flagdot" /><span className="t on">{line.text}</span><span className="fa">›</span></button>
        : <div key={line.text} className="li flat"><span className="flagdot" /><span className="t on">{line.text}</span></div>)}
    </section>
  );
}
