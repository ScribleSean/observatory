// Replays the forecast over stored limit readings and says how far it missed.
// Usage: node scripts/harness/forecast-backtest.mjs --db <history.sqlite> | --data <points.json> | --fictional [--json]
// At each past half hour the forecast sees only the readings the dashboard would have had by then, and is
// scored on the share left 3, 6, 12 and 24 hours later and at the last reading before the reset.
// Compared: no spend at all, a straight line over the last day (the method before this one), the average
// pace since the window opened, and the forecast in lib/forecast.mjs with its stated range.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { projection, windowForecast, lookbackMs, RANGE_SHARE } from '../../lib/forecast.mjs';
import { LIMIT_SPENT_PERCENT } from '../../lib/glance-limits.mjs';

const MINUTE = 60000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
const HORIZONS = [3, 6, 12, 24];
const TARGETS = [...HORIZONS, 'reset'];
const same = (a, b) => a !== null && b !== null && Math.abs(a - b) <= 5 * MINUTE;
const stamp = value => typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;

/** One list of readings per provider, window name and window length. */
export function seriesFrom(points) {
  const groups = new Map();
  for (const point of points) {
    const at = stamp(point.t), resetsAt = stamp(point.x);
    if (!Number.isFinite(at) || typeof point.r !== 'number' || !Number.isFinite(resetsAt) || !(point.d > 0)) continue;
    const key = `${point.p} ${point.w} ${point.d}`;
    if (!groups.has(key)) groups.set(key, { provider: point.p, window: point.w, durationMinutes: point.d, readings: [] });
    groups.get(key).readings.push({ at, remaining: point.r, resetsAt });
  }
  for (const group of groups.values()) group.readings.sort((a, b) => a.at - b.at);
  return [...groups.values()];
}

/** The straight line the forecast drew before: first reading in the look-back to now. Points per hour, or null. */
export function straightLine(readings, { now, remaining, resetsAt, durationMinutes }) {
  const from = now - lookbackMs(durationMinutes);
  const cycle = readings.filter(reading => reading.at >= from && reading.at <= now && (reading.resetsAt === null || same(reading.resetsAt, resetsAt)));
  let start = 0;
  for (let index = 1; index < cycle.length; index++) if (cycle[index].remaining > cycle[index - 1].remaining + 0.5) start = index;
  const recent = [...cycle.slice(start), { at: now, remaining }];
  const span = now - recent[0].at;
  if (recent.length < 3 || span < 15 * MINUTE) return null;
  return Math.max(0, (recent[0].remaining - remaining) / (span / HOUR));
}

// The dashboard keeps every reading for two days and one an hour for thirty.
function stored(readings, hourly, index, now) {
  const older = hourly.filter(reading => reading.at < now - 2 * DAY && reading.at >= now - 30 * DAY);
  let from = index;
  while (from > 0 && readings[from - 1].at >= now - 2 * DAY) from--;
  return [...older, ...readings.slice(from, index)];
}

function leftAt(readings, at, resetsAt) {
  let low = 0, high = readings.length - 1;
  while (low < high) { const middle = (low + high + 1) >> 1; if (readings[middle].at <= at) low = middle; else high = middle - 1; }
  const a = readings[low], b = readings[low + 1];
  if (!a || a.at > at || !same(a.resetsAt, resetsAt)) return null;
  // Inside one window the share only falls, so two readings bound everything between them.
  if (b && same(b.resetsAt, resetsAt) && b.remaining <= a.remaining + 0.5) return a.remaining + (b.remaining - a.remaining) * (at - a.at) / (b.at - a.at);
  return at - a.at <= 20 * MINUTE ? a.remaining : null;
}

const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const round = (value, places = 2) => value === null ? null : Math.round(value * 10 ** places) / 10 ** places;

