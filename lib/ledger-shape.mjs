// The ledger: agent sessions per limit window, what each one cost and what it shipped.
// Collectors write one LedgerRow per computer into the snapshot's `ledger` array. The hub keeps each
// computer's row as it is (sessions are per computer, so nothing is added twice) and the views join them.
// A value that could not be read is null, never 0.

/**
 * @typedef {string} ToolId  A source adapter id (scripts/sources/<id>.mjs), e.g. 'claude' or 'codex'.
 *
 * @typedef {object} LedgerRow
 * @property {string} host
 * @property {'ok' | 'not-connected' | 'unavailable'} status
 * @property {string} collectedAt            ISO time.
 * @property {LedgerTool[]} tools            One per source adapter that found data on this computer.
 *
 * @typedef {object} LedgerTool
 * @property {ToolId} tool
 * @property {string} name                   Display name, e.g. "Claude Code".
 * @property {string | null} limitEngine     The forecast engine whose limits this tool spends ('claude', 'codex'), or null.
 * @property {LedgerPeriod[]} periods        'current' and, when readable, 'previous'.
 *
 * @typedef {object} LedgerPeriod
 * @property {'current' | 'previous'} key
 * @property {string} start                  ISO. The weekly window's start (resetsAt minus 7 days), or the last 7 days when no window is known.
 * @property {string} end                    ISO. The window's reset time, or now.
 * @property {boolean} windowKnown           True when start and end come from a real limit reading.
 * @property {number | null} apiUsd          Sum over every session in the period, listed or not.
 * @property {number | null} sessionCount    All sessions with activity in the period.
 * @property {LedgerSession[]} sessions      The largest sessions by apiUsd, at most LEDGER_TOP.
 * @property {LedgerOther | null} other      Everything not listed, summed.
 * @property {DayTotal[]} days               Per local day in the period, for "Spent and shipped".
 *
 * @typedef {object} LedgerSession
 * @property {string} id                     12-hex hash of the tool's session id.
 * @property {string | null} title           The tool's own session title. Null when the tool has none or `sessions.titles` is false.
 * @property {'headless' | 'interactive' | null} origin  Headless when no one typed (codex exec, claude -p). Null when the tool does not say.
 * @property {WorkKind | null} task          The kind of the session's first prompt, never the prompt. Null when unknown.
 * @property {string | null} repo           Folder name of the repository the session ran in, never a path. Null when unknown.
 * @property {string} startedAt              ISO, first activity in the period.
 * @property {string} lastActiveAt           ISO.
 * @property {boolean} running               A live process for this session was seen in this collection.
 * @property {'working' | 'waiting' | 'idle' | null} state  Only meaningful while running.
 * @property {number | null} ratePerHour     apiUsd per hour over the last 30 minutes, while running.
 * @property {Tokens} tokens
 * @property {number | null} apiUsd          At public API prices, as scripts/api-estimate.mjs prices them. The share of a limit is derived from this.
 * @property {ModelPart[]} models            Largest first.
 * @property {number} subagents              Count of subagents started in the period.
 * @property {KindPart[]} kinds              Subagent work by kind and model, largest first.
 * @property {FanoutPoint[]} fanout          Subagents running at once, per 15 minutes, only when subagents > 0.
 * @property {Shipped} shipped
 * @property {Signals} signals               Raw facts the flags are computed from (lib/ledger-flags.mjs).
 *
 * @typedef {object} Tokens
 * @property {number | null} input
 * @property {number | null} output
 * @property {number | null} cacheRead
 * @property {number | null} cacheWrite
 *
 * @typedef {object} ModelPart
 * @property {string} model                  Raw model id as the tool reported it.
 * @property {number | null} apiUsd
 * @property {number | null} outputTokens
 *
 * @typedef {'search' | 'research' | 'review' | 'design' | 'build' | 'test' | 'write' | 'main' | 'other'} WorkKind
 *
 * @typedef {object} KindPart
 * @property {WorkKind} kind                 'main' is the session's own thread.
 * @property {string} model
 * @property {number} subagents
 * @property {number | null} apiUsd
 *
 * @typedef {object} FanoutPoint
 * @property {string} at                     ISO, start of a 15-minute slot.
 * @property {number} count
 *
 * @typedef {object} Shipped                 An estimate: a commit counts for the session that last wrote in that repository within 20 minutes before it.
 * @property {boolean} estimated
 * @property {number | null} commits         Commits other than merge commits.
 * @property {number | null} onMain          Of those, commits reachable from the repository's default branch now.
 * @property {number | null} merges          Branches merged: a merge commit the session made and branches it created that are now merged or landed on the default branch as one squash commit, a merge and the branch it brought in counting once. Null when a branch's merge could not be read.
 * @property {number | null} prsOpen         Null unless a PR count was readable without the network.
 * @property {string[]} repos                Repository folder names only, never paths.
 *
 * @typedef {object} Signals
 * @property {number | null} longestRetry    Most consecutive failed calls of one tool with the same input.
 * @property {string | null} retryTool       Tool category from the fixed list in scripts/read-settings.mjs, never the raw command.
 * @property {number | null} autoResumeUsd   apiUsd spent in the first 30 minutes after resuming without a typed prompt right after a 5-hour reset.
 * @property {number | null} searchOnTopModelUsd  apiUsd of 'search' and 'research' subagents run on the tool's most expensive model.
 * @property {number | null} searchOnSmallModelUsd The same work priced at the tool's smallest model.
 *
 * @typedef {object} LedgerOther
 * @property {number} count
 * @property {number | null} apiUsd
 * @property {number} subagents
 * @property {Shipped} shipped
 *
 * @typedef {object} DayTotal
 * @property {string} date                   YYYY-MM-DD in the snapshot's time zone.
 * @property {number | null} apiUsd
 * @property {number | null} onMain
 */

export const LEDGER_TOP = 25;
export const WORK_KINDS = Object.freeze(['search', 'research', 'review', 'design', 'build', 'test', 'write', 'main', 'other']);

// A session's share of a limit window: its API-priced spend over the window's, times the percent of the
// window used. API prices stand in for how much of a limit each model's tokens use. Null when unknown:
// a missing, negative or non-finite value, nothing spent in the period, or a percent used over 100.
export function limitShare(sessionUsd, periodUsd, percentUsed) {
  const ok = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  if (!ok(sessionUsd) || !ok(periodUsd) || !ok(percentUsed) || periodUsd === 0 || percentUsed > 100) return null;
  return Math.min(percentUsed, percentUsed * sessionUsd / periodUsd);
}
