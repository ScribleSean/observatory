// When each engine runs out at its recent pace, from the limit readings already collected.
// Pure functions: the same inputs always give the same forecast.
import { LIMIT_SPENT_PERCENT } from './glance-limits.mjs';
import { ENGINE_OFF_MS, readingFresh } from './freshness.mjs';

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
// Claude and Codex always get a tile; Grok only when its source is set up.
const ENGINES = [['claude', 'Claude', 'claudeLimits'], ['codex', 'Codex', 'quota'], ['grok', 'Grok', 'grokLimits']];
const OPTIONAL = ['grok'];
// A reading belongs to the current window when its reset time matches within this margin.
const SAME_RESET_MS = 5 * MINUTE;
// Below this, "has room" undersells it: the sentence says when the window resets instead.
export const TIGHT_PERCENT = 25;

// How far back the burn rate looks: 40% of the window, at least an hour and at most a day.
// Checked against the recorded history: a day predicted the weekly window 12 hours ahead with a
// mean error of 5 points, against 8 for three or six hours.
export function lookbackMs(durationMinutes) {
  const minutes = Number.isFinite(durationMinutes) && durationMinutes > 0 ? durationMinutes * 0.4 : 60;
  return Math.min(24 * 60, Math.max(60, minutes)) * MINUTE;
}

const rows = value => Array.isArray(value) ? value : [];
const time = value => { const at = typeof value === 'string' ? Date.parse(value) : NaN; return Number.isFinite(at) ? at : null; };
const percent = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;

/**
 * One limit window.
 * @param {{remaining:number|null, resetsAt:string|null, durationMinutes:number|null,
 *   readings?:{at:number, remaining:number, resetsAt:number|null}[], now:number}} input
 */
export function windowForecast({ remaining, resetsAt, durationMinutes, readings = [], now }) {
  const reset = time(resetsAt);
  const base = { remaining: percent(remaining) ? remaining : null, resetsAt: reset === null ? null : new Date(reset).toISOString(),
    runoutAt: null, ratePerHour: null, confidence: 'low' };
  if (!percent(remaining)) return { ...base, status: 'unknown' };
  if (remaining <= LIMIT_SPENT_PERCENT) return { ...base, status: 'out', confidence: 'high' };
  const from = now - lookbackMs(durationMinutes);
  const cycle = readings
    .filter(reading => reading.at >= from && reading.at <= now && percent(reading.remaining) &&
      (reset === null || reading.resetsAt === null || Math.abs(reading.resetsAt - reset) <= SAME_RESET_MS))
    .sort((a, b) => a.at - b.at);
  // A rise means the window reset inside the lookback: only the readings after it count.
  let start = 0;
  for (let index = 1; index < cycle.length; index++) if (cycle[index].remaining > cycle[index - 1].remaining + 0.5) start = index;
  const recent = [...cycle.slice(start), { at: now, remaining }];
  const first = recent[0];
  const span = now - first.at;
  if (recent.length < 3 || span < 15 * MINUTE) return { ...base, status: 'room' };
  const ratePerHour = Math.max(0, (first.remaining - remaining) / (span / HOUR));
  const confidence = recent.length >= 6 && span >= lookbackMs(durationMinutes) / 2 ? 'high' : 'medium';
  const measured = { ...base, ratePerHour: Math.round(ratePerHour * 100) / 100, confidence };
  if (ratePerHour <= 0) return { ...measured, status: 'room' };
  const runout = now + remaining / ratePerHour * HOUR;
  if (reset !== null && runout >= reset) return { ...measured, status: 'room' };
  return { ...measured, status: 'runs-out', runoutAt: new Date(runout).toISOString() };
}

const rank = { out: 0, 'runs-out': 1, room: 2, unknown: 3, usage: 4, off: 5 };

/**
 * Why an engine reads as Off rather than showing an old number, or null when it is on.
 * The signals are the setting, the sign-in, the plan the account reports and the age of the last reading.
 * @param {any} source the engine's limit source @param {'auto'|'on'|'off'} setting @param {number} now
 */
export function offReason(source, setting = 'auto', now = Date.now(), lastSeen = null) {
  if (setting === 'off') return 'off';
  if (source?.status === 'needs-auth') return 'signed-out';
  // "on" keeps a free plan's own allowance on screen for people who use it.
  if (setting !== 'on' && source?.plan === 'free') return 'no-plan';
  // The last reading the source still names, or else the newest one in the stored history.
  const last = time(source?.checkedAt) ?? lastSeen;
  if (last !== null && last <= now && now - last >= ENGINE_OFF_MS) return 'no-reading';
  return null;
}

