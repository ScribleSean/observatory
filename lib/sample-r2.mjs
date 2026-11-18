// A fictional combined.json for round 2: three computers with daily ledger history, a settings echo
// and Grok request counts. Every name is made up. The same `now` always gives the same data.
// Lane b tests its view-models against it. Lane e takes screenshots from it.
//
// What it is built to exercise:
// - Mac history starts 120 days back, Windows 60, Linux 25 (a computer whose history starts inside the period).
// - One Windows day is unavailable (Unknown, not 0). Windows is stale (last snapshot 3 hours old).
// - Linux runs headless sessions with no title. Mac has titled sessions with and without a Role: prefix.
// - Codex runs on Windows only. Grok is on on the Mac only. Commits on main lag behind commits.
import { LEDGER_HISTORY_SCHEMA, SESSION_DAY_TOP } from './r2-shape.mjs';

const DAY = 86400000, HOUR = 3600000;
export const SAMPLE_R2_TIME_ZONE = 'America/New_York';
const REPOS = ['lantern', 'orchard', 'tidepool', 'quarry', 'kestrel'];
const TITLES = ['Builder: Lantern', 'Reviewer: Orchard', 'Chief of staff', 'Lead planning', 'Tidepool notes', null];
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
    id: sessionId, title: spec.titled ? pick(next, TITLES) : null, origin: spec.origin,
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
    roleAliases: spec.host === 'Mac' ? { 'tidepool notes': 'Researcher' } : {}, checkedAt: null };
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
  return {
    schema: 'observatory-combined/1', generatedAt: new Date(now).toISOString(), generatedBy: 'Mac', demo: true,
    devices: HOSTS.map(spec => ({ host: spec.host, name: spec.name, collectedAt: new Date(now - spec.lagHours * HOUR).toISOString(), stale: spec.lagHours > 1 })),
    view: {
      schema: 2, timezone: timeZone, collectedAt: new Date(now).toISOString(),
      deviceNames: Object.fromEntries(HOSTS.map(spec => [spec.host, spec.name])),
      ledgerHistory, config: HOSTS.map(spec => configFor(spec, 'Mac')),
      grokLimits: { status: 'ok', checkedAt: new Date(now - HOUR).toISOString(), refusal: null, plan: null, validUntil: null,
        requests: { timeZone, checkedAt: new Date(now - HOUR).toISOString(), days: requests },
        windows: [{ bucket: 'grok', window: 'weekly', durationMinutes: 10080, remainingPercent: 64, resetsAt: new Date(now + 3 * DAY).toISOString(), checkedAt: new Date(now - HOUR).toISOString() }] },
    },
    glance: { limits: [] },
  };
}
