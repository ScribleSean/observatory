// When each engine runs out at its recent pace, from the limit readings already collected.
// This is the only forecast. The hub runs forecast() once per combined reading (lib/combine.mjs) and stores
// the result, worded, in combined.json as glance.forecast. Every surface displays that stored result.
// Pure functions: the same inputs always give the same forecast.
import { LIMIT_SPENT_PERCENT } from './glance-limits.mjs';
import { ENGINE_OFF_MS, readingFresh } from './freshness.mjs';
import { allowanceStepped } from '../scripts/quota-timing.mjs';
import strings from './strings.json' with { type: 'json' };
import { format } from './format.mjs';

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
// Claude and Codex always get a tile; Grok only when its source is set up.
const ENGINES = [['claude', 'Claude', 'claudeLimits'], ['codex', 'Codex', 'quota'], ['grok', 'Grok', 'grokLimits']];
const OPTIONAL = ['grok'];
// A reading belongs to the current window when its reset time matches within this margin.
const SAME_RESET_MS = 5 * MINUTE;
// Below this, "has room" undersells it: the sentence says when the window resets instead.
export const TIGHT_PERCENT = 25;

// Without a window length the pace is a straight line over this much history: 40% of the window,
// at least an hour and at most a day.
export function lookbackMs(durationMinutes) {
  const minutes = Number.isFinite(durationMinutes) && durationMinutes > 0 ? durationMinutes * 0.4 : 60;
  return Math.min(24 * 60, Math.max(60, minutes)) * MINUTE;
}

// The pace has two parts: the last hour, and the average since the window opened, which counts nights
// and idle days. A burst fades toward the average over about two hours. Replayed over recorded weekly limits
// (scripts/harness/forecast-backtest.mjs), this missed by less than a straight line over the last day in most
// cases. Use comes in bursts, so a forecast a day ahead still misses by about 10 points.
const RECENT_MS = HOUR;
const FADE_HOURS = 2;
// The stated range is the middle 80% of how far past forecasts for the same look-ahead missed.
// In the backtest the share left at a fixed look-ahead landed inside it 7 to 8 times in 10.
const RANGE = [0.1, 0.9];
export const RANGE_SHARE = RANGE[1] - RANGE[0];
const RANGE_MIN_FORECASTS = 24;
const RANGE_MIN_SPAN_MS = 3 * 24 * HOUR;
const LOOK_AHEAD_HOURS = [1, 2, 3, 6, 12, 24, 48, 72, 96, 120, 144, 168];

const rows = value => Array.isArray(value) ? value : [];
const time = value => { const at = typeof value === 'string' ? Date.parse(value) : NaN; return Number.isFinite(at) ? at : null; };
const percent = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
const sameWindow = (a, b) => a.resetsAt === null || b.resetsAt === null || Math.abs(a.resetsAt - b.resetsAt) <= SAME_RESET_MS;
// A rise means the window reset between two readings.
const rose = (earlier, later) => later.remaining > earlier.remaining + 0.5;

/**
 * Points per hour at one reading: over the last hour and on average since the window opened.
 * @param {{at:number, remaining:number, resetsAt:number|null}[]} list sorted by time @param {number} index
 */
function paceAt(list, index, durationMinutes) {
  const here = list[index];
  const since = from => {
    let first = null, count = 1;
    for (let i = index - 1; i >= 0 && list[i].at >= from && sameWindow(list[i], here) && !rose(list[i], list[i + 1]) &&
      !allowanceStepped(list[i], list[i + 1], durationMinutes); i--) { first = list[i]; count++; }
    return first && here.at - first.at >= 15 * MINUTE ? { rate: Math.max(0, (first.remaining - here.remaining) / ((here.at - first.at) / HOUR)), count } : null;
  };
  // A reset further off than the window is long means the stored length is out of date: no opening time then.
  const start = here.resetsAt !== null && Number.isFinite(durationMinutes) && durationMinutes > 0 ? here.resetsAt - durationMinutes * MINUTE : null;
  const opened = start !== null && start <= here.at ? start : null;
  const line = opened === null ? since(here.at - lookbackMs(durationMinutes)) : null;
  const average = opened !== null && here.at - opened >= 15 * MINUTE ? (100 - here.remaining) / ((here.at - opened) / HOUR)
    : line && line.count >= 3 ? line.rate : null;
  if (average === null) return null;
  const recent = since(here.at - RECENT_MS);
  return { average, recent: recent ? recent.rate : average, measured: recent !== null };
}

