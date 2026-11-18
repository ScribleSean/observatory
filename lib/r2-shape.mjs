// The ledger history: what each session spent and shipped on each day, kept per computer for good.
// Contract only. Lane a (collector) writes the code that fills it. See docs/R2-PLAN.md.
//
// Today's ledger (lib/ledger-shape.mjs) keeps only the current and previous weekly windows. Round 2
// needs any day, week, month, year or all time, so each computer also keeps one LedgerDay per tool and
// date. The full record lives in the computer's private folder (private-history/ledger.sqlite, beside
// tokens.sqlite). The snapshot carries a trimmed copy as `ledgerHistory`, and the hub passes each
// computer's copy through as it is, as it does the ledger row. Sessions are per computer, so no session
// is added twice. Commits can be (one repository cloned on two computers), so commit sums across
// computers carry the "not deduplicated" label.
//
// What is kept: hashed session ids, the tool's own title (only while sessions.titles is true), how the
// session ran, the kind of its first prompt, repository folder names, model ids, counts and dollars.
// Never a path, prompt, command or message. Unknown is null, never 0.
//
// Days change after they happen: a branch merged on Friday turns Monday's commits into commits on main.
// Each collection rebuilds the last REDERIVE_DAYS from transcripts and git. Older days are frozen, except
// that `onMain` is checked again for ONMAIN_RECHECK_DAYS from the commit ids kept in the private store
// (never in the snapshot). Claude Code deletes transcripts after 30 days by default, so the first
// collection backfills as many days as the transcripts still hold.

import { WORK_KINDS } from './ledger-shape.mjs';
import { cleanTitle } from '../scripts/sources/pure.mjs';

