// Round 2 view-models: plain objects the React views and blocks render, one builder per view.
// See docs/R2-PLAN.md.
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

import strings from './strings.json' with { type: 'json' };
import { usd, compact, duration, recordedDays } from './panel-data.mjs';
import { modelLabel } from './ledger-join.mjs';
import { LIMIT_LOW_PERCENT, LIMIT_SPENT_PERCENT } from './glance-limits.mjs';
import { readingFresh } from './freshness.mjs';
import { driftView } from './drift.mjs';
import { lastReading, readAt, shown, shownSentence } from './forecast.mjs';
import { METRIC_DIMS } from './r2-blocks.mjs';
import { sessionNameOverDays, ROLES } from './roles.mjs';
import { composeAnswer } from './r2-specs.mjs';
import {
  HOSTS, SOURCE_IDS, periodOf, comparisonOf, stepRange, patchScope, deviceChips, sourceOn, limitsOn, sourceHasData,
  scopeContext, deviceNameOf, dateIn, validDate,
} from './scope.mjs';

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
 * @property {{value: number, text: string} | null} atLeast  When the sum is Unknown only because some days could not
 *                                          be read, the part that was read, as secondary text: "at least $642, 1 day not
 *                                          read on Tower". The value stays Unknown. Null otherwise.
 *
 * @typedef {object} Coverage               What the period's numbers rest on.
 * @property {string | null} from           The first recorded date across selected computers.
 * @property {{host: string, name: string, dates: string[]}[]} unknownDays  Days a computer could not read.
 * @property {{host: string, name: string, before: string}[]} startsLater  Computers whose history starts inside the period.
 * @property {boolean} sessionsTrimmed      Some days in the period keep totals only (older than SESSION_DAYS).
 * @property {{label: string, unknownDays: {host: string, name: string, dates: string[]}[], startsLater: {host: string, name: string, before: string}[]} | null} compare
 *                                          The comparison period ("vs same days last week"), the days in it a computer could
 *                                          not read, which make every comparison Unknown, and the computers whose history
 *                                          starts inside it, which add less to it than to this period. Null with no comparison.
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
 * @property {{remaining: number | null, resetsAt: string | null, checkedAt: string | null, resets: string | null} | null} weekly  When a reading
 *                                          is cached. `resets` is the stored reset label ("Resets Sat 10 AM"), null when none is stored.
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
 * @property {string} limitsHeadline        The menu bar's line over Limits now, as on the Limits view.
 * @property {FlagLine[]} flags             "Needs you": stale computers, a landed rate that fell, spend with nothing on main.
 * @property {Coverage} coverage
 *
 * @typedef {object} SessionRow
 * @property {'session' | 'bundle'} kind     A bundle folds sessions into one named row: recurring runs with one role and
 *                                          object ("[Runner] job queue (240)"), or the headless runs of one role and
 *                                          repository ("Headless runs in Observatory (2)"). Nothing else is bundled.
 * @property {number} count                 1 for a session.
 * @property {SessionRow[]} children        A bundle's sessions, empty for a session.
 * @property {string} key                   host.tool.id, the same key as the Week page. A bundle's key is stable per role and object or repo.
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
 * @property {number | null} commits        All commits it made in the period, for "no commits" and the flags.
 * @property {'headless' | 'interactive' | null} origin
 * @property {import('./roles.mjs').Role | null} role  The same as name.role, for grouping and filters.
 *
 * @typedef {object} SessionsVM
 * @property {Frame} frame
 * @property {SessionRow[]} rows
 * @property {{key: string, label: string, count: number, rows: SessionRow[], spend: Num, onMain: Num, subagents: number}[] | null} groups  When grouped.
 * @property {{count: number | null, listed: number, other: {count: number, spend: Num} | null, unlisted: {count: number, spend: Num} | null}} totals
 *   `other` is every session not in `rows`. `unlisted` is the part of it kept as totals only, with no name to list.
 * @property {Coverage} coverage
 *
 * @typedef {object} LimitWindowVM
 * @property {string} windowId
 * @property {string} label                 "weekly", "5 hour".
 * @property {number | null} remaining      Percent left. Never a sum. An old reading's last value, with `asOf`.
 * @property {string | null} asOf           "as of Wed 7:20 AM" when `remaining` is an old reading's last value, as every
 *                                          surface words it (lib/forecast.mjs lastReading). Null for a current reading.
 * @property {string | null} offText        Why the window reads Off, in the stored forecast's words. Null while on.
 * @property {string | null} resetsAt
 * @property {string | null} readOn         Device name the reading came from.
 * @property {string | null} checkedAt
 * @property {'ok' | 'low' | 'spent' | 'stale' | 'off' | 'absent'} state  'absent': the provider left the window out of
 *                                          its latest reading, which reads Not reported and nothing else.
 * @property {object | null} forecast       The window's record in the stored forecast (glance.forecast.windows), only while
 *                                          it is current. View-models never compute one.
 * @property {string | null} forecastText   Its stored headline through shown() ("Claude may run out Wed 10 AM", dated once
 *                                          old, "Unknown" when none was stored). Null while the engine is off.
 * @property {boolean} forecastStale        True when the stored forecast is older than a snapshot may be.
 * @property {string | null} forecastResets "Resets Sat 5:45 AM" as stored, null past the reset or with no forecast.
 * @property {{start: string, used: number | null}[]} pastWindows  Ended windows that overlap the period, oldest first.
 *
 * @typedef {object} LimitsVM
 * @property {Frame} frame
 * @property {string} headline              The menu bar's line, exactly as lib/glance-view.mjs shows it.
 * @property {{engine: 'claude' | 'codex' | 'grok', name: string, plan: string | null, headline: string, windows: LimitWindowVM[]}[]} engines
 *                                          `headline` is the engine's stored headline through shown().
 *
 * @typedef {object} TokensVM
 * @property {Frame} frame
 * @property {Num} total                    Tokens. Breakdowns: device, model, tool, agent.
 * @property {Num} spend
 * @property {{date: string, tokens: Num, spend: Num}[]} days
 * @property {AgentRow[]} agents
 * @property {{repo: string, tokens: number | null, spend: number | null}[]} repos  Spend from the ledger history for any range.
 *                                          Tokens only for today, from projectTokens, else null.
 * @property {Part[]} byKind                Input, output, cache read and cache write tokens, each with its share.
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
 * @property {import('./scope.mjs').ScopePatch | null} patch  What the question sets on the scope bar (range, device, source).
 * @property {import('./roles.mjs').Role | null} role  The role filter the question sets, for the "Role: Builder" chip.
 * @property {MetricId | null} metric       The metric the answer sentence is about (answerSentence).
 *
 * The view-model resolveBlock returns for each block type:
 *
 * @typedef {object} SectionVM
 * @property {string | null} title
 * @property {number} columns
 *
 * @typedef {object} HeadlineVM
 * @property {Num} num                      Breakdowns limited to the block's `breakdowns`, no comparison when `compare` is false.
 * @property {Frame} frame
 *
 * @typedef {object} SpendLandedChartVM
 * @property {DayPoint[]} points
 * @property {'day' | 'month'} bucket       Each point is a day, or a month for 'year' and 'all'.
 * @property {Dim | null} stack
 * @property {Frame} frame
 *
 * @typedef {object} BreakdownVM
 * @property {Num} total
 * @property {Dim} dim
 * @property {Part[]} parts                 At most `limit`, then one Other row.
 * @property {Frame} frame
 *
 * @typedef {object} LimitMeterVM
 * @property {LimitsVM['engines'][number] | null} engine  Null when the engine's source is off.
 * @property {boolean} history
 * @property {string} headline            The menu bar's line, as on the Limits view.
 *
 * @typedef {object} TimelineVM
 * @property {TimelineProps['series']} series
 * @property {Dim | null} by
 * @property {'day' | 'month'} bucket
 * @property {{date: string, value: Num}[]} points
 * @property {Frame} frame
 *
 * @typedef {object} FlagsVM
 * @property {FlagLine[]} lines
 * @property {Frame} frame
 *
 * @typedef {import('./r2-blocks.mjs').TimelineProps} TimelineProps
 */

// The label every cross-computer sum carries. The same text as lib/combine.mjs SUM_LABEL, which the
// browser does not load (a test keeps the two equal).
export const SUM_LABEL = 'not deduplicated';
// Rows a breakdown lists before the rest become one Other row.
export const BREAKDOWN_ROWS = 8;
// Overview lists.
export const TOP_SESSIONS = 6, FLAG_LINES = 5;
// "Needs you" thresholds, as the UI spec names them.
export const FLAG_COMMITS = 5, FLAG_NO_COMMIT_USD = 3, FLAG_LANDED_DROP = 8;

const R = strings.r2;
const UNKNOWN = strings.status.unknown;
const LEDGER_TOOLS = ['claude', 'codex'];
const SOURCE_NAMES = { claude: strings.providers.claudeCode, codex: strings.providers.codex, grok: strings.providers.grok };
const ENGINE_SOURCE = { claude: 'claudeLimits', codex: 'quota', grok: 'grokLimits' };
const CROSS_SUMMED = new Set(['spend', 'merged', 'onMain', 'churn', 'perLanded', 'noCommitSpend', 'tokens', 'screenTime']);
const UNITS = { spend: 'usd', merged: 'count', onMain: 'count', churn: 'count', perLanded: 'usdPerChange', noCommitSpend: 'usd',
  tokens: 'tokens', screenTime: 'seconds', grokRequests: 'requests', sessions: 'count', subagents: 'count' };

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const rows = value => Array.isArray(value) ? value.filter(object) : [];
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const time = value => { const at = typeof value === 'string' ? Date.parse(value) : NaN; return Number.isFinite(at) ? at : null; };
// Null when any value is Unknown. An empty list adds nothing.
const total = values => values.some(value => value === null) ? null : values.reduce((sum, value) => sum + value, 0); // zero-ok: an empty sum is nothing recorded
const minus = (a, b) => a === null || b === null ? null : Math.max(0, a - b);
const ratio = (a, b) => a === null || b === null || b === 0 ? null : a / b;
const descending = (a, b) => a === b ? 0 : a === null ? 1 : b === null ? -1 : b - a;
const whole = value => value === null ? UNKNOWN : Math.round(value).toLocaleString('en-US');
const fill = (template, values) => Object.entries(values).reduce((out, [key, value]) => out.replaceAll(`{${key}}`, String(value)), template);
const tokenSum = tokens => total(['input', 'output', 'cacheRead', 'cacheWrite'].map(key => number(tokens?.[key])));
// A time something was read, with its day, as every surface shows it (lib/forecast.mjs readAt).
const clock = (iso, timeZone, now) => time(iso) === null ? UNKNOWN : readAt(new Date(time(iso)).toISOString(), { now, timeZone });

