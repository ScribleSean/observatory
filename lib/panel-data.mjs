import strings from './strings.json' with { type: 'json' };
import { format } from './format.mjs';
import { nowFromHours, activityNow } from './view-activity.mjs';
import { READING_FRESH_MS, readingFresh, snapshotFresh } from './freshness.mjs';
import { LIMIT_LOW_PERCENT, LIMIT_SPENT_PERCENT } from './glance-limits.mjs';

export { format };

export const HIDDEN_BUCKETS = ['codex_bengalfox', 'codex_spark', 'spark'];
export const CLOCK_SKEW_MS = 2 * 60000;
const NATIVE_HOSTS = ['Mac', 'Windows'];

const rows = value => Array.isArray(value) ? value.filter(row => row && typeof row === 'object' && !Array.isArray(row)) : [];
const text = value => typeof value === 'string' ? value : strings.status.unknown;
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const byDate = days => [...days].sort((a, b) => text(a.date) < text(b.date) ? -1 : text(a.date) > text(b.date) ? 1 : 0);

const hasSourceEvidence = row => text(row.status) !== 'not-connected' ||
  ['days', 'profiles', 'tools'].some(field => row[field] !== undefined && !(Array.isArray(row[field]) && row[field].length === 0));

export function soleHost(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const sources = ['activity', 'tokens', 'settings', 'providerTokenSources'].flatMap(key => rows(snapshot[key]));
  const history = rows(snapshot.activityHistory);
  const hasDays = row => Array.isArray(row?.days) && row.days.length > 0;
  const present = new Set([
    ...sources.filter(row => row.status !== 'not-connected'),
    ...history.filter(row => row.status === 'ok' || hasDays(row)),
  ].filter(row => NATIVE_HOSTS.includes(row.host)).map(row => row.host));
  if (present.size !== 1) return null;
  const [host] = present;
  const otherRows = [...sources, ...history.filter(row =>
    !(NATIVE_HOSTS.includes(row.host) && row.status === 'unavailable' && !hasDays(row)))];
  if (snapshot.combined?.status === 'ok' || hasDays(snapshot.combined) ||
      history.some(row => row.host === 'Combined' && (row.status === 'ok' || hasDays(row))) ||
      (snapshot.peerQuota && typeof snapshot.peerQuota === 'object') ||
      otherRows.some(row => ![host, 'Combined', 'All'].includes(row.host) &&
        (NATIVE_HOSTS.includes(row.host) ? row.status !== 'not-connected' : hasSourceEvidence(row)))) return null;
  return host;
}

export function viewHost(snapshot, host) {
  return host === 'All' ? soleHost(snapshot) ?? host : host;
}

export function recordedSum(values, field) {
  if (values.length === 0) return null;
  let total = 0;
  for (const value of values) {
    const next = number(value[field]);
    if (next === null) return null;
    total += next;
  }
  return total;
}

export function hasAggregateScope(snapshot, key) {
  if (key !== 'activity') return false;
  const scope = field => snapshot?.[field] === undefined ? [] : Array.isArray(snapshot[field]) ? rows(snapshot[field]) : null;
  const sources = scope('activity'), siblings = scope('activityHistory');
  if (!sources || !siblings) return false;
  return ![...sources, ...siblings].some(row => {
    const host = text(row.host);
    return !NATIVE_HOSTS.includes(host) && host !== 'Combined' && hasSourceEvidence(row);
  });
}

export function deviceReadingReference(snapshot, now = Date.now()) {
  return Number(now);
}

export function deviceReadingCurrent(source, reference = Date.now()) {
  if (source?.status !== 'ok') return false;
  if (source.checkedAt === undefined) return true;
  const checked = Date.parse(source.checkedAt);
  return Number.isFinite(checked) && Number(reference) - checked <= READING_FRESH_MS;
}

export function deviceReadingLate(source, reference = Date.now()) {
  return source?.status === 'stale' || (source?.status === 'ok' &&
    Number(reference) - Date.parse(source.checkedAt) > READING_FRESH_MS);
}

// A computer that has not been heard from keeps its past. Only a period that reaches its
// last reading is incomplete, and All counts everything it recorded up to that reading.
export function devicePeriodIncomplete(snapshot, source, period, anchor, now = Date.now()) {
  if (period === 'all' || !deviceReadingLate(source, deviceReadingReference(snapshot, now))) return false;
  const checked = Date.parse(source.checkedAt);
  return period === 'now' || !Number.isFinite(checked) || anchor >= today(snapshot?.timezone, new Date(checked));
}

