// The global scope every round 2 view follows: which computers, which span of time and which sources.
// See docs/R2-PLAN.md.
//
// Periods are calendar spans in the snapshot's time zone (view.timezone), stepped as dates, never as
// 24-hour blocks, so a 23 or 25 hour day is never skipped or counted twice (as periodDates in
// scripts/ledger.mjs does). Dates are YYYY-MM-DD strings.

import strings from './strings.json' with { type: 'json' };
import { snapshotFresh } from './freshness.mjs';
import { deviceLabel } from './panel-data.mjs';
import { readAt } from './forecast.mjs';

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
 * @property {string | null} since         ISO time of its last snapshot.
 * @property {boolean} off                 Turned off in the hub's settings: it reads "Off", never a reading time.
 * @property {string | null} stateLabel    What the chip says, as the hub decided it once (lib/combine.mjs deviceState):
 *                                         "Off", or the day and time of its last reading ("Wed 8:12 AM"). Null when
 *                                         not set up.
 * @property {boolean} selected
 */

export const RANGE_UNITS = Object.freeze(['day', 'week', 'month', 'year', 'all']);
export const SOURCE_IDS = Object.freeze(['claude', 'codex', 'grok']);
// Weeks start on Monday (ISO 8601). Limit windows keep their own reset times on the Limits view.
export const WEEK_STARTS_ON = 1;
// The settings keys that turn each source on.
export const SOURCE_SETTINGS = Object.freeze({ claude: ['claudeCode', 'claudeLimits'], codex: ['codex', 'codexLimits'], grok: ['grokLimits'] });


export const HOSTS = Object.freeze(['Mac', 'Windows', 'Linux']);
const R = strings.r2;
const DAY_MS = 86400000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const rows = value => Array.isArray(value) ? value.filter(object) : [];
const time = value => { const at = typeof value === 'string' ? Date.parse(value) : NaN; return Number.isFinite(at) ? at : null; };

// Dates are stepped at UTC noon, so a 23 or 25 hour day in the user's zone never moves a date.
const noon = date => Date.parse(`${date}T12:00:00Z`);
const iso = ms => new Date(ms).toISOString().slice(0, 10);
/** The date `days` after `date` (negative for before). */
export const addDays = (date, days) => iso(noon(date) + days * DAY_MS);
const weekday = date => new Date(noon(date)).getUTCDay();
const pad = value => String(value).padStart(2, '0');
const monthEnd = (year, month) => new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
const addMonths = (date, months) => {
  const year = Number(date.slice(0, 4)), month = Number(date.slice(5, 7)) - 1 + months;
  const y = year + Math.floor(month / 12), m = ((month % 12) + 12) % 12 + 1;
  return `${y}-${pad(m)}-01`;
};
/** True for a real calendar date in YYYY-MM-DD form. */
export const validDate = value => typeof value === 'string' && DATE.test(value) && Number.isFinite(noon(value)) && iso(noon(value)) === value;

/** The date `now` falls on in `timeZone`. */
export function dateIn(timeZone, now = Date.now()) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now)); }
  catch { return iso(now); }
}

/** Every date from `first` to `last`, both included. */
export function datesBetween(first, last) {
  const dates = [];
  for (let date = first; date <= last; date = addDays(date, 1)) dates.push(date);
  return dates;
}

// The calendar span a unit covers around `anchor`, before it is cut at today.
function span(unit, anchor) {
  if (unit === 'day') return { first: anchor, end: anchor };
  if (unit === 'week') {
    const first = addDays(anchor, -((weekday(anchor) - WEEK_STARTS_ON + 7) % 7));
    return { first, end: addDays(first, 6) };
  }
  if (unit === 'month') {
    const first = `${anchor.slice(0, 7)}-01`;
    return { first, end: `${anchor.slice(0, 7)}-${pad(monthEnd(Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7))))}` };
  }
  return { first: `${anchor.slice(0, 4)}-01-01`, end: `${anchor.slice(0, 4)}-12-31` };
}