/** A number as text in its unit. */
export function formatValue(unit, value) {
  if (value === null || value === undefined) return UNKNOWN;
  if (unit === 'usd' || unit === 'usdPerChange') return usd(value);
  if (unit === 'tokens') return compact(value);
  if (unit === 'seconds') return duration(value);
  if (unit === 'percent') return `${Math.round(value)}%`;
  return whole(value);
}

// ---------------------------------------------------------------------------------------------------
// What a scope reads: one cell per selected computer and date, holding that computer's ledger days.

function contextFor(snapshot, scope, now) {
  const view = snapshot?.view ?? {};
  const base = scopeContext(snapshot, scope, now);
  // A computer turned off in the hub's settings adds nothing to any number, even with its last reading kept.
  const off = new Set(rows(snapshot?.devices).filter(device => device.state === 'off').map(device => device.host));
  const hosts = HOSTS.filter(host => scope.devices.includes(host) && !off.has(host));
  const tools = LEDGER_TOOLS.filter(tool => scope.sources.includes(tool));
  const aliases = {};
  // The hub's own map wins over a spoke's.
  for (const row of [...rows(view.config)].sort((a, b) => (a.role === 'hub') - (b.role === 'hub')))
    if (object(row.roleAliases)) Object.assign(aliases, row.roleAliases);
  const history = new Map(rows(view.ledgerHistory).map(row => [row.host, row]));
  const names = Object.fromEntries(HOSTS.map(host => [host, deviceNameOf(snapshot, host)]));
  return { snapshot, view, scope, now, ...base, today: dateIn(base.timeZone, now), hosts, tools, aliases, history, names };
}

function cellsFor(ctx, dates) {
  const key = `${dates[0] ?? ''}|${dates.at(-1) ?? ''}|${dates.length}`;
  ctx.cellCache ??= new Map();
  if (!ctx.cellCache.has(key)) ctx.cellCache.set(key, readCells(ctx, dates));
  // A copy, so a caller can attach `dates` or filter without touching the cache.
  return [...ctx.cellCache.get(key)];
}

function readCells(ctx, dates) {
  const cells = [];
  for (const host of ctx.hosts) {
    const row = ctx.history.get(host);
    if (!row || row.status === 'not-connected') continue;
    const read = time(row.checkedAt);
    const readDate = read === null ? null : dateIn(ctx.timeZone, read);
    const byDate = new Map();
    for (const day of rows(row.days)) if (ctx.tools.includes(day.tool)) byDate.set(day.date, [...(byDate.get(day.date) ?? []), day]);
    for (const date of dates) {
      if (row.status !== 'ok') { cells.push({ host, date, unknown: true, days: [], trimmed: false }); continue; }
      if (validDate(row.firstDate) && date < row.firstDate) continue;
      const days = byDate.get(date) ?? [];
      // A day after the computer's last read is not known yet, and a day it could not read is Unknown.
      const unknown = readDate === null || date > readDate || days.some(day => day.status !== 'ok');
      cells.push({ host, date, unknown, days: unknown ? [] : days, trimmed: validDate(row.sessionsFrom) && date < row.sessionsFrom });
    }
  }
  return cells;
}

// Sessions in the cells, joined across days by host, tool and id.
const sessionCache = new WeakMap();
function sessionsIn(ctx, cells) {
  // Cells are rebuilt per call, so the cache keys on the cell objects themselves.
  const key = cells.length ? cells[0] : null;
  const cached = key && sessionCache.get(key)?.find(entry => entry.cells.length === cells.length && entry.cells.every((cell, index) => cell === cells[index]));
  if (cached) return cached.sessions;
  const sessions = joinSessions(ctx, cells);
  if (key) sessionCache.set(key, [...(sessionCache.get(key) ?? []), { cells: [...cells], sessions }]);
  return sessions;
}

function joinSessions(ctx, cells) {
  const joined = new Map();
  const add = (cell, day, entry, compactRow) => {
    const key = `${cell.host}.${day.tool}.${entry.id}`;
    const session = joined.get(key) ?? { key, host: cell.host, tool: day.tool, id: entry.id, days: [], compact: true };
    session.compact = session.compact && compactRow;
    session.days.push(compactRow ? entry : { ...entry, date: cell.date });
    joined.set(key, session);
  };
  for (const cell of cells) for (const day of cell.days) {
    for (const entry of rows(day.sessions)) add(cell, day, entry, false);
    for (const [id, apiUsd, commits, onMain] of Array.isArray(day.other?.rows) ? day.other.rows : [])
      add(cell, day, { id, apiUsd, commits, onMain, compact: true }, true);
  }
  return [...joined.values()].map(session => summarize(ctx, session));
}

function summarize(ctx, session) {
  const full = session.days.filter(day => !day.compact);
  const ships = full.flatMap(day => rows(day.ship));
  const repoShip = new Map();
  for (const ship of ships) {
    const entry = repoShip.get(ship.repo) ?? { commits: [], onMain: [], merges: [] };
    entry.commits.push(number(ship.commits)); entry.onMain.push(number(ship.onMain)); entry.merges.push(number(ship.merges));
    repoShip.set(ship.repo, entry);
  }
  const compactRows = session.days.filter(day => day.compact);
  const commits = total([...ships.map(ship => number(ship.commits)), ...compactRows.map(day => number(day.commits))]);
  const onMain = total([...ships.map(ship => number(ship.onMain)), ...compactRows.map(day => number(day.onMain))]);
  const parts = (key, field) => {
    const map = new Map();
    for (const part of full.flatMap(day => rows(day[key]))) {
      const label = key === 'models' ? modelLabel(part.model) : part.kind;
      const entry = map.get(label) ?? [];
      entry.push(number(part[field]));
      map.set(label, entry);
    }
    return new Map([...map].map(([label, values]) => [label, total(values)]));
  };
  const firsts = full.map(day => time(day.firstAt)).filter(at => at !== null), lasts = full.map(day => time(day.lastAt)).filter(at => at !== null);
  return {
    ...session,
    name: session.compact ? null : sessionNameOverDays(full, { aliases: ctx.aliases }),
    origin: [...full].reverse().map(day => day.origin).find(Boolean) ?? null,
    repo: [...full].reverse().map(day => day.repo).find(Boolean) ?? null,
    usd: total(session.days.map(day => number(day.apiUsd))),
    commits, onMain,
    merges: session.compact ? null : total(ships.map(ship => number(ship.merges))),
    subagents: session.compact ? null : total(full.flatMap(day => rows(day.kinds).map(kind => number(kind.subagents)))),
    tokens: session.compact ? null : total(full.map(day => tokenSum(day.tokens))),
    models: parts('models', 'apiUsd'), kinds: parts('kinds', 'apiUsd'), kindSubagents: parts('kinds', 'subagents'),
    repoShip: new Map([...repoShip].map(([repo, entry]) => [repo, { commits: total(entry.commits), onMain: total(entry.onMain), merges: total(entry.merges) }])),
    repos: [...new Set([...ships.map(ship => ship.repo), ...full.map(day => day.repo)].filter(Boolean))],
    startedAt: firsts.length ? new Date(Math.min(...firsts)).toISOString() : null,
    lastActiveAt: lasts.length ? new Date(Math.max(...lasts)).toISOString() : null,
    // The latest title, only to tell a recurring run (lib/view-r2.mjs folded). Never copied into a row.
    title: [...full].reverse().map(day => day.title).find(title => typeof title === 'string' && title.trim() !== '') ?? null,
  };
}

// ---------------------------------------------------------------------------------------------------
// Metrics over cells.

const DAY_VALUES = {
  spend: day => number(day.apiUsd), merged: day => number(day.ship?.merges), onMain: day => number(day.ship?.onMain),
  commits: day => number(day.ship?.commits), tokens: day => tokenSum(day.tokens), sessions: day => number(day.sessionCount),
  subagents: day => number(day.subagents),
};
const SESSION_VALUES = {
  spend: s => s.usd, merged: s => s.merges, onMain: s => s.onMain, commits: s => s.commits, tokens: s => s.tokens,
  sessions: () => 1, subagents: s => s.subagents,
  noCommitSpend: s => s.commits === null || s.usd === null ? null : s.commits === 0 ? s.usd : 0, // zero-ok: a session with commits spent nothing without them
};

// The sum of a base value (spend, commits and so on) over cells: null when any cell is Unknown.
function cellSum(cells, base) {
  if (cells.some(cell => cell.unknown)) return null;
  return total(cells.flatMap(cell => cell.days.map(DAY_VALUES[base])));
}

// Every metric is built from base sums, so a part and the whole follow one rule.
function fromBases(metric, get) {
  if (metric === 'churn') return minus(get('commits'), get('onMain'));
  if (metric === 'perLanded') return ratio(get('spend'), get('onMain'));
  return get(metric === 'onMain' ? 'onMain' : metric);
}
const baseOf = metric => ({ churn: ['commits', 'onMain'], perLanded: ['spend', 'onMain'], onMain: ['onMain', 'commits'] })[metric] ?? [metric];

function noCommitSpend(ctx, cells) {
  if (cells.some(cell => cell.unknown || cell.trimmed)) return { value: null, count: null };
  const sessions = sessionsIn(ctx, cells);
  const values = sessions.map(SESSION_VALUES.noCommitSpend);
  return { value: total(values), count: values.some(value => value === null) ? null : sessions.filter(s => s.commits === 0).length };
}

// A day whose every session has a row (listed or compact), so sessions over several days can be told apart.
const fullyListed = day => typeof day.sessionCount === 'number' && rows(day.sessions).length + (Array.isArray(day.other?.rows) ? day.other.rows.length : 0) >= day.sessionCount;

// Distinct sessions, a session active on three days counting once. Unknown when a day was not read, or when a
// day kept its count but not its rows, since adding day counts would count a session once per day.
function sessionCount(ctx, cells) {
  if (cells.some(cell => cell.unknown) || !cells.every(cell => cell.days.every(fullyListed))) return null;
  return sessionsIn(ctx, cells).length;
}

// A true lower bound on distinct sessions from the cells that were read: the distinct rows found, or the
// busiest single cell's count (sessions in one cell are distinct), whichever is larger.
function sessionsAtLeast(ctx, cells) {
  const read = cells.filter(cell => !cell.unknown);
  if (!read.length) return null;
  const perCell = read.map(cell => cell.days.reduce((sum, day) => sum + (typeof day.sessionCount === 'number' ? day.sessionCount : 0), 0));
  return Math.max(sessionsIn(ctx, read).length, ...perCell);
}

