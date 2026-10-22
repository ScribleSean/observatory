import strings from './strings.json' with { type: 'json' };
import { format } from './format.mjs';
import { nowFromHours, activityNow } from './view-activity.mjs';

export { format };

export const HIDDEN_BUCKETS = ['codex_bengalfox', 'codex_spark', 'spark'];
export const CLOCK_SKEW_MS = 2 * 60000;
export const READING_FRESH_MS = 10 * 60000;
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
      snapshot.combinedTokens?.status === 'ok' || snapshot.combinedTokens?.verification?.status === 'verified' ||
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
  if (!['activity', 'tokens'].includes(key)) return false;
  const [first, second] = key === 'tokens' ? ['tokens', 'settings'] : ['activity', 'activityHistory'];
  const scope = field => snapshot?.[field] === undefined ? [] : Array.isArray(snapshot[field]) ? rows(snapshot[field]) : null;
  const sources = scope(first), siblings = scope(second);
  if (!sources || !siblings) return false;
  const retired = [...sources, ...siblings].some(row => {
    const host = text(row.host);
    if (NATIVE_HOSTS.includes(host) || (key === 'activity' && host === 'Combined')) return false;
    return hasSourceEvidence(row);
  });
  if (retired) return false;
  if (key === 'activity') return true;
  return NATIVE_HOSTS.every(host => {
    const matches = sources.filter(row => text(row.host) === host);
    return matches.length === 1 && text(matches[0].status) === 'ok' && Array.isArray(matches[0].days);
  });
}

