// The ledger joined across computers, with each limit window's percent used. Shared by the Week page
// (lib/view-week.mjs) and the flags (lib/ledger-flags.mjs), so neither imports the other.
import { limitShare } from './ledger-shape.mjs';
import strings from './strings.json' with { type: 'json' };

const WEEK_MINUTES = 10080;
export const SERIES = 7;

const UNKNOWN = strings.status.unknown;
const rows = value => Array.isArray(value) ? value.filter(row => row && typeof row === 'object' && !Array.isArray(row)) : [];
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const descending = (a, b) => a === b ? 0 : a === null ? 1 : b === null ? -1 : b - a;
// Null when there is nothing to add or any part is Unknown.
const total = values => values.length === 0 || values.some(value => value === null) ? null : values.reduce((sum, value) => sum + value, 0);

/** "Opus" for a Claude model family, otherwise the id without its date stamp. */
export function modelLabel(id) {
  if (typeof id !== 'string' || !id) return UNKNOWN;
  const family = id.match(/\b(opus|sonnet|haiku|fable)\b/i)?.[1];
  if (family) return family.charAt(0).toUpperCase() + family.slice(1).toLowerCase();
  return id.replace(/-\d{8}$/, '');
}

/**
 * Every limit window with its stored forecast. The hub forecasts each window once per reading (lib/forecast.mjs,
 * called from lib/combine.mjs) and stores it as glance.forecast.windows. A snapshot from before that has no stored
 * forecast: its windows keep their reading and read as Unknown, never forecast here.
 */
export function storedWindows(combined) {
  const stored = combined?.glance?.forecast?.windows;
  if (Array.isArray(stored)) return rows(stored);
  return rows(combined?.glance?.limits).filter(row => row.windowId && !row.absent && !row.gap && !row.off).map(row => ({
    engine: row.provider, name: row.name, window: row.window, windowId: row.windowId, durationMinutes: null,
    remaining: row.remaining !== null && !row.stale ? row.remaining : null, resetsAt: row.resetsAt ?? null, status: 'unknown',
    runoutAt: null, earliestAt: null, latestAt: null, previousUsed: null, claim: null, phrase: null, resets: null, beforeReset: null }));
}

/** What the Week page needs beyond the glance: each limit window's stored forecast and every computer's ledger. */
export function weekFeed(combined) {
  return { windows: storedWindows(combined), ledger: rows(combined?.view?.ledger) };
}

export const used = (window, period) => !window ? null : period === 'previous' ? number(window.previousUsed) : window.remaining === null ? null : 100 - window.remaining;
// The window a tool's week is measured against: the weekly one, or else the longest the engine reports.
export function weekWindow(windows, engine) {
  const own = windows.filter(window => window.engine === engine);
  return own.find(window => window.durationMinutes === WEEK_MINUTES) ?? [...own].sort((a, b) => descending(a.durationMinutes, b.durationMinutes))[0] ?? null;
}

const TASK_WORDS = { search: 'taskSearch', research: 'taskResearch', review: 'taskReview', design: 'taskDesign', build: 'taskBuild', test: 'taskTest', write: 'taskWrite' };
const fill = (text, values) => Object.entries(values).reduce((out, [key, value]) => out.replace(`{${key}}`, value), text);

/**
 * What a session is called: its title, else a short label from its title hash ("Session 3f2a") when
 * titles are off, else a label from how it ran, what it was asked and where ("Review run in cube-type"),
 * else `fallback`. Labels stay the same from one collection to the next.
 */
export function sessionLabel(session, fallback = strings.week.untitled) {
  const W = strings.week;
  if (typeof session?.title === 'string' && session.title.trim()) return session.title;
  if (typeof session?.titleHash === 'string' && /^[0-9a-f]{4,}$/.test(session.titleHash))
    return W.hashedTitle.replace('{hash}', session.titleHash.slice(0, 4));
  const headless = session?.origin === 'headless';
  const word = Object.hasOwn(TASK_WORDS, session?.task) ? W[TASK_WORDS[session.task]] : null;
  const repo = [...(Array.isArray(session?.shipped?.repos) ? session.shipped.repos : []), session?.repo].find(name => typeof name === 'string' && name.trim());
  if (word) return fill(W[`${headless ? 'taskRun' : 'taskSession'}${repo ? 'In' : ''}`], { task: word, repo });
  if (headless) return repo ? fill(W.headlessRunIn, { repo }) : W.headlessRun;
  if (repo) return fill(W.sessionIn, { repo });
  return fallback;
}

const sessionKey = (host, tool, id) => `${host}.${tool}.${id}`;

/**
 * The ledger joined across computers for one period. Tools that spend the same engine share its limit,
 * so a session's share is measured against everything spent on that engine.
 *
 * Unknown stays Unknown. One rule for totals, shares and paces:
 * - A tool's period total is known only when every computer could be read. A computer whose ledger is
 *   unavailable could have spent on any tool, so it makes every total Unknown. A readable computer whose tool is unavailable, or lacks the period, makes that
 *   tool's total Unknown. A computer that is not connected adds nothing. Shares and paces divide by
 *   these totals, so they are Unknown too, never computed from what is left.
 * - A share is "of the week" (a part of the weekly limit's percent used) only when the engine's window
 *   is the weekly one and every period on that engine came from a real limit reading (windowKnown).
 *   Otherwise a session's share is its part of what the engine spent in the period, shareKind 'spend',
 *   and anything priced against the limit (shareOf, the per-hour pace) is Unknown.
 */
