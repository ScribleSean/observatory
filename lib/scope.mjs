// The global scope every round 2 view follows: which computers, which span of time and which sources.
// Contract only. Lane b (view-models) writes the bodies. See docs/R2-PLAN.md.
//
// Periods are calendar spans in the snapshot's time zone (view.timezone), stepped as dates, never as
// 24-hour blocks, so a 23 or 25 hour day is never skipped or counted twice (as periodDates in
// scripts/ledger.mjs does). Dates are YYYY-MM-DD strings.

/**
 * @typedef {'Mac' | 'Windows' | 'Linux'} Host   The combine step's host keys (lib/combine.mjs HOSTS).
 *   The chip label is the device name from the settings file ("PC", "Ubuntu"), never the key.
 *
 * @typedef {'day' | 'week' | 'month' | 'year' | 'all'} RangeUnit
 *
 * @typedef {object} Range
 * @property {RangeUnit} unit
 * @property {string} anchor               Any date inside the period. Ignored for 'all'.
 *
 * @typedef {'claude' | 'codex' | 'grok'} SourceId
 *   claude: settings keys claudeCode and claudeLimits. codex: codex and codexLimits. grok: grokLimits.
 *   A source is on when any set-up computer lists one of its keys as true.
 *
 * @typedef {object} Scope
 * @property {Host[]} devices              Selected computers. Every set-up computer means "All combined".
 * @property {Range} range
 * @property {SourceId[]} sources          Sources shown. Only sources that are on and have data in the period.
 *
 * @typedef {object} ScopePatch            What a block or a pinned question changes about the global scope.
 * @property {Host[]} [devices]
 * @property {Partial<Range>} [range]      A unit alone keeps the global anchor.
 * @property {SourceId[]} [sources]
 *
 * @typedef {object} Period
 * @property {RangeUnit} unit
 * @property {string} first                First date in the period.
 * @property {string} last                 Last date in the period, today at most.
 * @property {string[]} dates              Every date from first to last.
 * @property {boolean} current             The period holds today.
 * @property {boolean} partial             The period has dates after today.
 * @property {string} label                "Nov 18", "Nov 17 to 23", "November 2026", "2026", "All time".
 *
 * @typedef {object} Comparison            The span a headline is compared with.
 * @property {Period} period               The previous period, cut to as many dates as the current one has
 *                                         so far, so a Wednesday is compared with last Monday to Wednesday.
 * @property {boolean} toDate              True when the previous period was cut.
 * @property {string} label                "vs same days last week", "vs yesterday".
 *
 * @typedef {'live' | 'stale' | 'not-set-up'} DeviceState
 *
 * @typedef {object} DeviceChip
 * @property {Host} host
 * @property {string} name                 Device name from the settings file.
 * @property {DeviceState} state           live: snapshot fresh (lib/freshness.mjs). stale: older, or the hub
 *                                         could not read it. not-set-up: no computer of that kind in the hub.
 * @property {string | null} since         ISO time of its last snapshot, for "off since 4:25 AM".
 * @property {boolean} selected
 */

export const RANGE_UNITS = Object.freeze(['day', 'week', 'month', 'year', 'all']);
export const SOURCE_IDS = Object.freeze(['claude', 'codex', 'grok']);
// Weeks start on Monday (ISO 8601). Limit windows keep their own reset times on the Limits view.
export const WEEK_STARTS_ON = 1;
// The settings keys that turn each source on.
export const SOURCE_SETTINGS = Object.freeze({ claude: ['claudeCode', 'claudeLimits'], codex: ['codex', 'codexLimits'], grok: ['grokLimits'] });

const todo = name => { throw new Error(`${name} is not implemented yet (round 2, lane b)`); };

/**
 * The scope a fresh dashboard opens with: every set-up computer, this week, every source that is on.
 * @param {object} snapshot  combined.json
 * @param {{now?: number}} [options]
 * @returns {Scope}
 */
export function defaultScope(snapshot, { now = Date.now() } = {}) { return todo('defaultScope'); }

/**
 * The period a range covers, in the time zone given.
 * 'all' runs from `firstDate` (the earliest recorded date across selected computers) to today.
 * @param {Range} range
 * @param {{timeZone: string, now?: number, firstDate?: string | null}} context
 * @returns {Period}
 */
export function periodOf(range, context) { return todo('periodOf'); }

/**
 * The range one step back (-1) or forward (+1). Null when the step would start after today or end
 * before `firstDate`, and always null for 'all', so the arrows can be disabled.
 * @param {Range} range
 * @param {-1 | 1} direction
 * @param {{timeZone: string, now?: number, firstDate?: string | null}} context
 * @returns {Range | null}
 */
export function stepRange(range, direction, context) { return todo('stepRange'); }

/**
 * What a period's headline is compared with. Null for 'all', and when the previous period has no
 * recorded date at all (the comparison then reads "no earlier data", not +100%).
 * @param {Range} range
 * @param {{timeZone: string, now?: number, firstDate?: string | null}} context
 * @returns {Comparison | null}
 */
export function comparisonOf(range, context) { return todo('comparisonOf'); }

/**
 * Applies a block's or a pinned question's patch on top of the global scope.
 * @param {Scope} scope
 * @param {ScopePatch | undefined} patch
 * @returns {Scope}
 */
export function patchScope(scope, patch) { return todo('patchScope'); }

/**
 * The device chips, in the order Mac, Windows, Linux, from combined.devices and the hub's spokes.
 * @param {object} snapshot
 * @param {Scope} scope
 * @param {{now?: number}} [options]
 * @returns {DeviceChip[]}
 */
export function deviceChips(snapshot, scope, { now = Date.now() } = {}) { return todo('deviceChips'); }

/**
 * Sources that are on in the settings echo (view.config) and have any data in the period on a
 * selected computer. Everything else is hidden on every view.
 * @param {object} snapshot
 * @param {Scope} scope
 * @returns {SourceId[]}
 */
export function visibleSources(snapshot, scope) { return todo('visibleSources'); }

/**
 * The scope as URL search text (?devices=Mac,Linux&unit=week&anchor=2026-11-18&sources=claude),
 * and back. Unknown or invalid values fall back to the default scope's value.
 * @param {Scope} scope
 * @returns {string}
 */
export function scopeToSearch(scope) { return todo('scopeToSearch'); }

/**
 * @param {string} search
 * @param {Scope} fallback
 * @returns {Scope}
 */
export function scopeFromSearch(search, fallback) { return todo('scopeFromSearch'); }
