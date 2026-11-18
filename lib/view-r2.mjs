// Round 2 view-models: plain objects the React views and blocks render, one builder per view.
// Contract only. Lane b (view-models) writes the bodies. See docs/R2-PLAN.md.
//
// Input is combined.json (the hub's output, lib/combine.mjs), including view.ledgerHistory
// (lib/r2-shape.mjs) and view.config (the settings echo). Every builder is pure: no clock, no fetch,
// `now` comes in as an option. Rules every number follows (AGENTS.md):
// - Unknown is null, never 0. Its text is "Unknown".
// - Every number carries its breakdowns, so the page can open them in place.
// - A cross-computer sum of tokens, screen time, spend or commits carries sumLabel "not deduplicated"
//   and is shown only next to its per-device parts. It is Unknown when any selected computer's part is.
// - In a cross-computer sum, a computer with no records for the period, or with that source off, adds
//   nothing. A computer whose day is 'unavailable' makes that day Unknown.
// - Account limits are never summed across computers. Grok requests are never added to dollars or tokens.
// - A day with screen tracking off is Unknown on its own. A longer period adds the tracked days only.

/**
 * @typedef {import('./scope.mjs').Scope} Scope
 * @typedef {import('./scope.mjs').Period} Period
 * @typedef {import('./scope.mjs').Comparison} Comparison
 * @typedef {import('./scope.mjs').DeviceChip} DeviceChip
 * @typedef {import('./scope.mjs').SourceId} SourceId
 * @typedef {import('./r2-blocks.mjs').MetricId} MetricId
 * @typedef {import('./r2-blocks.mjs').Dim} Dim
 * @typedef {import('./r2-blocks.mjs').SavedView} SavedView
 * @typedef {import('./roles.mjs').SessionName} SessionName
 *
 * @typedef {'usd' | 'count' | 'percent' | 'tokens' | 'seconds' | 'requests' | 'usdPerChange'} Unit
 *
 * @typedef {object} Part                   One row of a breakdown.
 * @property {string} key                   Stable key ('Mac', 'Builder', a session key, a repo, 'Opus').
 * @property {string} label                 Display text.
 * @property {number | null} value
 * @property {string} text                  Formatted, "Unknown" when null.
 * @property {number | null} share          Percent of the number's value, null when either is Unknown.
 *
 * @typedef {object} Num                    A number with everything needed to explain it.
 * @property {MetricId | null} metric
 * @property {Unit} unit
 * @property {number | null} value
 * @property {string} text                  "$412", "169 of 646", "Unknown".
 * @property {number | null} of             The whole, for "169 of 646" (onMain) and shares.
 * @property {string | null} sumLabel       "not deduplicated" on a cross-computer sum, else null.
 * @property {number | null} previous       The comparison period's value.
 * @property {number | null} delta          value minus previous. Null when either is Unknown.
 * @property {string | null} deltaText      "+6 vs last week", "no earlier data", null with no comparison.
 * @property {Partial<Record<Dim, Part[]>>} breakdowns  Only the dims METRIC_DIMS allows. Largest first, the rest as Other.
 * @property {string | null} note           A limit on the number ("Commits are estimated", "History from Nov 2").
 *
 * @typedef {object} Coverage               What the period's numbers rest on.
 * @property {string | null} from           The first recorded date across selected computers.
 * @property {{host: string, name: string, dates: string[]}[]} unknownDays  Days a computer could not read.
 * @property {{host: string, name: string, before: string}[]} startsLater  Computers whose history starts inside the period.
 * @property {boolean} sessionsTrimmed      Some days in the period keep totals only (older than SESSION_DAYS).
 *
 * @typedef {object} Frame                  What every view shares: the scope bar.
 * @property {Scope} scope
 * @property {Period} period
 * @property {Comparison | null} comparison
 * @property {DeviceChip[]} devices
 * @property {{id: SourceId, name: string, on: boolean, hasData: boolean}[]} sources
 * @property {{back: import('./scope.mjs').Range | null, forward: import('./scope.mjs').Range | null}} steps
 * @property {string} timeZone
 * @property {string} generatedAt
 * @property {boolean} stale
 *
 * @typedef {object} DayPoint               One bar of the spend-and-landed chart.
 * @property {string} date                  First date of the bucket (a day, or a month for 'year' and 'all').
 * @property {Num} spend                    Breakdown by device always, by the chart's stack dim when asked.
 * @property {Num} onMain
 * @property {Num} churn                    Commits that day not on main as last checked.
 * @property {Num} merged
 *
 * @typedef {object} GrokRequestsVM
 * @property {Num} total                    Requests in the period, unit 'requests'.
 * @property {{date: string, value: number | null}[]} days  Null for a day with no count read.
 * @property {{remaining: number | null, resetsAt: string | null, checkedAt: string | null} | null} weekly  When a reading is cached.
 *
 * @typedef {object} AgentRow               The models-and-agents breakdown: each in its own unit.
 * @property {string} agent                 'Fable', 'Opus', 'Sonnet', 'Haiku', another model label, or 'Grok'.
 * @property {Num | null} usd               Claude and Codex models. Null for Grok.
 * @property {Num | null} tokens            Claude and Codex models. Null for Grok.
 * @property {Num | null} requests          Grok only.
 *
 * @typedef {object} FlagLine
 * @property {string} text
 * @property {string | null} sessionKey
 *
 * @typedef {object} OverviewVM
 * @property {Frame} frame
 * @property {{spend: Num, merged: Num, onMain: Num, churn: Num, perLanded: Num, noCommitSpend: Num}} headline
 * @property {DayPoint[]} chart
 * @property {AgentRow[]} agents            Never totalled: the units differ.
 * @property {GrokRequestsVM | null} grok   Null when Grok is off or has no data in the period.
 * @property {SessionRow[]} topSessions     At most 6.
 * @property {SessionRow[]} running         Running now, current period only.
 * @property {LimitsVM['engines']} limits   Limits now, as on the Limits view.
 * @property {FlagLine[]} flags             "Needs you": stale computers, a landed rate that fell, spend with nothing on main.
 * @property {Coverage} coverage
 *
 * @typedef {object} SessionRow
 * @property {'session' | 'bundle'} kind     A bundle folds many small or headless sessions of one role into one row:
 *                                          "Headless review runs, Observatory (2)", "Smaller sessions, 8 repos (143)".
 * @property {number} count                 1 for a session.
 * @property {SessionRow[]} children        A bundle's sessions, empty for a session.
 * @property {string} key                   host.tool.id, the same key as the Week page. A bundle's key is stable per role and repo.
 * @property {string} host
 * @property {string} device                Device name.
 * @property {SourceId} tool
 * @property {SessionName} name             Role, object, "[Builder] Observatory".
 * @property {string[]} models              Labels, largest spend first.
 * @property {number} subagents
 * @property {Num} spend                    Breakdowns: model, kind.
 * @property {number | null} share          Percent of the period's spend in scope.
 * @property {Num} onMain                   value = commits on main, of = commits. Breakdown: repo.
 * @property {Num} merged
 * @property {Num} perLanded
 * @property {string} startedAt
 * @property {string} lastActiveAt
 * @property {boolean} running              Only from the live ledger, for the current period.
 * @property {'working' | 'waiting' | 'idle' | null} state
 * @property {boolean} needsYou             Running and waiting for a typed reply.
 * @property {string[]} repos
 *
 * @typedef {object} SessionsVM
 * @property {Frame} frame
 * @property {SessionRow[]} rows
 * @property {{key: string, label: string, count: number, rows: SessionRow[], spend: Num, onMain: Num, subagents: number}[] | null} groups  When grouped.
 * @property {{count: number | null, listed: number, other: {count: number, spend: Num} | null}} totals
 * @property {Coverage} coverage
 *
 * @typedef {object} LimitWindowVM
 * @property {string} windowId
 * @property {string} label                 "weekly", "5 hour".
 * @property {number | null} remaining      Percent left. Never a sum.
 * @property {string | null} resetsAt
 * @property {string | null} readOn         Device name the reading came from.
 * @property {string | null} checkedAt
 * @property {'ok' | 'low' | 'spent' | 'stale' | 'off'} state
 * @property {object | null} forecast       lib/forecast.mjs windowForecast output.
 * @property {{start: string, used: number | null}[]} pastWindows  Within the period.
 *
 * @typedef {object} LimitsVM
 * @property {Frame} frame
 * @property {{engine: 'claude' | 'codex' | 'grok', name: string, plan: string | null, windows: LimitWindowVM[]}[]} engines
 *
 * @typedef {object} TokensVM
 * @property {Frame} frame
 * @property {Num} total                    Tokens. Breakdowns: device, model, tool, agent.
 * @property {Num} spend
 * @property {{date: string, tokens: Num, spend: Num}[]} days
 * @property {AgentRow[]} agents
 * @property {{repo: string, tokens: number | null, spend: number | null}[]} repos  'day' only, from projectTokens.
 *
 * @typedef {object} ScreenTimeVM
 * @property {Frame} frame
 * @property {Num} total                    Seconds. Breakdowns: device, category.
 * @property {{date: string, seconds: Num, tracked: boolean | null}[]} days
 * @property {number[] | null} hours        24 values, 'day' only.
 * @property {{category: string, apps: Part[]}[]} apps
 *
 * @typedef {object} DriftVM
 * @property {Frame} frame
 * @property {object[]} models              lib/drift.mjs driftView rows over the period's dates, selected computers only.
 * @property {{date: string, model: string, effort: string, speed: string}[]} setup  Settings drift from view.settings.
 *
 * @typedef {object} SettingsVM             Read-only. The dashboard never edits settings.
 * @property {Frame} frame
 * @property {{host: string, name: string, role: 'hub' | 'spoke', sources: Record<string, boolean>, engines: Record<string, string>, titles: boolean}[]} computers
 * @property {{id: SourceId, name: string, reads: string, on: Record<string, boolean>}[]} sources
 * @property {{prefix: string, role: string}[]} roleAliases  sessions.roles, when set.
 * @property {string} howToChange           "Edit observatory.config.json on that computer. The next collection uses it."
 *
 * @typedef {object} AskAnswer
 * @property {string | null} matched        The pinned question or rule id that matched, null when none did.
 * @property {SavedView | null} view        The spec to draw. Null with `suggestions` when nothing matched.
 * @property {string[]} suggestions         Pinned questions to try.
 */

