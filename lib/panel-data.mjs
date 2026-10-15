import strings from './strings.json' with { type: 'json' };
import { format } from './format.mjs';
import { nowFromHours, activityNow } from './view-activity.mjs';

// One formatter for the viewer. It throws on a missing placeholder.
export { format };

// Shared view logic for the panel. It reads the sanitized snapshot only.
// Device records are never added together here. The collector's verified
// aggregates are the only source for All.

export const PERIODS = ['now', 'day', 'week', 'month', 'all'];
export const HIDDEN_BUCKETS = ['codex_bengalfox', 'codex_spark', 'spark'];
export const READING_FRESH_MS = 10 * 60000;
const NATIVE_HOSTS = ['Mac', 'Windows'];

const rows = value => Array.isArray(value) ? value.filter(row => row && typeof row === 'object' && !Array.isArray(row)) : [];
const text = value => typeof value === 'string' ? value : strings.status.unknown;
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const byDate = days => [...days].sort((a, b) => text(a.date) < text(b.date) ? -1 : text(a.date) > text(b.date) ? 1 : 0);

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
    return text(row.status) !== 'not-connected' ||
      ['days', 'profiles', 'tools'].some(field => row[field] !== undefined && !(Array.isArray(row[field]) && row[field].length === 0));
  });
  if (retired) return false;
  if (key === 'activity') return true;
  return NATIVE_HOSTS.every(host => {
    const matches = sources.filter(row => text(row.host) === host);
    return matches.length === 1 && text(matches[0].status) === 'ok' && Array.isArray(matches[0].days);
  });
}

export function recordedDays(snapshot, key, host) {
  if (!snapshot) return [];
  if (host === 'All' && !hasAggregateScope(snapshot, key)) return [];
  if (key === 'activity') {
    const archive = rows(snapshot.activityHistory).find(row => text(row.host) === (host === 'All' ? 'Combined' : host));
    if (archive) return text(archive.status) === 'ok' ? byDate(rows(archive.days)) : [];
  }
  let selected;
  if (host === 'All') {
    if (key === 'activity') selected = snapshot.combined;
    else {
      selected = snapshot.combinedTokens;
      if (text(selected?.verification?.status) !== 'verified') return [];
    }
  } else selected = rows(snapshot[key]).find(row => text(row.host) === host);
  return selected && text(selected.status) === 'ok' ? byDate(rows(selected.days)) : [];
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
  if (age < 0) return { label: strings.status.updateAhead, stale: true };
  const stale = age > 15 * 60000;
  if (age < 60000) return { label: strings.status.updatedNow, stale };
  return { label: format(strings.status.updatedAgo, { age: span(age) }), stale };
}

// One row per provider and window. A provider with no reading gets one
// Unknown row, so its absence is visible and never reads as zero.
export function limits(snapshot, now = Date.now(), { storedPace = true } = {}) {
  const result = [];
  const claude = snapshot?.claudeLimits;
  result.push(...providerLimits('claude', strings.providers.claudeCode, claude, now, strings.status.notCollected, storedPace));
  result.push(...providerLimits('codex', strings.providers.codex, snapshot?.quota, now, strings.status.enableLimits, storedPace));
  return result;
}

function providerLimits(id, name, quota, now, missing, storedPace) {
  const status = text(quota?.status);
  const windows = rows(quota?.windows).filter(row => !HIDDEN_BUCKETS.includes(text(row.bucket).toLowerCase()));
  if (!quota || !['ok', 'stale'].includes(status) || windows.length === 0) {
    const note = !quota || status === 'not-connected' ? missing : status === 'needs-auth' ? format(strings.status.signIn, { name }) : strings.status.noReading;
    return [{ provider: id, name, window: '', bucket: '', windowId: '', remaining: null, note, low: false, stale: false }];
  }
  const checked = Date.parse(quota.checkedAt);
  const current = status === 'ok' && !Number.isNaN(checked) && now >= checked && now - checked < READING_FRESH_MS;
  return windows.map(row => {
    const remaining = number(row.remainingPercent);
    const valid = remaining !== null && remaining <= 100;
    const reset = Date.parse(row.resetsAt);
    const notes = [Number.isNaN(reset) || reset <= now ? strings.status.resetUnknown : format(strings.formats.resetsIn, { span: span(reset - now) })];
    const pace = rows(quota.pace).find(item => text(item.bucket) === text(row.bucket) && text(item.window) === text(row.window));
    const exhausted = Date.parse(pace?.estimatedExhaustionAt);
    if (storedPace && current && pace && text(pace.asOf) === text(quota.checkedAt) && text(pace.status) === 'projected' && exhausted > now)
      notes.push(format(strings.formats.runsOut, { span: span(exhausted - now) }));
    if (!current) notes.push(Number.isNaN(checked) ? strings.status.readingUnknown : format(strings.formats.asOf, { time: new Date(checked).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }));
    return { provider: id, name, window: windowLabel(row.durationMinutes), bucket: row.bucket, windowId: row.window, remaining: valid ? remaining : null,
      note: notes.join(strings.formats.separator), low: valid && remaining < 20, stale: !current };
  });
}

