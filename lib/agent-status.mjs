// Observatory only reports. It never starts, stops or routes an agent itself.
import {limitRemaining} from './glance-limits.mjs';
import {shown, shownSentence} from './forecast.mjs';

export const SCHEMA = 1;
export const ENGINES = ['claude', 'codex'];
export const WINDOWS = ['five_hour', 'weekly'];
export const TASKS = ['code', 'review', 'research'];
export const SPEND_MARGIN = 20;
// Most jobs each engine may run at once when its pace reads `spend`. Claude counts sessions
// and subagents; Codex counts codex-job runs. The job cap shrinks from here as pace drops.
export const MAX_SLOTS = {claude: 10, codex: 5};

const lengths = {five_hour: 300, weekly: 10080};

const durations = {300: 'five_hour', 10080: 'weekly'};
const labels = {'5-hour': 'five_hour', weekly: 'weekly'};
// Claude Code window ids, for a reading that lost its window length.
const ids = {five_hour: 'five_hour', seven_day: 'weekly'};
const severity = ['spend', 'hold', 'unknown', 'slow', 'out'];
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sourceFor = (view, engine) => engine === 'claude' ? view?.claudeLimits : engine === 'codex' ? view?.quota : null;

export function classifyPace(percentLeft, burnPerHour, minutesToReset) {
  if (typeof percentLeft !== 'number') return 'unknown';
  if (percentLeft === 0) return 'out';
  if (typeof burnPerHour !== 'number' || burnPerHour < 0 || typeof minutesToReset !== 'number') return 'unknown';
  const leftAtReset = percentLeft - burnPerHour * minutesToReset / 60;
  if (leftAtReset <= 0) return 'slow';
  return leftAtReset >= SPEND_MARGIN ? 'spend' : 'hold';
}

// Straight-line pacing: a window with at least as much left as time left is under budget, so
// it may spend, but never with less than SPEND_MARGIN percent left. The burn rate covers up to
// the last hour, a fair projection for the 5-hour window, so a 5-hour window it says empties
// before reset stays `slow`. On the weekly window that hour is a burst, so the straight line
// wins. With no burn reading yet, the window holds rather than going unknown.
//
// `stored` is the window's forecast from glance.forecast.windows. When it says the window runs out before the reset,
// the pace is `slow`, and when it gives the share left at the reset, that decides spend or hold. So the status never
// says spend while every page says the limit runs out.
export function windowPace(percentLeft, burnPerHour, minutesToReset, windowMinutes, stored = null) {
  if (typeof percentLeft === 'number' && percentLeft > 0 && stored?.status === 'runs-out') return 'slow';
  if (typeof percentLeft === 'number' && percentLeft > 0 && stored?.status === 'room' && typeof stored.leftAtReset === 'number')
    return stored.leftAtReset >= SPEND_MARGIN ? 'spend' : 'hold';
  const pace = classifyPace(percentLeft, burnPerHour, minutesToReset);
  if (pace === 'out' || typeof percentLeft !== 'number' || typeof minutesToReset !== 'number' || !(windowMinutes > 0)) return pace;
  if (pace === 'slow' && windowMinutes <= lengths.five_hour) return pace;
  if (percentLeft >= SPEND_MARGIN && percentLeft >= 100 * minutesToReset / windowMinutes) return 'spend';
  return pace === 'unknown' ? 'hold' : pace;
}

// Percent left scaled by time left: 100 means on or under the straight-line budget.
export function effectiveHeadroom(percentLeft, minutesToReset, windowMinutes) {
  if (typeof percentLeft !== 'number') return null;
  if (percentLeft === 0) return 0;
  if (typeof minutesToReset !== 'number' || minutesToReset <= 0 || !(windowMinutes > 0)) return percentLeft;
  // Never round a positive allowance down to 0, which reads as out.
  return Math.max(1, Math.min(100, Math.round(percentLeft * windowMinutes / minutesToReset)));
}

function windowId(row, view) {
  const source = sourceFor(view, row.provider);
  const match = (Array.isArray(source?.windows) ? source.windows : [])
    .find(item => plain(item) && item.bucket === row.bucket && item.window === row.windowId);
  return durations[match?.durationMinutes] ?? labels[row.window] ?? ids[row.windowId] ?? null;
}

// The stored forecast for each window, as the hub wrote it. A snapshot from before it was stored has none.
function storedWindows(combined) {
  const list = Array.isArray(combined?.glance?.forecast?.windows) ? combined.glance.forecast.windows : [];
  return new Map(list.filter(plain).map(window => [`${window.engine}/${window.windowId}`, window]));
}

