// The History page: a year of days, spend by model and by hour, 5-hour blocks, and spent against shipped.
// Pure functions over the combined view. Days with no record are left out, never counted as zero.
import strings from './strings.json' with { type: 'json' };
import { format } from './format.mjs';
import { compact, usd, today } from './panel-data.mjs';
import { validTimeZone } from './timezone.mjs';
import { LIMIT_SPENT_PERCENT } from './glance-limits.mjs';
import { windowOf } from './view-limit-history.mjs';
import { joined, modelLabel, SERIES } from './view-week.mjs';

const H = strings.history;
const UNKNOWN = strings.status.unknown;
const DAY = 86400000, HOUR = 3600000;
const SAME_RESET_MS = 5 * 60000;
export const RANGES = { month: 30, year: 365 };
export const HEAT_WEEKS = 53;
const MODELS_SHOWN = 4;
const BLOCK_DAYS = 7;

const rows = value => Array.isArray(value) ? value.filter(row => row && typeof row === 'object' && !Array.isArray(row)) : [];
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const time = value => { const at = typeof value === 'string' ? Date.parse(value) : NaN; return Number.isFinite(at) ? at : null; };
const total = values => values.length === 0 || values.some(value => value === null) ? null : values.reduce((sum, value) => sum + value, 0);
const shift = (date, days) => new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const utc = date => new Date(`${date}T12:00:00Z`);
const monthDay = date => utc(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const whole = value => value === null ? UNKNOWN : value.toLocaleString('en-US');
const ENGINE_NAMES = { claude: strings.providers.claude, codex: strings.providers.codex, grok: strings.providers.grok };

// Every recorded day, with all computers and tools added together.
function recordedDays(view) {
  const days = new Map();
  for (const source of [...rows(view?.tokens), ...rows(view?.providerTokenSources)]) for (const day of rows(source.days)) {
    if (typeof day.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day.date)) continue;
    const sum = days.get(day.date) ?? { date: day.date, usd: [], output: [], cached: [], input: [], written: [], hours: null, models: new Map() };
    days.set(day.date, sum);
    sum.usd.push(number(day.apiEstimate?.usd));
    sum.output.push(number(day.outputTokens));
    sum.cached.push(number(day.cacheReadTokens));
    sum.input.push(number(day.inputTokens));
    sum.written.push(number(day.cacheCreationTokens));
    if (Array.isArray(day.hours) && day.hours.length === 24 && day.hours.every(value => number(value) !== null))
      sum.hours = (sum.hours ?? Array(24).fill(0)).map((value, hour) => value + day.hours[hour]);
    for (const model of rows(day.models)) {
      const label = modelLabel(model.model), spent = number(model.apiEstimate?.usd);
      if (spent !== null) sum.models.set(label, (sum.models.get(label) ?? 0) + spent); // zero-ok: starts a running sum
    }
  }
  return new Map([...days].map(([date, day]) => [date, { ...day, usd: total(day.usd), output: total(day.output), cached: total(day.cached), input: total(day.input), written: total(day.written) }]));
}

function heat(days, anchor) {
  const end = shift(anchor, 6 - utc(anchor).getUTCDay()), start = shift(end, -(HEAT_WEEKS * 7 - 1));
  const spent = [...days.values()].filter(day => day.date >= start && day.usd !== null && day.usd > 0).map(day => day.usd).sort((a, b) => a - b);
  const cut = share => spent[Math.min(spent.length - 1, Math.floor(spent.length * share))];
  const level = value => value === 0 || spent.length === 0 ? 0 : value <= cut(0.25) ? 1 : value <= cut(0.5) ? 2 : value <= cut(0.8) ? 3 : 4;
  const cells = [], months = [];
  for (let index = 0; index < HEAT_WEEKS * 7; index++) {
    const date = shift(start, index), week = Math.floor(index / 7);
    if (date.endsWith('-01') || index === 0) {
      const text = utc(date).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
      // A month that starts in the last column, or right beside the first label, has no room for its name.
      if (week < HEAT_WEEKS - 1 && (months.length === 0 || week - months.at(-1).week >= 3)) months.push({ week, text });
      else if (months.length === 1 && months[0].week === 0) months[0] = { week, text };
    }
    if (date > anchor) continue;
    const day = days.get(date);
    cells.push({ date, week, weekday: index % 7, level: !day || day.usd === null ? null : level(day.usd),
      title: format(H.dayValue, { date: monthDay(date), value: !day ? strings.charts.notRecorded : usd(day.usd) }) });
  }
  return { weeks: HEAT_WEEKS, cells, months };
}