function metricValue(ctx, cells, metric) {
  if (metric === 'noCommitSpend') return noCommitSpend(ctx, cells).value;
  if (metric === 'screenTime') return screenTotal(ctx, cells.dates ?? null).value;
  if (metric === 'grokRequests') return grokTotal(ctx, cells.dates ?? null).value;
  if (metric === 'sessions') return sessionCount(ctx, cells);
  return fromBases(metric, base => cellSum(cells, base));
}

// Parts of a base value by a key read from each ledger day (model, kind, origin, repo).
function dayParts(cells, read) {
  const known = !cells.some(cell => cell.unknown);
  const map = new Map();
  for (const cell of cells) for (const day of cell.days) for (const [key, label, value] of read(day, cell)) {
    const entry = map.get(key) ?? { key, label, values: [] };
    entry.values.push(value);
    map.set(key, entry);
  }
  return [...map.values()].map(entry => ({ key: entry.key, label: entry.label, value: known ? total(entry.values) : null }));
}

const DAY_DIMS = {
  device: null, tool: null,
  model: { spend: day => rows(day.models).map(part => [modelLabel(part.model), modelLabel(part.model), number(part.apiUsd)]),
    tokens: day => rows(day.models).map(part => [modelLabel(part.model), modelLabel(part.model), number(part.outputTokens)]) },
  kind: { spend: day => rows(day.kinds).map(part => [part.kind, kindName(part.kind), number(part.apiUsd)]),
    subagents: day => rows(day.kinds).map(part => [part.kind, kindName(part.kind), number(part.subagents)]) },
  origin: { spend: day => rows(day.origins).map(part => [part.origin, originName(part.origin), number(part.apiUsd)]),
    sessions: day => rows(day.origins).map(part => [part.origin, originName(part.origin), number(part.sessions)]) },
  repo: Object.fromEntries(['spend', 'commits', 'onMain', 'merged'].map(base => [base,
    day => rows(day.repos).map(part => [part.repo, part.repo, number(base === 'spend' ? part.apiUsd : base === 'merged' ? part.merges : part[base])])])),
};
DAY_DIMS.agent = DAY_DIMS.model;
const KIND_NAMES = { search: 'taskSearch', research: 'taskResearch', review: 'taskReview', design: 'taskDesign', build: 'taskBuild', test: 'taskTest', write: 'taskWrite' };
const kindName = kind => Object.hasOwn(KIND_NAMES, kind) ? strings.week[KIND_NAMES[kind]] : kind === 'main' ? R.kindMain : R.kindOther;
const originName = origin => origin === 'headless' ? R.originHeadless : origin === 'interactive' ? R.originInteractive : UNKNOWN;

// The parts of one metric by one dim, before sorting and the Other row.
function rawParts(ctx, cells, metric, dim) {
  if (dim === 'device' || dim === 'tool') {
    const keys = dim === 'device' ? ctx.hosts.filter(host => cells.some(cell => cell.host === host)) : ctx.tools;
    return keys.map(key => {
      const own = dim === 'device' ? cells.filter(cell => cell.host === key)
        : Object.assign(cells.map(cell => ({ ...cell, days: cell.days.filter(day => day.tool === key) })), { dates: cells.dates });
      if (dim === 'device') own.dates = cells.dates;
      const value = metric === 'screenTime' || metric === 'grokRequests' ? null : metricValue(ctx, own, metric);
      return { key, label: dim === 'device' ? ctx.names[key] : SOURCE_NAMES[key], value };
    }).filter(part => dim === 'device' || part.value !== 0);
  }
  if (dim === 'role' || dim === 'session' || (dim === 'origin' && !['spend', 'sessions'].includes(metric))) return sessionParts(ctx, cells, metric, dim);
  if (metric === 'noCommitSpend' && (dim === 'model' || dim === 'kind')) return noCommitParts(ctx, cells, dim);
  const table = DAY_DIMS[dim];
  if (!table) return [];
  const bases = baseOf(metric);
  if (bases.some(base => !table[base])) return [];
  const byBase = Object.fromEntries(bases.map(base => [base, new Map(dayParts(cells, table[base]).map(part => [part.key, part]))]));
  const keys = [...new Set(Object.values(byBase).flatMap(map => [...map.keys()]))];
  return keys.map(key => {
    const get = base => byBase[base].has(key) ? byBase[base].get(key).value : cells.some(cell => cell.unknown) ? null : 0; // zero-ok: a repo or model absent from a known day had none of it, while an unpriced one stays Unknown
    const label = Object.values(byBase).map(map => map.get(key)?.label).find(Boolean) ?? key;
    return { key, label, value: fromBases(metric, get) };
  });
}

// Parts from sessions (role, session, origin of commits). Sessions with no role, and what the listed
// sessions do not cover (days that keep totals only, sessions with only a compact row), are one Other part.
function sessionParts(ctx, cells, metric, dim) {
  const known = !cells.some(cell => cell.unknown);
  const sessions = sessionsIn(ctx, cells).filter(s => !s.compact);
  const groups = new Map();
  for (const s of sessions) {
    const key = dim === 'role' ? s.name.role ?? 'other' : dim === 'origin' ? s.origin ?? 'unknown' : s.key;
    const label = dim === 'role' ? s.name.role ?? R.other : dim === 'origin' ? originName(s.origin) : s.name.display;
    const entry = groups.get(key) ?? { key, label, sessions: [] };
    entry.sessions.push(s);
    groups.set(key, entry);
  }
  const value = (list, base) => known ? total(list.map(SESSION_VALUES[base])) : null;
  const parts = [...groups.values()].map(group => ({ key: group.key, label: group.label,
    value: metric === 'noCommitSpend' ? value(group.sessions, 'noCommitSpend') : fromBases(metric, base => value(group.sessions, base)) }));
  if (metric !== 'perLanded' && metric !== 'noCommitSpend') {
    const whole = metricValue(ctx, cells, metric), listed = total(parts.map(part => part.value));
    const left = whole === null || listed === null ? null : whole - listed;
    if (left === null ? !known : left > (metric === 'spend' ? 0.005 : 0)) parts.push({ key: 'other', label: R.other, value: left });
  }
  return parts;
}

// Spend of sessions that made no commit, by the models or kinds of work they spent it on.
function noCommitParts(ctx, cells, dim) {
  const known = !cells.some(cell => cell.unknown || cell.trimmed);
  const map = new Map();
  for (const s of sessionsIn(ctx, cells).filter(s => !s.compact && s.commits === 0))
    for (const [key, value] of dim === 'model' ? s.models : s.kinds) map.set(key, [...(map.get(key) ?? []), value]);
  return [...map].map(([key, values]) => ({ key, label: dim === 'kind' ? kindName(key) : key, value: known ? total(values) : null }));
}

function finishParts(parts, whole, limit, unit) {
  // Other is one row and the last one: parts already called Other join the rows past the limit.
  const isOther = part => part.key === 'other' && part.label === R.other;
  const sorted = parts.filter(part => !isOther(part)).sort((a, b) => descending(a.value, b.value) || String(a.label).localeCompare(String(b.label)));
  const shown = sorted.slice(0, limit), rest = [...sorted.slice(limit), ...parts.filter(isOther)];
  if (rest.length) shown.push({ key: 'other', label: R.other, value: total(rest.map(part => part.value)) });
  const sum = total(shown.map(part => part.value));
  return shown.map(part => {
    const of = whole ?? sum;
    return { key: part.key, label: part.label, value: part.value, text: formatValue(unit, part.value),
      share: part.value === null || of === null || of === 0 ? null : part.value / of * 100 };
  });
}

function breakdowns(ctx, cells, metric, value, dims = METRIC_DIMS[metric], limit = BREAKDOWN_ROWS) {
  const unit = UNITS[metric];
  const out = {};
  // A part of a rate is not a share of it, and output tokens by model are a part of output tokens only.
  const shareOf = metric === 'perLanded' ? undefined : value;
  for (const dim of dims.filter(dim => METRIC_DIMS[metric].includes(dim))) {
    if (metric === 'screenTime') out[dim] = finishParts(screenParts(ctx, cells.dates, dim), shareOf, limit, unit);
    else out[dim] = finishParts(rawParts(ctx, cells, metric, dim), metric === 'tokens' && (dim === 'model' || dim === 'agent') ? null : shareOf, limit, unit);
  }
  return out;
}

function deltaText(metric, value, previous, of, previousOf, comparison, unit) {
  if (!comparison) return null;
  const label = comparison.label;
  if (value === null || previous === null) return fill(R.compareUnknown, { label });
  if (metric === 'onMain' || metric === 'churn') {
    const rate = ratio(metric === 'onMain' ? value : value, of), before = ratio(previous, previousOf);
    if (rate !== null && before !== null)
      return fill(metric === 'onMain' ? R.landedWas : R.churnWas, { rate: Math.round(rate * 100), was: Math.round(before * 100) });
  }
  if (metric === 'perLanded') return fill(R.compareValue, { label, value: formatValue(unit, previous) });
  const change = value - previous;
  if (unit === 'count' || unit === 'requests') return change === 0 ? fill(R.noChange, { label }) : `${change > 0 ? '+' : '-'}${whole(Math.abs(change))} ${label}`;
  if (previous === 0) return change === 0 ? fill(R.noChange, { label }) : `+${formatValue(unit, change)} ${label}`;
  const percent = Math.round(change / previous * 100);
  return percent === 0 ? fill(R.noChange, { label }) : fill(percent > 0 ? R.up : R.down, { percent: Math.abs(percent), label });
}

function ofFor(ctx, cells, metric) {
  if (metric === 'onMain' || metric === 'churn') return cellSum(cells, 'commits');
  if (metric === 'noCommitSpend') return cellSum(cells, 'spend');
  return null;
}

function numText(metric, value, of, unit, cells) {
  if (metric === 'perLanded' && value === null && of === null && cells && cellSum(cells, 'onMain') === 0) return R.noneLanded;
  if (metric === 'onMain' && value !== null && of !== null) return fill(R.ofTotal, { value: whole(value), total: whole(of) });
  return formatValue(unit, value);
}

const withDates = (cells, dates) => Object.assign(cells, { dates });

function hostsWithData(ctx, metric, dates) {
  if (metric === 'screenTime') return screenHosts(ctx).length;
  if (metric === 'grokRequests') return 1;
  return new Set(cellsFor(ctx, dates).map(cell => cell.host)).size;
}

