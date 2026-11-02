import { devicePeriodIncomplete, deviceReadingReference, deviceReadingCurrent, deviceReadingNote, viewHost, CLOCK_SKEW_MS, recordedDays, periodDays, periodSeconds, recordedSum, hasAggregateScope, devices, deviceLabel, today, duration } from './panel-data.mjs';
import strings from './strings.json' with { type: 'json' };
import { READING_FRESH_MS } from './freshness.mjs';

export const NOW_MAX_AGE_MS = READING_FRESH_MS;
const words = strings.activity;
const format = (template, values) => template.replace(/\{([a-z][A-Za-z0-9]*)\}/g, (_, key) => values[key]);
const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const validHours = hours => Array.isArray(hours) && hours.length === 24 && hours.every(valid);
const stamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
const shiftDate = (date, offset) => new Date(Date.parse(`${date}T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
function clock(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone) throw new RangeError();
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  return time => {
    const parts = Object.fromEntries(formatter.formatToParts(time).map(part => [part.type, part.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second) };
  };
}
const hourLabel = hour => new Date(Date.UTC(2000, 0, 1, hour)).toLocaleTimeString('en-US', { hour: 'numeric', timeZone: 'UTC' });
function hourlyTitle(timeZone, now) {
  try {
    if (!timeZone || timeZone === Intl.DateTimeFormat().resolvedOptions().timeZone) return words.hourlyTitle;
    const zone = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(now).find(part => part.type === 'timeZoneName')?.value;
    return zone ? format(words.hourlyZoneTitle, { zone }) : words.hourlyTitle;
  } catch { return words.hourlyTitle; }
}
const bucket = wall => ({ date: wall.date, hour: wall.hour });

export function nowFromHours({ days, readingAt, timeZone, now }) {
  let current = null, previous = null;
  const reading = stamp(readingAt);
  const result = (reason, value = null) => ({ value, reason, readingAt: reading, current, previous });
  if (!reading) return result('noReading');
  if (Date.parse(reading) - now > CLOCK_SKEW_MS) return result('ahead');
  if (now - Date.parse(reading) > NOW_MAX_AGE_MS) return result('stale');
  let wall;
  try { wall = clock(timeZone); } catch { return result('timeZone'); }
  const read = wall(Date.parse(reading)), present = wall(Math.max(now, Date.parse(reading)));
  current = bucket(read);
  previous = read.hour ? { date: read.date, hour: read.hour - 1 } : { date: shiftDate(read.date, -1), hour: 23 };
  if (read.date !== present.date || read.hour !== present.hour) return result('hourAfterReading');
  const find = part => Array.isArray(days) ? days.find(day => day?.date === part.date) : null;
  if (![current, previous].every(part => validHours(find(part)?.hours))) return result('noHours');
  for (const part of [current, previous]) {
    let count = 0;
    const start = Date.parse(`${part.date}T00:00:00Z`) - 86400000;
    // freshness-exempt: a quarter-hour search step.
    for (let time = start; time < start + 3 * 86400000; time += 15 * 60000) {
      const candidate = wall(time);
      if (candidate.date === part.date && candidate.hour === part.hour) count++;
    }
    if (count !== 4) return result('daylightSaving');
  }
  return result('ok', find(current).hours[current.hour] + find(previous).hours[previous.hour]);
}

function liveSource(snapshot, host) {
  return snapshot?.activity?.find(row => row?.host === host && ['ok', 'stale'].includes(row.status)) ?? null;
}
const readingTime = (snapshot, host, source) => source ? source.checkedAt ?? snapshot?.collectedAt : null;
const activityHosts = snapshot => devices(snapshot).map(device => device.id)
  .filter(host => snapshot?.activity?.some(row => row?.host === host && row.status !== 'not-connected'));

export function activityNow(snapshot, host, now) {
  const dataHost = viewHost(snapshot, host);
  if (dataHost === 'All') return bothNow(snapshot, now);
  const source = liveSource(snapshot, dataHost);
  if (!source) return { value: null, reason: 'noSource', readingAt: null, current: null, previous: null, windowSeconds: null };
  const result = nowFromHours({ days: source.days, readingAt: readingTime(snapshot, dataHost, source), timeZone: snapshot?.timezone, now });
  if (source.status === 'stale') { result.value = null; result.reason = 'stale'; }
  const wall = result.reason === 'ok' ? clock(snapshot.timezone)(Date.parse(result.readingAt)) : null;
  return { ...result, windowSeconds: wall ? 3600 + wall.minute * 60 + wall.second : null };
}

// Both computers' Now is the sum of each one's Now, and Unknown when either is.
function bothNow(snapshot, now) {
  const hosts = hasAggregateScope(snapshot, 'activity') ? activityHosts(snapshot) : [];
  const each = hosts.map(host => activityNow(snapshot, host, now));
  const missing = each.find(result => result.reason !== 'ok');
  if (!each.length || missing) return { value: null, reason: missing?.reason ?? 'noSource', readingAt: null, current: null, previous: null, windowSeconds: null };
  const windowSeconds = Math.max(...each.map(result => result.windowSeconds));
  return { ...each[0], value: each.reduce((total, result) => total + result.value, 0), windowSeconds };
}

// Adds the computers' recorded days date by date. A date one computer has no record of adds
// nothing from it; a day it recorded as Unknown makes that date Unknown.
function sumDays(lists) {
  const byDate = new Map();
  for (const day of lists.flat()) {
    if (!byDate.has(day.date)) byDate.set(day.date, []);
    byDate.get(day.date).push(day);
  }
  const add = values => values.every(valid) ? values.reduce((a, b) => a + b, 0) : null;
  return [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([date, days]) => {
    const counted = days.length > 1 ? days.filter(day => !day.untracked) : days;
    const categories = {}, apps = {};
    for (const day of counted) for (const [name, seconds] of Object.entries(day.categories ?? {})) {
      if (!valid(seconds)) continue;
      categories[name] = (categories[name] ?? 0) + seconds;
      for (const [app, amount] of Object.entries(day.apps?.[name] ?? {})) if (valid(amount)) (apps[name] ??= {})[app] = (apps[name][app] ?? 0) + amount;
    }
    return { date, seconds: counted.length ? add(counted.map(day => day.seconds)) : null,
      ...(counted.every(day => validHours(day.hours)) && counted.length ? { hours: Array.from({ length: 24 }, (_, hour) => add(counted.map(day => day.hours[hour]))) } : {}),
      categories, apps, ...(counted.every(day => day.untracked) ? { untracked: true } : {}) };
  });
}

function categoriesFor(days) {
  if (!days.some(day => day.categories && typeof day.categories === 'object')) return null;
  const categories = new Map();
  for (const day of days) for (const [name, seconds] of Object.entries(day.categories ?? {})) {
    if (!valid(seconds) || seconds === 0) continue;
    const category = categories.get(name) ?? { name, label: name === 'Mixed activity' ? words.deviceOverlap : name, seconds: 0, apps: new Map() };
    category.seconds += seconds;
    for (const [app, amount] of Object.entries(day.apps?.[name] ?? {})) {
      if (valid(amount) && amount > 0) category.apps.set(app, (category.apps.get(app) ?? 0) + amount);
    }
    categories.set(name, category);
  }
  return [...categories.values()].map(category => ({ ...category, apps: [...category.apps].map(([name, seconds]) => ({ name, seconds })).sort((a, b) => b.seconds - a.seconds) })).sort((a, b) => b.seconds - a.seconds);
}

const firstDate = days => days.filter(day => valid(day.seconds) && day.seconds > 0).map(day => day.date).sort((a, b) => a.localeCompare(b))[0] ?? null;

/**
 * @param {object | null} snapshot
 * @param {{host?: string, period?: string, date?: string, now?: number}} options
 */
export function activityView(snapshot, { host = 'All', period = 'day', date, now = Date.now() } = {}) {
  const dataHost = viewHost(snapshot, host);
  const both = dataHost === 'All';
  const hosts = both && hasAggregateScope(snapshot, 'activity') ? activityHosts(snapshot) : [];
  const days = both ? sumDays(hosts.map(device => recordedDays(snapshot, 'activity', device))) : recordedDays(snapshot, 'activity', dataHost);
  const timeZone = snapshot?.timezone || null;
  const anchor = days.some(day => day.date === date) ? date : today(timeZone ?? undefined, new Date(now));
  const dates = [...new Set([...days.map(day => day.date), anchor, today(timeZone ?? undefined, new Date(now))])].sort((a, b) => b.localeCompare(a));
  const deviceSource = snapshot?.activity?.find(row => row.host === dataHost);
  const reference = deviceReadingReference(snapshot, now);
  const incomplete = !both && devicePeriodIncomplete(snapshot, deviceSource, period, anchor, now);
  const selected = incomplete ? [] : periodDays(days, period === 'now' ? 'day' : period, anchor);
  const current = activityNow(snapshot, dataHost, now);
  const reasons = { noSource: words.nowNoSource, noReading: words.nowNoReading, ahead: words.nowAhead, stale: words.nowStale, hourAfterReading: words.nowHourAfter, noHours: words.nowNoHours, daylightSaving: words.nowDaylight, timeZone: words.nowZone, ok: '' };
  // Both is the sum of each computer's own total, so the big number always matches the rows under it.
  const byDevice = hosts.map(device => {
    const view = activityView(snapshot, { host: device, period, date: anchor, now });
    return { host: device, label: deviceLabel(device), total: view.total, note: view.total === null ? view.note : '' };
  });
  const recorded = byDevice.filter(row => row.note !== strings.status.noRecords);
  const total = period === 'now' ? current.value
    : both ? recorded.length && recorded.every(row => row.total !== null) ? recorded.reduce((sum, row) => sum + row.total, 0) : null
    : periodSeconds(selected, period);
  const emptyPeriod = !incomplete && !selected.length &&
    (days.length || (!both && deviceReadingCurrent(deviceSource, reference)));
  const note = period === 'now' ? reasons[current.reason]
    : both && !hasAggregateScope(snapshot, 'activity') ? strings.status.allUnverified
    : incomplete ? deviceReadingNote(deviceSource, reference)
    : emptyPeriod || (both && byDevice.length && !recorded.length) ? strings.status.noRecords : '';
  const first = days.map(day => day.date).sort((a, b) => a.localeCompare(b))[0];
  const length = period === 'week' ? 7 : period === 'all' && first
    ? Math.max(7, Math.round((Date.parse(`${anchor}T12:00:00Z`) - Date.parse(`${first}T12:00:00Z`)) / 86400000) + 1) : 30;
  const series = Array.from({ length }, (_, index) => {
    const date = shiftDate(anchor, index - (length - 1));
    return { label: date.slice(5), date, value: recordedSum(days.filter(day => day.date === date), 'seconds') };
  });
  // Both computers' hours are known up to the earlier of their two readings.
  const readings = (both ? hosts : [dataHost]).map(device => {
    const archive = snapshot?.activityHistory?.find(row => row?.host === device);
    return stamp(readingTime(snapshot, device, liveSource(snapshot, device))) ?? stamp(archive?.asOf);
  });
  const readAt = readings.length && readings.every(Boolean) ? readings.sort((a, b) => Date.parse(a) - Date.parse(b))[0] : null;
  let read = null, present = null;
  try {
    const wall = clock(timeZone);
    if (readAt) read = wall(Date.parse(readAt));
    present = wall(now);
  } catch { /* An unknown clock cannot establish observed hours. */ }
  const hourlyDate = period === 'now' ? read?.date : anchor;
  const source = liveSource(snapshot, dataHost);
  const currentDevice = both || deviceReadingCurrent(source, deviceReadingReference(snapshot, now));
  const hourlyDays = period === 'now' ? currentDevice ? both ? days : source?.days : [] : days;
  const day = hourlyDays?.find(day => day.date === hourlyDate);
  const future = hour => present && hourlyDate === present.date && hour > present.hour;
  const hourly = ['day', 'now'].includes(period) ? Array.from({ length: 24 }, (_, hour) => ({ label: hourLabel(hour), value:
    future(hour) ? undefined : !day?.untracked && validHours(day?.hours) && read && (hourlyDate < read.date || (hourlyDate === read.date && hour <= read.hour)) ? day.hours[hour] : null })) : null;
  // Each computer's own view carries its tracking warning, so Both shows none.
  const archive = both ? null : snapshot?.activityHistory?.find(row => row?.host === dataHost);
  const status = both ? 'recent' : snapshot?.activity?.some(row => row.host === dataHost && !deviceReadingCurrent(row, deviceReadingReference(snapshot, now))) || archive?.latestReadStatus !== 'ok' ? 'unavailable' : ['recent', 'stale'].includes(archive.trackingStatus) ? archive.trackingStatus : 'unknown';
  const trackingWords = { recent: words.trackingRecent, stale: words.trackingStale, unknown: words.trackingUnknown, unavailable: words.trackingUnavailable };
  const anchorDay = days.find(day => day.date === anchor);
  return {
    devices: [['All', strings.devices.all], ...devices(snapshot).map(device => [device.id, device.label])], timeZone, anchor, dates,
    total, note, series, hourly, byDevice, since: period === 'all' ? firstDate(selected) : null,
    hourlyTitle: hourlyTitle(timeZone, now), categories: categoriesFor(selected),
    noTracking: anchorDay?.untracked === true || (anchorDay?.trackedSeconds === 0 && anchorDay?.seconds === 0),
    tracking: { status, label: trackingWords[status], through: stamp(archive?.trackingThrough), asOf: stamp(archive?.asOf) },
    windowSeconds: current.windowSeconds, windowLabel: format(words.windowOf, { span: duration(current.windowSeconds) }),
  };
}
