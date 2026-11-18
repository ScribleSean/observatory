// A fictional combined.json for round 2: three computers with daily ledger history, a settings echo
// and Grok request counts. Every name is made up. The same `now` always gives the same data.
// Lane b tests its view-models against it. Lane e takes screenshots from it.
//
// What it is built to exercise:
// - Mac history starts 120 days back, Windows 60, Linux 25 (a computer whose history starts inside the period).
// - One Windows day is unavailable (Unknown, not 0). Windows is stale (last snapshot 3 hours old).
// - Linux runs headless sessions with no title. Mac has titled sessions with and without a Role: prefix.
// - Codex runs on Windows only. Grok is on on the Mac only. Commits on main lag behind commits.
// - Screen time is on for the Mac and Windows, off on Linux, and one Mac day was not tracked.
// - Claude Code and Codex limits with readings, so past windows and the forecast have history.
// - A live ledger with one Mac session working and one Linux session waiting on a reply.
import { LEDGER_HISTORY_SCHEMA, SESSION_DAY_TOP } from './r2-shape.mjs';
import { sampleDriftRow } from './sample-drift.mjs';
import { limits, limitsWithGaps } from './panel-data.mjs';
import { forecast } from './forecast.mjs';
import { deviceState } from './combine.mjs';

const DAY = 86400000, HOUR = 3600000;
export const SAMPLE_R2_TIME_ZONE = 'America/New_York';
const REPOS = ['lantern', 'orchard', 'tidepool', 'quarry', 'kestrel'];
// Shapes a real week has: a Role: prefix, a bare role, a role with a date, a plain title, a long one and none.
const TITLES = ['Builder: Lantern', 'Reviewer: Orchard', 'Chief of staff', 'Lead planning', 'Tidepool notes', null,
  'Chief of staff (Nov 18)', 'Kestrel voice decoder', 'Rebuild the quarry importer into something that survives a bad file'];
// Most titles name one piece of work, so a title like "Builder: Lantern" carries a detail that varies by session.
const DETAILED = new Set(['Builder: Lantern', 'Reviewer: Orchard', 'Lead planning', 'Tidepool notes', 'Kestrel voice decoder']);
const DETAILS = ['sync', 'export', 'search', 'onboarding', 'settings', 'charts', 'release', 'importer', 'themes', 'cache', 'crash fix', 'docs'];
// A scheduled queue runner that recurs under one agent name. Its role comes from the Mac's settings map.
const QUEUE = 'LanternBot: job queue';
// The detail and the queue runs come from the session id, so the seeded numbers stay the same. Three in four of the dated
// chief of staff titles are queue runs.
const titleFor = (title, id) => DETAILED.has(title) ? `${title} ${DETAILS[parseInt(id.slice(0, 4), 16) % DETAILS.length]}`
  : title === 'Chief of staff (Nov 18)' && parseInt(id.slice(4, 5), 16) % 4 !== 0 ? QUEUE : title;
const KINDS = ['build', 'review', 'research', 'design', 'test', 'search'];
const MODELS = { claude: ['claude-opus-5-5', 'claude-sonnet-4-20250514', 'claude-haiku-4-5'], codex: ['gpt-6-astra'] };
const HOSTS = [
  { host: 'Mac', name: 'Studio', days: 120, tools: ['claude'], titled: true, origin: 'interactive', lagHours: 0.1 },
  { host: 'Windows', name: 'Tower', days: 60, tools: ['claude', 'codex'], titled: true, origin: 'interactive', lagHours: 3, unavailable: 9 },
  { host: 'Linux', name: 'Lab', days: 25, tools: ['claude'], titled: false, origin: 'headless', lagHours: 0.2 },
];

