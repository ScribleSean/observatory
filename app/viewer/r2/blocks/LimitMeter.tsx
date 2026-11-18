// One engine's limit windows as meter rows: used, a tick at the share of the window gone, the projection
// at the reset and the computer the reading came from. An account limit is never summed across computers.
import type { LimitWindowVM, LimitsVM } from '../../../../lib/view-r2.mjs';
import { UNKNOWN, clock, dayClock } from '../views/parts';
import '../views/more.css';

export type Engine = LimitsVM['engines'][number];
type Forecast = { status?: string; ratePerHour?: number | null; runoutAt?: string | null } | null;

const MINUTE = 60000;
/** The window's length in minutes, from its label: "weekly", "5 hour", "30 day". */
export function windowMinutes(window: Pick<LimitWindowVM, 'label' | 'windowId'>) {
  const text = `${window.label} ${window.windowId}`.toLowerCase();
  if (/week|seven_day|secondary/.test(text)) return 10080;
  const hours = /(\d+)\s*h(ou)?r?/.exec(text), days = /(\d+)\s*d(ay)?/.exec(text);
  if (/five_hour|primary/.test(text)) return 300;
  if (hours) return Number(hours[1]) * 60;
  if (days) return Number(days[1]) * 1440;
  return null;
}

/** What the window looks like now: percent used, share of the window gone and the projection at the reset. */
export function windowNow(window: LimitWindowVM, now: number) {
  const used = window.remaining === null ? null : Math.max(0, Math.min(100, 100 - window.remaining));
  const minutes = windowMinutes(window), reset = window.resetsAt ? Date.parse(window.resetsAt) : NaN;
  const length = minutes ? minutes * MINUTE : null;
  const gone = length && Number.isFinite(reset) ? Math.max(0, Math.min(1, 1 - (reset - now) / length)) : null;
  const forecast = window.forecast as Forecast;
  let projected: number | null = null;
  if (used !== null && forecast?.status === 'runs-out') projected = 100;
  else if (used !== null && forecast && typeof forecast.ratePerHour === 'number' && Number.isFinite(reset))
    projected = Math.min(100, used + forecast.ratePerHour * Math.max(0, reset - now) / (60 * MINUTE));
  else if (used !== null && forecast?.status === 'room' && gone === 1) projected = used;
  return { used, gone, length, reset: Number.isFinite(reset) ? reset : null, projected, runoutAt: forecast?.status === 'runs-out' ? forecast.runoutAt ?? null : null };
}

const pct = (value: number) => `${Math.round(value)}%`;

/** The pace in plain words, from the projection. */
export function paceWords(state: ReturnType<typeof windowNow>, timeZone: string) {
  if (state.used === null) return null;
  if (state.used >= 100) return 'used up';
  if (state.runoutAt) return `runs out ${dayClock(state.runoutAt, timeZone)}`;
  if (state.projected !== null) return 'on pace to last';
  return null;
}

function Row({ name, window, now, timeZone }: { name: string; window: LimitWindowVM; now: number; timeZone: string }) {
  const state = windowNow(window, now);
  const title = `${name} ${window.label}`;
  if (state.used === null || window.state === 'stale' || window.state === 'off') {
    const why = window.state === 'off' ? 'Turned off in observatory.config.json'
      : window.checkedAt ? `Not in the ${clock(window.checkedAt, timeZone)} read` : 'Not reported by the app yet';
    return (
      <div className="lim">
        <div className="h"><span>{title}</span><b className="unk">{window.state === 'off' ? 'Off' : UNKNOWN}</b></div>
        <div className="f"><span>{why}</span></div>
      </div>
    );
  }
  const spent = state.used >= 100 || window.state === 'spent';
  const pace = paceWords(state, timeZone);
  return (
    <div className="lim">
      <div className="h"><span>{title}</span><span>{state.reset ? `Resets ${dayClock(state.reset, timeZone)}` : 'Reset Unknown'}</span></div>
      <div className="h" style={{ marginTop: 2 }}>
        <b className={spent ? 'acc' : undefined}>{pct(state.used)}<small>used</small></b>
        {pace && <span className={state.runoutAt ? 'acc' : undefined}>{pace}</span>}
      </div>
      <div className="meter">
        <i style={{ width: `${state.used}%`, ...(spent ? { background: 'var(--accent)' } : {}) }} />
        {state.gone !== null && <u style={{ left: `${100 * state.gone}%` }} title={`${pct(100 * state.gone)} of the window has passed`} />}
      </div>
      <div className="f">
        <span>{state.gone !== null ? `${pct(100 * state.gone)} of the ${window.label === 'weekly' ? 'week' : 'window'} gone` : `Read on ${window.readOn ?? UNKNOWN}`}</span>
        <span>{state.projected !== null ? `about ${pct(state.projected)} at the reset` : window.readOn ? `read on ${window.readOn} at ${clock(window.checkedAt, timeZone)}` : ''}</span>
      </div>
    </div>
  );
}

/** Every window of one engine, or only `windowId`. */
export function LimitMeter({ engine, windowId = null, now, timeZone }: { engine: Engine; windowId?: string | null; now: number; timeZone: string }) {
  const windows = engine.windows.filter(window => windowId === null || window.windowId === windowId);
  return <>{windows.map(window => <Row key={window.windowId} name={engine.name} window={window} now={now} timeZone={timeZone} />)}</>;
}