/**
 * @param {{provider:string, window:string, durationMinutes:number, readings:{at:number, remaining:number, resetsAt:number}[]}} series
 * @returns the errors per method and look-ahead, the range's coverage, and how the sentence's claims turned out
 */
export function backtest(series, { stepMinutes = 30 } = {}) {
  const { readings, durationMinutes } = series;
  const hourlyKept = new Map();
  for (const reading of readings) hourlyKept.set(Math.floor(reading.at / HOUR), reading);
  const hourly = [...hourlyKept.values()];
  // The first days only build history.
  const first = readings[0].at + Math.min(5 * DAY, durationMinutes * MINUTE * 5);
  const end = readings.at(-1).at, middle = (first + end) / 2;
  const errors = {}, ranges = {}, claims = {};
  const add = (method, target, record) => ((errors[method] ??= {})[target] ??= []).push(record);
  let index = 0, moments = 0;
  for (let tick = Math.ceil(first / (stepMinutes * MINUTE)) * stepMinutes * MINUTE; tick <= end; tick += stepMinutes * MINUTE) {
    while (index + 1 < readings.length && readings[index + 1].at <= tick) index++;
    const current = readings[index];
    if (tick - current.at > 15 * MINUTE || current.remaining <= LIMIT_SPENT_PERCENT || current.resetsAt <= current.at) continue;
    const now = current.at, { remaining, resetsAt } = current;
    const history = stored(readings, hourly, index, now);
    const input = { remaining, resetsAt: new Date(resetsAt).toISOString(), durationMinutes, readings: history, now };
    const line = straightLine(history, { now, remaining, resetsAt, durationMinutes });
    const ahead = projection(input);
    if (line === null || !ahead) continue;
    moments++;
    const day = Math.floor(now / DAY), half = now <= middle ? 1 : 2;

    // The last reading of this window, and whether it ran out on the way.
    let last = index, ranOut = null;
    while (last + 1 < readings.length && same(readings[last + 1].resetsAt, resetsAt) && readings[last + 1].at < resetsAt) {
      last++;
      if (ranOut === null && readings[last].remaining <= LIMIT_SPENT_PERCENT) ranOut = readings[last].at;
    }
    const sawReset = resetsAt - readings[last].at <= Math.min(4 * HOUR, durationMinutes * MINUTE * 0.15);
    const targets = HORIZONS.map(hours => [hours, now + hours * HOUR]);
    if (sawReset && readings[last].at - now >= Math.min(HOUR, durationMinutes * MINUTE * 0.1)) targets.push(['reset', readings[last].at]);
    for (const [target, at] of targets) {
      if (at >= resetsAt) continue;
      const actual = target === 'reset' ? readings[last].remaining : leftAt(readings, at, resetsAt);
      if (actual === null) continue;
      const hours = (at - now) / HOUR;
      const predicted = ahead.after(hours);
      const guesses = { none: remaining, line: Math.max(0, remaining - line * hours),
        average: Math.max(0, remaining - ahead.pace.average * hours), forecast: predicted.left };
      for (const [method, left] of Object.entries(guesses)) add(method, target, { miss: left - actual, day, half });
      if (predicted.low !== null) (ranges[target] ??= []).push({ inside: actual >= predicted.low - 0.5 && actual <= predicted.high + 0.5,
        below: actual < predicted.low - 0.5, width: predicted.high - predicted.low });
    }

    // What the sentence would have claimed, against what happened. Windows whose end was not seen are left out.
    if (ranOut === null && !sawReset) continue;
    const window = windowForecast(input);
    const claim = window.status === 'runs-out' ? (window.earliestAt && window.latestAt ? 'may run out, range' : window.earliestAt ? 'may run out, from' : 'runs out, no range')
      : window.earliestAt ? 'likely lasts' : window.confidence === 'high' ? 'lasts' : 'lasts, no range';
    const row = claims[claim] ??= { said: 0, ranOut: 0, windows: new Set(), inRange: 0, ranged: 0, hoursOff: [] };
    row.said++; row.windows.add(resetsAt); if (ranOut !== null) row.ranOut++;
    if (window.status === 'runs-out' && ranOut !== null) {
      row.hoursOff.push(Math.abs(Date.parse(window.runoutAt) - ranOut) / HOUR);
      if (window.earliestAt && window.latestAt) { row.ranged++; if (ranOut >= Date.parse(window.earliestAt) - HOUR && ranOut <= Date.parse(window.latestAt) + HOUR) row.inRange++; }
    }
    const old = line > 0 && now + remaining / line * HOUR < resetsAt ? 'line: runs out' : 'line: lasts';
    const oldRow = claims[old] ??= { said: 0, ranOut: 0, windows: new Set(), inRange: 0, ranged: 0, hoursOff: [] };
    oldRow.said++; oldRow.windows.add(resetsAt); if (ranOut !== null) oldRow.ranOut++;
    if (old === 'line: runs out' && ranOut !== null) oldRow.hoursOff.push(Math.abs(now + remaining / line * HOUR - ranOut) / HOUR);
  }

  const table = {};
  for (const [method, byTarget] of Object.entries(errors)) {
    table[method] = {};
    for (const target of TARGETS) {
      const records = byTarget[target] ?? [];
      const mae = part => round(mean(records.filter(part).map(record => Math.abs(record.miss))));
      table[method][target] = { count: records.length, mae: mae(() => true), bias: round(mean(records.map(record => record.miss))),
        firstHalf: mae(record => record.half === 1), secondHalf: mae(record => record.half === 2) };
    }
  }
  // Days on which the forecast missed by less than the straight line, out of the days both were scored.
  const daysBetter = {};
  for (const target of TARGETS) {
    const perDay = method => {
      const days = new Map();
      for (const record of errors[method]?.[target] ?? []) days.set(record.day, [...(days.get(record.day) ?? []), Math.abs(record.miss)]);
      return days;
    };
    const ours = perDay('forecast'), theirs = perDay('line');
    daysBetter[target] = { better: [...ours].filter(([day, values]) => mean(values) < mean(theirs.get(day))).length, days: ours.size };
  }
  const range = Object.fromEntries(TARGETS.map(target => {
    const records = ranges[target] ?? [];
    return [target, { count: records.length, inside: records.length ? round(records.filter(record => record.inside).length / records.length) : null,
      below: records.length ? round(records.filter(record => record.below).length / records.length) : null, width: round(mean(records.map(record => record.width)), 1) }];
  }));
  const said = Object.fromEntries(Object.entries(claims).map(([claim, row]) => [claim, { said: row.said, windows: row.windows.size,
    ranOut: round(row.ranOut / row.said), hoursOff: round(mean(row.hoursOff), 1), inRange: row.ranged ? round(row.inRange / row.ranged) : null }]));
  return { name: `${series.provider} ${series.window} (${durationMinutes >= 1440 ? `${durationMinutes / 1440}-day` : `${durationMinutes / 60}-hour`})`,
    moments, days: round((end - first) / DAY, 1), errors: table, daysBetter, range, claims: said };
}