// The words as every other surface shows them now (lib/forecast.mjs shown()): dated once old, Unknown past the reset.
function said(record, outlook, now) {
  const words = shown(outlook, record, now);
  return {status: record?.status ?? 'unknown', phrase: words.phrase, sentence: words.sentence,
    runsOutAt: record?.runoutAt ?? null, earliestAt: record?.earliestAt ?? null, latestAt: record?.latestAt ?? null,
    leftAtReset: record?.leftAtReset ?? null, resetsLabel: words.resets, stale: words.stale, asOfLabel: words.asOf, headline: words.headline};
}

function emptyWindow(outlook, now) {
  return {percentLeft: null, resetsAt: null, minutesToReset: null, burnPerHour: null, pace: 'unknown', forecast: said(null, outlook, now)};
}

// A window the reading marks absent (Claude Ultra has no 5-hour window, and a plan could report
// only its 5-hour window) is left out, and the engine is judged on the rest. Any other window
// with no current number, or no window with a number at all, makes the engine unknown.
function engineSummary(windows, absent) {
  const values = WINDOWS.map(id => windows[id]);
  const known = values.filter(item => item.percentLeft !== null);
  if (known.some(item => item.percentLeft === 0)) return {status: 'out', headroom: 0, effectiveHeadroom: 0, pace: 'out'};
  if (!known.length || WINDOWS.some(id => !absent.has(id) && windows[id].percentLeft === null)) return {status: 'unknown', headroom: null, effectiveHeadroom: null, pace: 'unknown'};
  const pace = known.map(item => item.pace).reduce((worst, item) => severity.indexOf(item) > severity.indexOf(worst) ? item : worst, 'spend');
  const effective = Math.min(...WINDOWS.filter(id => windows[id].percentLeft !== null)
    .map(id => effectiveHeadroom(windows[id].percentLeft, windows[id].minutesToReset, lengths[id])));
  return {status: 'ok', headroom: Math.min(...known.map(item => item.percentLeft)), effectiveHeadroom: effective, pace};
}

export function nextReturn(engines) {
  const result = {};
  for (const id of ['claude', 'codex']) {
    if (engines[id].status !== 'out') continue;
    const zero = WINDOWS.map(windowId => engines[id].windows[windowId]).filter(row => row.percentLeft === 0);
    const known = zero.every(row => row.resetsAt !== null);
    const last = known ? zero.reduce((a, b) => Date.parse(b.resetsAt) > Date.parse(a.resetsAt) ? b : a) : null;
    result[id] = {resetsAt: last?.resetsAt ?? null, minutesToReset: last?.minutesToReset ?? null};
  }
  return result;
}

function slots(engine, id) {
  const max = MAX_SLOTS[id];
  if (engine.sourceOff) return 0;
  if (engine.status === 'out') return 0;
  if (engine.status !== 'ok') return 1;
  if (engine.pace === 'spend') return max;
  if (engine.pace === 'hold') return Math.max(1, Math.ceil(max * engine.effectiveHeadroom / 100));
  return 1;
}

// How many jobs may run at once, from each engine's pace and headroom. codexByAge is how many
// of the running Codex jobs were counted from marker age alone, with no live PID check.
export function jobCap(engines, codexRunning = null, codexByAge = 0) {
  const claude = slots(engines.claude, 'claude'), codex = slots(engines.codex, 'codex');
  const why = id => `${id} ${engines[id].status === 'ok' ? `pace ${engines[id].pace}, ${engines[id].effectiveHeadroom}% effective` : engines[id].status}`;
  const age = codexByAge > 0 && !engines.codex.sourceOff ? ` ${codexByAge} Codex job${codexByAge === 1 ? '' : 's'} counted by marker age only.` : '';
  // An engine whose source is off is not named: it has no slots and no reading to explain.
  const gives = ['claude', 'codex'].filter(id => !engines[id].sourceOff).map(id => `${why(id)} gives ${id === 'claude' ? claude : codex}`);
  return {total: claude + codex, claude, codex, codexRunning, reason: `${gives.join('; ')}.${age}`};
}

function describeOther(engines, back, id) {
  const item = engines[id];
  if (item.sourceOff) return null;
  if (item.status === 'out') return back[id]?.minutesToReset != null ? `${id} is out for ${back[id].minutesToReset} min` : `${id} is out`;
  return item.status === 'unknown' ? `${id} is unknown` : `${id} has ${item.effectiveHeadroom}%`;
}