/**
 * @typedef {import('./ledger-shape.mjs').WorkKind} WorkKind
 * @typedef {import('./ledger-shape.mjs').ToolId} ToolId
 *
 * @typedef {object} LedgerHistoryRow       One per computer in snapshot.ledgerHistory and view.ledgerHistory.
 * @property {string} host                  'Mac' | 'Windows' | 'Linux'
 * @property {'ok' | 'unavailable' | 'not-connected'} status  not-connected: claudeCode and codex are both off.
 * @property {string | null} checkedAt      ISO.
 * @property {number} schema                LEDGER_HISTORY_SCHEMA.
 * @property {string} timeZone              The zone the dates are in.
 * @property {string | null} firstDate      The earliest date kept. Days before it are not recorded (they add nothing).
 * @property {string | null} sessionsFrom   The earliest date that still lists sessions. Older days keep totals only.
 * @property {LedgerDay[]} days             Ascending by date, then tool.
 *
 * @typedef {object} LedgerDay
 * @property {string} date                  YYYY-MM-DD in timeZone.
 * @property {ToolId} tool                  'claude' | 'codex'.
 * @property {'ok' | 'unavailable'} status  unavailable: the day could not be read (it is Unknown, not 0).
 * @property {boolean} frozen               Older than REDERIVE_DAYS when last written.
 * @property {number | null} apiUsd         Every session that day, listed or not.
 * @property {number | null} sessionCount
 * @property {number | null} subagents
 * @property {DayTokens} tokens
 * @property {DayModel[]} models            Largest first.
 * @property {DayKind[]} kinds              Largest first. 'main' is the sessions' own threads.
 * @property {DayOrigin[]} origins          Spend by how sessions ran.
 * @property {RepoShip[]} repos             Per repository, largest spend first, at most MAX_DAY_REPOS.
 * @property {ShipCounts} ship              The day's total. Commits other than merges, by commit time.
 * @property {SessionDay[]} sessions        The largest SESSION_DAY_TOP sessions. Empty before sessionsFrom.
 * @property {SessionDayOther | null} other Every session not listed, summed, with a compact row each.
 *
 * @typedef {object} DayTokens
 * @property {number | null} input
 * @property {number | null} output
 * @property {number | null} cacheRead
 * @property {number | null} cacheWrite
 *
 * @typedef {object} DayModel
 * @property {string} model                 Raw model id.
 * @property {number | null} apiUsd
 * @property {number | null} outputTokens
 *
 * @typedef {object} DayKind
 * @property {WorkKind} kind
 * @property {number | null} apiUsd
 * @property {number} subagents
 *
 * @typedef {object} DayOrigin
 * @property {'headless' | 'interactive' | 'unknown'} origin
 * @property {number | null} apiUsd
 * @property {number} sessions
 *
 * @typedef {object} ShipCounts             Estimated, as in lib/ledger-shape.mjs Shipped.
 * @property {number | null} commits        Commits other than merge commits.
 * @property {number | null} onMain         Of those, reachable from the default branch as last checked.
 * @property {number | null} merges         Branches merged, a merge and the branch it brought in counting once.
 *
 * @typedef {ShipCounts & {repo: string, apiUsd: number | null}} RepoShip
 *   repo is a folder name only. apiUsd is the spend of sessions whose `repo` is this one.
 *
 * @typedef {object} SessionDay             One session's part of one day. Role inputs are kept, the role is not:
 *                                          lib/roles.mjs derives it when shown, so a better rule applies to the past.
 * @property {string} id                    12-hex id, the same as the ledger's, so days join into one session.
 * @property {string | null} title          Null when the tool has none or sessions.titles is false.
 * @property {'headless' | 'interactive' | null} origin
 * @property {WorkKind | null} task         The kind of the first prompt, never the prompt.
 * @property {string | null} repo           Folder the session ran in.
 * @property {string} firstAt               ISO, first activity that day.
 * @property {string} lastAt                ISO.
 * @property {number | null} apiUsd
 * @property {DayTokens} tokens
 * @property {DayModel[]} models            At most MAX_SESSION_MODELS, the rest as model 'other'.
 * @property {DayKind[]} kinds              At most MAX_SESSION_KINDS, the rest as kind 'other'.
 * @property {RepoShip[]} ship              Commits it made that day, per repository, at most MAX_SESSION_REPOS.
 *
 * @typedef {object} SessionDayOther
 * @property {number} count
 * @property {number | null} apiUsd
 * @property {number} subagents
 * @property {ShipCounts} ship
 * @property {CompactSession[]} rows        Enough to tell, over a whole range, which sessions shipped nothing.
 *
 * @typedef {[id: string, apiUsd: number | null, commits: number | null, onMain: number | null]} CompactSession
 *
 * @typedef {object} ConfigEcho             One per computer in view.config: its settings file, minus anything
 *                                          private. No paths, SSH aliases, data folders or program locations.
 * @property {string} host
 * @property {string} name                  device.name
 * @property {'hub' | 'spoke'} role
 * @property {Record<string, boolean>} sources  Every key of lib/config.mjs SOURCES.
 * @property {Record<string, 'auto' | 'on' | 'off'>} engines
 * @property {boolean} titles               sessions.titles
 * @property {Record<string, string>} roleAliases  sessions.roles: title start to role (lib/roles.mjs). New, optional, default {}.
 * @property {string | null} checkedAt
 */

export const LEDGER_HISTORY_SCHEMA = 1;
// Sessions listed per tool and day. The rest are summed in `other` with a compact row each.
export const SESSION_DAY_TOP = 30;
// Days the snapshot still lists sessions for. Older days keep their totals and breakdowns for good.
// The private store keeps every session for as long as the store exists.
export const SESSION_DAYS = 92;
// Days rebuilt from transcripts and git on each collection.
export const REDERIVE_DAYS = 14;
// Days whose commits are checked again for reaching main, from commit ids in the private store.
export const ONMAIN_RECHECK_DAYS = 92;
export const MAX_DAY_REPOS = 12;
export const MAX_SESSION_MODELS = 4;
export const MAX_SESSION_KINDS = 5;
export const MAX_SESSION_REPOS = 3;
// Bytes of serialized ledgerHistory per computer. combined.json holds up to three computers twice
// (snapshots and view, see scripts/hub.mjs), so three computers stay well under snapshotMaximumBytes
// with the activity history beside them. scripts/snapshot-size.mjs trims in this order until it fits:
// 1. session rows, oldest day first, down to MIN_SESSION_DAYS (each folds into the day's compact rows)
// 2. each day's compact rows (`other.rows`), oldest first
// 3. per-day breakdowns (models, kinds, origins, repos) of days before the last MIN_SESSION_DAYS, oldest first
// 4. the session rows of the last MIN_SESSION_DAYS, oldest day first, with their compact rows
// 5. the remaining per-day breakdowns, oldest first
// Day totals and ship counts are never dropped: a row that is still over the budget as totals is kept
// as it is, so a computer's history never reads as unavailable only because it is large.
export const LEDGER_HISTORY_BUDGET = 1_500_000;
export const MIN_SESSION_DAYS = 35;