/**
 * Four weeks of made-up use for one weekly limit: bursts of work on most days, quiet nights and some idle days.
 * The same seed always gives the same readings.
 */
export function fictionalPoints({ seed = 7, days = 35, start = Date.parse('2026-03-02T00:00:00Z') } = {}) {
  let state = seed;
  const random = () => { state = (state * 1664525 + 1013904223) % 4294967296; return state / 4294967296; };
  const points = [];
  let used = 0, opened = start, busyUntil = 0, rate = 0;
  for (let at = start; at < start + days * DAY; at += 10 * MINUTE) {
    if (at - opened >= 7 * DAY) { opened += 7 * DAY; used = 0; }
    const hour = new Date(at).getUTCHours(), weekday = new Date(at).getUTCDay();
    const working = hour >= 13 && hour < 23 && weekday !== 0;
    // A session starts about three times a working day, runs one to four hours and spends 1 to 5 points an hour.
    if (at >= busyUntil && working && random() < 0.05) { busyUntil = at + (1 + random() * 3) * HOUR; rate = 1 + random() * 4; }
    if (at < busyUntil) used = Math.min(100, used + rate / 6);
    points.push({ p: 'claude', w: 'seven_day', t: new Date(at).toISOString(), r: Math.round(100 - used), x: new Date(opened + 7 * DAY).toISOString(), d: 10080 });
  }
  return points;
}