// A small seeded generator, so the fixture is the same on every run.
function random(seed) {
  let state = seed >>> 0;
  return () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (next, list) => list[Math.floor(next() * list.length)];
const money = value => Math.round(value * 100) / 100;
const dateIn = (ms, timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const hex = (next, length) => Array.from({ length }, () => Math.floor(next() * 16).toString(16)).join('');
const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);

function sessionDay(next, spec, tool, dayStart, sessionId) {
  const models = MODELS[tool], kind = pick(next, KINDS), repo = pick(next, REPOS);
  const usd = money(1 + next() * (tool === 'codex' ? 6 : 24));
  const split = [0.6, 0.3, 0.1].slice(0, models.length);
  const commits = next() < 0.3 ? 0 : Math.floor(next() * 9);
  const onMain = Math.min(commits, Math.floor(commits * (0.2 + next() * 0.6)));
  const merges = commits && next() < 0.4 ? 1 : 0;
  const output = Math.round(usd * 9000);
  const firstAt = dayStart + (8 + Math.floor(next() * 10)) * HOUR;
  return {
    id: sessionId, title: spec.titled ? titleFor(pick(next, TITLES), sessionId) : null, origin: spec.origin,
    task: spec.origin === 'headless' ? pick(next, ['review', 'test', 'build']) : next() < 0.5 ? kind : null, repo,
    firstAt: new Date(firstAt).toISOString(), lastAt: new Date(firstAt + Math.floor(next() * 4 * HOUR)).toISOString(), apiUsd: usd,
    tokens: { input: Math.round(output * 0.3), output, cacheRead: output * 40, cacheWrite: output * 2 },
    models: models.map((model, index) => ({ model, apiUsd: money(usd * split[index]), outputTokens: Math.round(output * split[index]) })).filter(row => row.apiUsd > 0),
    kinds: [{ kind: 'main', apiUsd: money(usd * 0.55), subagents: 0 }, { kind, apiUsd: money(usd * 0.45), subagents: 1 + Math.floor(next() * 5) }],
    ship: commits || merges ? [{ repo, apiUsd: usd, commits, onMain, merges }] : [],
  };
}

function dayRecord(next, spec, tool, date, dayStart, unavailable, frozen) {
  if (unavailable) return { date, tool, status: 'unavailable', frozen, apiUsd: null, sessionCount: null, subagents: null,
    tokens: { input: null, output: null, cacheRead: null, cacheWrite: null }, models: [], kinds: [], origins: [], repos: [],
    ship: { commits: null, onMain: null, merges: null }, sessions: [], other: null };
  const count = tool === 'codex' ? 1 + Math.floor(next() * 2) : 3 + Math.floor(next() * 6);
  const sessions = Array.from({ length: count }, () => sessionDay(next, spec, tool, dayStart, hex(next, 12))).sort((a, b) => b.apiUsd - a.apiUsd);
  const listed = sessions.slice(0, SESSION_DAY_TOP);
  const ships = sessions.flatMap(session => session.ship);
  const group = (rows, key, value) => [...rows.reduce((map, row) => map.set(row[key], (map.get(row[key]) ?? 0) + value(row)), new Map())];
  return {
    date, tool, status: 'ok', frozen, apiUsd: money(sum(sessions, 'apiUsd')), sessionCount: sessions.length,
    subagents: sessions.reduce((total, session) => total + sum(session.kinds, 'subagents'), 0),
    tokens: Object.fromEntries(['input', 'output', 'cacheRead', 'cacheWrite'].map(key => [key, sessions.reduce((total, session) => total + session.tokens[key], 0)])),
    models: group(sessions.flatMap(session => session.models), 'model', row => row.apiUsd).map(([model, apiUsd]) => ({ model, apiUsd: money(apiUsd),
      outputTokens: sessions.flatMap(session => session.models).filter(row => row.model === model).reduce((total, row) => total + row.outputTokens, 0) })).sort((a, b) => b.apiUsd - a.apiUsd),
    kinds: group(sessions.flatMap(session => session.kinds), 'kind', row => row.apiUsd).map(([kind, apiUsd]) => ({ kind, apiUsd: money(apiUsd),
      subagents: sessions.flatMap(session => session.kinds).filter(row => row.kind === kind).reduce((total, row) => total + row.subagents, 0) })).sort((a, b) => b.apiUsd - a.apiUsd),
    origins: [{ origin: spec.origin, apiUsd: money(sum(sessions, 'apiUsd')), sessions: sessions.length }],
    repos: group(ships, 'repo', row => row.apiUsd).map(([repo, apiUsd]) => {
      const rows = ships.filter(row => row.repo === repo);
      return { repo, apiUsd: money(apiUsd), commits: sum(rows, 'commits'), onMain: sum(rows, 'onMain'), merges: sum(rows, 'merges') };
    }).sort((a, b) => b.apiUsd - a.apiUsd),
    ship: { commits: sum(ships, 'commits'), onMain: sum(ships, 'onMain'), merges: sum(ships, 'merges') },
    sessions: listed, other: null,
  };
}

/**
 * A fictional ledgerHistory row for one computer, for tests that need daily history: `days` days up to `now`, read
 * just now, with the tools given (Codex on every third day).
 */
export function sampleLedgerHistory(host, now, { tools = ['claude'], days = 21, timeZone = SAMPLE_R2_TIME_ZONE } = {}) {
  const spec = HOSTS.find(row => row.host === host) ?? HOSTS[0];
  return historyFor({ ...spec, host, tools, days, lagHours: 0, unavailable: undefined }, now, timeZone);
}

/** One computer's ledgerHistory row, as lib/r2-shape.mjs describes it. */
function historyFor(spec, now, timeZone) {
  const next = random(spec.host.length * 7919 + spec.days);
  const checkedAt = now - spec.lagHours * HOUR;
  const days = [];
  for (let back = spec.days - 1; back >= 0; back--) {
    const dayStart = checkedAt - back * DAY, date = dateIn(dayStart, timeZone);
    for (const tool of spec.tools) {
      if (tool === 'codex' && back % 3) continue;
      days.push(dayRecord(next, spec, tool, date, dayStart - 12 * HOUR, back === spec.unavailable && tool === 'claude', back >= 14));
    }
  }
  return { host: spec.host, status: 'ok', checkedAt: new Date(checkedAt).toISOString(), schema: LEDGER_HISTORY_SCHEMA, timeZone,
    firstDate: days[0]?.date ?? null, sessionsFrom: days[0]?.date ?? null, days };
}

function configFor(spec, hub) {
  const codex = spec.tools.includes('codex');
  return { host: spec.host, name: spec.name, role: spec.host === hub ? 'hub' : 'spoke',
    sources: { screenTime: spec.host !== 'Linux', codex, codexLimits: codex, claudeCode: true, claudeLimits: true, grokLimits: spec.host === 'Mac', sessions: true, wsl: false },
    engines: { claude: 'auto', codex: codex ? 'auto' : 'off', grok: 'auto' }, titles: spec.titled,
    roleAliases: spec.host === 'Mac' ? { 'tidepool notes': 'Researcher', lanternbot: 'Runner' } : {}, checkedAt: null };
}

const CATEGORIES = { 'AI apps': ['Claude', 'Terminal'], Browser: ['Safari'], Communication: ['Mail'], Other: ['Finder'] };
const SCREEN_HOURS = [0, 0, 0, 0, 0, 0, 1, 3, 6, 9, 10, 9, 6, 8, 10, 10, 9, 7, 5, 4, 3, 2, 1, 0];

// Screen time per day for one computer: hours, categories and apps that add up to the day.
function activityFor(spec, history, now, timeZone) {
  const next = random(spec.days * 31 + 5);
  const dates = [...new Set(history.days.map(day => day.date))];
  const today = dateIn(now, timeZone);
  const days = dates.map((date, index) => {
    // One Mac day had tracking off: it holds zero seconds tracked, which reads Unknown.
    if (spec.host === 'Mac' && dates.length - 1 - index === 4) return { date, seconds: 0, trackedSeconds: 0, hours: Array(24).fill(0), categories: {}, apps: {} };
    const full = Math.round((3 + next() * 6) * 3600);
    const share = date === today ? 0.4 : 1;
    const hours = SCREEN_HOURS.map(weight => Math.round(full * share * weight / 103));
    const seconds = hours.reduce((total, value) => total + value, 0);
    const split = [0.45, 0.3, 0.1];
    const parts = Object.keys(CATEGORIES).map((name, at) => [name, at < 3 ? Math.round(seconds * split[at]) : 0]);
    parts[3][1] = seconds - parts.slice(0, 3).reduce((total, [, value]) => total + value, 0);
    const categories = Object.fromEntries(parts);
    const apps = Object.fromEntries(parts.map(([name, value]) => {
      const list = CATEGORIES[name];
      const first = list.length > 1 ? Math.round(value * 0.7) : value;
      return [name, Object.fromEntries(list.map((app, at) => [app, at === 0 ? first : value - first]))];
    }));
    return { date, seconds, trackedSeconds: seconds, hours, categories, apps };
  });
  return { host: spec.host, status: 'ok', checkedAt: history.checkedAt, asOf: history.checkedAt, latestReadStatus: 'ok', trackingStatus: 'recent', trackingThrough: history.checkedAt, days };
}

// Limit readings every 6 hours for four weekly windows and the 5 hour windows of the last day, so past
// windows, the forecast and "ran out early" all have history. The second past week ran out.
function limitHistoryFor(now) {
  const points = [];
  const weekReset = Math.floor((now + 2 * DAY) / HOUR) * HOUR;
  for (let week = 3; week >= 0; week--) {
    const reset = weekReset - week * 7 * DAY, start = reset - 7 * DAY;
    const finalUsed = week === 2 ? 100 : 70 + week * 6;
    for (let at = start + 6 * HOUR; at <= Math.min(reset - HOUR, now); at += 6 * HOUR) {
      const used = Math.min(finalUsed, (at - start) / (7 * DAY) * finalUsed * (week === 2 ? 1.4 : 1));
      points.push({ t: new Date(at).toISOString(), p: 'claude', w: 'seven_day', d: 10080, r: Math.round((100 - used) * 10) / 10, x: new Date(reset).toISOString() });
    }
  }
  for (let at = now - 20 * HOUR; at <= now; at += HOUR) {
    const reset = Math.ceil(at / (5 * HOUR)) * 5 * HOUR;
    points.push({ t: new Date(at).toISOString(), p: 'claude', w: 'five_hour', d: 300, r: Math.round(100 - ((at - (reset - 5 * HOUR)) / (5 * HOUR)) * 60), x: new Date(reset).toISOString() });
  }
  return [{ host: 'Mac', status: 'ok', checkedAt: new Date(now).toISOString(), points: points.filter(point => Date.parse(point.t) <= now) }];
}

// The live ledger, only for what the round 2 views read from it: which sessions run now.
function liveLedger(history, host, state) {
  const today = history.days.at(-1);
  const session = today?.sessions?.[0];
  return { host, status: 'ok', collectedAt: history.checkedAt, tools: [{ tool: 'claude', name: 'Claude Code', limitEngine: 'claude',
    periods: [{ key: 'current', start: history.checkedAt, end: history.checkedAt, windowKnown: false, apiUsd: null, sessionCount: null, other: null, days: [],
      sessions: session ? [{ id: session.id, title: session.title, origin: session.origin, task: session.task, repo: session.repo,
        startedAt: session.firstAt, lastActiveAt: history.checkedAt, running: true, state, ratePerHour: 4.2, tokens: session.tokens, apiUsd: session.apiUsd,
        models: session.models, subagents: 3, kinds: [], fanout: [], shipped: { estimated: true, commits: null, onMain: null, merges: null, prsOpen: null, repos: [] },
        signals: { longestRetry: null, retryTool: null, autoResumeUsd: null, searchOnTopModelUsd: null, searchOnSmallModelUsd: null } }] : [] }] }] };
}

/**
 * The fictional combined.json parts round 2 adds, on top of what the hub already writes. Lane b may
 * extend it with tokens and screen time from lib/sample-snapshot.mjs.
 * @param {number} [now]
 */
export function sampleR2Combined(now = Date.now()) {
  const timeZone = SAMPLE_R2_TIME_ZONE;
  const ledgerHistory = HOSTS.map(spec => historyFor(spec, now, timeZone));
  const next = random(42);
  const requests = Array.from({ length: 30 }, (_, index) => ({ date: dateIn(now - (29 - index) * DAY, timeZone), count: Math.floor(next() * 60) }));
  requests[12].count = null;
  const iso = ms => new Date(ms).toISOString();
  const weekReset = Math.floor((now + 2 * DAY) / HOUR) * HOUR;
  const limitHistory = limitHistoryFor(now);
  const claudeHistory = limitHistory[0].points.filter(point => Date.parse(point.t) > now - 2 * HOUR)
    .map(point => ({ checkedAt: point.t, windows: [{ bucket: 'claude', window: point.w, durationMinutes: point.d, remainingPercent: point.r, resetsAt: point.x }] }));
  const activityHistory = HOSTS.filter(spec => spec.host !== 'Linux').map(spec => activityFor(spec, ledgerHistory.find(row => row.host === spec.host), now, timeZone));
  const recent = Array.from({ length: 45 }, (_, index) => dateIn(now - (44 - index) * DAY, timeZone));
  const combined = {
    schema: 'observatory-combined/1', generatedAt: new Date(now).toISOString(), generatedBy: 'Mac', demo: true,
    // Each computer's state is decided once, as the hub does (lib/combine.mjs deviceState).
    devices: HOSTS.map(spec => {
      const collectedAt = new Date(now - spec.lagHours * HOUR).toISOString();
      return { host: spec.host, name: spec.name, collectedAt, stale: spec.lagHours > 1, ...deviceState({ rows: { collectedAt } }, now, timeZone) };
    }),
    view: {
      schema: 2, timezone: timeZone, collectedAt: new Date(now).toISOString(),
      deviceNames: Object.fromEntries(HOSTS.map(spec => [spec.host, spec.name])),
      ledgerHistory, config: HOSTS.map(spec => configFor(spec, 'Mac')),
      grokLimits: { status: 'ok', checkedAt: new Date(now - HOUR).toISOString(), refusal: null, plan: null, validUntil: new Date(now + 23 * HOUR).toISOString(),
        requests: { timeZone, checkedAt: new Date(now - HOUR).toISOString(), days: requests },
        windows: [{ bucket: 'grok', window: 'weekly', durationMinutes: 10080, remainingPercent: 64, resetsAt: new Date(now + 3 * DAY).toISOString(), checkedAt: new Date(now - HOUR).toISOString() }],
        observedOn: 'Mac' },
      claudeLimits: { provider: 'Claude Code', scope: 'account', status: 'ok', checkedAt: iso(now - 6 * 60000), plan: 'max', observedOn: 'Mac',
        // No 5-hour session is open, so the app leaves that window out of its reading, as the collector records it.
        windows: [{ bucket: 'claude', window: 'seven_day', durationMinutes: 10080, remainingPercent: 40, resetsAt: iso(weekReset) }], notReported: ['five_hour'],
        history: claudeHistory },
      // Codex reports a free plan with nothing left: it reads Off unless its engine setting is "on".
      quota: { provider: 'Codex', scope: 'account', status: 'ok', checkedAt: iso(now - 3 * HOUR), plan: 'free', observedOn: 'Windows',
        windows: [{ bucket: 'codex', window: 'secondary', durationMinutes: 43200, remainingPercent: 0, resetsAt: iso(now + 9 * DAY) }] },
      limitHistory, activityHistory,
      ledger: [liveLedger(ledgerHistory[0], 'Mac', 'working'), liveLedger(ledgerHistory[2], 'Linux', 'waiting')],
      settings: HOSTS.map(spec => ({ host: spec.host, status: 'ok', checkedAt: iso(now - spec.lagHours * HOUR),
        profiles: recent.flatMap((date, index) => [{ date, model: 'claude-opus-5-5', effort: spec.host === 'Windows' && index > 40 ? 'high' : 'medium', speed: 'standard', totalTokens: 1e6 }]) })),
      modelDrift: HOSTS.filter(spec => spec.host !== 'Linux').map((spec, index) => sampleDriftRow(spec.host, { dates: recent, checkedAt: iso(now), scale: index ? 0.4 : 1, seed: 7 + index })),
      projectTokens: [{ host: 'Mac', status: 'ok', checkedAt: iso(now), date: dateIn(now, timeZone), timeZone, providers: ['claude'], other: null,
        projects: REPOS.slice(0, 3).map((name, index) => ({ name, totalTokens: (3 - index) * 4e6, subagentTokens: null, usd: (3 - index) * 6, sessionCount: 1, sessions: [] })) }],
    },
  };
  // The one stored forecast, made the way the hub makes it (lib/combine.mjs), so every surface reads the same words.
  const rows = limitsWithGaps(limits(combined.view, now)).map(row => ({ ...row,
    resetsAt: combined.view[{ claude: 'claudeLimits', codex: 'quota', grok: 'grokLimits' }[row.provider]]?.windows?.find(window => window.window === row.windowId)?.resetsAt ?? null }));
  combined.glance = { limits: rows, forecast: forecast(combined.view, rows, { now, timeZone }) };
  return combined;
}