/** The engine is as tight as its tightest window. */
export function engineForecast(engine, name, windows) {
  const known = windows.filter(window => window.status !== 'unknown');
  if (known.length === 0) return { engine, name, status: 'unknown', remaining: null, at: null, resetsAt: null, confidence: 'low', window: null };
  const by = status => known.filter(window => window.status === status);
  const out = by('out').sort((a, b) => (time(b.resetsAt) ?? Infinity) - (time(a.resetsAt) ?? Infinity))[0];
  const runs = by('runs-out').sort((a, b) => time(a.runoutAt) - time(b.runoutAt))[0];
  const lowest = [...known].sort((a, b) => a.remaining - b.remaining)[0];
  // A window with no current number could be the tight one, so "room" is only said when every window is read.
  if (!out && !runs && known.length < windows.length) return { engine, name, status: 'unknown', remaining: null, at: null, resetsAt: null, confidence: 'low', window: null };
  const pick = out ?? runs ?? lowest;
  const status = out ? 'out' : runs ? 'runs-out' : 'room';
  return { engine, name, status, remaining: pick.remaining, window: pick.window ?? null, measured: pick.ratePerHour !== null && pick.ratePerHour !== undefined,
    at: status === 'out' ? pick.resetsAt : status === 'runs-out' ? pick.runoutAt : null,
    resetsAt: pick.resetsAt, confidence: pick.confidence };
}

/** The engine to show when there is room for one number only. */
export function scarcest(engines) {
  const order = (a, b) => rank[a.status] - rank[b.status] ||
    (a.status === 'out' || a.status === 'runs-out' ? (time(a.at) ?? Infinity) - (time(b.at) ?? Infinity) : (a.remaining ?? 101) - (b.remaining ?? 101));
  return [...engines].sort(order)[0] ?? null;
}

/** "Thu 4 PM", "4:15 PM" today, or "Dec 3" further out, rounded to a quarter hour. */
export function when(iso, { now, timeZone }) {
  const at = Math.round(time(iso) / (15 * MINUTE)) * 15 * MINUTE;
  const day = value => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
  const clock = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(at).replace(':00', '');
  if (day(at) === day(now)) return clock;
  if (Math.abs(at - now) < 6 * 24 * HOUR) return `${new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(at)} ${clock}`;
  return new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric' }).format(at);
}

const OFF_PHRASES = { off: 'is off', 'signed-out': 'is signed out', 'no-plan': 'has no plan' };

/** One short phrase per engine, and the sentence that joins them, scarcest first. */
export function phrase(engine, context) {
  if (engine.status === 'off') return engine.off === 'no-reading' && engine.at ? `has no reading since ${when(engine.at, context)}` : OFF_PHRASES[engine.off] ?? 'is off';
  if (engine.status === 'usage') return engine.figure === '1' ? 'request today' : 'requests today';
  if (engine.status === 'out') return engine.at ? `is out until ${when(engine.at, context)}` : 'is out';
  if (engine.status === 'runs-out') return `runs out ${engine.confidence === 'low' ? 'around ' : ''}${when(engine.at, context)} at this pace`;
  // "Lasts until" needs a measured pace; without one, only the reset is known.
  if (engine.status === 'room' && engine.remaining !== null && engine.remaining <= TIGHT_PERCENT && engine.resetsAt)
    return `${engine.measured === false ? 'resets' : 'lasts until'} ${when(engine.resetsAt, context)}`;
  if (engine.status === 'room') return 'has room';
  return 'has no current reading';
}

const list = names => names.length > 2 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names.join(' and ');

export function sentence(engines, context) {
  const lead = scarcest(engines);
  const ordered = [...engines].sort((a, b) => a === lead ? -1 : b === lead ? 1 : rank[a.status] >= 4 || rank[b.status] >= 4 ? rank[a.status] - rank[b.status] : 0);
  if (ordered.length > 1 && ordered.every(engine => phrase(engine, context) === 'has room')) return `${list(ordered.map(engine => engine.name))} have room.`;
  return ordered.map(engine => `${engine.name} ${engine.status === 'usage' ? `has ${engine.figure} ` : ''}${phrase(engine, context)}.`).join(' ');
}