// Metrics that add up day by day, so the days that were read give a lower bound when others were not.
// Sessions do not: one session runs over several days, so their lower bound counts distinct sessions instead.
const ADDITIVE = { spend: 'spend', merged: 'merged', onMain: 'onMain', tokens: 'tokens', subagents: 'subagents' };

/** The part of an Unknown sum that was read, and which days were not. Null when the sum is known or has no such part. */
function knownPart(ctx, cells, metric, unit) {
  const base = ADDITIVE[metric];
  if ((!base && metric !== 'sessions') || !cells.some(cell => cell.unknown)) return null;
  const read = cells.filter(cell => !cell.unknown);
  if (!read.length) return null;
  const value = base ? total(read.flatMap(cell => cell.days.map(DAY_VALUES[base]))) : sessionsAtLeast(ctx, cells);
  if (value === null) return null;
  const missing = new Map();
  for (const cell of cells.filter(cell => cell.unknown)) missing.set(cell.host, (missing.get(cell.host) ?? 0) + 1);
  const days = [...missing].map(([host, count]) => fill(count === 1 ? R.dayNotRead : R.daysNotRead, { count, name: ctx.names[host] ?? host }));
  return { value, text: fill(R.atLeast, { value: formatValue(unit, value), missing: days.join(', ') }) };
}

function buildNum(ctx, metric, { dates = ctx.period.dates, compare = true, dims = METRIC_DIMS[metric], limit = BREAKDOWN_ROWS } = {}) {
  const unit = UNITS[metric];
  const cells = withDates(cellsFor(ctx, dates), dates);
  const value = metricValue(ctx, cells, metric);
  const of = ofFor(ctx, cells, metric);
  const comparison = compare && dates === ctx.period.dates ? ctx.comparison : null;
  let previous = null, previousOf = null;
  if (comparison) {
    const before = withDates(cellsFor(ctx, comparison.period.dates), comparison.period.dates);
    previous = metricValue(ctx, before, metric);
    previousOf = ofFor(ctx, before, metric);
  }
  const showCompare = compare && dates === ctx.period.dates && ctx.period.unit !== 'all';
  const notes = [];
  if (['merged', 'onMain', 'churn', 'perLanded', 'noCommitSpend'].includes(metric)) notes.push(R.noteEstimated);
  if (metric === 'tokens' && (dims.includes('model') || dims.includes('agent'))) notes.push(R.noteOutputByModel);
  if (metric === 'noCommitSpend') { const count = noCommitSpend(ctx, cells).count; if (count !== null) notes.push(fill(R.noteSessions, { count })); }
  return {
    metric, unit, value, text: numText(metric, value, of, unit, cells), of,
    sumLabel: CROSS_SUMMED.has(metric) && hostsWithData(ctx, metric, dates) > 1 ? SUM_LABEL : null,
    previous, delta: value === null || previous === null ? null : value - previous,
    deltaText: showCompare ? (comparison ? deltaText(metric, value, previous, of, previousOf, comparison, unit) : R.noEarlierData) : null,
    breakdowns: breakdowns(ctx, cells, metric, value, dims, limit),
    note: notes.length ? notes.join(strings.formats.separator) : null,
    atLeast: value === null ? knownPart(ctx, cells, metric, unit) : null,
  };
}

// A plain number with no comparison, for rows and chart points.
function plainNum(metric, unit, value, { of = null, breakdowns: parts = {}, text = null } = {}) {
  return { metric, unit, value, text: text ?? formatValue(unit, value), of, sumLabel: null, previous: null, delta: null, deltaText: null, breakdowns: parts, note: null, atLeast: null };
}

// ---------------------------------------------------------------------------------------------------
// Screen time, from each computer's activity history. A computer with screen time off adds nothing.

function screenHosts(ctx) {
  return ctx.hosts.filter(host => rows(ctx.view.config).find(row => row.host === host)?.sources?.screenTime === true);
}

function screenDays(ctx, dates) {
  const single = dates.length === 1;
  const out = [];
  for (const host of screenHosts(ctx)) {
    const archive = rows(ctx.view.activityHistory).find(row => row.host === host);
    const read = time(archive?.asOf ?? archive?.checkedAt);
    const readDate = read === null ? null : dateIn(ctx.timeZone, read);
    const byDate = new Map(recordedDays(ctx.view, 'activity', host).map(day => [day.date, day]));
    for (const date of dates) {
      const day = byDate.get(date);
      const late = readDate === null || date > readDate;
      // A day not read yet is Unknown in any period. A single day with tracking off is Unknown too, while a longer
      // period adds the tracked days and leaves the untracked one out.
      if (late || day?.untracked) { if (single || late) out.push({ host, date, seconds: null, day: null, tracked: late ? null : false }); continue; }
      if (day) out.push({ host, date, seconds: number(day.seconds), day, tracked: true });
    }
  }
  return out;
}

/** "at least 12h 3m, 1 day not read on Tower" for a sum with unread days, or null when it is known or nothing was read. */
function atLeastText(unit, known, missing) {
  if (!missing.length || known === null || known <= 0) return null; // zero-ok: nothing read leaves no known part
  const days = missing.map(([name, count]) => fill(count === 1 ? R.dayNotRead : R.daysNotRead, { count, name }));
  return { value: known, text: fill(R.atLeast, { value: formatValue(unit, known), missing: days.join(', ') }) };
}

function screenTotal(ctx, dates) {
  const list = screenDays(ctx, dates ?? ctx.period.dates);
  const value = total(list.map(entry => entry.seconds));
  const missing = new Map();
  for (const entry of list.filter(entry => entry.seconds === null)) missing.set(entry.host, (missing.get(entry.host) ?? 0) + 1);
  const atLeast = value === null ? atLeastText('seconds', total(list.filter(entry => entry.seconds !== null).map(entry => entry.seconds)), [...missing].map(([host, count]) => [ctx.names[host] ?? host, count])) : null;
  return { value, list, atLeast };
}

function screenParts(ctx, dates, dim) {
  const list = screenDays(ctx, dates ?? ctx.period.dates);
  if (dim === 'device') return screenHosts(ctx).map(host => ({ key: host, label: ctx.names[host], value: total(list.filter(entry => entry.host === host).map(entry => entry.seconds)) }));
  const known = list.every(entry => entry.seconds !== null);
  const map = new Map();
  for (const entry of list) for (const [category, seconds] of Object.entries(entry.day?.categories ?? {}))
    if (number(seconds) !== null) map.set(category, (map.get(category) ?? 0) + seconds); // zero-ok: starts a running sum
  // A kind of app with no time in the range is not a row.
  return [...map].filter(([, value]) => value > 0).map(([key, value]) => ({ key, label: key, value: known ? value : null }));
}

// ---------------------------------------------------------------------------------------------------
// Grok requests, from the request log the limits source keeps. Never added to dollars or tokens.

function grokDays(ctx, dates) {
  const grok = ctx.view.grokLimits;
  const log = rows(grok?.requests?.days).filter(day => validDate(day.date)).sort((a, b) => a.date.localeCompare(b.date));
  const counted = time(grok?.requests?.checkedAt);
  const zone = typeof grok?.requests?.timeZone === 'string' ? grok.requests.timeZone : ctx.timeZone;
  const lastDate = counted === null ? null : dateIn(zone, counted);
  const firstDate = log[0]?.date ?? null;
  const byDate = new Map(log.map(day => [day.date, day]));
  return dates.map(date => {
    // Days before the log starts add nothing. A day after the last count is not known yet.
    if (firstDate === null || date < firstDate) return { date, value: null, counted: false };
    if (lastDate === null || date > lastDate) return { date, value: null, counted: true };
    const row = byDate.get(date);
    // zero-ok: the log lists every day with a request, so a day it does not list had none.
    return { date, value: row ? (Number.isSafeInteger(row.count) && row.count >= 0 ? row.count : null) : 0, counted: true };
  });
}

function grokTotal(ctx, dates) {
  const days = grokDays(ctx, dates ?? ctx.period.dates);
  const counted = days.filter(day => day.counted);
  const value = total(counted.map(day => day.value));
  const unread = counted.filter(day => day.value === null).length;
  const atLeast = value === null ? atLeastText('requests', total(counted.filter(day => day.value !== null).map(day => day.value)), unread ? [[SOURCE_NAMES.grok, unread]] : []) : null;
  return { value, days, atLeast };
}

function grokVM(ctx) {
  if (!ctx.scope.sources.includes('grok') || !limitsOn(ctx.snapshot, 'grok')) return null;
  const { value, days, atLeast } = grokTotal(ctx, ctx.period.dates);
  const weekly = rows(ctx.view.grokLimits?.windows).find(window => window.durationMinutes === 10080 || window.window === 'weekly');
  return { total: { ...plainNum('grokRequests', 'requests', value), atLeast }, days: days.map(day => ({ date: day.date, value: day.value })),
    weekly: weekly ? { remaining: number(weekly.remainingPercent), resetsAt: weekly.resetsAt ?? null, checkedAt: weekly.checkedAt ?? ctx.view.grokLimits?.checkedAt ?? null,
      resets: storedForecast(ctx.snapshot, 'grok', weekly.window, ctx.now).resets } : null };
}

// ---------------------------------------------------------------------------------------------------
// Frame and coverage.

/** @param {object} snapshot @param {Scope} scope @param {{now?: number}} [options] @returns {Frame} */
export function buildFrame(snapshot, scope, { now = Date.now() } = {}) {
  return frameOf(prepared(snapshot, scope, now));
}

function frameOf(ctx) {
  if (ctx.frame) return ctx.frame;
  const { snapshot, scope } = ctx;
  const devices = deviceChips(snapshot, scope, { now: ctx.now });
  ctx.frame = {
    scope, period: ctx.period, comparison: ctx.comparison, devices,
    sources: SOURCE_IDS.map(id => ({ id, name: SOURCE_NAMES[id], on: sourceOn(snapshot, id), hasData: sourceHasData(snapshot, id, scope.devices, ctx.period.dates) })),
    steps: { back: stepRange(scope.range, -1, ctx), forward: stepRange(scope.range, 1, ctx) },
    timeZone: ctx.timeZone, generatedAt: typeof snapshot?.generatedAt === 'string' ? snapshot.generatedAt : new Date(ctx.now).toISOString(),
    stale: devices.some(chip => chip.selected && chip.state === 'stale' && !chip.off),
  };
  return ctx.frame;
}

const unknownDays = (ctx, cells) => ctx.hosts.map(host => ({ host, name: ctx.names[host], dates: cells.filter(cell => cell.host === host && cell.unknown).map(cell => cell.date) }))
  .filter(entry => entry.dates.length);