/** Points spent after a number of hours: the average pace, plus what is left of the current burst. */
export function burnAfter(pace, hours) {
  return pace.average * hours + (pace.recent - pace.average) * FADE_HOURS * (1 - Math.exp(-hours / FADE_HOURS));
}

function runoutHours(pace, remaining, limit) {
  if (burnAfter(pace, limit) < remaining) return null;
  let low = 0, high = limit;
  for (let step = 0; step < 40; step++) { const middle = (low + high) / 2; if (burnAfter(pace, middle) < remaining) low = middle; else high = middle; }
  return high;
}

function quantile(sorted, share) {
  const at = (sorted.length - 1) * share, below = Math.floor(at);
  return sorted[below] + (sorted[Math.min(sorted.length - 1, below + 1)] - sorted[below]) * (at - below);
}

/**
 * How far forecasts made from the stored readings missed, per look-ahead: the user's own record.
 * @returns {(hours:number) => {low:number, high:number}|null} points spent beyond the forecast, or null with too little history
 */
function pastMisses(list, durationMinutes) {
  // Points spent and time accounted for up to each reading. Time with the limit spent, across a reset, or across a
  // change of allowance says nothing about demand.
  const spent = [0], known = [0];
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1], b = list[i];
    const counts = sameWindow(a, b) && !rose(a, b) && !allowanceStepped(a, b, durationMinutes) && a.remaining > LIMIT_SPENT_PERCENT;
    spent.push(spent[i - 1] + (counts ? Math.max(0, a.remaining - b.remaining) : 0));
    known.push(known[i - 1] + (counts ? b.at - a.at : 0));
  }
  const upTo = (sums, at) => {
    let low = 0, high = list.length - 1;
    while (low < high) { const middle = (low + high + 1) >> 1; if (list[middle].at <= at) low = middle; else high = middle - 1; }
    const next = list[low + 1];
    return next ? sums[low] + (sums[low + 1] - sums[low]) * (at - list[low].at) / (next.at - list[low].at) : sums[low];
  };
  // One past forecast an hour is plenty: readings a few minutes apart say the same thing.
  const made = [];
  for (let i = 0, last = -Infinity; i < list.length - 1; i++) {
    if (list[i].at - last < HOUR || list[i].remaining <= LIMIT_SPENT_PERCENT) continue;
    const pace = paceAt(list, i, durationMinutes);
    if (pace) { made.push({ index: i, pace }); last = list[i].at; }
  }
  const end = list.at(-1).at;
  const cache = new Map();
  return hours => {
    if (cache.has(hours)) return cache.get(hours);
    const span = hours * HOUR, misses = [];
    let first = null, latest = null;
    for (const { index, pace } of made) {
      const from = list[index].at;
      if (from + span > end) break;
      const covered = upTo(known, from + span) - known[index];
      if (covered < 0.8 * span) continue;
      misses.push((upTo(spent, from + span) - spent[index]) * span / covered - burnAfter(pace, hours));
      first ??= from; latest = from;
    }
    const enough = misses.length >= RANGE_MIN_FORECASTS && latest - first >= RANGE_MIN_SPAN_MS;
    misses.sort((a, b) => a - b);
    const result = enough ? { low: Math.min(0, quantile(misses, RANGE[0])), high: Math.max(0, quantile(misses, RANGE[1])) } : null;
    cache.set(hours, result);
    return result;
  };
}

/**
 * The share left after some hours, with the range past forecasts support.
 * @param {{remaining:number, resetsAt:string|null, durationMinutes:number|null,
 *   readings?:{at:number, remaining:number, resetsAt:number|null}[], now:number}} input
 * @returns {null | {pace:{average:number, recent:number, measured:boolean},
 *   miss:(hours:number) => {low:number, high:number}|null,
 *   after:(hours:number) => {left:number, low:number|null, high:number|null}}}
 */
export function projection({ remaining, resetsAt, durationMinutes, readings = [], now }) {
  if (!percent(remaining)) return null;
  const list = [...readings.filter(reading => reading.at < now && percent(reading.remaining)).sort((a, b) => a.at - b.at),
    { at: now, remaining, resetsAt: time(resetsAt) }];
  const pace = paceAt(list, list.length - 1, durationMinutes);
  if (!pace) return null;
  let misses;
  const miss = hours => (misses ??= pastMisses(list, durationMinutes))(hours);
  return { pace, miss, after(hours) {
    const left = remaining - burnAfter(pace, hours), range = miss(hours);
    return { left: Math.max(0, left), low: range ? Math.max(0, left - range.high) : null, high: range ? Math.max(0, Math.min(100, left - range.low)) : null };
  } };
}