/** Readings for one window from the stored limit history, merged across computers. */
export function readingsFor(view, provider, windowId) {
  const rows = Array.isArray(view?.limitHistory) ? view.limitHistory : [];
  const seen = new Set();
  const readings = [];
  for (const point of rows.flatMap(row => Array.isArray(row?.points) ? row.points : [])) {
    if (point?.p !== provider || point.w !== windowId) continue;
    const at = time(point.t);
    if (at === null || !percent(point.r) || seen.has(at)) continue;
    seen.add(at);
    readings.push({ at, remaining: point.r, resetsAt: time(point.x) });
  }
  return readings;
}

/** Requests per day from the local request log, if the source keeps one: today's count, or null. */
export function requestsToday(source, { now, timeZone }) {
  const days = Array.isArray(source?.requests?.days) ? source.requests.days : null;
  if (!days) return null;
  // Days are counted where the log is kept, so today is that computer's today.
  const zone = typeof source.requests.timeZone === 'string' ? source.requests.timeZone : timeZone;
  let today;
  try { today = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }
  catch { return null; }
  // Counted on an earlier day: today's number is not known, so no zero is made up.
  const counted = time(source.requests.checkedAt);
  if (counted === null || new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(counted) !== today) return null;
  const row = days.find(day => day?.date === today);
  if (!row) return 0;
  return Number.isSafeInteger(row.count) && row.count >= 0 ? row.count : null;
}

/**
 * The forecast for every engine, from the glance limit rows (already checked for freshness).
 * @param {Record<string, any>} view @param {any[]} limitRows
 * @param {{now:number, timeZone:string, settings?:Record<string, 'auto'|'on'|'off'>}} context
 */
export function forecast(view, limitRows, { now, timeZone, settings = {} }) {
  const context = { now, timeZone };
  const present = ([engine, , key]) => !OPTIONAL.includes(engine) || (view?.[key] && view[key].status !== 'not-connected');
  const engines = ENGINES.filter(present).map(([engine, name, key]) => {
    const source = view?.[key];
    const seen = Math.max(-Infinity, ...rows(view?.limitHistory).flatMap(row => rows(row?.points)).filter(point => point?.p === engine).map(point => time(point.t) ?? -Infinity));
    const off = offReason(source, settings[engine] ?? 'auto', now, Number.isFinite(seen) ? seen : null);
    const requests = requestsToday(source, context);
    const detail = [];
    if (requests !== null) detail.push(`${requests} ${requests === 1 ? 'request' : 'requests'} today`);
    if (off) {
      const last = time(source?.checkedAt) ?? (Number.isFinite(seen) ? seen : null);
      return { engine, name, status: 'off', off, figure: 'Off', remaining: null, window: null, resetsAt: null, confidence: 'low',
        at: off === 'no-reading' && last !== null ? new Date(last).toISOString() : null };
    }
    // A gap row is a window the dashboard expected but the provider never named: it says nothing about this engine.
    const own = limitRows.filter(row => row.provider === engine && !row.absent && !row.gap);
    if (requests !== null && !(Array.isArray(source?.windows) && source.windows.length))
      return { engine, name, status: 'usage', figure: String(requests), remaining: null, window: null, at: null, resetsAt: null, confidence: 'low' };
    const windows = own.map(row => {
      const stored = (Array.isArray(source?.windows) ? source.windows : []).find(window => window?.bucket === row.bucket && window.window === row.windowId);
      const current = row.remaining !== null && !row.stale ? row.remaining : null;
      return { ...windowForecast({ remaining: current, resetsAt: row.resetsAt ?? stored?.resetsAt ?? null,
        durationMinutes: stored?.durationMinutes ?? null, readings: readingsFor(view, engine, row.windowId), now }), window: row.window };
    });
    const result = engineForecast(engine, name, windows);
    // A reading the source says is still good, but older than the usual few minutes, says when it was taken.
    const checked = time(source?.checkedAt);
    if (result.status !== 'unknown' && checked !== null && !readingFresh(checked, now)) detail.push(`as of ${when(new Date(checked).toISOString(), context)}`);
    return detail.length ? { ...result, detail: detail.join(' · ') } : result;
  });
  const scarce = scarcest(engines);
  const shown = scarce && rank[scarce.status] <= rank.room ? scarce : null;
  return {
    engines: engines.map(engine => ({ ...engine, phrase: phrase(engine, context) })),
    scarce: shown ? { engine: shown.engine, name: shown.name, remaining: shown.remaining, status: shown.status } : null,
    sentence: sentence(engines, context),
    menu: shown && shown.remaining !== null ? `${shown.name} ${Math.round(shown.remaining)}%` : null,
  };
}