function coverageOf(ctx) {
  const cells = cellsFor(ctx, ctx.period.dates);
  const rowsOf = ctx.hosts.map(host => ctx.history.get(host)).filter(row => row?.status === 'ok');
  const startsAfter = first => rowsOf.filter(row => validDate(row.firstDate) && row.firstDate > first)
    .map(row => ({ host: row.host, name: ctx.names[row.host], before: row.firstDate }));
  return {
    from: ctx.firstDate,
    unknownDays: unknownDays(ctx, cells),
    startsLater: startsAfter(ctx.period.first),
    sessionsTrimmed: cells.some(cell => cell.trimmed),
    compare: ctx.comparison ? { label: ctx.comparison.label, unknownDays: unknownDays(ctx, cellsFor(ctx, ctx.comparison.period.dates)),
      startsLater: startsAfter(ctx.comparison.period.first) } : null,
  };
}

function prepared(snapshot, scope, now) {
  const ctx = contextFor(snapshot, scope, now);
  ctx.period = periodOf(scope.range, ctx);
  ctx.comparison = comparisonOf(scope.range, ctx);
  return ctx;
}

// ---------------------------------------------------------------------------------------------------
// Sessions.

function liveSessions(ctx) {
  const live = new Map();
  if (!ctx.period.current) return live;
  for (const row of rows(ctx.view.ledger)) {
    if (!ctx.hosts.includes(row.host)) continue;
    for (const tool of rows(row.tools)) for (const period of rows(tool.periods)) for (const session of rows(period.sessions))
      if (session.running === true) live.set(`${row.host}.${tool.tool}.${session.id}`, session.state ?? null);
  }
  return live;
}

function partsFromMap(map, unit, whole, limit = BREAKDOWN_ROWS, label = key => key) {
  return finishParts([...map].map(([key, value]) => ({ key, label: label(key), value })), whole, limit, unit);
}

function sessionRow(ctx, s, spendInScope, live) {
  const perLanded = ratio(s.usd, s.onMain);
  const running = live.has(s.key);
  const state = running ? live.get(s.key) : null;
  return {
    kind: 'session', count: 1, children: [], key: s.key, host: s.host, device: ctx.names[s.host], tool: s.tool, name: s.name,
    models: [...s.models].sort((a, b) => descending(a[1], b[1])).map(([label]) => label),
    subagents: s.subagents ?? 0, // zero-ok: a listed session always reports its subagents, null only for compact rows that are never rows
    spend: plainNum('spend', 'usd', s.usd, { breakdowns: { model: partsFromMap(s.models, 'usd', s.usd), kind: partsFromMap(s.kinds, 'usd', s.usd, BREAKDOWN_ROWS, kindName) } }),
    share: s.usd === null || !spendInScope ? null : s.usd / spendInScope * 100,
    onMain: plainNum('onMain', 'count', s.onMain, { of: s.commits, text: s.commits === 0 ? R.noCommits : numText('onMain', s.onMain, s.commits, 'count'),
      breakdowns: { repo: partsFromMap(new Map([...s.repoShip].map(([repo, ship]) => [repo, ship.onMain])), 'count', s.onMain) } }),
    merged: plainNum('merged', 'count', s.merges),
    perLanded: plainNum('perLanded', 'usdPerChange', perLanded, { text: perLanded === null && s.onMain === 0 ? R.noneLanded : null }),
    startedAt: s.startedAt, lastActiveAt: s.lastActiveAt, running, state, needsYou: running && state === 'waiting', repos: s.repos,
    commits: s.commits, origin: s.origin, role: s.name.role,
  };
}

function bundle(ctx, members, spendInScope, { role, object, key }) {
  const sum = key => total(members.map(row => row[key]));
  const usdValue = total(members.map(row => row.spend.value)), onMain = total(members.map(row => row.onMain.value));
  const commits = total(members.map(row => row.onMain.of)), perLanded = ratio(usdValue, onMain);
  const hosts = [...new Set(members.map(row => row.host))], tools = [...new Set(members.map(row => row.tool))];
  const merge = key => { const map = new Map(); for (const row of members) for (const part of row.spend.breakdowns[key] ?? []) map.set(part.label, (map.get(part.label) ?? 0) + (part.value ?? 0)); return map; }; // zero-ok: bundle parts sum known session parts
  return {
    kind: 'bundle', count: members.length, children: members, key,
    host: hosts.length === 1 ? hosts[0] : '', device: hosts.length === 1 ? ctx.names[hosts[0]] : R.severalDevices, tool: tools[0],
    name: { role, roleSource: members[0].name.roleSource, object, display: role ? `[${role}] ${object}` : object, subtitle: null },
    models: [...new Set(members.flatMap(row => row.models))], subagents: sum('subagents'),
    spend: plainNum('spend', 'usd', usdValue, { breakdowns: { model: partsFromMap(merge('model'), 'usd', usdValue), kind: partsFromMap(merge('kind'), 'usd', usdValue) } }),
    share: usdValue === null || !spendInScope ? null : usdValue / spendInScope * 100,
    onMain: plainNum('onMain', 'count', onMain, { of: commits, text: commits === 0 ? R.noCommits : numText('onMain', onMain, commits, 'count') }),
    merged: plainNum('merged', 'count', total(members.map(row => row.merged.value))),
    perLanded: plainNum('perLanded', 'usdPerChange', perLanded, { text: perLanded === null && onMain === 0 ? R.noneLanded : null }),
    startedAt: members.map(row => row.startedAt).filter(Boolean).sort()[0] ?? null,
    lastActiveAt: members.map(row => row.lastActiveAt).filter(Boolean).sort().at(-1) ?? null,
    running: members.some(row => row.running), state: null, needsYou: members.some(row => row.needsYou),
    repos: [...new Set(members.flatMap(row => row.repos))], commits, origin: members[0].origin, role,
  };
}

// A run that recurs: at least this many sessions in range with the same role and the same object from their titles.
export const RECURRING_MIN = 3;
// "Job queue", "job  queue" and "job queue." are one object.
export const recurringObject = object => String(object ?? '').toLowerCase().replace(/[\s\p{P}]+$/u, '').replace(/^[\s\p{P}]+/u, '').replace(/\s+/g, ' ');

// Sessions fold in two ways, and every other session is its own row.
// 1. Recurring runs: sessions with the same role and normalized object, RECURRING_MIN or more of them, such as a
//    scheduled queue runner, fold into one row named like its runs ("[Runner] job queue"). The object must come from
//    the title: a day or repository put in for a missing one names nothing that recurs.
// 2. Headless runs of one role and repository fold into one named row ("Headless runs in Observatory").
function folded(ctx, listed, sessionRows, spendInScope) {
  const recurring = new Map();
  sessionRows.forEach((row, index) => {
    const object = recurringObject(row.name.object), title = recurringObject(listed[index].title);
    if (!object || !title.includes(object)) return;
    const key = `${row.role ?? ''}|${object}`;
    recurring.set(key, [...(recurring.get(key) ?? []), row]);
  });
  const out = [], grouped = new Set(), headless = new Map();
  for (const [key, members] of recurring) {
    if (members.length < RECURRING_MIN) continue;
    const latest = [...members].sort((a, b) => String(b.lastActiveAt ?? '').localeCompare(String(a.lastActiveAt ?? '')))[0];
    out.push(bundle(ctx, members, spendInScope, { role: latest.role, object: latest.name.object, key: `bundle.recurring.${key}` }));
    for (const row of members) grouped.add(row);
  }
  for (const row of sessionRows) {
    if (grouped.has(row)) continue;
    if (row.origin !== 'headless') { out.push(row); continue; }
    const key = `${row.role}|${row.repos[0] ?? ''}`;
    headless.set(key, [...(headless.get(key) ?? []), row]);
  }
  for (const members of headless.values()) {
    const role = members[0].role, repo = members[0].repos[0] ?? null;
    out.push(members.length > 1 ? bundle(ctx, members, spendInScope, { role, object: fill(R.headlessRunsIn, { repo: repo ?? UNKNOWN }), key: `bundle.headless.${role ?? 'none'}.${repo ?? ''}` }) : members[0]);
  }
  return out;
}

const SORTS = {
  spend: (a, b) => descending(a.spend.value, b.spend.value),
  onMain: (a, b) => descending(a.onMain.value, b.onMain.value),
  perLanded: (a, b) => descending(a.perLanded.value, b.perLanded.value),
  startedAt: (a, b) => String(b.startedAt ?? '').localeCompare(String(a.startedAt ?? '')),
};

function sessionsVM(ctx, { groupBy = null, role = null, running = false, sort = 'spend', limit = 25 } = {}) {
  const cells = withDates(cellsFor(ctx, ctx.period.dates), ctx.period.dates);
  const spendInScope = cellSum(cells, 'spend');
  const live = liveSessions(ctx);
  const all = sessionsIn(ctx, cells);
  const listed = all.filter(s => !s.compact);
  let list = folded(ctx, listed, listed.map(s => sessionRow(ctx, s, spendInScope, live)), spendInScope);
  if (ROLES.includes(role)) list = list.filter(row => row.role === role);
  if (running) list = list.filter(row => row.running);
  list.sort((a, b) => (SORTS[sort] ?? SORTS.spend)(a, b) || a.key.localeCompare(b.key));
  const shown = list.slice(0, Math.max(0, limit));
  const rest = list.slice(shown.length);
  // A session kept as totals only has no role and no state, so a filter leaves it out.
  const unlisted = ROLES.includes(role) || running ? [] : all.filter(s => s.compact);
  const otherSpend = total([...rest.map(row => row.spend.value), ...unlisted.map(s => s.usd)]);
  const restCount = rest.reduce((sum, row) => sum + row.count, 0) + unlisted.length;
  const groupKey = row => groupBy === 'role' ? row.role ?? 'none' : groupBy === 'device' ? row.host || 'several' : row.repos[0] ?? 'none';
  const groupLabel = (key, row) => groupBy === 'role' ? row.role ?? R.other : groupBy === 'device' ? row.device : key === 'none' ? R.noRepo : key;
  let groups = null;
  if (['role', 'device', 'repo'].includes(groupBy)) {
    const map = new Map();
    for (const row of list) {
      const key = groupKey(row);
      const group = map.get(key) ?? { key, label: groupLabel(key, row), rows: [] };
      group.rows.push(row);
      map.set(key, group);
    }
    groups = [...map.values()].map(group => {
      const spend = total(group.rows.map(row => row.spend.value)), onMain = total(group.rows.map(row => row.onMain.value));
      return { key: group.key, label: group.label, count: group.rows.reduce((sum, row) => sum + row.count, 0), rows: group.rows,
        spend: plainNum('spend', 'usd', spend), onMain: plainNum('onMain', 'count', onMain, { of: total(group.rows.map(row => row.onMain.of)) }),
        subagents: group.rows.reduce((sum, row) => sum + row.subagents, 0) };
    }).sort((a, b) => descending(a.spend.value, b.spend.value));
  }
  const counted = cells.some(cell => cell.unknown || cell.trimmed) ? null : all.length;
  return {
    rows: shown, groups,
    totals: { count: role || running ? list.reduce((sum, row) => sum + row.count, 0) : counted, listed: shown.length,
      other: restCount ? { count: restCount, spend: plainNum('spend', 'usd', otherSpend) } : null,
      unlisted: unlisted.length ? { count: unlisted.length, spend: plainNum('spend', 'usd', total(unlisted.map(s => s.usd))) } : null },
  };
}