// Code goes to Codex first unless it is low (under SPEND_MARGIN effective headroom, or pace
// `slow`) or every Codex slot is busy; with Claude out, it
// still goes to Codex, where it waits for a slot rather than being dropped. Review and research
// go to Claude whenever it has at least as much effective headroom as Codex.
function route(engines, back, cap) {
  const usable = id => engines[id].status === 'ok' && engines[id].effectiveHeadroom > 0;
  const has = id => engines[id].effectiveHeadroom;
  const busy = cap.codexRunning !== null && cap.codexRunning >= cap.codex;
  const reasonFor = (pick, why) => {
    if (!pick) return 'No engine has a current reading with allowance left.';
    const other = pick === 'claude' ? 'codex' : 'claude';
    const rest = describeOther(engines, back, other);
    return `${pick} has ${has(pick)}% effective headroom${why ? ` (${why})` : ''}${rest ? `, ${rest}` : ''}.`;
  };
  let code = null, codeWhy = '';
  const low = has('codex') < SPEND_MARGIN || ['slow', 'out'].includes(engines.codex.pace);
  if (usable('codex') && !low && !busy) code = 'codex';
  else if (usable('claude')) { code = 'claude'; if (usable('codex')) codeWhy = busy ? `all ${cap.codex} Codex slots busy` : 'codex is low'; }
  else if (usable('codex')) code = 'codex';
  let other = null;
  if (usable('claude') && (!usable('codex') || has('claude') >= has('codex'))) other = 'claude';
  else if (usable('codex')) other = 'codex';
  else if (usable('claude')) other = 'claude';
  const hint = {engine: other, reason: reasonFor(other, '')};
  return {code: {engine: code, reason: reasonFor(code, codeWhy)}, review: hint, research: {...hint}};
}

export function agentStatus(combined, now = Date.now(), {codexRunning = null, codexByAge = 0} = {}) {
  const engines = {};
  const view = plain(combined?.view) ? combined.view : null;
  const stored = storedWindows(combined);
  const outlook = plain(combined?.glance?.forecast) ? combined.glance.forecast : null;
  for (const engine of ['claude', 'codex']) {
    const windows = Object.fromEntries(WINDOWS.map(id => [id, emptyWindow(outlook, now)]));
    const absent = new Set();
    for (const row of Array.isArray(combined?.glance?.limits) ? combined.glance.limits : []) {
      if (!plain(row) || row.provider !== engine) continue;
      const id = windowId(row, view);
      if (!id) continue;
      // Only the reading's own marker says the plan has no such window; a gap or a passed reset is unknown.
      if (row.absent) { absent.add(id); continue; }
      const percentLeft = limitRemaining(row, now);
      const reset = typeof row.resetsAt === 'string' ? Date.parse(row.resetsAt) : NaN;
      const current = percentLeft !== null && reset > now;
      const minutesToReset = current ? Math.ceil((reset - now) / 60000) : null;
      const forecast = stored.get(`${engine}/${row.windowId}`) ?? null;
      const rate = forecast?.ratePerHour;
      const burnPerHour = percentLeft !== null && typeof rate === 'number' && Number.isFinite(rate) && rate >= 0 ? Math.round(rate * 10) / 10 : null;
      windows[id] = {percentLeft, resetsAt: current ? new Date(reset).toISOString() : null, minutesToReset, burnPerHour,
        pace: windowPace(percentLeft, burnPerHour, minutesToReset, lengths[id], percentLeft === null ? null : forecast), forecast: said(forecast, outlook, now)};
    }
    for (const id of WINDOWS) if (windows[id].percentLeft !== null) absent.delete(id);
    const own = (Array.isArray(outlook?.engines) ? outlook.engines : []).find(item => plain(item) && item.engine === engine);
    // An engine whose limits source the settings turn off is not read: its numbers stay Unknown and describe() leaves it out.
    const sourceOff = Array.isArray(view?.sourcesOff) && view.sourcesOff.includes(engine);
    engines[engine] = {...engineSummary(windows, absent), windows,
      forecast: {...said(own, outlook, now), window: own?.window ?? null}, ...(sourceOff ? {sourceOff: true} : {})};
  }
  const current = ['claude', 'codex'].some(engine => WINDOWS.some(id => engines[engine].windows[id].percentLeft !== null));
  const back = nextReturn(engines);
  const cap = jobCap(engines, codexRunning, codexByAge);
  // The stored sentence and each computer's stored state, worded in the user's time zone, for apps that show them as they are.
  const forecast = {asOf: outlook?.asOf ?? null, timeZone: outlook?.timeZone ?? null, sentence: shownSentence(outlook, now),
    stale: outlook?.asOf ? shownSentence(outlook, now) !== outlook.sentence : false};
  // By host only: the status holds no device names.
  const devices = (Array.isArray(combined?.devices) ? combined.devices : []).filter(plain).map(device => ({host: device.host ?? null,
    state: device.state ?? 'unknown', stateLabel: device.stateLabel ?? 'Unknown', collectedAt: device.collectedAt ?? null}));
  return {schema: SCHEMA, generatedAt: new Date(now).toISOString(), current, engines, nextReturn: back, route: route(engines, back, cap), cap, forecast, devices};
}