// Sessions under this percent of the period's spend fold into a "Smaller sessions" bundle.
export const BUNDLE_BELOW_SHARE = 1;

const todo = name => { throw new Error(`${name} is not implemented yet (round 2, lane b)`); };

/** @param {object} snapshot @param {Scope} scope @param {{now?: number}} [options] @returns {Frame} */
export function buildFrame(snapshot, scope, { now = Date.now() } = {}) { return todo('buildFrame'); }

/** @param {object} snapshot @param {Scope} scope @param {{now?: number}} [options] @returns {OverviewVM} */
export function buildOverview(snapshot, scope, { now = Date.now() } = {}) { return todo('buildOverview'); }

/**
 * @param {object} snapshot
 * @param {Scope} scope
 * Headless runs of one role and repository fold into a bundle, and sessions under BUNDLE_BELOW_SHARE percent of
 * spend fold into one "Smaller sessions" bundle per role.
 * @param {{now?: number, groupBy?: 'role' | 'device' | 'repo' | null, role?: string | null, running?: boolean, sort?: 'spend' | 'onMain' | 'perLanded' | 'startedAt', limit?: number}} [options]
 * @returns {SessionsVM}
 */
export function buildSessions(snapshot, scope, { now = Date.now(), groupBy = null, role = null, running = false, sort = 'spend', limit = 25 } = {}) { return todo('buildSessions'); }

