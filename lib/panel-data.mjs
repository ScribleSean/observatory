// Shared view logic for the panel. It reads the sanitized snapshot only.
// Device records are never added together here. The collector's verified
// aggregates are the only source for All.

export const PERIODS = ['now', 'day', 'week', 'month', 'all'];
const HIDDEN_BUCKETS = ['codex_bengalfox', 'codex_spark', 'spark'];
const NATIVE_HOSTS = ['Mac', 'Windows'];

const rows = value => Array.isArray(value) ? value.filter(row => row && typeof row === 'object' && !Array.isArray(row)) : [];
const text = value => typeof value === 'string' ? value : 'Unknown';
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
  const platform = host => host === 'Mac' ? 'macOS' : host;
  return NATIVE_HOSTS.filter(host => hosts.has(host))
    .map(host => ({ id: host, label: typeof names[host] === 'string' && names[host].trim() ? names[host].trim() : platform(host) }));
}

export function windowLabel(minutes) {
  const value = number(minutes);
  if (!value) return 'Unknown window';
  if (value === 10080) return 'weekly';
  if (value >= 1440) return `${+(value / 1440).toFixed(1)}-day`;
  if (value >= 60) return `${+(value / 60).toFixed(1)}-hour`;
  return `${Math.round(value)}-minute`;
}