function byModel(inRange) {
  if (inRange.length < 2) return null;
  const spend = new Map();
  for (const day of inRange) for (const [label, value] of day.models) spend.set(label, (spend.get(label) ?? 0) + value); // zero-ok: starts a running sum
  const order = [...spend].sort((a, b) => b[1] - a[1]).map(([label]) => label);
  if (order.length === 0) return null;
  const named = order.slice(0, MODELS_SHOWN), rest = order.slice(MODELS_SHOWN);
  const series = named.map((label, index) => ({ label, series: index % SERIES, values: inRange.map(day => day.models.get(label) ?? 0) })); // zero-ok: a model not used that day spent nothing
  if (rest.length) series.push({ label: H.otherModels, series: MODELS_SHOWN % SERIES,
    values: inRange.map(day => rest.reduce((sum, label) => sum + (day.models.get(label) ?? 0), 0)) }); // zero-ok: a model not used that day spent nothing
  // Each series sits on the ones before it.
  let floor = inRange.map(() => 0);
  for (const part of series) { part.base = floor; part.top = part.values.map((value, index) => floor[index] + value); floor = part.top; }
  const stride = Math.max(1, Math.ceil(inRange.length / 4));
  return { series, max: Math.max(...inRange.map((_, index) => series.reduce((sum, part) => sum + part.values[index], 0))),
    ticks: inRange.flatMap((day, index) => index % stride === 0 && inRange.length - 1 - index >= stride * 0.7 ? [{ index, text: monthDay(day.date) }] : []),
    last: monthDay(inRange.at(-1).date), count: inRange.length };
}

function byHour(inRange) {
  const recorded = inRange.filter(day => day.hours);
  if (recorded.length === 0) return null;
  const hours = Array.from({ length: 24 }, (_, hour) => recorded.reduce((sum, day) => sum + day.hours[hour], 0));
  const name = hour => new Date(Date.UTC(2000, 0, 1, hour)).toLocaleTimeString('en-US', { hour: 'numeric', timeZone: 'UTC' });
  return { max: Math.max(...hours), bars: hours.map((value, hour) => ({ value, label: `${name(hour)}: ${compact(value)}` })),
    ticks: [0, 6, 12, 18].map(hour => ({ index: hour, text: name(hour) })) };
}

// Readings of one kind of window, grouped into the windows they belong to. A window's use is 100 minus its lowest reading.
function windowsOf(view, engine, kind, now) {
  const points = rows(view?.limitHistory).flatMap(row => rows(row.points)).filter(point => point.p === engine && windowOf(point) === kind)
    .map(point => ({ at: time(point.t), reset: time(point.x), left: number(point.r) }))
    .filter(point => point.at !== null && point.reset !== null && point.left !== null && point.at <= now).sort((a, b) => a.reset - b.reset);
  const windows = [];
  for (const point of points) {
    const last = windows.at(-1);
    if (last && point.reset - last.reset <= SAME_RESET_MS) last.left = Math.min(last.left, point.left);
    else windows.push({ reset: point.reset, left: point.left });
  }
  return windows.map(window => ({ reset: window.reset, used: 100 - window.left, hit: window.left <= LIMIT_SPENT_PERCENT }));
}

function blocks(view, engine, timeZone, now) {
  // A block nobody used is not a block: Codex reports a moving reset while its window sits full.
  const own = windowsOf(view, engine, '5h', now).filter(block => block.reset > now - BLOCK_DAYS * DAY && block.used >= 1);
  if (own.length === 0) return null;
  const weekday = at => new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(at);
  const key = at => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  const days = [];
  for (const block of own) {
    const start = block.reset - 5 * HOUR, id = key(start);
    if (days.at(-1)?.id !== id) days.push({ id, label: weekday(start), blocks: [] });
    days.at(-1).blocks.push({ used: Math.min(100, block.used), hit: block.hit,
      label: format(H.blockValue, { day: weekday(start), value: Math.round(block.used) }) });
  }
  return { days, aside: format(H.blocksAside, { count: own.filter(block => block.hit).length }) };
}

function spentAndShipped(view) {
  const days = new Map();
  let sessions = [], merged = [], periods = 0;
  // A session active on both sides of a reset is listed in both periods. It counts once. Only listed
  // sessions can be matched, so one that is summed into "other" on both sides may still count twice.
  const listed = [];
  for (const period of ['current', 'previous']) {
    const join = joined({ week: { ledger: view?.ledger, windows: [] } }, period);
    if (join.tools.every(tool => tool.count === null && tool.usd === null)) continue;
    periods++;
    listed.push(new Set(join.sessions.map(session => session.key)));
    sessions = sessions.concat(join.tools.map(tool => tool.count));
    merged = merged.concat([...join.sessions, ...join.others].map(part => number(part.shipped?.merges)));
    for (const day of join.days) {
      const sum = days.get(day.date) ?? { date: day.date, usd: [], onMain: [] };
      sum.usd.push(day.usd); sum.onMain.push(day.onMain);
      days.set(day.date, sum);
    }
  }
  const list = [...days.values()].sort((a, b) => a.date < b.date ? -1 : 1).map(day => ({ date: day.date, usd: total(day.usd), onMain: total(day.onMain) }));
  const both = listed.length === 2 ? [...listed[0]].filter(key => listed[1].has(key)).length : 0;
  const count = total(sessions);
  return { periods, sessions: count === null ? null : count - both, merged: total(merged), days: list };
}