/**
 * One limit window.
 * @param {{remaining:number|null, resetsAt:string|null, durationMinutes:number|null,
 *   readings?:{at:number, remaining:number, resetsAt:number|null}[], now:number}} input
 */
export function windowForecast({ remaining, resetsAt, durationMinutes, readings = [], now }) {
  const reset = time(resetsAt);
  const base = { remaining: percent(remaining) ? remaining : null, resetsAt: reset === null ? null : new Date(reset).toISOString(),
    runoutAt: null, earliestAt: null, latestAt: null, ratePerHour: null, leftAtReset: null, confidence: 'low' };
  if (!percent(remaining)) return { ...base, status: 'unknown' };
  if (remaining <= LIMIT_SPENT_PERCENT) return { ...base, status: 'out', confidence: 'high' };
  // A reset that has already passed means the reading is from the old window: nothing to project.
  if (reset !== null && reset <= now) return { ...base, status: 'room' };
  const ahead = projection({ remaining, resetsAt, durationMinutes, readings, now });
  if (!ahead) return { ...base, status: 'room' };
  const stamp = hours => new Date(now + hours * HOUR).toISOString();
  const untilReset = reset !== null && reset > now ? (reset - now) / HOUR : null;
  // The range is followed hour by hour to the reset, and stops where the history runs short.
  let earliest = null, latest = null, ranged = untilReset !== null;
  if (untilReset !== null) {
    let before = { hours: 0, low: remaining, high: remaining };
    for (const hours of [...LOOK_AHEAD_HOURS.filter(value => value < untilReset), untilReset]) {
      const miss = ahead.miss(hours);
      if (!miss) { ranged = false; break; }
      const left = remaining - burnAfter(ahead.pace, hours), low = left - miss.high, high = left - miss.low;
      const crossed = (was, is) => before.hours + (hours - before.hours) * was / (was - is);
      if (earliest === null && low <= 0) earliest = crossed(before.low, low);
      if (latest === null && high <= 0) latest = crossed(before.high, high);
      before = { hours, low, high };
    }
  }
  const ran = runoutHours(ahead.pace, remaining, untilReset ?? 24 * 365);
  const measured = { ...base, ratePerHour: Math.round(ahead.pace.average * 100) / 100,
    leftAtReset: untilReset === null ? null : Math.round(Math.max(0, remaining - burnAfter(ahead.pace, untilReset)) * 10) / 10,
    confidence: ranged ? 'high' : ahead.pace.measured ? 'medium' : 'low',
    earliestAt: earliest === null ? null : stamp(earliest), latestAt: latest === null ? null : stamp(latest) };
  // A runout at the reset itself is the window lasting.
  if (ran === null || (untilReset !== null && ran >= untilReset - 1 / 60)) return { ...measured, status: 'room' };
  return { ...measured, status: 'runs-out', runoutAt: stamp(ran) };
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
  const unknown = { engine, name, status: 'unknown', remaining: null, at: null, runoutAt: null, earliestAt: null, latestAt: null, resetsAt: null, confidence: 'low', window: null, windowId: null };
  if (known.length === 0) return unknown;
  const by = status => known.filter(window => window.status === status);
  const out = by('out').sort((a, b) => (time(b.resetsAt) ?? Infinity) - (time(a.resetsAt) ?? Infinity))[0];
  const runs = by('runs-out').sort((a, b) => time(a.runoutAt) - time(b.runoutAt))[0];
  const lowest = [...known].sort((a, b) => a.remaining - b.remaining)[0];
  // A window with no current number could be the tight one, so "room" is only said when every window is read.
  if (!out && !runs && known.length < windows.length) return unknown;
  const pick = out ?? runs ?? lowest;
  const status = out ? 'out' : runs ? 'runs-out' : 'room';
  return { engine, name, status, remaining: pick.remaining, window: pick.window ?? null, windowId: pick.windowId ?? null,
    measured: pick.ratePerHour !== null && pick.ratePerHour !== undefined,
    at: status === 'out' ? pick.resetsAt : status === 'runs-out' ? pick.runoutAt : null,
    runoutAt: pick.runoutAt ?? null, earliestAt: pick.earliestAt ?? null, latestAt: pick.latestAt ?? null,
    resetsAt: pick.resetsAt, confidence: pick.confidence, ratePerHour: pick.ratePerHour ?? null, leftAtReset: pick.leftAtReset ?? null };
}

