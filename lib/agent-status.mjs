// Read-only usage status for agents. Pure: combined.json in, a plain object out.
// Observatory only reports. It never starts, stops or routes an agent itself.
import {limitRemaining} from './glance-limits.mjs';
import {limitRows} from './view-limits.mjs';

export const SCHEMA = 1;
export const ENGINES = ['claude', 'codex', 'grokbot'];
export const WINDOWS = ['five_hour', 'weekly'];
export const TASKS = ['code', 'review', 'research'];
// A window is "spend" when at least this many points are projected to be left unused at reset.
export const SPEND_MARGIN = 20;

const durations = {300: 'five_hour', 10080: 'weekly'};
const labels = {'5-hour': 'five_hour', weekly: 'weekly'};
const severity = ['spend', 'hold', 'unknown', 'slow', 'out'];
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sourceFor = (view, engine) => engine === 'claude' ? view?.claudeLimits : engine === 'codex' ? view?.quota : null;

// Classify one window. Rules, in order:
// unknown: no current reading, or no measured burn rate.
// out: 0% left.
// slow: at the current burn the window reaches 0 before it resets.
// spend: at the current burn at least SPEND_MARGIN points are left unused at reset.
// hold: anything else.
export function classifyPace(percentLeft, burnPerHour, minutesToReset) {
  if (typeof percentLeft !== 'number') return 'unknown';
  if (percentLeft === 0) return 'out';
  if (typeof burnPerHour !== 'number' || burnPerHour < 0 || typeof minutesToReset !== 'number') return 'unknown';
  const leftAtReset = percentLeft - burnPerHour * minutesToReset / 60;
  if (leftAtReset <= 0) return 'slow';
  return leftAtReset >= SPEND_MARGIN ? 'spend' : 'hold';
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

function engineSummary(windows) {
  const values = WINDOWS.map(id => windows[id]);
  const known = values.filter(item => item.percentLeft !== null);
  if (known.some(item => item.percentLeft === 0)) return {status: 'out', headroom: 0, pace: 'out'};
  if (known.length < values.length) return {status: 'unknown', headroom: null, pace: 'unknown'};
  const pace = values.map(item => item.pace).reduce((worst, item) => severity.indexOf(item) > severity.indexOf(worst) ? item : worst, 'spend');
  return {status: 'ok', headroom: Math.min(...known.map(item => item.percentLeft)), pace};
}

// For each engine that is out, when its exhausted window resets (the later one if both are at 0).
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

function route(engines, back) {
  const ranked = ['claude', 'codex'].filter(id => engines[id].status === 'ok' && engines[id].headroom > 0)
    .sort((a, b) => engines[b].headroom - engines[a].headroom);
  const pick = ranked[0] ?? null;
  const others = ['claude', 'codex'].filter(id => id !== pick).map(id => {
    const item = engines[id];
    if (item.status === 'out') return back[id]?.minutesToReset != null ? `${id} is out for ${back[id].minutesToReset} min` : `${id} is out`;
    return item.status === 'unknown' ? `${id} is unknown` : `${id} has ${item.headroom}%`;
  });
  const reason = pick ? `${pick} has ${engines[pick].headroom}% effective headroom, ${others.join(', ')}.`
    : 'No engine has a current reading with allowance left.';
  return Object.fromEntries(TASKS.map(task => [task, {engine: pick, reason}]));
}

export function agentStatus(combined, now = Date.now()) {
  const engines = {};
  const view = plain(combined?.view) ? combined.view : null;
  const rates = view ? burnRates(view, now) : new Map();
  for (const engine of ['claude', 'codex']) {
    const windows = Object.fromEntries(WINDOWS.map(id => [id, emptyWindow()]));
    for (const row of Array.isArray(combined?.glance?.limits) ? combined.glance.limits : []) {
      if (!plain(row) || row.provider !== engine) continue;
      const id = windowId(row, view);
      if (!id) continue;
      const percentLeft = limitRemaining(row, now);
      const reset = typeof row.resetsAt === 'string' ? Date.parse(row.resetsAt) : NaN;
      const current = percentLeft !== null && reset > now;
      const minutesToReset = current ? Math.ceil((reset - now) / 60000) : null;
      const burnPerHour = percentLeft !== null ? rates.get(`${engine}/${row.windowId}`) ?? null : null;
      windows[id] = {percentLeft, resetsAt: current ? new Date(reset).toISOString() : null, minutesToReset, burnPerHour,
        pace: classifyPace(percentLeft, burnPerHour, minutesToReset)};
    }
    engines[engine] = {...engineSummary(windows), windows};
  }
  engines.grokbot = {status: 'unknown', headroom: null, pace: 'unknown', windows: null};
  const current = ['claude', 'codex'].some(engine => WINDOWS.some(id => engines[engine].windows[id].percentLeft !== null));
  const back = nextReturn(engines);
  return {schema: SCHEMA, generatedAt: new Date(now).toISOString(), current, engines, nextReturn: back, route: route(engines, back)};
}