// Rows a snapshot may hold: three tools a day for ten years.
const MAX_HISTORY_DAYS = 3 * 3660;
// Compact rows per day: a busy day of headless runs, with room to spare.
const MAX_OTHER_ROWS = 5000;
const FAIL = () => { throw new Error('Invalid ledger history'); };
const need = ok => { if (!ok) FAIL(); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const list = (value, max) => { need(Array.isArray(value) && value.length <= max); return value; };
const count = value => { need(value === null || (Number.isSafeInteger(value) && value >= 0)); return value; };
const usd = value => { need(value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0)); return value; };
const instant = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const DATE = /^\d{4}-\d\d-\d\d$/;
const ID = /^[0-9a-f]{12}$/;
const TOOL = /^[a-z][a-z0-9-]{0,31}$/;
const MODEL = /^[a-z0-9][a-z0-9.-]{0,63}$/;
const REPO = /^[\p{L}\p{N}_.+ @-]{1,64}$/u;
const ZONE = /^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/;
const date = value => { need(typeof value === 'string' && DATE.test(value)); return value; };
const nullableDate = value => value === null || value === undefined ? null : date(value);
const repoName = value => typeof value === 'string' && REPO.test(value) && value !== '.' && value !== '..' && !/[\\/]/.test(value);
// The rule a repository folder name must pass to be kept, shared with the collector (scripts/ledger-history.mjs).
export const isRepoName = repoName;
const nullTokens = () => ({ input: null, output: null, cacheRead: null, cacheWrite: null });
const tokens = raw => { need(object(raw)); return Object.fromEntries(['input', 'output', 'cacheRead', 'cacheWrite'].map(key => [key, count(raw[key] ?? null)])); };
const ship = raw => { need(object(raw)); return { commits: count(raw.commits ?? null), onMain: count(raw.onMain ?? null), merges: count(raw.merges ?? null) }; };
const model = raw => { need(object(raw) && (raw.model === 'other' || raw.model === 'unknown' || MODEL.test(raw.model))); return { model: raw.model, apiUsd: usd(raw.apiUsd ?? null), outputTokens: count(raw.outputTokens ?? null) }; };
const kind = raw => { need(object(raw) && WORK_KINDS.includes(raw.kind) && Number.isSafeInteger(raw.subagents) && raw.subagents >= 0); return { kind: raw.kind, apiUsd: usd(raw.apiUsd ?? null), subagents: raw.subagents }; };
const add = (a, b) => a === null || b === null ? null : a + b;
// Repository rows. A name that fails the rule (written before the collector checked it) is counted as 'other',
// so one odd folder name never makes a whole history unreadable. Rows that share a name are summed.
const repoShips = (raw, max) => {
  const out = new Map();
  for (const entry of list(raw, max)) {
    need(object(entry));
    const row = { repo: repoName(entry.repo) ? entry.repo : 'other', apiUsd: usd(entry.apiUsd ?? null), ...ship(entry) };
    const prior = out.get(row.repo);
    const spent = prior ? add(prior.apiUsd, row.apiUsd) : null;
    out.set(row.repo, prior ? { repo: row.repo, apiUsd: spent === null ? null : Math.round(spent * 1e6) / 1e6,
      commits: add(prior.commits, row.commits), onMain: add(prior.onMain, row.onMain), merges: add(prior.merges, row.merges) } : row);
  }
  return [...out.values()];
};

function session(raw, titles) {
  need(object(raw) && ID.test(raw.id) && instant(raw.firstAt) && instant(raw.lastAt) && raw.firstAt <= raw.lastAt);
  need(raw.origin === undefined || raw.origin === null || raw.origin === 'headless' || raw.origin === 'interactive');
  need(raw.task === undefined || raw.task === null || WORK_KINDS.includes(raw.task));
  return { id: raw.id, title: titles ? cleanTitle(raw.title) : null, origin: raw.origin ?? null, task: raw.task ?? null,
    repo: repoName(raw.repo) ? raw.repo : null, firstAt: raw.firstAt, lastAt: raw.lastAt, apiUsd: usd(raw.apiUsd ?? null), tokens: tokens(raw.tokens),
    models: list(raw.models, MAX_SESSION_MODELS).map(model), kinds: list(raw.kinds, MAX_SESSION_KINDS).map(kind),
    ship: repoShips(raw.ship, MAX_SESSION_REPOS) };
}