export function deviceDays(source, field = 'days') {
  return ['ok', 'stale'].includes(source?.status) ? byDate(rows(source[field])) : [];
}

// Days with tracking off hold no record. A single such day is Unknown, but a longer period counts the days that were tracked.
export function periodSeconds(days, period) {
  return recordedSum(period === 'day' || period === 'now' ? days : days.filter(day => !day.untracked), 'seconds');
}

export function deviceReadingNote(source, reference = Date.now()) {
  const checked = Date.parse(source?.checkedAt);
  return source && ['ok', 'stale'].includes(source.status) && !deviceReadingCurrent(source, reference) && Number.isFinite(checked)
    ? format(strings.formats.asOf, { time: readingTime(checked, reference) }) : '';
}

const unknownAsOf = note => note ? [strings.status.unknown, note].join(strings.formats.separator) : '';

export function untrackedDay(day) {
  return number(day?.trackedSeconds) === 0 && number(day?.seconds) === 0;
}

export function recordedDays(snapshot, key, host) {
  const days = recordedDaysRaw(snapshot, key, host);
  return key === 'activity' ? days.map(day => untrackedDay(day) ? { ...day, seconds: null, untracked: true } : day) : days;
}

// One computer's days. Both computers' days are added up by the views.
function recordedDaysRaw(snapshot, key, host) {
  if (!snapshot || !NATIVE_HOSTS.includes(host)) return [];
  const archive = key === 'activity' ? rows(snapshot.activityHistory).find(row => text(row.host) === host) : null;
  if (!archive) return deviceDays(rows(snapshot[key]).find(row => text(row.host) === host));
  return text(archive.status) === 'ok' ? byDate(rows(archive.days)) : [];
}

const noon = date => Date.parse(date + 'T12:00:00Z');

export function periodDays(days, period, anchor) {
  if (!['day', 'week', 'month', 'all'].includes(period) || days.length === 0) return [];
  const sorted = byDate(days);
  if (sorted.some(day => Number.isNaN(noon(text(day.date))))) return [];
  if (period === 'all') return sorted;
  const end = noon(anchor);
  if (Number.isNaN(end)) return [];
  const span = period === 'week' ? 6 : period === 'month' ? 29 : 0;
  const start = end - span * 86400000;
  return sorted.filter(day => noon(day.date) >= start && noon(day.date) <= end);
}

export function today(timeZone, now = new Date()) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }
  catch { return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }
}

export function devices(snapshot) {
  const hosts = new Set();
  for (const key of ['activity', 'tokens'])
    for (const row of rows(snapshot?.[key]))
      if (NATIVE_HOSTS.includes(text(row.host)) && text(row.status) !== 'not-connected') hosts.add(row.host);
  return NATIVE_HOSTS.filter(host => hosts.has(host))
    .map(host => ({ id: host, label: deviceLabel(host), name: deviceName(snapshot, host) }));
}

export function deviceLabel(host) {
  return host === 'Mac' ? strings.devices.mac : host === 'Windows' ? strings.devices.pc : typeof host === 'string' && host ? host : strings.status.unknown;
}

export function deviceName(snapshot, host) {
  const name = snapshot?.deviceNames?.[host];
  return typeof name === 'string' && name.trim() ? name.trim() : deviceLabel(host);
}

export function usd(value) {
  const amount = number(value);
  if (amount === null) return strings.status.unknown;
  if (amount > 0 && amount < 0.005) return strings.tokens.underCent;
  return format(strings.formats.usd, { value: amount < 10 ? amount.toFixed(2) : Math.round(amount).toLocaleString('en-US') });
}

export function percent(value) {
  const amount = number(value);
  return amount === null ? strings.status.unknown : format(strings.formats.percent, { value: Math.round(amount) });
}

export function windowLabel(minutes) {
  const value = number(minutes);
  if (!value) return strings.status.unknownWindow;
  if (value === 10080) return strings.formats.weekly;
  if (value >= 1440) return format(strings.formats.day, { value: +(value / 1440).toFixed(1) });
  if (value >= 60) return format(strings.formats.hour, { value: +(value / 60).toFixed(1) });
  return format(strings.formats.minute, { value: Math.round(value) });
}

