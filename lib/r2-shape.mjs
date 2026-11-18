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
// 1. session rows, oldest day first, down to MIN_SESSION_DAYS
// 2. each day's `other.rows`, oldest first
// 3. per-day breakdowns (models, kinds, origins, repos), oldest first, keeping totals and ship counts
// 4. the row reads as unavailable (never reached by a year of fixture data, checked by a test)
export const LEDGER_HISTORY_BUDGET = 1_500_000;
export const MIN_SESSION_DAYS = 35;

const todo = name => { throw new Error(`${name} is not implemented yet (round 2, lane a)`); };

/**
 * Checks one computer's ledgerHistory row from a snapshot, local or pulled over SSH, and returns a copy
 * holding only the fields above. Throws on a wrong shape. With titles false, every title becomes null.
 * Lives here so both scripts/snapshot-clean.mjs and lib/combine.mjs use one rule.
 * @param {unknown} row
 * @param {{titles: boolean}} options
 * @returns {LedgerHistoryRow}
 */
export function cleanLedgerHistory(row, { titles }) { return todo('cleanLedgerHistory'); }

/**
 * Trims a snapshot's ledgerHistory rows in place to `budget` bytes each, in the order above.
 * @param {{ledgerHistory?: LedgerHistoryRow[]}} data
 * @param {{budget?: number}} [options]
 */
export function fitLedgerHistory(data, { budget = LEDGER_HISTORY_BUDGET } = {}) { return todo('fitLedgerHistory'); }