function other(raw) {
  if (raw === null || raw === undefined) return null;
  need(object(raw) && Number.isSafeInteger(raw.count) && raw.count > 0 && Number.isSafeInteger(raw.subagents) && raw.subagents >= 0);
  const rows = list(raw.rows ?? [], MAX_OTHER_ROWS).map(row => {
    need(Array.isArray(row) && row.length === 4 && ID.test(row[0]));
    return [row[0], usd(row[1]), count(row[2]), count(row[3])];
  });
  need(rows.length <= raw.count);
  return { count: raw.count, apiUsd: usd(raw.apiUsd ?? null), subagents: raw.subagents, ship: ship(raw.ship), rows };
}

function day(raw, titles) {
  need(object(raw) && TOOL.test(raw.tool) && ['ok', 'unavailable'].includes(raw.status) && typeof raw.frozen === 'boolean');
  const base = { date: date(raw.date), tool: raw.tool, status: raw.status, frozen: raw.frozen };
  if (raw.status === 'unavailable') return { ...base, apiUsd: null, sessionCount: null, subagents: null, tokens: nullTokens(), models: [], kinds: [],
    origins: [], repos: [], ship: { commits: null, onMain: null, merges: null }, sessions: [], other: null };
  const sessions = list(raw.sessions, SESSION_DAY_TOP).map(row => session(row, titles));
  need(new Set(sessions.map(row => row.id)).size === sessions.length);
  const sessionCount = count(raw.sessionCount ?? null);
  const rest = other(raw.other);
  need(sessionCount === null || sessionCount >= sessions.length + (rest === null ? 0 : rest.count));
  return { ...base, apiUsd: usd(raw.apiUsd ?? null), sessionCount, subagents: count(raw.subagents ?? null), tokens: tokens(raw.tokens),
    models: list(raw.models, 200).map(model), kinds: list(raw.kinds, WORK_KINDS.length).map(kind),
    origins: list(raw.origins, 3).map(row => { need(object(row) && ['headless', 'interactive', 'unknown'].includes(row.origin) && Number.isSafeInteger(row.sessions) && row.sessions >= 0);
      return { origin: row.origin, apiUsd: usd(row.apiUsd ?? null), sessions: row.sessions }; }),
    repos: repoShips(raw.repos, MAX_DAY_REPOS), ship: ship(raw.ship), sessions, other: rest };
}

/**
 * Checks one computer's ledgerHistory row from a snapshot, local or pulled over SSH, and returns a copy
 * holding only the fields above. Throws on a wrong shape. With titles false, every title becomes null.
 * Lives here so both scripts/snapshot-clean.mjs and lib/combine.mjs use one rule.
 * @param {unknown} row
 * @param {{titles: boolean}} options
 * @returns {LedgerHistoryRow}
 */
export function cleanLedgerHistory(row, { titles }) {
  need(object(row) && typeof row.host === 'string' && row.host.length > 0 && row.host.length <= 32);
  const timeZone = typeof row.timeZone === 'string' && ZONE.test(row.timeZone) ? row.timeZone : 'UTC';
  const checkedAt = instant(row.checkedAt) ? row.checkedAt : null;
  if (row.status !== 'ok') {
    need(['unavailable', 'not-connected'].includes(row.status));
    return { host: row.host, status: row.status, checkedAt, schema: LEDGER_HISTORY_SCHEMA, timeZone, firstDate: null, sessionsFrom: null, days: [] };
  }
  need(row.schema === LEDGER_HISTORY_SCHEMA && ZONE.test(row.timeZone ?? ''));
  const days = list(row.days, MAX_HISTORY_DAYS).map(raw => day(raw, titles));
  for (let index = 1; index < days.length; index++) {
    const [before, after] = [days[index - 1], days[index]];
    need(before.date < after.date || (before.date === after.date && before.tool < after.tool));
  }
  const firstDate = nullableDate(row.firstDate), sessionsFrom = nullableDate(row.sessionsFrom);
  need(firstDate === (days[0]?.date ?? null));
  return { host: row.host, status: 'ok', checkedAt, schema: LEDGER_HISTORY_SCHEMA, timeZone, firstDate, sessionsFrom, days };
}