export function span(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return strings.status.unknown;
  const minutes = Math.round(milliseconds / 60000);
  if (minutes < 60) return format(strings.formats.minutes, { minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return format(strings.formats.hoursMinutes, { hours, minutes: minutes % 60 });
  return format(strings.formats.daysHours, { days: Math.floor(hours / 24), hours: hours % 24 });
}

export function compact(value) {
  const amount = number(value);
  if (amount === null) return strings.status.unknown;
  const units = [[1e12, strings.formats.trillion], [1e9, strings.formats.billion], [1e6, strings.formats.million], [1e3, strings.formats.thousand]];
  for (const [index, [divisor, suffix]] of units.entries()) {
    if (amount < divisor) continue;
    const scaled = amount / divisor;
    const text = scaled < 10 ? String(+scaled.toFixed(1)) : String(Math.round(scaled));
    // Rounding can reach the next unit (999,600 is 1000K), so step up instead.
    if (text === '1000' && index > 0) return format(strings.formats.compact, { value: 1, suffix: units[index - 1][1] });
    return format(strings.formats.compact, { value: text, suffix });
  }
  const whole = Math.round(amount);
  return whole === 1000 ? format(strings.formats.compact, { value: 1, suffix: strings.formats.thousand }) : String(whole);
}

export function duration(seconds) {
  const amount = number(seconds);
  if (amount === null) return strings.status.unknown;
  const minutes = Math.round(amount / 60);
  if (minutes < 60) return format(strings.formats.minutes, { minutes });
  return format(strings.formats.hoursMinutes, { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

export function freshness(timestamp, now = Date.now()) {
  const at = Date.parse(timestamp);
  if (Number.isNaN(at)) return { label: strings.status.updatedUnknown, stale: true };
  const age = now - at;
  if (age < -CLOCK_SKEW_MS) return { label: strings.status.updateAhead, stale: true };
  const stale = !snapshotFresh(at, now);
  if (age < 60000) return { label: strings.status.updatedNow, stale };
  return { label: format(strings.status.updatedAgo, { age: span(age) }), stale };
}

export function limits(snapshot, now = Date.now(), { storedPace = true } = {}) {
  const result = [];
  const claude = snapshot?.claudeLimits;
  result.push(...providerLimits('claude', strings.providers.claudeCode, claude, now, strings.status.notCollected, storedPace));
  result.push(...providerLimits('codex', strings.providers.codex, snapshot?.quota, now, strings.status.enableLimits, storedPace));
  return result;
}

export function readingTime(checked, now = Date.now()) {
  const at = new Date(checked), today = new Date(now);
  const sameDay = at.getFullYear() === today.getFullYear() && at.getMonth() === today.getMonth() && at.getDate() === today.getDate();
  return sameDay ? at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : at.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const REPORTED_WINDOWS = { five_hour: 300, seven_day: 10080 };

function providerLimits(id, name, quota, now, missing, storedPace) {
  const status = text(quota?.status);
  const windows = rows(quota?.windows).filter(row => !HIDDEN_BUCKETS.includes(text(row.bucket).toLowerCase()));
  // A window the provider left out of its latest reading has no limit to show, which is not the same as Unknown.
  const absent = ['ok', 'stale'].includes(status) && Array.isArray(quota?.notReported) ? quota.notReported.filter(window => Object.hasOwn(REPORTED_WINDOWS, window))
    .map(window => ({ provider: id, name, window: windowLabel(REPORTED_WINDOWS[window]), bucket: text(windows[0]?.bucket), windowId: window, remaining: null,
      note: '', absent: strings.status.notReported, low: false, spent: false, stale: false })) : [];
  if (!quota || !['ok', 'stale'].includes(status) || windows.length === 0) {
    const note = !quota || status === 'not-connected' ? missing : status === 'needs-auth' ? format(strings.status.signIn, { name }) : strings.status.noReading;
    return [{ provider: id, name, window: '', bucket: '', windowId: '', remaining: null, note, low: false, spent: false, stale: false }];
  }
  return windows.map(row => {
    const own = Date.parse(row.checkedAt), source = Date.parse(quota.checkedAt);
    const checkedAt = Number.isFinite(own) && Number.isFinite(source) && own <= source ? row.checkedAt : quota.checkedAt;
    const checked = Date.parse(checkedAt);
    const current = status === 'ok' && readingFresh(checked, now);
    const remaining = number(row.remainingPercent);
    const reset = Date.parse(row.resetsAt);
    const valid = remaining !== null && remaining <= 100 && !(reset <= now);
    const notes = [Number.isNaN(reset) ? strings.status.resetUnknown : reset <= now ? strings.limits.resetPending : format(strings.formats.resetsIn, { span: span(reset - now) })];
    const pace = rows(quota.pace).find(item => text(item.bucket) === text(row.bucket) && text(item.window) === text(row.window));
    const exhausted = Date.parse(pace?.estimatedExhaustionAt);
    if (storedPace && valid && current && pace && text(pace.asOf) === text(checkedAt) && text(pace.status) === 'projected' && exhausted > now)
      notes.push(format(strings.formats.runsOut, { span: span(exhausted - now) }));
    if (!current) notes.push(Number.isNaN(checked) ? strings.status.readingUnknown : format(strings.formats.asOf, { time: readingTime(checked, now) }));
    return { provider: id, name, window: windowLabel(number(row.durationMinutes) ?? REPORTED_WINDOWS[row.window]), bucket: row.bucket, windowId: row.window, remaining: valid ? remaining : null,
      note: notes.join(strings.formats.separator), low: valid && remaining <= LIMIT_LOW_PERCENT, spent: valid && remaining <= LIMIT_SPENT_PERCENT, stale: !current };
  }).concat(absent);
}

const EXPECTED_WINDOWS = [300, 10080];

export function limitsWithGaps(rows) {
  const labels = EXPECTED_WINDOWS.map(windowLabel);
  const rank = row => { const index = labels.indexOf(row.window); return index < 0 ? labels.length : index; };
  return ['claude', 'codex'].flatMap(provider => {
    const own = rows.filter(row => row.provider === provider);
    if (!own.some(row => labels.includes(row.window))) return own;
    const name = own[0].name;
    const gaps = labels.filter(label => !own.some(row => row.window === label)).map(label =>
      ({ provider, name, window: label, bucket: '', windowId: '', remaining: null, note: strings.status.noReading, low: false, spent: false, stale: false }));
    return [...own, ...gaps].sort((a, b) => rank(a) - rank(b));
  }).concat(rows.filter(row => !['claude', 'codex'].includes(row.provider)));
}

export function totals(snapshot, host, period, now = new Date()) {
  const reference = deviceReadingReference(snapshot, now);
  const sourceFor = key => rows(snapshot?.[key]).find(row => row.host === host);
  const claude = rows(snapshot?.providerTokenSources).find(row => text(row.provider) === 'claude-code' && text(row.host) === host);
  const noteFor = source => unknownAsOf(deviceReadingNote(source, reference));
  if (period === 'now') {
    const time = now instanceof Date ? now.getTime() : now;
    const value = result => result.reason === 'ok' ? result.value : null;
    const read = source => source?.status === 'ok' ? value(nowFromHours({ days: source.days,
      readingAt: source.checkedAt ?? snapshot?.collectedAt, timeZone: snapshot?.timezone, now: time })) : null;
    const codex = sourceFor('tokens');
    const codexTokens = read(codex), claudeTokens = read(claude);
    const seconds = value(activityNow(snapshot, host, time));
    return { codexTokens, claudeTokens, claudeNote: noteFor(claude), codexNote: noteFor(codex),
      timeNote: noteFor(sourceFor('activity')), usd: null, seconds,
      note: [codexTokens, claudeTokens, seconds].some(value => value !== null) ? strings.activity.nowCaveat : strings.status.hourlyUnavailable };
  }
  const anchor = today(text(snapshot?.timezone), now);
  const pick = days => periodDays(days, period, anchor);
  const incomplete = source => devicePeriodIncomplete(snapshot, source, period, anchor, now);
  const lateNote = source => incomplete(source) ? noteFor(source) : '';
  const tokenDays = incomplete(sourceFor('tokens')) ? [] : pick(recordedDays(snapshot, 'tokens', host));
  const activityDays = incomplete(sourceFor('activity')) ? [] : pick(recordedDays(snapshot, 'activity', host));
  const estimates = tokenDays.map(day => day.apiEstimate).filter(value => value && typeof value === 'object');
  let claudeTokens = null, claudeNote = lateNote(claude);
  if (!incomplete(claude) && ['ok', 'stale'].includes(claude?.status)) {
    const claudeDays = pick(deviceDays(claude));
    claudeTokens = recordedSum(claudeDays, 'totalTokens');
    if (claudeDays.length === 0) claudeNote = strings.status.noRecords;
  }
  const hasReading = key => recordedDays(snapshot, key, host).length > 0 || deviceReadingCurrent(sourceFor(key), reference);
  return {
    codexTokens: recordedSum(tokenDays, 'totalTokens'),
    claudeTokens, claudeNote,
    codexNote: lateNote(sourceFor('tokens')) || (hasReading('tokens') && tokenDays.length === 0 ? strings.status.noRecords : ''),
    timeNote: lateNote(sourceFor('activity')) || (hasReading('activity') && activityDays.length === 0 ? strings.status.noRecords : ''),
    usd: estimates.length === tokenDays.length ? recordedSum(estimates, 'usd') : null,
    seconds: periodSeconds(activityDays, period),
  };
}