const short = (date, year) => new Date(noon(date)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC', ...(year ? { year: 'numeric' } : {}) });

function label(unit, first, end, today) {
  const otherYear = first.slice(0, 4) !== today.slice(0, 4);
  if (unit === 'day') return short(first, otherYear);
  if (unit === 'week') {
    const sameMonth = first.slice(0, 7) === end.slice(0, 7);
    const last = sameMonth ? String(Number(end.slice(8))) : short(end, false);
    const text = R.rangeTo.replace('{first}', short(first, false)).replace('{last}', last);
    return otherYear || end.slice(0, 4) !== today.slice(0, 4) ? `${text}, ${end.slice(0, 4)}` : text;
  }
  if (unit === 'month') return new Date(noon(first)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  if (unit === 'year') return first.slice(0, 4);
  return R.allTime;
}

const contextOf = context => {
  const now = context?.now ?? Date.now();
  const today = dateIn(context?.timeZone ?? 'UTC', now);
  const firstDate = validDate(context?.firstDate) ? context.firstDate : null;
  return { today, firstDate };
};

/**
 * The period a range covers, in the time zone given.
 * 'all' runs from `firstDate` (the earliest recorded date across selected computers) to today.
 * An anchor after today, or not a date, is read as today.
 * @param {Range} range
 * @param {{timeZone: string, now?: number, firstDate?: string | null}} context
 * @returns {Period}
 */
export function periodOf(range, context) {
  const { today, firstDate } = contextOf(context);
  const unit = RANGE_UNITS.includes(range?.unit) ? range.unit : 'week';
  if (unit === 'all') {
    const first = firstDate && firstDate <= today ? firstDate : today;
    return { unit, first, last: today, dates: datesBetween(first, today), current: true, partial: false, label: label(unit, first, today, today) };
  }
  const anchor = validDate(range?.anchor) && range.anchor <= today ? range.anchor : today;
  const { first, end } = span(unit, anchor);
  const last = end < today ? end : today;
  return { unit, first, last, dates: datesBetween(first, last), current: first <= today && today <= end, partial: end > today, label: label(unit, first, end, today) };
}

// The first date of the period one unit before or after the one holding `anchor`.
function stepped(unit, anchor, direction) {
  const { first } = span(unit, anchor);
  if (unit === 'day') return addDays(first, direction);
  if (unit === 'week') return addDays(first, 7 * direction);
  if (unit === 'month') return addMonths(first, direction);
  return `${Number(first.slice(0, 4)) + direction}-01-01`;
}

/**
 * The range one step back (-1) or forward (+1). Null when the step would start after today or end
 * before `firstDate`, and always null for 'all', so the arrows can be disabled. With no recorded date
 * at all (`firstDate` null), there is nothing earlier to step to.
 * @param {Range} range
 * @param {-1 | 1} direction
 * @param {{timeZone: string, now?: number, firstDate?: string | null}} context
 * @returns {Range | null}
 */
export function stepRange(range, direction, context) {
  if (range?.unit === 'all' || ![-1, 1].includes(direction)) return null;
  const { today, firstDate } = contextOf(context);
  const current = periodOf(range, context);
  const anchor = stepped(current.unit, current.first, direction);
  if (anchor > today) return null;
  if (direction < 0 && (!firstDate || span(current.unit, anchor).end < firstDate)) return null;
  return { unit: current.unit, anchor };
}

const UNIT_WORDS = { week: R.unitWeek, month: R.unitMonth, year: R.unitYear };

/**
 * What a period's headline is compared with. Null for 'all', and when the previous period starts before
 * the first recorded date: its days before then were not recorded, so its value would count too little.
 * The comparison then reads "no earlier data", not +100%.
 * @param {Range} range
 * @param {{timeZone: string, now?: number, firstDate?: string | null}} context
 * @returns {Comparison | null}
 */
export function comparisonOf(range, context) {
  if (range?.unit === 'all') return null;
  const { today, firstDate } = contextOf(context);
  const current = periodOf(range, context);
  const anchor = stepped(current.unit, current.first, -1);
  const { first, end } = span(current.unit, anchor);
  if (!firstDate || first < firstDate) return null;
  const full = datesBetween(first, end);
  const dates = full.slice(0, current.dates.length);
  const toDate = dates.length < full.length;
  const last = dates.at(-1);
  const period = { unit: current.unit, first, last, dates, current: false, partial: false, label: label(current.unit, first, end, today) };
  const unit = UNIT_WORDS[current.unit];
  const text = current.unit === 'day' ? (current.current ? R.vsYesterday : R.vsDayBefore)
    : current.current ? (toDate ? R.vsSameDaysLast : R.vsLast).replace('{unit}', unit)
      : (toDate ? R.vsSameDaysBefore : R.vsBefore).replace('{unit}', unit);
  return { period, toDate, label: text };
}

/**
 * Applies a block's or a pinned question's patch on top of the global scope. Devices are replaced,
 * a range unit alone keeps the global anchor, and sources narrow the global ones (a patch never shows
 * a source the scope hides).
 * @param {Scope} scope
 * @param {ScopePatch | undefined} patch
 * @returns {Scope}
 */
export function patchScope(scope, patch) {
  if (!object(patch)) return scope;
  const devices = Array.isArray(patch.devices) ? patch.devices.filter(host => HOSTS.includes(host)) : [];
  const range = object(patch.range) ? {
    unit: RANGE_UNITS.includes(patch.range.unit) ? patch.range.unit : scope.range.unit,
    anchor: validDate(patch.range.anchor) ? patch.range.anchor : scope.range.anchor,
  } : scope.range;
  const sources = Array.isArray(patch.sources) ? scope.sources.filter(id => patch.sources.includes(id)) : scope.sources;
  return { devices: devices.length ? devices : scope.devices, range, sources };
}

/** Hosts with a computer set up in the hub, in HOSTS order. */
export function setUpHosts(snapshot) {
  const listed = new Set([...rows(snapshot?.devices).map(device => device.host), ...rows(snapshot?.view?.config).map(row => row.host)]);
  return HOSTS.filter(host => listed.has(host));
}

/** The device name from the settings file, else the hub's name for it, else "Mac", "PC" or the host. */
export function deviceNameOf(snapshot, host) {
  const names = [rows(snapshot?.view?.config).find(row => row.host === host)?.name, snapshot?.view?.deviceNames?.[host],
    rows(snapshot?.devices).find(row => row.host === host)?.name];
  const name = names.find(value => typeof value === 'string' && value.trim());
  return name ? name.trim() : deviceLabel(host);
}

/** The earliest recorded date across the hosts given, from the ledger history, or null. */
export function firstDateOf(snapshot, hosts = HOSTS) {
  const dates = rows(snapshot?.view?.ledgerHistory).filter(row => hosts.includes(row.host) && row.status === 'ok')
    .flatMap(row => [row.firstDate, rows(row.days)[0]?.date]).filter(validDate);
  return dates.length ? dates.sort((a, b) => a.localeCompare(b))[0] : null;
}

/** What periodOf, stepRange and comparisonOf need, for a snapshot and the computers in a scope. */
export function scopeContext(snapshot, scope, now = Date.now()) {
  const timeZone = typeof snapshot?.view?.timezone === 'string' ? snapshot.view.timezone : 'UTC';
  return { timeZone, now, firstDate: firstDateOf(snapshot, scope?.devices ?? HOSTS) };
}

/**
 * The scope a fresh dashboard opens with: every set-up computer, this week, every source that is on.
 * @param {object} snapshot  combined.json
 * @param {{now?: number}} [options]
 * @returns {Scope}
 */
export function defaultScope(snapshot, { now = Date.now() } = {}) {
  const devices = setUpHosts(snapshot);
  const base = { devices, range: { unit: 'week', anchor: dateIn(scopeContext(snapshot, { devices }, now).timeZone, now) }, sources: [...SOURCE_IDS] };
  return { ...base, sources: visibleSources(snapshot, base, { now }) };
}

/**
 * The device chips, in the order Mac, Windows, Linux, from combined.devices and the hub's spokes.
 * @param {object} snapshot
 * @param {Scope} scope
 * @param {{now?: number}} [options]
 * @returns {DeviceChip[]}
 */
export function deviceChips(snapshot, scope, { now = Date.now() } = {}) {
  const timeZone = typeof snapshot?.view?.timezone === 'string' ? snapshot.view.timezone : 'UTC';
  return HOSTS.map(host => {
    const device = rows(snapshot?.devices).find(row => row.host === host);
    const at = time(device?.collectedAt);
    const since = at === null ? null : new Date(at).toISOString();
    const notSetUp = !device && !rows(snapshot?.view?.config).some(row => row.host === host);
    // The hub decides each computer's state once. A snapshot from before that is judged by its age.
    const decided = typeof device?.state === 'string' ? device.state : null;
    const off = decided === 'off';
    const live = decided ? decided === 'current' : at !== null && snapshotFresh(at, now);
    const state = notSetUp ? 'not-set-up' : live ? 'live' : 'stale';
    const stateLabel = notSetUp ? null : typeof device?.stateLabel === 'string' ? device.stateLabel
      : since === null ? strings.status.unknown : readAt(since, { now, timeZone });
    return { host, name: deviceNameOf(snapshot, host), state, since, off, stateLabel, selected: scope?.devices?.includes(host) ?? false };
  });
}

// The settings key for a source's own usage, which each computer decides for itself, and for its account limits.
const USAGE_SETTING = Object.freeze({ claude: 'claudeCode', codex: 'codex' });
const LIMITS_SETTING = Object.freeze({ claude: 'claudeLimits', codex: 'codexLimits', grok: 'grokLimits' });

/**
 * Whether the source's account limits show. The hub decides it once and stores it as view.sourcesOff, so every
 * computer shows the same limits. A copy with no stored list falls back to the settings echo.
 */
export function limitsOn(snapshot, id) {
  const off = snapshot?.view?.sourcesOff;
  if (Array.isArray(off) && off.includes(id)) return false;
  return rows(snapshot?.view?.config).some(row => row.sources?.[LIMITS_SETTING[id]] === true);
}

/** Whether the source shows anywhere: some computer reads its usage, or its limits are on for the account. */
export function sourceOn(snapshot, id) {
  const usage = USAGE_SETTING[id];
  return (usage !== undefined && rows(snapshot?.view?.config).some(row => row.sources?.[usage] === true)) || limitsOn(snapshot, id);
}

/** Whether a source has any record in the dates given on one of the hosts given. */
export function sourceHasData(snapshot, id, hosts, dates) {
  const inPeriod = new Set(dates);
  if (id === 'grok') {
    const grok = snapshot?.view?.grokLimits;
    const from = typeof grok?.observedOn === 'string' ? grok.observedOn : null;
    if (from && !hosts.includes(from)) return false;
    return rows(grok?.requests?.days).some(day => inPeriod.has(day.date) && typeof day.count === 'number');
  }
  return rows(snapshot?.view?.ledgerHistory).some(row => hosts.includes(row.host) && rows(row.days).some(day => day.tool === id && inPeriod.has(day.date)));
}

/**
 * Sources that are on in the settings echo (view.config) and have any data in the period on a
 * selected computer. Everything else is hidden on every view.
 * @param {object} snapshot
 * @param {Scope} scope
 * @param {{now?: number}} [options]
 * @returns {SourceId[]}
 */
export function visibleSources(snapshot, scope, { now = Date.now() } = {}) {
  const period = periodOf(scope.range, scopeContext(snapshot, scope, now));
  return SOURCE_IDS.filter(id => sourceOn(snapshot, id) && sourceHasData(snapshot, id, scope.devices, period.dates));
}

/**
 * The scope as URL search text (?devices=Mac,Linux&unit=week&anchor=2026-11-18&sources=claude),
 * and back. Unknown or invalid values fall back to the default scope's value.
 * @param {Scope} scope
 * @returns {string}
 */
export function scopeToSearch(scope) {
  const parts = [['devices', scope.devices.join(',')], ['unit', scope.range.unit]];
  if (scope.range.unit !== 'all') parts.push(['anchor', scope.range.anchor]);
  parts.push(['sources', scope.sources.join(',')]);
  return `?${parts.map(([key, value]) => `${key}=${value}`).join('&')}`;
}

/**
 * @param {string} search
 * @param {Scope} fallback
 * @returns {Scope}
 */
export function scopeFromSearch(search, fallback) {
  let params;
  try { params = new URLSearchParams(typeof search === 'string' ? search : ''); }
  catch { return fallback; }
  const list = (key, allowed) => {
    if (!params.has(key)) return null;
    const values = [...new Set(params.get(key).split(',').filter(value => allowed.includes(value)))];
    return values.length ? allowed.filter(value => values.includes(value)) : null;
  };
  const unit = params.get('unit'), anchor = params.get('anchor');
  return {
    devices: list('devices', HOSTS) ?? fallback.devices,
    range: { unit: RANGE_UNITS.includes(unit) ? unit : fallback.range.unit, anchor: validDate(anchor) ? anchor : fallback.range.anchor },
    sources: list('sources', SOURCE_IDS) ?? fallback.sources,
  };
}