const bytes = value => Buffer.byteLength(JSON.stringify(value));

// Folds a day's listed sessions into its `other`, with a compact row each, so its totals stay whole.
function foldListed(day) {
  if (!day.sessions.length) return;
  const sum = values => values.some(value => value === null) ? null : values.reduce((a, b) => a + b, 0);
  const rows = day.sessions.map(row => [row.id, row.apiUsd, sum(row.ship.map(part => part.commits)), sum(row.ship.map(part => part.onMain))]);
  const prior = day.other ?? { count: 0, apiUsd: 0, subagents: 0, ship: { commits: 0, onMain: 0, merges: 0 }, rows: [] };
  const ships = [prior.ship, ...day.sessions.map(row => ({ commits: sum(row.ship.map(part => part.commits)), onMain: sum(row.ship.map(part => part.onMain)),
    merges: sum(row.ship.map(part => part.merges)) }))];
  const total = sum([prior.apiUsd, ...day.sessions.map(row => row.apiUsd)]);
  day.other = { count: prior.count + day.sessions.length, apiUsd: total === null ? null : Math.round(total * 1e6) / 1e6,
    subagents: prior.subagents + day.sessions.reduce((all, row) => all + row.kinds.reduce((each, part) => each + part.subagents, 0), 0),
    ship: { commits: sum(ships.map(part => part.commits)), onMain: sum(ships.map(part => part.onMain)), merges: sum(ships.map(part => part.merges)) },
    rows: [...prior.rows, ...rows] };
  day.sessions = [];
}

function fitRow(row, budget) {
  if (row?.status !== 'ok' || !Array.isArray(row.days)) return row;
  // Sizes are kept per day, so trimming a year costs one pass instead of one serialization per step.
  const sizes = row.days.map(bytes);
  let total = bytes({ ...row, days: [] }) + sizes.reduce((a, b) => a + b, 0) + Math.max(0, sizes.length - 1);
  const fits = () => total <= budget;
  const change = (index, edit) => { edit(row.days[index]); const size = bytes(row.days[index]); total += size - sizes[index]; sizes[index] = size; };
  if (fits()) return row;
  const dates = [...new Set(row.days.map(day => day.date))].sort((a, b) => a.localeCompare(b));
  const keepFrom = dates[Math.max(0, dates.length - MIN_SESSION_DAYS)];
  // 1. Session rows, oldest day first, down to MIN_SESSION_DAYS.
  for (let index = 0; index < row.days.length && !fits(); index++) {
    if (row.days[index].date >= keepFrom) break;
    if (!row.days[index].sessions.length) continue;
    change(index, foldListed);
    row.sessionsFrom = row.days.find((day, at) => at > index && day.sessions.length)?.date ?? row.sessionsFrom;
  }
  // 2. Each day's compact rows, oldest first.
  for (let index = 0; index < row.days.length && !fits(); index++)
    if (row.days[index].other?.rows.length) change(index, day => { day.other.rows = []; });
  const plain = day => { day.models = []; day.kinds = []; day.origins = []; day.repos = []; };
  // 3. Per-day breakdowns of the older days, oldest first.
  for (let index = 0; index < row.days.length && !fits() && row.days[index].date < keepFrom; index++) change(index, plain);
  // 4. The recent days' session rows, oldest first, folded into the day's totals.
  for (let index = 0; index < row.days.length && !fits(); index++) {
    if (!row.days[index].sessions.length) continue;
    change(index, day => { foldListed(day); day.other.rows = []; });
    row.sessionsFrom = row.days.find((day, at) => at > index && day.sessions.length)?.date ?? null;
  }
  // 5. The remaining breakdowns, oldest first. Totals and ship counts stay, even past the budget.
  for (let index = 0; index < row.days.length && !fits(); index++) change(index, plain);
  return row;
}

/**
 * Trims a snapshot's ledgerHistory rows in place to `budget` bytes each, in the order above.
 * @param {{ledgerHistory?: LedgerHistoryRow[]}} data
 * @param {{budget?: number}} [options]
 */
export function fitLedgerHistory(data, { budget = LEDGER_HISTORY_BUDGET } = {}) {
  if (!Array.isArray(data?.ledgerHistory)) return;
  data.ledgerHistory = data.ledgerHistory.map(row => fitRow(row, budget));
}