/** The engine to show when there is room for one number only. */
export function scarcest(engines) {
  const order = (a, b) => rank[a.status] - rank[b.status] ||
    (a.status === 'out' || a.status === 'runs-out' ? (time(a.at) ?? Infinity) - (time(b.at) ?? Infinity) : (a.remaining ?? 101) - (b.remaining ?? 101));
  return [...engines].sort(order)[0] ?? null;
}

const weekday = (at, timeZone) => new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(at);
const dateOf = (at, timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
const SOON_MS = 6 * 24 * HOUR;

/** "Thu 4 PM" or "Thu 4:15 PM" within six days, today included, or "Dec 3" further out. Rounded to a quarter hour. A time always names its day. */
export function when(iso, { now, timeZone }) {
  const at = Math.round(time(iso) / (15 * MINUTE)) * 15 * MINUTE;
  const clock = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(at).replace(':00', '');
  if (Math.abs(at - now) < SOON_MS) return `${weekday(at, timeZone)} ${clock}`;
  return new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric' }).format(at);
}

/** "Thu 3–6 PM", "Wed 9 PM to Thu 8 AM", or "Thu to Sat" and "by Sat" when the range is longer than a day. */
export function between(from, to, { now, timeZone }) {
  const round = iso => Math.round(time(iso) / HOUR) * HOUR;
  const start = round(from), end = round(to);
  const single = at => when(new Date(at).toISOString(), { now, timeZone });
  if (end <= start) return single(start);
  const soon = Math.abs(end - now) < SOON_MS;
  if (dateOf(start, timeZone) !== dateOf(end, timeZone)) {
    if (end - start <= 24 * HOUR && soon) return `${single(start)} to ${single(end)}`;
    // Both ends are weekdays, or both are dates.
    const name = at => soon ? weekday(at, timeZone) : new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric' }).format(at);
    return dateOf(start, timeZone) === dateOf(now, timeZone) && soon ? `by ${name(end)}` : `${name(start)} to ${name(end)}`;
  }
  if (Math.abs(start - now) >= SOON_MS) return single(start);
  // The day is said once, and the first hour drops its AM or PM when the second has the same.
  const [day, hour, half] = single(start).split(' '), [, lastHour, lastHalf] = single(end).split(' ');
  return `${day} ${hour}${half === lastHalf ? '' : ` ${half}`}–${lastHour} ${lastHalf}`;
}

const F = strings.forecast;
const OFF_CLAIMS = { off: F.isOff, 'signed-out': F.signedOut, 'no-plan': F.noPlan };

/**
 * What the forecast claims about one engine or one window, in three parts so a page can set the time in bold.
 * The words come from lib/strings.json (forecast). Every surface shows these parts, joined by spaces, unchanged.
 * @returns {{lead: string, when: string, tail: string}}
 */
export function claim(record, context) {
  const say = (lead, at = '', tail = '') => ({ lead, when: at, tail });
  const at = iso => when(iso, context);
  const runout = record.runoutAt ?? record.at ?? null;
  // A window's pace is measured when it has a rate. An engine says so itself.
  const measured = record.measured ?? record.ratePerHour !== null;
  const tight = record.remaining !== null && record.remaining !== undefined && record.remaining <= TIGHT_PERCENT;
  if (record.status === 'off') return record.off === 'no-reading' && record.at ? say(F.noReadingSince, at(record.at)) : say(OFF_CLAIMS[record.off] ?? F.isOff);
  if (record.status === 'usage') return say(format(record.figure === '1' ? F.oneRequest : F.requests, { count: record.figure }));
  if (record.status === 'out') { const until = record.at ?? record.resetsAt; return until ? say(F.outUntil, at(until)) : say(F.out); }
  // With a range from past forecasts, the range is the claim. It says "may" because in the backtest a window forecast
  // to run out often lasted, on recorded limits because use slows as a limit gets low.
  if (record.status === 'runs-out' && record.earliestAt && record.latestAt) return say(F.mayRunOut, between(record.earliestAt, record.latestAt, context));
  if (record.status === 'runs-out' && record.earliestAt) return say(F.mayRunOutFrom, at(record.earliestAt));
  if (record.status === 'room' && record.earliestAt && record.resetsAt && tight) return say(F.likelyLasts, at(record.resetsAt));
  if (record.status === 'runs-out' && runout) return say(record.confidence === 'low' ? F.runsOutAround : F.runsOut, at(runout), F.atPace);
  // "Lasts until" needs a measured pace. Without one, only the reset is known.
  if (record.status === 'room' && tight && record.resetsAt) return say(measured ? F.lastsUntil : F.resetsWhen, at(record.resetsAt));
  if (record.status === 'room') return say(F.hasRoom);
  return say(F.noReading);
}

const joinClaim = parts => [parts.lead, parts.when, parts.tail].filter(Boolean).join(' ');
const capital = text => text.charAt(0).toUpperCase() + text.slice(1);

/** One short phrase per engine or window: the claim as one line. */
export function phrase(record, context) {
  return joinClaim(claim(record, context));
}

/** How long before the reset the claimed run-out time is: "24 hours before the reset", or null. */
export function beforeReset(record) {
  if (record.status !== 'runs-out') return null;
  const said = time(record.earliestAt) ?? time(record.runoutAt ?? record.at), reset = time(record.resetsAt);
  if (said === null || reset === null) return null;
  const hours = Math.round((reset - said) / HOUR);
  if (hours < 1) return null;
  if (hours === 1) return F.beforeResetHour;
  return hours < 48 ? format(F.beforeResetHours, { count: hours }) : format(F.beforeResetDays, { count: Math.round(hours / 24) });
}

/** Everything a surface shows about one engine or window, worded once. */
export function worded(record, name, context) {
  const parts = claim(record, context);
  const text = joinClaim(parts);
  const reset = time(record.resetsAt);
  const headline = capital(format(F.headline, { name, phrase: text }));
  // The headline in three parts, so a page can set the time in bold and still show exactly the headline.
  const say = { lead: headline.slice(0, headline.length - [parts.when, parts.tail].filter(Boolean).join(' ').length).trimEnd(), when: parts.when, tail: parts.tail };
  return { ...record, claim: parts, phrase: text, headline, say,
    sentence: format(F.sentence, { name, phrase: text }),
    resets: reset !== null && reset > context.now ? format(F.resets, { time: when(record.resetsAt, context) }) : null,
    resetsWhen: reset !== null && reset > context.now ? when(record.resetsAt, context) : null,
    beforeReset: beforeReset(record) };
}

const list = names => names.length > 2 ? format(F.listMany, { rest: names.slice(0, -1).join(', '), last: names.at(-1) })
  : names.length === 2 ? format(F.listMany, { rest: names[0], last: names[1] }) : names.join('');

/** The sentence that joins every engine's phrase, scarcest first. */
export function sentence(engines, context) {
  const lead = scarcest(engines);
  const ordered = [...engines].sort((a, b) => a === lead ? -1 : b === lead ? 1 : rank[a.status] >= 4 || rank[b.status] >= 4 ? rank[a.status] - rank[b.status] : 0);
  if (ordered.length > 1 && ordered.every(engine => phrase(engine, context) === F.hasRoom)) return format(F.allRoom, { names: list(ordered.map(engine => engine.name)) });
  return ordered.map(engine => format(F.sentence, { name: engine.name, phrase: phrase(engine, context) })).join(' ');
}
export function readingsFor(view, provider, windowId, durationMinutes = null) {
  const rows = Array.isArray(view?.limitHistory) ? view.limitHistory : [];
  const seen = new Set();
  const readings = [];
  for (const point of rows.flatMap(row => Array.isArray(row?.points) ? row.points : [])) {
    if (point?.p !== provider || point.w !== windowId) continue;
    // A window that changed length under the same name is a different limit.
    if (durationMinutes !== null && typeof point.d === 'number' && point.d !== durationMinutes) continue;
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
export const FORECAST_SCHEMA = 'observatory-forecast/1';

/**
 * The forecast for every engine and every limit window, from the glance limit rows (already checked for freshness).
 * Run once per combined reading by lib/combine.mjs, which stores the result as glance.forecast. Each engine and window
 * carries its claim already worded in the user's time zone, so no surface words or recomputes it.
 * @param {Record<string, any>} view @param {any[]} limitRows
 * @param {{now:number, timeZone:string, settings?:Record<string, 'auto'|'on'|'off'>}} context
 */
export function forecast(view, limitRows, { now, timeZone, settings = {} }) {
  const context = { now, timeZone };
  const windows = [];
  const present = ([engine, , key]) => !OPTIONAL.includes(engine) || (view?.[key] && view[key].status !== 'not-connected');
  const engines = ENGINES.filter(present).map(([engine, name, key]) => {
    const source = view?.[key];
    const seen = Math.max(-Infinity, ...rows(view?.limitHistory).flatMap(row => rows(row?.points)).filter(point => point?.p === engine).map(point => time(point.t) ?? -Infinity));
    const off = offReason(source, settings[engine] ?? 'auto', now, Number.isFinite(seen) ? seen : null);
    const requests = requestsToday(source, context);
    const detail = [];
    if (requests !== null) detail.push(requests === 1 ? F.oneRequestToday : format(F.requestsToday, { count: requests }));
    if (off) {
      const last = time(source?.checkedAt) ?? (Number.isFinite(seen) ? seen : null);
      return { engine, name, status: 'off', off, figure: 'Off', remaining: null, window: null, windowId: null, resetsAt: null, confidence: 'low',
        at: off === 'no-reading' && last !== null ? new Date(last).toISOString() : null, runoutAt: null, earliestAt: null, latestAt: null };
    }
    // A gap row is a window the dashboard expected but the provider never named: it says nothing about this engine.
    const own = limitRows.filter(row => row.provider === engine && !row.absent && !row.gap);
    if (requests !== null && !(Array.isArray(source?.windows) && source.windows.length))
      return { engine, name, status: 'usage', figure: String(requests), remaining: null, window: null, windowId: null, at: null, resetsAt: null, confidence: 'low',
        runoutAt: null, earliestAt: null, latestAt: null };
    const forecasts = own.map(row => {
      const stored = (Array.isArray(source?.windows) ? source.windows : []).find(window => window?.bucket === row.bucket && window.window === row.windowId);
      const durationMinutes = typeof stored?.durationMinutes === 'number' && stored.durationMinutes > 0 ? stored.durationMinutes : null;
      const current = row.remaining !== null && !row.stale ? row.remaining : null;
      const resetsAt = row.resetsAt ?? stored?.resetsAt ?? null;
      const readings = readingsFor(view, engine, row.windowId, durationMinutes);
      const result = { ...windowForecast({ remaining: current, resetsAt, durationMinutes, readings, now }), window: row.window, windowId: row.windowId };
      if (row.windowId) {
        // The share used in the window before this one, from its last reading.
        const before = time(resetsAt) !== null && durationMinutes !== null ? time(resetsAt) - durationMinutes * MINUTE : null;
        const last = before === null ? null : readings.filter(reading => reading.resetsAt !== null && Math.abs(reading.resetsAt - before) <= SAME_RESET_MS)
          .sort((a, b) => b.at - a.at)[0];
        windows.push({ engine, name: row.name, bucket: row.bucket ?? null, durationMinutes, ...result,
          previousUsed: last ? Math.max(0, 100 - last.remaining) : null, headlineName: name });
      }
      return result;
    });
    const result = engineForecast(engine, name, forecasts);
    // A reading the source says is still good, but older than the usual few minutes, says when it was taken.
    const checked = time(source?.checkedAt);
    if (result.status !== 'unknown' && checked !== null && !readingFresh(checked, now)) detail.push(format(strings.formats.asOf, { time: when(new Date(checked).toISOString(), context) }));
    return detail.length ? { ...result, detail: detail.join(strings.formats.separator) } : result;
  });
  const scarce = scarcest(engines);
  const shown = scarce && rank[scarce.status] <= rank.room ? scarce : null;
  return {
    schema: FORECAST_SCHEMA, asOf: new Date(now).toISOString(), timeZone,
    engines: engines.map(engine => worded(engine, engine.name, context)),
    windows: windows.map(({ headlineName, ...window }) => worded(window, headlineName, context)),
    scarce: shown ? { engine: shown.engine, name: shown.name, remaining: shown.remaining, status: shown.status, window: shown.window ?? null, windowId: shown.windowId ?? null } : null,
    sentence: sentence(engines, context),
    menu: shown && shown.remaining !== null ? `${shown.name} ${Math.round(shown.remaining)}%` : null,
  };
}
