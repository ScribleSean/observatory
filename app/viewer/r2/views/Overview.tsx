import type { Spec } from '@json-render/react';
import { answerSentence } from '../../../../lib/view-r2.mjs';
import { UNKNOWN, count, metric, useR2, type AskAnswer } from '../data';
import { SpecView } from '../registry';
import { withoutBlocks, type Pin } from '../pins';

/** The answer line over a pinned or composed view: the question, then one sentence built from the same numbers as the blocks under it. */
function Answer({ question, missed, answer, onClear }: { question: string; missed: boolean; answer: AskAnswer | null; onClear: () => void }) {
  const { snapshot, scope, now, frame } = useR2();
  // A question about one number is answered with that number (lib/view-r2.mjs answerSentence).
  const own = answer?.metric ? answerSentence(snapshot, answer, scope, { now }) : null;
  const spend = metric(snapshot, 'spend', scope, { now }), landed = metric(snapshot, 'onMain', scope, { now });
  const top = (spend.breakdowns.role ?? [])[0];
  const when = frame.period.unit === 'day' && frame.period.current ? 'today' : `in ${frame.period.label}`;
  return (
    <section className="blk">
      <div className="answer">
        <div className="q"><span>{question}</span><span style={{ flex: 1 }} /><button type="button" className="fa" onClick={onClear}>Clear</button></div>
        <div className="a">
          {missed ? <>No block answers that yet. <span>Try spend, shipped, limits, a role or a range.</span></>
            : own ? own
            : spend.value === null ? <>Spend {when} is {UNKNOWN}. <span>{spend.atLeast ? `${spend.atLeast.text.charAt(0).toUpperCase()}${spend.atLeast.text.slice(1)}.` : 'A computer could not be read on a day in this range.'}</span></>
            : <>{spend.text} {when}{top?.share ? `. ${top.label} took ${Math.round(top.share)}%` : ''}. <span>{landed.value === null ? `Commits on main are ${UNKNOWN}.` : `${count(landed.value)} of ${count(landed.of)} commits reached main.`}</span></>}
        </div>
      </div>
    </section>
  );
}

type Props = { pin: Pin; hidden: string[]; question: string | null; missed: boolean; answer?: AskAnswer | null; onClear: () => void };

export function Overview({ pin, hidden, question, missed, answer = null, onClear }: Props) {
  return (
    <div className="grid c12">
      {(question || missed) && <Answer question={question ?? ''} missed={missed} answer={answer} onClear={onClear} />}
      {/* A new pin or question draws fresh blocks, so a role, sort or tab chosen in one never carries into the next. */}
      <SpecView key={`${pin.id}:${question ?? ''}`} spec={withoutBlocks(pin.spec as Spec, hidden)} />
    </div>
  );
}