/**
 * @param {object} snapshot
 * @param {Scope} scope
 * The rows are the top `limit` by the sort, and `totals.other` counts the rest. Recurring runs (RECURRING_MIN or
 * more titled sessions with one role and object) and headless runs of one role and repository fold into named bundles. `totals.unlisted` is the part of the rest kept as totals only, which no
 * limit can list.
 * @param {{now?: number, groupBy?: 'role' | 'device' | 'repo' | null, role?: string | null, running?: boolean, sort?: 'spend' | 'onMain' | 'perLanded' | 'startedAt', limit?: number}} [options]
 * @returns {SessionsVM}
 */
export function buildSessions(snapshot, scope, { now = Date.now(), groupBy = null, role = null, running = false, sort = 'spend', limit = 25 } = {}) {
  const ctx = prepared(snapshot, scope, now);
  return { frame: frameOf(ctx), ...sessionsVM(ctx, { groupBy, role, running, sort, limit }), coverage: coverageOf(ctx) };
}

// ---------------------------------------------------------------------------------------------------
// Limits. Account limits belong to no one computer: each shows once, with the computer it was read on.

const storedOutlook = snapshot => object(snapshot?.glance?.forecast) ? snapshot.glance.forecast : null;

/**
 * The forecast the hub made once and stored as glance.forecast (lib/forecast.mjs, called from lib/combine.mjs), for
 * one window, or for the engine when `windowId` is null. It is shown through shown(), the rule every surface uses:
 * the stored words while current, dated once old, Unknown past the reset or when none were stored. View-models
 * never forecast or word a run-out themselves.
 * @returns {{forecast: object | null, text: string, stale: boolean, resets: string | null}} `forecast` is the stored
 *   record only while it is current, so nothing projects from an old one.
 */
export function storedForecast(snapshot, engine, windowId, now) {
  const outlook = storedOutlook(snapshot);
  const record = outlook ? rows(windowId === null ? outlook.engines : outlook.windows).find(row => row.engine === engine && (windowId === null || row.windowId === windowId)) ?? null : null;
  const said = shown(outlook, record, now);
  return { forecast: said.stale ? null : record, text: said.headline, stale: said.stale, resets: said.resets };
}

/** The menu bar's line, as lib/glance-view.mjs shows it: the scarcest engine's stored headline, else the stored sentence. */
export function menuHeadline(snapshot, now) {
  const outlook = storedOutlook(snapshot);
  const lead = outlook ? rows(outlook.engines).find(engine => engine.engine === outlook.scarce?.engine) ?? null : null;
  return lead ? shown(outlook, lead, now).headline : shownSentence(outlook, now) ?? UNKNOWN;
}

// Readings of one window from the stored limit history, merged across computers (account wide).
function storedReadings(view, provider, windowId, durationMinutes) {
  const seen = new Set(), out = [];
  for (const point of rows(view?.limitHistory).flatMap(row => rows(row.points))) {
    if (point.p !== provider || point.w !== windowId || (durationMinutes !== null && typeof point.d === 'number' && point.d !== durationMinutes)) continue;
    const at = time(point.t), remaining = number(point.r);
    if (at === null || remaining === null || seen.has(at)) continue;
    seen.add(at);
    out.push({ at, remaining, resetsAt: time(point.x) });
  }
  return out;
}

// Off as the settings and the source say it: turned off, signed out, not connected, or a free plan
// with its engine on "auto".
function engineOff(source, setting) {
  return setting === 'off' || ['needs-auth', 'not-connected'].includes(source?.status) || (setting !== 'on' && source?.plan === 'free');
}

const WINDOW_LABELS = { 300: R.window5h, 10080: R.windowWeekly, 43200: R.window30d };
// The windows a provider can leave out of a reading, by length (lib/panel-data.mjs REPORTED_WINDOWS).
const NOT_REPORTED_MINUTES = { five_hour: 300, seven_day: 10080 };

function pastWindows(ctx, provider, windowId, durationMinutes) {
  const readings = storedReadings(ctx.view, provider, windowId, durationMinutes).filter(reading => reading.resetsAt !== null);
  const byReset = new Map();
  for (const reading of readings) {
    // Reset times reported to the minute can read a minute apart for the same window.
    const key = [...byReset.keys()].find(reset => Math.abs(reset - reading.resetsAt) <= 120000) ?? reading.resetsAt;
    byReset.set(key, Math.min(byReset.get(key) ?? 100, reading.remaining));
  }
  const first = ctx.period.first, last = ctx.period.last;
  return [...byReset].filter(([reset]) => reset <= ctx.now).map(([reset, left]) => {
    const start = durationMinutes ? reset - durationMinutes * 60000 : reset;
    return { start: new Date(start).toISOString(), date: dateIn(ctx.timeZone, start), ends: dateIn(ctx.timeZone, reset), used: Math.max(0, Math.min(100, 100 - left)) };
  // A window belongs to the period when the two overlap.
  }).filter(window => window.date <= last && window.ends >= first).sort((a, b) => a.start.localeCompare(b.start))
    .map(({ start, used }) => ({ start, used }));
}

function engineSetting(ctx, engine) {
  const values = rows(ctx.view.config).map(row => row.engines?.[engine]).filter(Boolean);
  return values.includes('on') ? 'on' : values.length && values.every(value => value === 'off') ? 'off' : 'auto';
}

function limitsVM(ctx) {
  const engines = [];
  for (const engine of SOURCE_IDS) {
    // An engine whose limits are off for the account is on no surface, even when a computer still carries a copy.
    if (!limitsOn(ctx.snapshot, engine)) continue;
    const source = ctx.view[ENGINE_SOURCE[engine]];
    const off = engineOff(source, engineSetting(ctx, engine));
    const engineText = storedForecast(ctx.snapshot, engine, null, ctx.now).text;
    // The stored limit rows (combined.glance.limits), which word an old reading the same way on every surface.
    const glanceRows = rows(ctx.snapshot?.glance?.limits).filter(row => row.provider === engine);
    const checked = time(source?.checkedAt);
    const validUntil = time(source?.validUntil);
    const fresh = source?.status === 'ok' && checked !== null && (readingFresh(checked, ctx.now) || (validUntil !== null && validUntil > ctx.now));
    const windows = rows(source?.windows).filter(window => typeof window.window === 'string').map(window => {
      const durationMinutes = number(window.durationMinutes);
      const remaining = number(window.remainingPercent);
      const readOn = typeof source?.observedOn === 'string' ? ctx.names[source.observedOn] ?? source.observedOn : null;
      const state = off ? 'off' : !fresh ? 'stale' : remaining === null ? 'stale' : remaining <= LIMIT_SPENT_PERCENT ? 'spent' : remaining <= LIMIT_LOW_PERCENT ? 'low' : 'ok';
      const stored = off ? { forecast: null, text: null, stale: false, resets: null } : storedForecast(ctx.snapshot, engine, window.window, ctx.now);
      const glanceRow = glanceRows.find(row => row.windowId === window.window);
      const last = state === 'stale' && glanceRow ? lastReading(glanceRow, ctx.now, ctx.timeZone) : null;
      return {
        windowId: window.window, label: WINDOW_LABELS[durationMinutes] ?? window.window,
        remaining: off ? null : state === 'stale' ? last?.remaining ?? null : remaining, asOf: last?.asOf ?? null, offText: off ? engineText : null,
        resetsAt: typeof window.resetsAt === 'string' ? window.resetsAt : null, readOn,
        checkedAt: typeof window.checkedAt === 'string' ? window.checkedAt : typeof source?.checkedAt === 'string' ? source.checkedAt : null,
        state, forecast: stored.forecast, forecastText: stored.text, forecastStale: stored.stale, forecastResets: off ? null : stored.resets,
        pastWindows: pastWindows(ctx, engine, window.window, durationMinutes),
      };
    });
    // A window the provider left out of its latest reading has no limit to show, which is not the same as Unknown.
    const listed = new Set(windows.map(window => window.windowId));
    const absent = !off && ['ok', 'stale'].includes(source?.status) && Array.isArray(source?.notReported) ? source.notReported : [];
    for (const id of absent.filter(id => typeof id === 'string' && !listed.has(id) && NOT_REPORTED_MINUTES[id])) {
      windows.push({ windowId: id, label: WINDOW_LABELS[NOT_REPORTED_MINUTES[id]], remaining: null, asOf: null, offText: null, resetsAt: null, readOn: null,
        checkedAt: null, state: 'absent', forecast: null, forecastText: null, forecastStale: false, forecastResets: null, pastWindows: [] });
    }
    engines.push({ engine, name: SOURCE_NAMES[engine], plan: typeof source?.plan === 'string' ? source.plan : null,
      headline: engineText, windows });
  }
  return engines;
}

/** Limits follow the range (past windows) and sources, not the device chips: an account limit belongs to no one computer. @param {object} snapshot @param {Scope} scope @param {{now?: number}} [options] @returns {LimitsVM} */
export function buildLimits(snapshot, scope, { now = Date.now() } = {}) {
  const ctx = prepared(snapshot, scope, now);
  return { frame: frameOf(ctx), headline: menuHeadline(snapshot, now), engines: limitsVM(ctx) };
}

// ---------------------------------------------------------------------------------------------------
// Charts.

function buckets(ctx) {
  if (!['year', 'all'].includes(ctx.period.unit)) return { bucket: 'day', list: ctx.period.dates.map(date => ({ date, dates: [date] })) };
  const months = new Map();
  for (const date of ctx.period.dates) {
    const key = `${date.slice(0, 7)}-01`;
    months.set(key, [...(months.get(key) ?? []), date]);
  }
  return { bucket: 'month', list: [...months].map(([date, dates]) => ({ date, dates })) };
}

