import { STRINGS } from '../../../lib/strings.generated';
import './forecast.css';

export type EngineForecast = {
  engine: 'claude' | 'codex' | 'grok'; name: string; status: 'out' | 'runs-out' | 'room' | 'unknown' | 'usage' | 'off';
  remaining: number | null; at: string | null; resetsAt: string | null; window: string | null; phrase: string;
  figure?: string; detail?: string;
};
export type Outlook = { engines: EngineForecast[]; scarce: { engine: string; remaining: number | null; status: string } | null; sentence: string; menu: string | null };

const tone = (engine: EngineForecast) => engine.status === 'out' ? 'spent' : engine.status === 'runs-out' ? 'warn' : '';
// Off and request counts come with their own figure; everything else is the share left.
const number = (engine: EngineForecast) => engine.figure ?? (engine.remaining === null ? STRINGS.status.unknown : `${Math.round(engine.remaining)}%`);
const muted = (engine: EngineForecast) => engine.status === 'off' || (engine.remaining === null && engine.figure === undefined);
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// The scarcer engine leads, so the first thing read is the one that matters.
function ordered(outlook: Outlook) {
  return [...outlook.engines].sort((a, b) => a.engine === outlook.scarce?.engine ? -1 : b.engine === outlook.scarce?.engine ? 1 : 0);
}

function Bar({ engine }: { engine: EngineForecast }) {
  return <span className="fc-bar" aria-hidden="true">{engine.remaining !== null && <i className={engine.engine} style={{ width: `${Math.max(1, engine.remaining)}%` }} />}</span>;
}

/** One tile per engine: a large number and its part of the sentence. The scarcer engine leads. */
export function Forecast({ outlook, stale = false }: { outlook: Outlook; stale?: boolean }) {
  const engines = ordered(outlook);
  return <section className={`fc fc-tiles ${stale ? 'stale' : ''}`.trim()} aria-label={STRINGS.forecast.title}>
    <h2 className="ob-visually-hidden">{outlook.sentence}</h2>
    <ul>
      {engines.map(engine => <li key={engine.engine} className={`fc-tile ${engine.engine === outlook.scarce?.engine ? 'lead' : ''}`}>
        <span className="fc-name"><i className={`ob-dot ${engine.engine}`} aria-hidden="true" />{engine.name}</span>
        <span className={`fc-big ${tone(engine)} ${muted(engine) ? 'ob-unknown' : ''}`.trim()} data-hero={engine.engine === outlook.scarce?.engine ? '' : undefined}>{number(engine)}</span>
        <Bar engine={engine} />
        <span className="fc-phrase">{capital(engine.phrase.replace(/ at this pace$/, ''))}{engine.detail && <span className="fc-detail"> · {engine.detail}</span>}</span>
      </li>)}
    </ul>
  </section>;
}
