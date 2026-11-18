import type { Spec } from '@json-render/react';
import { UNKNOWN, count, metric, useR2 } from '../data';
import { SpecView } from '../registry';
import { withoutBlocks, type Pin } from '../specs';

/** The answer line over a pinned or composed view: the question, then one sentence built from the same numbers as the blocks under it. */
function Answer({ question, missed, onClear }: { question: string; missed: boolean; onClear: () => void }) {
  const { snapshot, scope, now, frame } = useR2();
  const spend = metric(snapshot, 'spend', scope, { now }), landed = metric(snapshot, 'onMain', scope, { now });
  const top = (spend.breakdowns.role ?? [])[0];
  const when = frame.period.unit === 'day' && frame.period.current ? 'today' : `in ${frame.period.label}`;
  return (
    <section className="blk">
      <div className="answer">
        <div className="q"><span>{question}</span><span style={{ flex: 1 }} /><button type="button" className="fa" onClick={onClear}>Clear</button></div>
        <div className="a">
          {missed ? <>No block answers that yet. <span>Try spend, shipped, limits, a role or a range.</span></>
            : spend.value === null ? <>Spend {when} is {UNKNOWN}. <span>{spend.atLeast ? `${spend.atLeast.text.charAt(0).toUpperCase()}${spend.atLeast.text.slice(1)}.` : 'A computer could not be read on a day in this range.'}</span></>
            : <>{spend.text} {when}{top?.share ? `. ${top.label} took ${Math.round(top.share)}%` : ''}. <span>{landed.value === null ? `Commits on main are ${UNKNOWN}.` : `${count(landed.value)} of ${count(landed.of)} commits reached main.`}</span></>}
        </div>
      </div>
    </section>
  );
}

export function Overview({ pin, hidden, question, missed, onClear }: { pin: Pin; hidden: string[]; question: string | null; missed: boolean; onClear: () => void }) {
  return (
    <div className="grid c12">
      {(question || missed) && <Answer question={question ?? ''} missed={missed} onClear={onClear} />}
      <SpecView spec={withoutBlocks(pin.spec as Spec, hidden)} />
    </div>
  );
}