export function span(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return 'Unknown';
  const minutes = Math.round(milliseconds / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function compact(value) {
  const amount = number(value);
  if (amount === null) return 'Unknown';
  for (const [divisor, suffix] of [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']])
    if (amount >= divisor) return `${+(amount / divisor).toFixed(1)}${suffix}`;
  return String(Math.round(amount));
}

export function duration(seconds) {
  const amount = number(seconds);
  if (amount === null) return 'Unknown';
  const minutes = Math.floor(amount / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function freshness(timestamp, now = Date.now()) {
  const at = Date.parse(timestamp);
  if (Number.isNaN(at)) return { label: 'Updated: Unknown', stale: true };
  const age = now - at;
  if (age < 0) return { label: 'Update time is ahead of this device', stale: true };
  const stale = age > 15 * 60000;
  if (age < 60000) return { label: 'Updated just now', stale };
  return { label: `Updated ${span(age)} ago`, stale };
}

// One row per provider and window. A provider with no reading gets one
// Unknown row, so its absence is visible and never reads as zero.
export function limits(snapshot, now = Date.now()) {
  const result = [];
  const claude = snapshot?.claudeLimits;
  result.push(...providerLimits('claude', 'Claude Code', claude, now, 'Not collected yet'));
  result.push(...providerLimits('codex', 'Codex', snapshot?.quota, now, 'Turn on limits in Settings'));
  return result;
}

function providerLimits(id, name, quota, now, missing) {
  const status = text(quota?.status);
  const windows = rows(quota?.windows).filter(row => !HIDDEN_BUCKETS.includes(text(row.bucket).toLowerCase()));
  if (!quota || !['ok', 'stale'].includes(status) || windows.length === 0) {
    const note = !quota || status === 'not-connected' ? missing : status === 'needs-auth' ? `Sign in to ${name}` : 'No reading available';
    return [{ provider: id, name, window: '', remaining: null, note, low: false, stale: false }];
  }
  const checked = Date.parse(quota.checkedAt);
  const current = status === 'ok' && !Number.isNaN(checked) && now >= checked && now - checked < 10 * 60000;
  return windows.map(row => {
    const remaining = number(row.remainingPercent);
    const valid = remaining !== null && remaining <= 100;
    const reset = Date.parse(row.resetsAt);
    const notes = [Number.isNaN(reset) || reset <= now ? 'Reset time unknown' : `Resets in ${span(reset - now)}`];
    const pace = rows(quota.pace).find(item => text(item.bucket) === text(row.bucket) && text(item.window) === text(row.window));
    const exhausted = Date.parse(pace?.estimatedExhaustionAt);
    if (current && pace && text(pace.asOf) === text(quota.checkedAt) && text(pace.status) === 'projected' && exhausted > now)
      notes.push(`runs out in about ${span(exhausted - now)}`);
    if (!current) notes.push(Number.isNaN(checked) ? 'reading time unknown' : `as of ${new Date(checked).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
    return { provider: id, name, window: windowLabel(row.durationMinutes), remaining: valid ? remaining : null,
      note: notes.join(' · '), low: valid && remaining < 20, stale: !current };
  });
}

export function totals(snapshot, host, period, now = new Date()) {
  if (period === 'now') return { codexTokens: null, claudeTokens: null, claudeNote: '', codexNote: '', timeNote: '', usd: null, seconds: null, note: 'Hourly totals are not collected yet' };
  const anchor = today(text(snapshot?.timezone), now);
  const pick = days => periodDays(days, period, anchor);
  const tokenDays = pick(recordedDays(snapshot, 'tokens', host));
  const activityDays = pick(recordedDays(snapshot, 'activity', host));
  const estimates = tokenDays.map(day => day.apiEstimate).filter(value => value && typeof value === 'object');
  // A source that was read but has no day in the period is "No records".
  // A source that was not read stays Unknown.
  const blocked = host === 'All' && !hasAggregateScope(snapshot, 'tokens');
  let claudeTokens = null, claudeNote = '';
  if (host === 'All') claudeNote = 'By device';
  else {
    const source = rows(snapshot?.providerTokenSources).find(row => text(row.provider) === 'claude-code' && text(row.host) === host);
    if (source && text(source.status) === 'ok') {
      const claudeDays = pick(byDate(rows(source.days)));
      claudeTokens = recordedSum(claudeDays, 'totalTokens');
      if (claudeDays.length === 0) claudeNote = 'No records';
    }
  }
  const readTokens = !blocked && recordedDays(snapshot, 'tokens', host).length > 0;
  const readActivity = recordedDays(snapshot, 'activity', host).length > 0;
  return {
    codexTokens: recordedSum(tokenDays, 'totalTokens'),
    claudeTokens, claudeNote,
    codexNote: readTokens && tokenDays.length === 0 ? 'No records' : '',
    timeNote: readActivity && activityDays.length === 0 ? 'No records' : '',
    usd: estimates.length === tokenDays.length ? recordedSum(estimates, 'usd') : null,
    seconds: recordedSum(activityDays, 'seconds'),
    note: blocked ? 'All needs verified records from every device' : '',
  };
}

export function sourceCounts(snapshot) {
  let sources = ['activity', 'tokens', 'settings', 'dictation', 'providerTokenSources'].flatMap(key => rows(snapshot?.[key]));
  if (snapshot?.quota && typeof snapshot.quota === 'object') sources.push(snapshot.quota);
  sources = sources.filter(row => text(row.status) !== 'not-connected');
  return { read: sources.filter(row => text(row.status) === 'ok').length, total: sources.length };
}

export function demoSnapshot(now = Date.now()) {
  const iso = offset => new Date(now + offset).toISOString();
  const date = offset => today('UTC', new Date(now - offset * 86400000));
  const days = scale => Array.from({ length: 40 }, (_, index) => ({ date: date(index), totalTokens: Math.round(scale * (1 + (index * 7 % 5) / 4)),
    apiEstimate: { usd: +(scale / 1e6 * 1.8 * (1 + (index * 7 % 5) / 4)).toFixed(2) } }));
  const active = scale => Array.from({ length: 40 }, (_, index) => ({ date: date(index), seconds: Math.round(scale * (1 + (index * 3 % 4) / 5)) }));
  const source = (host, scale) => ({ host, status: 'ok', days: days(scale) });
  return {
    demo: true, collectedAt: iso(-120000), timezone: 'UTC',
    deviceNames: { Mac: 'Studio', Windows: 'Desk' },
    claudeLimits: { status: 'stale', checkedAt: iso(-48 * 60000), windows: [
      { bucket: 'claude', window: 'five_hour', durationMinutes: 300, remainingPercent: 64, resetsAt: iso(130 * 60000) },
      { bucket: 'claude', window: 'seven_day', durationMinutes: 10080, remainingPercent: 12, resetsAt: iso(3 * 86400000) }] },
    quota: { status: 'ok', checkedAt: iso(-90000), windows: [
      { bucket: 'codex', window: 'primary', durationMinutes: 300, remainingPercent: 81, resetsAt: iso(225 * 60000) },
      { bucket: 'codex', window: 'secondary', durationMinutes: 10080, remainingPercent: 47, resetsAt: iso(5 * 86400000) }],
      pace: [{ bucket: 'codex', window: 'primary', asOf: iso(-90000), status: 'projected', estimatedExhaustionAt: iso(170 * 60000) }] },
    tokens: [source('Mac', 9.4e6), source('Windows', 5.1e6)],
    settings: [{ host: 'Mac', status: 'ok' }, { host: 'Windows', status: 'ok' }],
    combinedTokens: { status: 'ok', verification: { status: 'verified' }, days: days(14.5e6) },
    providerTokenSources: [{ provider: 'claude-code', host: 'Mac', status: 'ok', days: days(21e6) },
      { provider: 'claude-code', host: 'Windows', status: 'ok', days: days(8e6) }],
    activity: [{ host: 'Mac', status: 'ok', days: active(14000) }, { host: 'Windows', status: 'ok', days: active(9000) }],
    combined: { status: 'ok', days: active(19000) },
  };
}
