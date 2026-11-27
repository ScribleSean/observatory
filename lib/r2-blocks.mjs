// The block catalog: the pieces every round 2 screen is composed from.
// Contract only.
//
// Every screen, built in or composed, is a json-render spec (@json-render/core and @json-render/react,
// pinned to 0.22.0) over this catalog, so one renderer draws them all. A spec names blocks and their
// props. Props are queries (which metric, which breakdown, which scope patch), never numbers or
// names: a block's component asks lib/view-r2.mjs resolveBlock for its view-model at render time. So a
// saved spec holds no usage data, and an agent that composes one needs no access to the data.
//
// lib/r2-catalog.mjs (lane b) turns these typedefs into zod schemas with json-render's defineCatalog.
// app/viewer/r2/registry.tsx (lane c, with lane d's blocks) maps each block to a React component.
// lib/r2-specs.mjs (lane b) holds the built-in specs: one per view and one per pinned question.

/**
 * @typedef {import('./scope.mjs').ScopePatch} ScopePatch
 *
 * @typedef {'spend' | 'merged' | 'onMain' | 'churn' | 'perLanded' | 'noCommitSpend'
 *   | 'tokens' | 'screenTime' | 'grokRequests' | 'sessions' | 'subagents'} MetricId
 *   spend: API-equivalent dollars. merged: branches merged. onMain: commits on main of all commits.
 *   churn: commits not yet on main. perLanded: spend per commit on main. noCommitSpend: spend by sessions
 *   that made no commit in the period. grokRequests: Grok requests, never added to dollars or tokens.
 *
 * @typedef {'device' | 'role' | 'session' | 'repo' | 'model' | 'kind' | 'origin' | 'tool' | 'agent' | 'category'} Dim
 *   agent: one row per model family and per Grok, each in its own unit, never summed (the models-and-agents view).
 *   category: screen time by kind of app.
 *
 * @typedef {'Section' | 'Headline' | 'SpendLandedChart' | 'SessionsTable' | 'Breakdown' | 'LimitMeter'
 *   | 'GrokRequests' | 'Timeline' | 'Flags'} BlockType
 *
 * @typedef {object} SectionProps          The one container. Children are laid out on the 12-column grid.
 * @property {string | null} title
 * @property {1 | 2 | 3 | 4 | 6 | 12} columns  Columns each child spans.
 *
 * @typedef {object} HeadlineProps         One number, its comparison and its in-place breakdown.
 * @property {MetricId} metric
 * @property {boolean} [compare]           Default true.
 * @property {Dim[]} [breakdowns]          Default: every dim the metric supports (METRIC_DIMS).
 * @property {ScopePatch} [scope]
 *
 * @typedef {object} SpendLandedChartProps Spend and commits on main per day (per month for 'year' and 'all').
 * @property {Dim | null} [stack]          Stack spend by 'device', 'model' or 'role'. Default null.
 * @property {ScopePatch} [scope]
 *
 * @typedef {object} SessionsTableProps
 * @property {'role' | 'device' | 'repo' | null} [groupBy]
 * @property {import('./roles.mjs').Role | null} [role]  Only this role.
 * @property {boolean} [running]          Only sessions running now (the Running now panel).
 * @property {'spend' | 'onMain' | 'perLanded' | 'startedAt'} [sort]  Default 'spend'.
 * @property {number} [limit]              Default 25.
 * @property {ScopePatch} [scope]
 *
 * @typedef {object} BreakdownProps        One metric split by one dim, as a ranked bar list.
 * @property {MetricId} metric
 * @property {Dim} dim
 * @property {number} [limit]              Default 8, the rest as Other.
 * @property {ScopePatch} [scope]
 *
 * @typedef {object} LimitMeterProps       One engine's limit windows. Never summed across computers.
 * @property {'claude' | 'codex' | 'grok'} engine
 * @property {string | null} [window]      A window id, else every window of the engine.
 * @property {boolean} [history]           Show the past windows chart. Default false.
 *
 * @typedef {object} GrokRequestsProps     Grok requests per day, and its weekly limit when a reading is cached.
 * @property {ScopePatch} [scope]
 *
 * @typedef {object} TimelineProps         A series over the period.
 * @property {'spend' | 'tokens' | 'screenTime' | 'grokRequests' | 'subagents'} series
 * @property {Dim | null} [by]             Split into lines or stacks.
 * @property {ScopePatch} [scope]
 *
 * @typedef {object} FlagsProps            "Worth a look" lines from lib/ledger-flags.mjs, over the period.
 * @property {number} [limit]              Default 4.
 * @property {ScopePatch} [scope]
 *
 * @typedef {object} SavedView             A spec saved by the optional MCP server (lane f) or built in.
 * @property {string} id                   Lowercase letters, digits and dashes, at most 48.
 * @property {string} title                At most 80 characters.
 * @property {string | null} question      The question it answers, shown under the title.
 * @property {object} spec                 A json-render flat spec ({root, elements}) valid against the catalog.
 * @property {string} savedAt              ISO.
 * @property {'built-in' | 'composed'} origin
 */

export const BLOCK_TYPES = Object.freeze(['Section', 'Headline', 'SpendLandedChart', 'SessionsTable', 'Breakdown', 'LimitMeter', 'GrokRequests', 'Timeline', 'Flags']);
export const METRICS = Object.freeze(['spend', 'merged', 'onMain', 'churn', 'perLanded', 'noCommitSpend', 'tokens', 'screenTime', 'grokRequests', 'sessions', 'subagents']);
export const DIMS = Object.freeze(['device', 'role', 'session', 'repo', 'model', 'kind', 'origin', 'tool', 'agent', 'category']);

// The breakdowns each metric supports. Commits have no model or kind: a commit is not made by a model.
export const METRIC_DIMS = Object.freeze({
  spend: ['device', 'role', 'session', 'repo', 'model', 'kind', 'origin', 'tool'],
  merged: ['device', 'role', 'session', 'repo', 'origin'],
  onMain: ['device', 'role', 'session', 'repo', 'origin'],
  churn: ['device', 'role', 'session', 'repo', 'origin'],
  perLanded: ['device', 'role', 'repo'],
  noCommitSpend: ['device', 'role', 'session', 'model', 'kind', 'origin'],
  tokens: ['device', 'model', 'tool', 'agent'],
  screenTime: ['device', 'category'],
  grokRequests: [],
  sessions: ['device', 'role', 'origin', 'tool'],
  subagents: ['device', 'role', 'kind', 'model'],
});

// Limits a saved spec must keep, checked by lib/r2-catalog.mjs before a spec is saved or drawn.
export const SPEC_LIMITS = Object.freeze({ elements: 40, depth: 4, bytes: 32_000, savedViews: 50 });