function chartPoints(ctx, stack = null) {
  const dims = ['device', ...(stack && stack !== 'device' && METRIC_DIMS.spend.includes(stack) ? [stack] : [])];
  return buckets(ctx).list.map(({ date, dates }) => ({
    date,
    spend: buildNum(ctx, 'spend', { dates, compare: false, dims }),
    onMain: buildNum(ctx, 'onMain', { dates, compare: false, dims: ['device'] }),
    churn: buildNum(ctx, 'churn', { dates, compare: false, dims: ['device'] }),
    merged: buildNum(ctx, 'merged', { dates, compare: false, dims: ['device'] }),
  }));
}

function agentRows(ctx) {
  const cells = withDates(cellsFor(ctx, ctx.period.dates), ctx.period.dates);
  const spend = new Map(rawParts(ctx, cells, 'spend', 'model').map(part => [part.key, part.value]));
  const tokens = new Map(rawParts(ctx, cells, 'tokens', 'model').map(part => [part.key, part.value]));
  const perDevice = (key, read) => ctx.hosts.filter(host => cells.some(cell => cell.host === host)).map(host => {
    const own = cells.filter(cell => cell.host === host);
    const value = own.some(cell => cell.unknown) ? null : total(own.flatMap(cell => cell.days.flatMap(day => rows(day.models).filter(part => modelLabel(part.model) === key).map(read))));
    return { key: host, label: ctx.names[host], value };
  });
  const out = [...spend.keys()].sort((a, b) => descending(spend.get(a), spend.get(b))).map(key => ({
    agent: key,
    usd: plainNum('spend', 'usd', spend.get(key), { breakdowns: { device: finishParts(perDevice(key, part => number(part.apiUsd)), spend.get(key), BREAKDOWN_ROWS, 'usd') } }),
    tokens: plainNum('tokens', 'tokens', tokens.get(key) ?? null, { breakdowns: { device: finishParts(perDevice(key, part => number(part.outputTokens)), tokens.get(key) ?? null, BREAKDOWN_ROWS, 'tokens') } }),
    requests: null,
  }));
  const grok = grokVM(ctx);
  if (grok) out.push({ agent: strings.providers.grok, usd: null, tokens: null, requests: grok.total });
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Overview.

function flagsOf(ctx, { headline, sessions, engines }) {
  const lines = [];
  const stale = frameOf(ctx).devices.filter(chip => chip.selected && chip.state === 'stale' && !chip.off);
  if (stale.length) lines.push({ text: fill(R.flagStale, { names: stale.map(chip => chip.name).join(', '), time: clock(stale[0].since, ctx.timeZone, ctx.now) }), sessionKey: null });
  const now = ratio(headline.onMain.value, headline.onMain.of);
  const previousCells = ctx.comparison ? cellsFor(ctx, ctx.comparison.period.dates) : null;
  const before = previousCells ? ratio(cellSum(previousCells, 'onMain'), cellSum(previousCells, 'commits')) : null;
  if (now !== null && before !== null && (before - now) * 100 >= FLAG_LANDED_DROP)
    lines.push({ text: fill(R.flagLandedFell, { rate: Math.round(now * 100), was: Math.round(before * 100) }), sessionKey: null });
  const plain = sessions.filter(row => row.kind === 'session');
  for (const row of plain.filter(row => row.commits !== null && row.commits > FLAG_COMMITS && row.onMain.value === 0).sort((a, b) => b.commits - a.commits).slice(0, 2))
    lines.push({ text: fill(R.flagNoneOnMain, { name: row.name.display, commits: row.commits }), sessionKey: row.key });
  const idle = plain.filter(row => row.commits === 0 && row.spend.value !== null && row.spend.value > FLAG_NO_COMMIT_USD).sort((a, b) => b.spend.value - a.spend.value)[0];
  if (idle) lines.push({ text: fill(R.flagNoCommits, { name: idle.name.display, spend: idle.spend.text }), sessionKey: idle.key });
  for (const engine of engines) for (const window of engine.windows)
    if (window.state === 'spent') lines.push({ text: fill(R.flagLimitSpent, { name: engine.name, window: window.label }), sessionKey: null });
  return lines.slice(0, FLAG_LINES);
}

/** @param {object} snapshot @param {Scope} scope @param {{now?: number}} [options] @returns {OverviewVM} */
export function buildOverview(snapshot, scope, { now = Date.now() } = {}) {
  const ctx = prepared(snapshot, scope, now);
  const headline = Object.fromEntries(['spend', 'merged', 'onMain', 'churn', 'perLanded', 'noCommitSpend'].map(id => [id, buildNum(ctx, id)]));
  const all = sessionsVM(ctx, { limit: Infinity });
  const engines = limitsVM(ctx);
  return {
    frame: frameOf(ctx), headline, chart: chartPoints(ctx), agents: agentRows(ctx), grok: grokVM(ctx),
    topSessions: all.rows.slice(0, TOP_SESSIONS), running: all.rows.filter(row => row.running), limits: engines, limitsHeadline: menuHeadline(snapshot, now),
    flags: flagsOf(ctx, { headline, sessions: all.rows, engines }), coverage: coverageOf(ctx),
  };
}

// ---------------------------------------------------------------------------------------------------
// Tokens, screen time, drift and settings.

/** @param {object} snapshot @param {Scope} scope @param {{now?: number}} [options] @returns {TokensVM} */
export function buildTokens(snapshot, scope, { now = Date.now() } = {}) {
  const ctx = prepared(snapshot, scope, now);
  const tokens = buildNum(ctx, 'tokens'), spend = buildNum(ctx, 'spend');
  const cells = withDates(cellsFor(ctx, ctx.period.dates), ctx.period.dates);
  const known = !cells.some(cell => cell.unknown);
  const kinds = ['input', 'output', 'cacheRead', 'cacheWrite'].map(key => ({ key, label: R[`token${key[0].toUpperCase()}${key.slice(1)}`],
    value: known ? total(cells.flatMap(cell => cell.days.map(day => number(day.tokens?.[key])))) : null }));
  const repoSpend = rawParts(ctx, cells, 'spend', 'repo').sort((a, b) => descending(a.value, b.value));
  const today = ctx.period.unit === 'day' && ctx.period.current;
  const projectTokens = new Map();
  if (today) for (const row of rows(ctx.view.projectTokens)) if (ctx.hosts.includes(row.host) && row.status === 'ok')
    for (const project of rows(row.projects)) projectTokens.set(project.name, (projectTokens.get(project.name) ?? 0) + (number(project.totalTokens) ?? 0)); // zero-ok: sums today's known project totals
  return {
    frame: frameOf(ctx), total: tokens, spend,
    days: ctx.period.dates.map(date => ({ date, tokens: buildNum(ctx, 'tokens', { dates: [date], compare: false }), spend: buildNum(ctx, 'spend', { dates: [date], compare: false }) })),
    agents: agentRows(ctx).filter(row => row.tokens !== null),
    repos: repoSpend.map(part => ({ repo: part.key, tokens: projectTokens.has(part.key) ? projectTokens.get(part.key) : null, spend: part.value })),
    byKind: finishParts(kinds, tokens.value, kinds.length, 'tokens'),
  };
}

/** @param {object} snapshot @param {Scope} scope @param {{now?: number}} [options] @returns {ScreenTimeVM} */
export function buildScreenTime(snapshot, scope, { now = Date.now() } = {}) {
  const ctx = prepared(snapshot, scope, now);
  const num = (dates, compare) => {
    const value = screenTotal(ctx, dates).value;
    const cells = withDates([], dates);
    let previous = null;
    const comparison = compare ? ctx.comparison : null;
    if (comparison) previous = screenTotal(ctx, comparison.period.dates).value;
    return { metric: 'screenTime', unit: 'seconds', value, text: formatValue('seconds', value), of: null,
      sumLabel: screenHosts(ctx).length > 1 ? SUM_LABEL : null, previous, delta: value === null || previous === null ? null : value - previous,
      deltaText: compare && ctx.period.unit !== 'all' ? (comparison ? deltaText('screenTime', value, previous, null, null, comparison, 'seconds') : R.noEarlierData) : null,
      breakdowns: breakdowns(ctx, cells, 'screenTime', value), note: null, atLeast: screenTotal(ctx, dates).atLeast };
  };
  const days = ctx.period.dates.map(date => {
    const entries = screenDays(ctx, [date]);
    const tracked = entries.some(entry => entry.tracked === true) ? true : entries.some(entry => entry.tracked === false) ? false : null;
    return { date, seconds: num([date], false), tracked };
  });
  let hours = null;
  if (ctx.period.unit === 'day') {
    const lists = screenDays(ctx, ctx.period.dates).map(entry => entry.day?.hours).filter(list => Array.isArray(list) && list.length === 24 && list.every(value => number(value) !== null));
    if (lists.length) hours = Array.from({ length: 24 }, (_, hour) => lists.reduce((sum, list) => sum + list[hour], 0));
  }
  const apps = new Map();
  for (const entry of screenTotal(ctx, ctx.period.dates).list) for (const [category, list] of Object.entries(entry.day?.apps ?? {})) {
    const map = apps.get(category) ?? new Map();
    for (const [app, seconds] of Object.entries(object(list) ? list : {})) if (number(seconds) !== null) map.set(app, (map.get(app) ?? 0) + seconds); // zero-ok: starts a running sum
    apps.set(category, map);
  }
  const categoryTotal = map => [...map.values()].reduce((sum, value) => sum + value, 0);
  return {
    frame: frameOf(ctx), total: num(ctx.period.dates, true), days, hours,
    apps: [...apps].sort((a, b) => categoryTotal(b[1]) - categoryTotal(a[1])).map(([category, map]) => ({ category, apps: partsFromMap(map, 'seconds', categoryTotal(map)) })),
  };
}

/** @param {object} snapshot @param {Scope} scope @param {{now?: number}} [options] @returns {DriftVM} */
export function buildDrift(snapshot, scope, { now = Date.now() } = {}) {
  const ctx = prepared(snapshot, scope, now);
  const dates = new Set(ctx.period.dates);
  const seen = new Set(), setup = [];
  for (const row of rows(ctx.view.settings).filter(row => ctx.hosts.includes(row.host) && row.status === 'ok'))
    for (const profile of rows(row.profiles)) {
      if (!dates.has(profile.date) || typeof profile.model !== 'string') continue;
      const entry = { date: profile.date, model: profile.model, effort: typeof profile.effort === 'string' ? profile.effort : UNKNOWN, speed: typeof profile.speed === 'string' ? profile.speed : UNKNOWN };
      const key = `${entry.date}|${entry.model}|${entry.effort}|${entry.speed}`;
      if (!seen.has(key)) { seen.add(key); setup.push(entry); }
    }
  let models = [];
  try { models = driftView(rows(ctx.view.modelDrift).filter(row => ctx.hosts.includes(row.host) && row.status === 'ok'), { dates: ctx.period.dates }); }
  catch { models = []; }
  return { frame: frameOf(ctx), models, setup: setup.sort((a, b) => a.date.localeCompare(b.date) || a.model.localeCompare(b.model)) };
}

const SOURCE_READS = { claude: R.readsClaude, codex: R.readsCodex, grok: R.readsGrok };

/** @param {object} snapshot @param {Scope} scope @param {{now?: number}} [options] @returns {SettingsVM} */
export function buildSettings(snapshot, scope, { now = Date.now() } = {}) {
  const ctx = prepared(snapshot, scope, now);
  const config = rows(ctx.view.config).filter(row => HOSTS.includes(row.host)).sort((a, b) => HOSTS.indexOf(a.host) - HOSTS.indexOf(b.host));
  const aliases = new Map();
  for (const row of config) for (const [prefix, role] of Object.entries(object(row.roleAliases) ? row.roleAliases : {}))
    if (typeof prefix === 'string' && typeof role === 'string') aliases.set(prefix, role);
  return {
    frame: frameOf(ctx),
    computers: config.map(row => ({ host: row.host, name: ctx.names[row.host], role: row.role === 'hub' ? 'hub' : 'spoke',
      sources: Object.fromEntries(Object.entries(object(row.sources) ? row.sources : {}).filter(([, value]) => typeof value === 'boolean')),
      engines: Object.fromEntries(Object.entries(object(row.engines) ? row.engines : {}).filter(([, value]) => typeof value === 'string')),
      titles: row.titles === true })),
    sources: SOURCE_IDS.map(id => ({ id, name: SOURCE_NAMES[id], reads: SOURCE_READS[id],
      on: Object.fromEntries(config.map(row => [row.host, ['claude', 'codex', 'grok'].includes(id) && Object.keys(row.sources ?? {}).length
        ? (id === 'claude' ? ['claudeCode', 'claudeLimits'] : id === 'codex' ? ['codex', 'codexLimits'] : ['grokLimits']).some(key => row.sources[key] === true) : false])) })),
    roleAliases: [...aliases].map(([prefix, role]) => ({ prefix, role })),
    howToChange: R.howToChange,
  };
}

// ---------------------------------------------------------------------------------------------------
// One metric, blocks and the Ask field.

/**
 * One metric over the scope, with its comparison and breakdowns. The Headline and Breakdown blocks,
 * the Overview headline and the MCP query tool all go through this.
 * @param {object} snapshot @param {MetricId} metric @param {Scope} scope @param {{now?: number}} [options]
 * @returns {Num}
 */
export function metric(snapshot, metric, scope, { now = Date.now() } = {}) {
  if (!Object.hasOwn(METRIC_DIMS, metric)) throw new Error(`Unknown metric: ${metric}`);
  const ctx = prepared(snapshot, scope, now);
  if (metric === 'screenTime') return buildScreenTime(snapshot, scope, { now }).total;
  if (metric === 'grokRequests') {
    const { value, atLeast } = grokTotal(ctx, ctx.period.dates);
    let previous = null;
    if (ctx.comparison) previous = grokTotal(ctx, ctx.comparison.period.dates).value;
    return { ...plainNum('grokRequests', 'requests', value), atLeast, previous, delta: value === null || previous === null ? null : value - previous,
      deltaText: ctx.period.unit === 'all' ? null : ctx.comparison ? deltaText('grokRequests', value, previous, null, null, ctx.comparison, 'requests') : R.noEarlierData };
  }
  return buildNum(ctx, metric);
}

function timeline(ctx, series, by) {
  const { bucket, list } = buckets(ctx);
  const metricId = series;
  const dims = by && METRIC_DIMS[metricId]?.includes(by) ? [by] : [];
  return { bucket, points: list.map(({ date, dates }) => {
    if (series === 'screenTime') {
      const value = screenTotal(ctx, dates).value;
      return { date, value: plainNum('screenTime', 'seconds', value, { breakdowns: dims.length ? { [by]: finishParts(screenParts(ctx, dates, by), value, BREAKDOWN_ROWS, 'seconds') } : {} }) };
    }
    if (series === 'grokRequests') return { date, value: plainNum('grokRequests', 'requests', grokTotal(ctx, dates).value) };
    return { date, value: buildNum(ctx, metricId, { dates, compare: false, dims }) };
  }) };
}

/**
 * The view-model a block draws: the bridge between a json-render element and the builders above.
 * The block's `scope` prop is applied with patchScope first. Unknown block types throw.
 * @param {import('./r2-blocks.mjs').BlockType} type
 * @param {object} props
 * @param {object} snapshot
 * @param {Scope} scope
 * @param {{now?: number}} [options]
 * @returns {SectionVM | HeadlineVM | SpendLandedChartVM | SessionsVM | BreakdownVM | LimitMeterVM | GrokRequestsVM | TimelineVM | FlagsVM | null}
 */
export function resolveBlock(type, props, snapshot, scope, { now = Date.now() } = {}) {
  const p = object(props) ? props : {};
  const own = patchScope(scope, p.scope);
  if (type === 'Section') return { title: typeof p.title === 'string' ? p.title : null, columns: p.columns ?? 12 };
  const ctx = prepared(snapshot, own, now);
  switch (type) {
    case 'Headline': {
      const dims = Array.isArray(p.breakdowns) ? p.breakdowns : METRIC_DIMS[p.metric];
      const num = p.metric === 'screenTime' || p.metric === 'grokRequests' ? metric(snapshot, p.metric, own, { now })
        : buildNum(ctx, p.metric, { compare: p.compare !== false, dims });
      return { num: p.compare === false ? { ...num, previous: null, delta: null, deltaText: null } : num, frame: frameOf(ctx) };
    }
    case 'SpendLandedChart': return { points: chartPoints(ctx, p.stack ?? null), bucket: buckets(ctx).bucket, stack: p.stack ?? null, frame: frameOf(ctx) };
    case 'SessionsTable': return { frame: frameOf(ctx), ...sessionsVM(ctx, { groupBy: p.groupBy ?? null, role: p.role ?? null, running: p.running === true, sort: p.sort ?? 'spend', limit: p.limit ?? 25 }), coverage: coverageOf(ctx) };
    case 'Breakdown': {
      const limit = Number.isSafeInteger(p.limit) && p.limit > 0 ? p.limit : BREAKDOWN_ROWS;
      const num = p.metric === 'screenTime' || p.metric === 'grokRequests' ? metric(snapshot, p.metric, own, { now })
        : buildNum(ctx, p.metric, { compare: false, dims: [p.dim], limit });
      const parts = p.metric === 'screenTime' ? finishParts(screenParts(ctx, ctx.period.dates, p.dim), num.value, limit, 'seconds') : num.breakdowns[p.dim] ?? [];
      return { total: num, dim: p.dim, parts, frame: frameOf(ctx) };
    }
    case 'LimitMeter': {
      const engine = limitsVM(ctx).find(entry => entry.engine === p.engine) ?? null;
      return { engine: engine && p.window ? { ...engine, windows: engine.windows.filter(window => window.windowId === p.window) } : engine, history: p.history === true,
        headline: menuHeadline(snapshot, now) };
    }
    case 'GrokRequests': return grokVM(ctx);
    case 'Timeline': return { series: p.series, by: p.by ?? null, ...timeline(ctx, p.series, p.by ?? null), frame: frameOf(ctx) };
    case 'Flags': {
      const headline = { onMain: buildNum(ctx, 'onMain', { compare: false, dims: [] }) };
      const lines = flagsOf(ctx, { headline, sessions: sessionsVM(ctx, { limit: Infinity }).rows, engines: limitsVM(ctx) });
      return { lines: lines.slice(0, Number.isSafeInteger(p.limit) && p.limit > 0 ? p.limit : 4), frame: frameOf(ctx) };
    }
    default: throw new Error(`Unknown block: ${String(type)}`);
  }
}

/**
 * The Ask field: a local rules matcher, no model call. Words in the question pick a pinned question
 * or fill a rule's slots (metric, dim, role, range unit, device, source), and the answer is a spec over
 * the same catalog. A question nothing matches gets the pinned questions as suggestions.
 * `now` and `timeZone`, when given, let "yesterday" and "last week" set an anchor date.
 * @param {string} question
 * @param {{savedViews?: SavedView[], now?: number, timeZone?: string}} [options]
 * @returns {AskAnswer}
 */
export function answerQuestion(question, { savedViews = [], now = null, timeZone = 'UTC' } = {}) {
  return composeAnswer(question, { savedViews, now, timeZone });
}

/**
 * The one sentence over an answered question, from the same numbers the blocks below it draw. Facts
 * only, and it does not address the reader. Null when the answer names no metric.
 * @param {object} snapshot @param {AskAnswer} answer @param {Scope} scope @param {{now?: number}} [options]
 * @returns {string | null}
 */
export function answerSentence(snapshot, answer, scope, { now = Date.now() } = {}) {
  if (!answer?.metric) return null;
  const own = patchScope(scope, answer.patch ?? undefined);
  const ctx = prepared(snapshot, own, now);
  const num = metric(snapshot, answer.metric, own, { now });
  const lead = fill(R.answerLead, { value: num.text, metric: R[`metric${answer.metric[0].toUpperCase()}${answer.metric.slice(1)}`], period: ctx.period.label });
  // A rate has no largest part, and a part of an Unknown total is not cited.
  if (num.value === null || answer.metric === 'perLanded') return `${lead}.`;
  // Tokens by model count output tokens only, so they are not a part of all tokens.
  const dims = answer.metric === 'tokens' ? ['tool', 'device'] : ['role', 'model', 'repo', 'category', 'device'];
  const dim = answer.role ? 'role' : dims.find(d => (num.breakdowns[d] ?? []).length);
  const top = dim ? (num.breakdowns[dim] ?? []).find(part => !['other', 'unlisted', 'none'].includes(part.key) && (!answer.role || part.key === answer.role)) : null;
  if (!top || top.value === null || top.share === null) return `${lead}.`;
  return `${lead}, ${fill(answer.role ? R.answerRole : R.answerTop, { label: top.label, value: top.text, share: `${Math.round(top.share)}%` })}.`;
}