export function joined(summary, period = 'current') {
  const feed = summary?.week ?? {};
  const windows = rows(feed.windows);
  const tools = new Map(), sessions = [], others = [], days = new Map();
  const ledger = rows(feed.ledger);
  const missing = ledger.some(row => row.status !== 'ok' && row.status !== 'not-connected');
  for (const row of ledger.filter(row => row.status === 'ok')) for (const tool of rows(row.tools)) {
    const id = String(tool.tool);
    const entry = tools.get(id) ?? { id, name: typeof tool.name === 'string' && tool.name ? tool.name : id, engine: tool.limitEngine ?? null, usd: [], count: [], previous: false, start: null, end: null, windowKnown: true };
    tools.set(id, entry);
    if (rows(tool.periods).some(part => part.key === 'previous')) entry.previous = true;
    const part = tool.status === 'unavailable' ? null : rows(tool.periods).find(part => part.key === period);
    if (!part) { entry.usd.push(null); entry.count.push(null); continue; }
    entry.usd.push(number(part.apiUsd));
    entry.count.push(number(part.sessionCount));
    if (part.windowKnown !== true) entry.windowKnown = false;
    entry.start ??= part.start ?? null;
    entry.end ??= part.end ?? null;
    for (const session of rows(part.sessions)) sessions.push({ ...session, host: row.host, tool: id, key: sessionKey(row.host, id, session.id) });
    if (part.other && typeof part.other === 'object') others.push({ ...part.other, tool: id });
    for (const day of rows(part.days)) {
      if (typeof day.date !== 'string') continue;
      const sum = days.get(day.date) ?? { date: day.date, usd: [], onMain: [] };
      sum.usd.push(number(day.apiUsd));
      sum.onMain.push(number(day.onMain));
      days.set(day.date, sum);
    }
  }
  const engines = new Map();
  for (const tool of tools.values()) {
    tool.usd = missing ? null : total(tool.usd);
    tool.count = missing ? null : total(tool.count);
    if (tool.engine === null) continue;
    const engine = engines.get(tool.engine) ?? { usd: [], window: weekWindow(windows, tool.engine), windowKnown: true };
    engine.usd.push(tool.usd);
    if (!tool.windowKnown) engine.windowKnown = false;
    engines.set(tool.engine, engine);
  }
  for (const engine of engines.values()) {
    engine.usd = total(engine.usd);
    engine.used = used(engine.window, period);
    engine.shareKind = engine.windowKnown && engine.window?.durationMinutes === WEEK_MINUTES ? 'week' : 'spend';
  }
  const engineOf = tool => engines.get(tools.get(tool)?.engine) ?? null;
  // A part of the weekly limit, or Unknown when the window is not a real weekly one.
  const shareOf = (tool, amount) => { const engine = engineOf(tool); return engine?.shareKind === 'week' ? limitShare(amount, engine.usd, engine.used) : null; };
  // A part of what the tool spent in the period.
  const spendShare = (tool, amount) => { const total = tools.get(tool)?.usd; return number(amount) !== null && number(total) ? 100 * amount / total : null; };
  // What a session's share is of: 'week' or 'spend'. A tool with no limit engine has no share to show.
  const shareKindOf = tool => engineOf(tool)?.shareKind ?? 'spend';
  const sessionShare = (tool, amount) => {
    const engine = engineOf(tool);
    if (!engine) return null;
    if (engine.shareKind === 'week') return shareOf(tool, amount);
    return number(amount) !== null && number(engine.usd) ? 100 * amount / engine.usd : null;
  };
  for (const session of sessions) { session.share = sessionShare(session.tool, number(session.apiUsd)); session.shareKind = shareKindOf(session.tool); }
  for (const other of others) { other.share = sessionShare(other.tool, number(other.apiUsd)); other.shareKind = shareKindOf(other.tool); }
  sessions.sort((a, b) => descending(a.share, b.share) || descending(number(a.apiUsd), number(b.apiUsd)) || (a.key < b.key ? -1 : 1));
  // One colour per model, the same everywhere on the page: the model that cost most first.
  const spend = new Map();
  for (const session of sessions) for (const model of rows(session.models)) {
    const label = modelLabel(model.model);
    spend.set(label, (spend.get(label) ?? 0) + (number(model.apiUsd) ?? 0)); // zero-ok: ranks colours, never shown
  }
  const order = [...spend].sort((a, b) => b[1] - a[1]).map(([label]) => label);
  const series = label => { const index = order.indexOf(label); return (index < 0 ? order.length : index) % SERIES; };
  return { windows, tools: [...tools.values()], engines, sessions, others, shareOf, spendShare, shareKindOf, series,
    days: [...days.values()].sort((a, b) => a.date < b.date ? -1 : 1).map(day => ({ date: day.date, usd: total(day.usd), onMain: total(day.onMain) })) };
}
