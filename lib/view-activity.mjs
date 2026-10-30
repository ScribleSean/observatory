import { devicePeriodIncomplete, deviceReadingReference, deviceReadingCurrent, deviceReadingNote, viewHost, CLOCK_SKEW_MS, recordedDays, periodDays, recordedSum, hasAggregateScope, devices, today, duration } from './panel-data.mjs';
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
  if (host === 'All') return hasAggregateScope(snapshot, 'activity') && snapshot?.combined?.status === 'ok' ? snapshot.combined : null;
  return snapshot?.activity?.find(row => row?.host === host && ['ok', 'stale'].includes(row.status)) ?? null;
}
const readingTime = (snapshot, host, source) => source ? (host === 'All' ? source.checkedAt : source.checkedAt ?? snapshot?.collectedAt) : null;

export function activityNow(snapshot, host, now) {
  const dataHost = viewHost(snapshot, host);
  const source = liveSource(snapshot, dataHost);
  if (!source) return { value: null, reason: 'noSource', readingAt: null, current: null, previous: null, windowSeconds: null };
  const result = nowFromHours({ days: source.days, readingAt: readingTime(snapshot, dataHost, source), timeZone: snapshot?.timezone, now });
  if (source.status === 'stale') { result.value = null; result.reason = 'stale'; }
  const wall = result.reason === 'ok' ? clock(snapshot.timezone)(Date.parse(result.readingAt)) : null;
  return { ...result, windowSeconds: wall ? 3600 + wall.minute * 60 + wall.second : null };
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

/**
 * @param {object | null} snapshot
 * @param {{host?: string, period?: string, date?: string, now?: number}} options
 */
export function activityView(snapshot, { host = 'All', period = 'day', date, now = Date.now() } = {}) {
  const dataHost = viewHost(snapshot, host);
  const days = recordedDays(snapshot, 'activity', dataHost, now);
  const timeZone = snapshot?.timezone || null;
  const anchor = days.some(day => day.date === date) ? date : today(timeZone ?? undefined, new Date(now));
  const dates = [...new Set([...days.map(day => day.date), anchor, today(timeZone ?? undefined, new Date(now))])].sort((a, b) => b.localeCompare(a));
  const deviceSource = snapshot?.activity?.find(row => row.host === dataHost);
  const reference = deviceReadingReference(snapshot, now);
  const incomplete = dataHost !== 'All' && devicePeriodIncomplete(snapshot, deviceSource, period, anchor, now);
  const selected = incomplete ? [] : periodDays(days, period === 'now' ? 'day' : period, anchor);
  const current = activityNow(snapshot, dataHost, now);
  const reasons = { noSource: words.nowNoSource, noReading: words.nowNoReading, ahead: words.nowAhead, stale: words.nowStale, hourAfterReading: words.nowHourAfter, noHours: words.nowNoHours, daylightSaving: words.nowDaylight, timeZone: words.nowZone, ok: '' };
  const emptyPeriod = !incomplete && !selected.length &&
    (days.length || (dataHost !== 'All' && deviceReadingCurrent(deviceSource, reference)));
  const note = period === 'now' ? reasons[current.reason]
    : dataHost === 'All' && !hasAggregateScope(snapshot, 'activity') ? strings.status.allUnverified
    : incomplete ? deviceReadingNote(deviceSource, reference)
    : emptyPeriod ? strings.status.noRecords : '';
  const series = Array.from({ length: period === 'week' ? 7 : 30 }, (_, index) => {
    const date = shiftDate(anchor, index - (period === 'week' ? 6 : 29));
    return { label: date.slice(5), date, value: recordedSum(days.filter(day => day.date === date), 'seconds') };
  });
  const source = liveSource(snapshot, dataHost);
  const archive = snapshot?.activityHistory?.find(row => row?.host === (dataHost === 'All' ? 'Combined' : dataHost));
  const readAt = stamp(readingTime(snapshot, dataHost, source)) ?? stamp(archive?.asOf);
  let read = null;
  try {
    const wall = clock(timeZone);
    if (readAt) read = wall(Date.parse(readAt));
  } catch { /* An unknown clock cannot establish observed hours. */ }
  const hourlyDate = period === 'now' ? read?.date : anchor;
  const currentDevice = dataHost === 'All' || deviceReadingCurrent(source, deviceReadingReference(snapshot, now));
  const hourlyDays = period === 'now' ? currentDevice ? source?.days : [] : days;
  const day = hourlyDays?.find(day => day.date === hourlyDate);
  const hourly = ['day', 'now'].includes(period) ? Array.from({ length: 24 }, (_, hour) => ({ label: String(hour), value:
    !day?.untracked && validHours(day?.hours) && read && (hourlyDate < read.date || (hourlyDate === read.date && hour <= read.hour)) ? day.hours[hour] : null })) : null;
  const status = (dataHost !== 'All' && snapshot?.activity?.some(row => row.host === dataHost && !deviceReadingCurrent(row, deviceReadingReference(snapshot, now)))) || archive?.latestReadStatus !== 'ok' ? 'unavailable' : ['recent', 'stale'].includes(archive.trackingStatus) ? archive.trackingStatus : 'unknown';
  const trackingWords = {
    recent: [words.trackingRecent, dataHost === 'All' ? words.trackingRecentCombinedDetail : words.trackingRecentDetail],
    stale: [words.trackingStale, words.trackingStaleDetail], unknown: [words.trackingUnknown, words.trackingUnknownDetail], unavailable: [words.trackingUnavailable, words.trackingUnavailableDetail],
  };
  const zone = timeZone || strings.status.unknown;
  const zoneCaveat = format(words.zoneCaveat, { zone });
  const anchorDay = days.find(day => day.date === anchor);
  return {
    devices: [['All', strings.devices.all], ...devices(snapshot).map(device => [device.id, device.label])], timeZone, anchor, dates,
    total: period === 'now' ? current.value : recordedSum(selected, 'seconds'), note, series, hourly,
    zoneLabel: format(words.hourlyTitle, { zone }), categories: categoriesFor(selected),
    noTracking: anchorDay?.untracked === true || (anchorDay?.trackedSeconds === 0 && anchorDay?.seconds === 0),
    tracking: { status, label: trackingWords[status][0], detail: trackingWords[status][1], through: stamp(archive?.trackingThrough), asOf: stamp(archive?.asOf) },
    windowSeconds: current.windowSeconds, windowLabel: format(words.windowOf, { span: duration(current.windowSeconds) }),
    info: [...(period === 'now' ? [words.nowCaveat] : []), zoneCaveat, words.foregroundNote, words.missingDates].join(' '),
  };
}
