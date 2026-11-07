// Observatory only reports. It never starts, stops or routes an agent itself.
import {limitRemaining} from './glance-limits.mjs';
import {limitRows} from './view-limits.mjs';

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
// spend it, whatever a short burst of burn says. Over budget, the burn projection decides, and
// with no burn reading yet the window holds rather than going unknown.
export function windowPace(percentLeft, burnPerHour, minutesToReset, windowMinutes) {
  const pace = classifyPace(percentLeft, burnPerHour, minutesToReset);
  if (pace === 'out' || typeof percentLeft !== 'number' || typeof minutesToReset !== 'number' || !(windowMinutes > 0)) return pace;
  if (percentLeft >= 100 * minutesToReset / windowMinutes) return 'spend';
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
  return durations[match?.durationMinutes] ?? labels[row.window] ?? null;
}

function burnRates(view, now) {
  const rates = new Map();
  let rows = [];
  try { rows = limitRows(view, now); } catch { rows = []; }
  for (const row of rows) {
    const rate = row.pace?.ratePerHour;
    if (typeof rate === 'number' && Number.isFinite(rate) && rate >= 0)
      rates.set(`${row.provider}/${row.windowId}`, Math.round(rate * 10) / 10);
  }
  return rates;
}

function emptyWindow() {
  return {percentLeft: null, resetsAt: null, minutesToReset: null, burnPerHour: null, pace: 'unknown'};
}

// A plan with no 5-hour window (Claude Ultra) is judged on its weekly window alone. A window
// that was reported but has no current reading, or a missing weekly reading, means unknown.
function engineSummary(windows, reported) {
  const values = WINDOWS.map(id => windows[id]);
  const known = values.filter(item => item.percentLeft !== null);
  if (known.some(item => item.percentLeft === 0)) return {status: 'out', headroom: 0, effectiveHeadroom: 0, pace: 'out'};
  if (windows.weekly.percentLeft === null || WINDOWS.some(id => reported.has(id) && windows[id].percentLeft === null)) return {status: 'unknown', headroom: null, effectiveHeadroom: null, pace: 'unknown'};
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
  if (engine.status === 'out') return 0;
  if (engine.status !== 'ok') return 1;
  if (engine.pace === 'spend') return max;
  if (engine.pace === 'hold') return Math.max(1, Math.ceil(max * engine.effectiveHeadroom / 100));
  return 1;
}

// How many jobs may run at once, from each engine's pace and headroom.
export function jobCap(engines, codexRunning = null) {
  const claude = slots(engines.claude, 'claude'), codex = slots(engines.codex, 'codex');
  const why = id => `${id} ${engines[id].status === 'ok' ? `pace ${engines[id].pace}, ${engines[id].effectiveHeadroom}% effective` : engines[id].status}`;
  return {total: claude + codex, claude, codex, codexRunning,
    reason: `${why('claude')} gives ${claude}; ${why('codex')} gives ${codex}.`};
}

function describeOther(engines, back, id) {
  const item = engines[id];
  if (item.status === 'out') return back[id]?.minutesToReset != null ? `${id} is out for ${back[id].minutesToReset} min` : `${id} is out`;
  return item.status === 'unknown' ? `${id} is unknown` : `${id} has ${item.effectiveHeadroom}%`;
}

// Code goes to Codex first unless it is low or every Codex slot is busy; with Claude out, it
// still goes to Codex, where it waits for a slot rather than being dropped. Review and research
// go to Claude whenever it has at least as much effective headroom as Codex.
function route(engines, back, cap) {
  const usable = id => engines[id].status === 'ok' && engines[id].effectiveHeadroom > 0;
  const has = id => engines[id].effectiveHeadroom;
  const busy = cap.codexRunning !== null && cap.codexRunning >= cap.codex;
  const reasonFor = (pick, why) => {
    if (!pick) return 'No engine has a current reading with allowance left.';
    const other = pick === 'claude' ? 'codex' : 'claude';
    return `${pick} has ${has(pick)}% effective headroom${why ? ` (${why})` : ''}, ${describeOther(engines, back, other)}.`;
  };
  let code = null, codeWhy = '';
  if (usable('codex') && has('codex') >= SPEND_MARGIN && !busy) code = 'codex';
  else if (usable('claude')) { code = 'claude'; if (usable('codex')) codeWhy = busy ? `all ${cap.codex} Codex slots busy` : 'codex is low'; }
  else if (usable('codex')) code = 'codex';
  let other = null;
  if (usable('claude') && (!usable('codex') || has('claude') >= has('codex'))) other = 'claude';
  else if (usable('codex')) other = 'codex';
  else if (usable('claude')) other = 'claude';
  const hint = {engine: other, reason: reasonFor(other, '')};
  return {code: {engine: code, reason: reasonFor(code, codeWhy)}, review: hint, research: {...hint}};
}

export function agentStatus(combined, now = Date.now(), {codexRunning = null} = {}) {
  const engines = {};
  const view = plain(combined?.view) ? combined.view : null;
  const rates = view ? burnRates(view, now) : new Map();
  for (const engine of ['claude', 'codex']) {
    const windows = Object.fromEntries(WINDOWS.map(id => [id, emptyWindow()]));
    const reported = new Set();
    for (const row of Array.isArray(combined?.glance?.limits) ? combined.glance.limits : []) {
      if (!plain(row) || row.provider !== engine) continue;
      const id = windowId(row, view);
      if (!id) continue;
      reported.add(id);
      const percentLeft = limitRemaining(row, now);
      const reset = typeof row.resetsAt === 'string' ? Date.parse(row.resetsAt) : NaN;
      const current = percentLeft !== null && reset > now;
      const minutesToReset = current ? Math.ceil((reset - now) / 60000) : null;
      const burnPerHour = percentLeft !== null ? rates.get(`${engine}/${row.windowId}`) ?? null : null;
      windows[id] = {percentLeft, resetsAt: current ? new Date(reset).toISOString() : null, minutesToReset, burnPerHour,
        pace: windowPace(percentLeft, burnPerHour, minutesToReset, lengths[id])};
    }
    engines[engine] = {...engineSummary(windows, reported), windows};
  }
  const current = ['claude', 'codex'].some(engine => WINDOWS.some(id => engines[engine].windows[id].percentLeft !== null));
  const back = nextReturn(engines);
  const cap = jobCap(engines, codexRunning);
  return {schema: SCHEMA, generatedAt: new Date(now).toISOString(), current, engines, nextReturn: back, route: route(engines, back, cap), cap};
}