export function deviceReadingReference(snapshot, now = Date.now()) {
  const collected = Date.parse(snapshot?.collectedAt);
  return Number.isFinite(collected) && collected - Number(now) <= CLOCK_SKEW_MS ? collected : Number(now);
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

export function devicePeriodIncomplete(snapshot, source, period, anchor, now = Date.now()) {
  if (!deviceReadingLate(source, deviceReadingReference(snapshot, now))) return false;
  const checked = Date.parse(source.checkedAt);
  return period === 'all' || period === 'now' || !Number.isFinite(checked) || anchor >= today(snapshot?.timezone, new Date(checked));
}

export function deviceCompleteDays(snapshot, source, now = Date.now(), field = 'days') {
  if (!deviceReadingLate(source, deviceReadingReference(snapshot, now)))
    return source?.status === 'ok' ? byDate(rows(source[field])) : [];
  const checked = Date.parse(source.checkedAt);
  return Number.isFinite(checked) ? byDate(rows(source[field])).filter(day => day.date < today(snapshot?.timezone, new Date(checked))) : [];
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

export function recordedDays(snapshot, key, host, now = Date.now()) {
  const days = recordedDaysRaw(snapshot, key, host, now);
  return key === 'activity' ? days.map(day => untrackedDay(day) ? { ...day, seconds: null, untracked: true } : day) : days;
}

function recordedDaysRaw(snapshot, key, host, now) {
  if (!snapshot) return [];
  if (host === 'All' && !hasAggregateScope(snapshot, key)) return [];
  const source = rows(snapshot[key]).find(row => text(row.host) === host);
  if (key === 'activity') {
    const archive = rows(snapshot.activityHistory).find(row => text(row.host) === (host === 'All' ? 'Combined' : host));
    if (archive) {
      if (host !== 'All' && deviceReadingLate(source, deviceReadingReference(snapshot, now)))
        return deviceCompleteDays(snapshot, { ...source, days: archive.days }, now);
      return text(archive.status) === 'ok' ? byDate(rows(archive.days)) : [];
    }
  }
  let selected;
  if (host === 'All') {
    if (key === 'activity') selected = snapshot.combined;
    else {
      selected = snapshot.combinedTokens;
      if (text(selected?.verification?.status) !== 'verified') return [];
    }
  } else selected = rows(snapshot[key]).find(row => text(row.host) === host);
  if (host === 'All') return selected?.status === 'ok' ? byDate(rows(selected.days)) : [];
  return deviceCompleteDays(snapshot, selected, now);
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
  const names = snapshot?.deviceNames && typeof snapshot.deviceNames === 'object' ? snapshot.deviceNames : {};
  const platform = host => host === 'Mac' ? strings.devices.macOS : strings.devices.windows;
  return NATIVE_HOSTS.filter(host => hosts.has(host))
    .map(host => ({ id: host, label: typeof names[host] === 'string' && names[host].trim() ? names[host].trim() : platform(host) }));
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
  for (const [divisor, suffix] of [[1e12, strings.formats.trillion], [1e9, strings.formats.billion], [1e6, strings.formats.million], [1e3, strings.formats.thousand]])
    if (amount >= divisor) return format(strings.formats.compact, { value: +(amount / divisor).toFixed(1), suffix });
  return String(Math.round(amount));
}

export function duration(seconds) {
  const amount = number(seconds);
  if (amount === null) return strings.status.unknown;
  const minutes = Math.floor(amount / 60);
  if (minutes < 60) return format(strings.formats.minutes, { minutes });
  return format(strings.formats.hoursMinutes, { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

export function freshness(timestamp, now = Date.now()) {
  const at = Date.parse(timestamp);
  if (Number.isNaN(at)) return { label: strings.status.updatedUnknown, stale: true };
  const age = now - at;
  if (age < -CLOCK_SKEW_MS) return { label: strings.status.updateAhead, stale: true };
  const stale = age > 15 * 60000;
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

function providerLimits(id, name, quota, now, missing, storedPace) {
  const status = text(quota?.status);
  const windows = rows(quota?.windows).filter(row => !HIDDEN_BUCKETS.includes(text(row.bucket).toLowerCase()));
  if (!quota || !['ok', 'stale'].includes(status) || windows.length === 0) {
    const note = !quota || status === 'not-connected' ? missing : status === 'needs-auth' ? format(strings.status.signIn, { name }) : strings.status.noReading;
    return [{ provider: id, name, window: '', bucket: '', windowId: '', remaining: null, note, low: false, stale: false }];
  }
  return windows.map(row => {
    const own = Date.parse(row.checkedAt), source = Date.parse(quota.checkedAt);
    const checkedAt = Number.isFinite(own) && Number.isFinite(source) && own <= source ? row.checkedAt : quota.checkedAt;
    const checked = Date.parse(checkedAt);
    const current = status === 'ok' && !Number.isNaN(checked) && now >= checked && now - checked < READING_FRESH_MS;
    const remaining = number(row.remainingPercent);
    const reset = Date.parse(row.resetsAt);
    const valid = remaining !== null && remaining <= 100 && !(reset <= now);
    const notes = [Number.isNaN(reset) ? strings.status.resetUnknown : reset <= now ? strings.limits.resetPending : format(strings.formats.resetsIn, { span: span(reset - now) })];
    const pace = rows(quota.pace).find(item => text(item.bucket) === text(row.bucket) && text(item.window) === text(row.window));
    const exhausted = Date.parse(pace?.estimatedExhaustionAt);
    if (storedPace && valid && current && pace && text(pace.asOf) === text(checkedAt) && text(pace.status) === 'projected' && exhausted > now)
      notes.push(format(strings.formats.runsOut, { span: span(exhausted - now) }));
    if (!current) notes.push(Number.isNaN(checked) ? strings.status.readingUnknown : format(strings.formats.asOf, { time: readingTime(checked, now) }));
    return { provider: id, name, window: windowLabel(row.durationMinutes), bucket: row.bucket, windowId: row.window, remaining: valid ? remaining : null,
      note: notes.join(strings.formats.separator), low: valid && remaining < 20, stale: !current };
  });
}

export function totals(snapshot, host, period, now = new Date()) {
  const dataHost = viewHost(snapshot, host);
  if (period === 'now') {
    const time = now instanceof Date ? now.getTime() : now;
    const value = result => result.reason === 'ok' ? result.value : null;
    const read = source => source?.status === 'ok' ? value(nowFromHours({ days: source.days,
      readingAt: dataHost === 'All' ? source.checkedAt : source.checkedAt ?? snapshot?.collectedAt,
      timeZone: snapshot?.timezone, now: time })) : null;
    const codex = dataHost === 'All'
      ? hasAggregateScope(snapshot, 'tokens') && snapshot?.combinedTokens?.verification?.status === 'verified' ? snapshot.combinedTokens : null
      : rows(snapshot?.tokens).find(row => row.host === dataHost);
    const claude = rows(snapshot?.providerTokenSources).find(row => row.provider === 'claude-code' && row.host === dataHost);
    const codexTokens = read(codex), claudeTokens = dataHost === 'All' ? null : read(claude);
    const seconds = value(activityNow(snapshot, host, time));
    const noteFor = source => dataHost === 'All' ? '' : unknownAsOf(deviceReadingNote(source, deviceReadingReference(snapshot, now)));
    return { codexTokens, claudeTokens, claudeNote: dataHost === 'All' ? strings.status.byDevice : noteFor(claude), codexNote: noteFor(codex),
      timeNote: noteFor(rows(snapshot?.activity).find(row => row.host === dataHost)), usd: null, seconds,
      note: [codexTokens, claudeTokens, seconds].some(value => value !== null) ? strings.activity.nowCaveat : strings.status.hourlyUnavailable };
  }
  const anchor = today(text(snapshot?.timezone), now);
  const pick = days => periodDays(days, period, anchor);
  const incomplete = key => dataHost !== 'All' && devicePeriodIncomplete(snapshot, rows(snapshot?.[key]).find(row => row.host === dataHost), period, anchor, now);
  const tokenDays = incomplete('tokens') ? [] : pick(recordedDays(snapshot, 'tokens', dataHost, now));
  const activityDays = incomplete('activity') ? [] : pick(recordedDays(snapshot, 'activity', dataHost, now));
  const estimates = tokenDays.map(day => day.apiEstimate).filter(value => value && typeof value === 'object');
  const blocked = dataHost === 'All' && !hasAggregateScope(snapshot, 'tokens');
  let claudeTokens = null, claudeNote = '';
  if (dataHost === 'All') claudeNote = strings.status.byDevice;
  else {
    const source = rows(snapshot?.providerTokenSources).find(row => text(row.provider) === 'claude-code' && text(row.host) === dataHost);
    claudeNote = unknownAsOf(deviceReadingNote(source, deviceReadingReference(snapshot, now)));
    if (deviceReadingCurrent(source, deviceReadingReference(snapshot, now))) {
      const claudeDays = pick(byDate(rows(source.days)));
      claudeTokens = recordedSum(claudeDays, 'totalTokens');
      if (claudeDays.length === 0) claudeNote = strings.status.noRecords;
    }
  }
  const sourceNote = key => dataHost === 'All' ? '' : unknownAsOf(deviceReadingNote(rows(snapshot?.[key]).find(row => row.host === dataHost), deviceReadingReference(snapshot, now)));
  const hasReading = key => recordedDays(snapshot, key, dataHost, now).length > 0 ||
    (dataHost !== 'All' && deviceReadingCurrent(rows(snapshot?.[key]).find(row => row.host === dataHost), deviceReadingReference(snapshot, now)));
  const readTokens = !blocked && hasReading('tokens');
  const readActivity = hasReading('activity');
  return {
    codexTokens: recordedSum(tokenDays, 'totalTokens'),
    claudeTokens, claudeNote,
    codexNote: sourceNote('tokens') || (readTokens && tokenDays.length === 0 ? strings.status.noRecords : ''),
    timeNote: sourceNote('activity') || (readActivity && activityDays.length === 0 ? strings.status.noRecords : ''),
    usd: estimates.length === tokenDays.length ? recordedSum(estimates, 'usd') : null,
    seconds: recordedSum(activityDays, 'seconds'),
    note: blocked ? strings.status.allUnverified : '',
  };
}

export function sourceCounts(snapshot, now = Date.now()) {
  let sources = ['activity', 'tokens', 'settings', 'providerTokenSources'].flatMap(key => rows(snapshot?.[key]));
  if (snapshot?.quota && typeof snapshot.quota === 'object') sources.push(snapshot.quota);
  if (snapshot?.claudeLimits && typeof snapshot.claudeLimits === 'object' && !Array.isArray(snapshot.claudeLimits)) sources.push(snapshot.claudeLimits);
  sources = sources.filter(row => text(row.status) !== 'not-connected');
  return { read: sources.filter(row => NATIVE_HOSTS.includes(row.host) ? deviceReadingCurrent(row, deviceReadingReference(snapshot, now)) : text(row.status) === 'ok').length, total: sources.length };
}

export { sampleSnapshot as demoSnapshot } from './sample-snapshot.mjs';