export function totals(snapshot, host, period, now = new Date()) {
  if (period === 'now') {
    const time = now instanceof Date ? now.getTime() : now;
    const value = result => result.reason === 'ok' ? result.value : null;
    const read = source => source?.status === 'ok' ? value(nowFromHours({ days: source.days,
      readingAt: host === 'All' ? source.checkedAt : source.checkedAt ?? snapshot?.collectedAt,
      timeZone: snapshot?.timezone, now: time })) : null;
    const codex = host === 'All'
      ? hasAggregateScope(snapshot, 'tokens') && snapshot?.combinedTokens?.verification?.status === 'verified' ? snapshot.combinedTokens : null
      : rows(snapshot?.tokens).find(row => row.host === host);
    const claude = rows(snapshot?.providerTokenSources).find(row => row.provider === 'claude-code' && row.host === host);
    const codexTokens = read(codex), claudeTokens = host === 'All' ? null : read(claude);
    const seconds = value(activityNow(snapshot, host, time));
    return { codexTokens, claudeTokens, claudeNote: host === 'All' ? strings.status.byDevice : '', codexNote: '', timeNote: '', usd: null, seconds,
      note: [codexTokens, claudeTokens, seconds].some(value => value !== null) ? strings.activity.nowCaveat : strings.status.hourlyUnavailable };
  }
  const anchor = today(text(snapshot?.timezone), now);
  const pick = days => periodDays(days, period, anchor);
  const tokenDays = pick(recordedDays(snapshot, 'tokens', host));
  const activityDays = pick(recordedDays(snapshot, 'activity', host));
  const estimates = tokenDays.map(day => day.apiEstimate).filter(value => value && typeof value === 'object');
  // A source that was read but has no day in the period is "No records".
  // A source that was not read stays Unknown.
  const blocked = host === 'All' && !hasAggregateScope(snapshot, 'tokens');
  let claudeTokens = null, claudeNote = '';
  if (host === 'All') claudeNote = strings.status.byDevice;
  else {
    const source = rows(snapshot?.providerTokenSources).find(row => text(row.provider) === 'claude-code' && text(row.host) === host);
    if (source && text(source.status) === 'ok') {
      const claudeDays = pick(byDate(rows(source.days)));
      claudeTokens = recordedSum(claudeDays, 'totalTokens');
      if (claudeDays.length === 0) claudeNote = strings.status.noRecords;
    }
  }
  const readTokens = !blocked && recordedDays(snapshot, 'tokens', host).length > 0;
  const readActivity = recordedDays(snapshot, 'activity', host).length > 0;
  return {
    codexTokens: recordedSum(tokenDays, 'totalTokens'),
    claudeTokens, claudeNote,
    codexNote: readTokens && tokenDays.length === 0 ? strings.status.noRecords : '',
    timeNote: readActivity && activityDays.length === 0 ? strings.status.noRecords : '',
    usd: estimates.length === tokenDays.length ? recordedSum(estimates, 'usd') : null,
    seconds: recordedSum(activityDays, 'seconds'),
    note: blocked ? strings.status.allUnverified : '',
  };
}

export function sourceCounts(snapshot) {
  let sources = ['activity', 'tokens', 'settings', 'dictation', 'providerTokenSources'].flatMap(key => rows(snapshot?.[key]));
  if (snapshot?.quota && typeof snapshot.quota === 'object') sources.push(snapshot.quota);
  if (snapshot?.claudeLimits && typeof snapshot.claudeLimits === 'object' && !Array.isArray(snapshot.claudeLimits)) sources.push(snapshot.claudeLimits);
  sources = sources.filter(row => text(row.status) !== 'not-connected');
  return { read: sources.filter(row => text(row.status) === 'ok').length, total: sources.length };
}

export { sampleSnapshot as demoSnapshot } from './sample-snapshot.mjs';