const cell = value => String(value ?? '-').padStart(8);

export function report(result) {
  const lines = [`\n${result.name}: ${result.moments} forecasts over ${result.days} days`,
    `mean miss in points   ${TARGETS.map(target => cell(target === 'reset' ? 'reset' : `+${target}h`)).join('')}`];
  const names = { none: 'no spend', line: 'straight line', average: 'window average', forecast: 'forecast' };
  for (const [method, name] of Object.entries(names)) lines.push(`${name.padEnd(22)}${TARGETS.map(target => cell(result.errors[method]?.[target].mae)).join('')}`);
  lines.push(`${'  first half'.padEnd(22)}${TARGETS.map(target => cell(`${result.errors.forecast?.[target].firstHalf ?? '-'}/${result.errors.line?.[target].firstHalf ?? '-'}`)).join(' ')}  (forecast/line)`);
  lines.push(`${'  second half'.padEnd(22)}${TARGETS.map(target => cell(`${result.errors.forecast?.[target].secondHalf ?? '-'}/${result.errors.line?.[target].secondHalf ?? '-'}`)).join(' ')}`);
  lines.push(`${'  days better'.padEnd(22)}${TARGETS.map(target => cell(`${result.daysBetter[target].better}/${result.daysBetter[target].days}`)).join('')}`);
  lines.push(`${`range, ${Math.round(RANGE_SHARE * 100)}% stated`.padEnd(22)}${TARGETS.map(target => cell(result.range[target].inside === null ? null : `${Math.round(result.range[target].inside * 100)}%`)).join('')}`);
  lines.push(`${'  width in points'.padEnd(22)}${TARGETS.map(target => cell(result.range[target].width)).join('')}`);
  lines.push(`${'  forecasts ranged'.padEnd(22)}${TARGETS.map(target => cell(result.range[target].count)).join('')}`);
  for (const [claim, row] of Object.entries(result.claims).sort(([a], [b]) => a.localeCompare(b)))
    lines.push(`said "${claim}" ${row.said} times in ${row.windows} windows: ran out ${Math.round(row.ranOut * 100)}%${row.hoursOff === null ? '' : `, time off by ${row.hoursOff}h`}${row.inRange === null ? '' : `, inside the range ${Math.round(row.inRange * 100)}%`}`);
  return lines.join('\n');
}

async function load(args) {
  const option = name => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : null; };
  if (args.includes('--fictional')) return fictionalPoints();
  if (option('--data')) { const data = JSON.parse(readFileSync(option('--data'), 'utf8')); return Array.isArray(data) ? data : (data.limitHistory ?? data.view?.limitHistory ?? []).flatMap(row => row.points ?? []); }
  if (option('--db')) {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(option('--db'), { readOnly: true });
    try { return db.prepare('SELECT provider p, window w, observed_at t, remaining r, resets_at x, duration_minutes d FROM limit_readings ORDER BY observed_at').all(); }
    finally { db.close(); }
  }
  throw Error('Give --db <history.sqlite>, --data <points.json> or --fictional.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const results = seriesFrom(await load(args)).filter(series => series.readings.length >= 200).map(series => backtest(series)).filter(result => result.moments >= 50);
  console.log(args.includes('--json') ? JSON.stringify(results, null, 2) : results.map(report).join('\n'));
}