/**
 * @typedef {{ index: number, text: string }} Tick
 * @typedef {{ range: 'month' | 'year', computers: string, figures: { label: string, value: string }[],
 *   heat: { weeks: number, cells: { date: string, week: number, weekday: number, level: number | null, title: string }[], months: { week: number, text: string }[] },
 *   models: { series: { label: string, series: number, values: number[], base: number[], top: number[] }[], max: number, ticks: Tick[], last: string, count: number } | null,
 *   hours: { max: number, bars: { value: number, label: string }[], ticks: Tick[] } | null,
 *   engines: { id: string, name: string }[], engine: string | null,
 *   blocks: { days: { id: string, label: string, blocks: { used: number, hit: boolean, label: string }[] }[], aside: string } | null,
 *   pair: { days: { date: string, usd: number | null, onMain: number | null, label: string }[], maxUsd: number, maxMain: number, first: string, last: string } | null }} HistoryViewModel
 */

/**
 * @param {any} view the combined view @param {{range?: 'month'|'year', engine?: string|null, now?: number}} options
 * @returns {HistoryViewModel}
 */
export function historyView(view, { range = 'month', engine = null, now = Date.now() } = {}) {
  const timeZone = validTimeZone(view?.timezone) ? view.timezone : 'UTC';
  const anchor = today(timeZone, new Date(now));
  const length = RANGES[range] ?? RANGES.month;
  const from = shift(anchor, -(length - 1));
  const days = recordedDays(view);
  const inRange = [...days.values()].filter(day => day.date >= from && day.date <= anchor).sort((a, b) => a.date < b.date ? -1 : 1);
  const sent = total(inRange.flatMap(day => [day.cached, day.input, day.written])), cached = total(inRange.map(day => day.cached));
  const ledger = spentAndShipped(view);
  // The ledger keeps this week and last, so its counts say how many days they cover when the range is longer.
  const covered = ledger.periods * 7, short = ledger.periods > 0 && covered < length;
  const engines = [...new Set(rows(view?.limitHistory).flatMap(row => rows(row.points)).filter(point => windowOf(point) === '5h').map(point => point.p))]
    .filter(id => typeof id === 'string').map(id => ({ id, name: ENGINE_NAMES[id] ?? id }));
  const picked = engines.find(entry => entry.id === engine) ?? engines[0] ?? null;
  const weeks = picked ? windowsOf(view, picked.id, 'week', now).filter(week => week.reset > now - length * DAY && week.used >= 1) : [];
  const pairDays = ledger.days.filter(day => day.date >= from && day.date <= anchor);
  return {
    range, computers: Object.values(view?.deviceNames ?? {}).filter(name => typeof name === 'string' && name).join(', '),
    figures: [
      { label: H.outputTokens, value: compact(total(inRange.map(day => day.output))) },
      { label: H.apiPrices, value: usd(total(inRange.map(day => day.usd))) },
      { label: H.cacheHit, value: sent && cached !== null ? format(strings.formats.percent, { value: Math.round(cached / sent * 100) }) : UNKNOWN },
      { label: short ? format(H.sessionsDays, { count: covered }) : H.sessions, value: whole(ledger.sessions) },
      { label: short ? format(H.mergedDays, { count: covered }) : H.merged, value: whole(ledger.merged) },
      { label: picked ? format(H.weeksOut, { name: picked.name }) : H.weeksOutAny,
        value: weeks.length ? format(H.ofTotal, { count: weeks.filter(week => week.hit).length, total: weeks.length }) : UNKNOWN },
    ],
    heat: heat(days, anchor),
    models: byModel(inRange),
    hours: byHour(inRange),
    engines, engine: picked?.id ?? null,
    blocks: picked ? blocks(view, picked.id, timeZone, now) : null,
    pair: pairDays.length ? { days: pairDays.map(day => ({ ...day, label: format(H.pairValue, { date: monthDay(day.date), spent: usd(day.usd), shipped: whole(day.onMain) }) })),
      maxUsd: Math.max(0, ...pairDays.map(day => day.usd ?? 0)), maxMain: Math.max(0, ...pairDays.map(day => day.onMain ?? 0)), // zero-ok: scales the bars, an Unknown day draws none
      first: monthDay(pairDays[0].date), last: monthDay(pairDays.at(-1).date) } : null,
  };
}