/** Limits follow the range (past windows) and sources, not the device chips: an account limit belongs to no one computer. @param {object} snapshot @param {Scope} scope @param {{now?: number}} [options] @returns {LimitsVM} */
export function buildLimits(snapshot, scope, { now = Date.now() } = {}) { return todo('buildLimits'); }

/** @param {object} snapshot @param {Scope} scope @param {{now?: number}} [options] @returns {TokensVM} */
export function buildTokens(snapshot, scope, { now = Date.now() } = {}) { return todo('buildTokens'); }

/** @param {object} snapshot @param {Scope} scope @param {{now?: number}} [options] @returns {ScreenTimeVM} */
export function buildScreenTime(snapshot, scope, { now = Date.now() } = {}) { return todo('buildScreenTime'); }

/** @param {object} snapshot @param {Scope} scope @param {{now?: number}} [options] @returns {DriftVM} */
export function buildDrift(snapshot, scope, { now = Date.now() } = {}) { return todo('buildDrift'); }

/** @param {object} snapshot @param {Scope} scope @param {{now?: number}} [options] @returns {SettingsVM} */
export function buildSettings(snapshot, scope, { now = Date.now() } = {}) { return todo('buildSettings'); }

/**
 * One metric over the scope, with its comparison and breakdowns. The Headline and Breakdown blocks,
 * the Overview headline and the MCP query tool all go through this.
 * @param {object} snapshot @param {MetricId} metric @param {Scope} scope @param {{now?: number}} [options]
 * @returns {Num}
 */
export function metric(snapshot, metric, scope, { now = Date.now() } = {}) { return todo('metric'); }

/**
 * The view-model a block draws: the bridge between a json-render element and the builders above.
 * The block's `scope` prop is applied with patchScope first.
 * @param {import('./r2-blocks.mjs').BlockType} type
 * @param {object} props
 * @param {object} snapshot
 * @param {Scope} scope
 * @param {{now?: number}} [options]
 * @returns {object}
 */
export function resolveBlock(type, props, snapshot, scope, { now = Date.now() } = {}) { return todo('resolveBlock'); }

/**
 * The Ask field: a local rules matcher, no model call. Words in the question pick a pinned question
 * or fill a rule's slots (metric, dim, role, range unit, device, source), and the answer is a spec over
 * the same catalog. A question nothing matches gets the pinned questions as suggestions.
 * @param {string} question
 * @param {{savedViews?: SavedView[]}} [options]
 * @returns {AskAnswer}
 */
export function answerQuestion(question, { savedViews = [] } = {}) { return todo('answerQuestion'); }
