import strings from './strings.json' with { type: 'json' };
import { deviceReadingReference, deviceReadingCurrent, CLOCK_SKEW_MS, span, deviceLabel, deviceName } from './panel-data.mjs';

const statusWords = new Map([
  ['ok', strings.sources.statusOk], ['not-connected', strings.sources.statusNotConnected],
  ['partial', strings.sources.statusPartial], ['unavailable', strings.sources.statusUnavailable],
  ['not-found', strings.sources.statusNotFound], ['stale', strings.sources.statusStale],
  ['needs-auth', strings.sources.statusNeedsAuth], ['unsupported', strings.sources.statusUnsupported],
  ['rate-limited', strings.sources.statusRateLimited],
]);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const rows = value => Array.isArray(value) ? value.filter(object) : [];
const hosts = ['Mac', 'Windows'];
// A computer appears only when one of its sources is connected, so a single computer never lists the other one's rows.
const connectedHosts = snapshot => new Set(['activity', 'tokens', 'providerTokenSources', 'settings']
  .flatMap(key => rows(snapshot?.[key])).filter(row => hosts.includes(row.host) && row.status !== 'not-connected').map(row => row.host));
const format = (template, values) => template.replace(/\{([a-z][A-Za-z0-9]*)\}/g, (_, key) => String(values[key]));

/** @param {unknown} status */
export function statusWord(status) {
  return statusWords.get(status) ?? strings.status.unknown;
}

/** @param {unknown} code */
export function refusalText(code) {
  if (typeof code !== 'string') return null;
  return code === 'ancestor-refused' ? strings.sources.ancestorRefusal : strings.sources.privateRefusal;
}

export function checkTime(checkedAt, now = Date.now()) {
  const at = typeof checkedAt === 'string' ? Date.parse(checkedAt) : NaN;
  if (!Number.isFinite(at)) return { label: strings.status.unknown, exact: null, iso: null };
  const age = Number(now) - at;
  return {
    label: age < -CLOCK_SKEW_MS ? strings.sources.checkAhead : age < 60000 ? strings.sources.checkedNow : format(strings.sources.checkedAgo, { age: span(age) }),
    exact: new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(at),
    iso: new Date(at).toISOString(),
  };
}

export function sourceGroups(snapshot, now = Date.now()) {
  const connected = connectedHosts(snapshot);
  const deviceRows = value => rows(value).filter(row => connected.has(row.host));
  const entry = (input, key, name, local = false) => {
    const row = !local && input.status === 'ok' && !deviceReadingCurrent(input, deviceReadingReference(snapshot, now)) ? { ...input, status: 'stale' } : input;
    const host = !local ? row.host : hosts.includes(row.observedOn) ? row.observedOn : null;
    return {
      key, name, device: host ? deviceLabel(host) : null, deviceName: host ? deviceName(snapshot, host) : null,
      status: statusWords.has(row.status) ? row.status : 'unknown',
      statusWord: statusWord(row.status),
      check: checkTime(row.checkedAt, now), refusal: row.status === 'ok' ? null : refusalText(row.refusal),
    };
  };
  // One group per source: Claude Code limits, then Codex limits with any reading shared from the other computer.
  const claudeLimits = object(snapshot?.claudeLimits) ? [entry(snapshot.claudeLimits, 'claudeLimits', strings.sources.claudeLimits, true)] : [];
  const codexLimits = object(snapshot?.quota) ? [entry(snapshot.quota, 'quota', strings.sources.codexLimits, true)] : [];
  if (object(snapshot?.peerQuota) && hosts.includes(snapshot.peerQuota.host))
    codexLimits.push(entry(snapshot.peerQuota, 'peerQuota', strings.sources.codexLimits));
  /** @returns {{ id: string, label: string, rows: ReturnType<typeof entry>[] }} */
  const group = (id, label, sources, name) => ({ id, label,
    rows: sources.map((row, index) => entry(row, `${id}-${row.host}-${index}`, name(row))) });
  return [
    { id: 'claudeLimits', label: strings.sources.claudeLimits, rows: claudeLimits },
    { id: 'codexLimits', label: strings.sources.codexLimits, rows: codexLimits },
    group('activity', strings.sections.activity, deviceRows(snapshot?.activity), () => strings.sections.activity),
    group('codexTokens', strings.sources.codexTokens, deviceRows(snapshot?.tokens), () => strings.sources.codexTokens),
    group('claudeTokens', strings.sources.claudeTokens, deviceRows(snapshot?.providerTokenSources).filter(row => row.provider === 'claude-code'), () => strings.sources.claudeTokens),
    group('settings', strings.sources.modelSettings, deviceRows(snapshot?.settings), () => strings.sources.modelSettings),
  ];
}

// The count describes every row on the page, so "5 of 6" sits over six rows.
export function sourceTotals(groups) {
  const sources = groups.flatMap(group => group.rows);
  const words = [...statusWords.values(), strings.status.unknown];
  return { read: sources.filter(row => row.status === 'ok').length, total: sources.length,
    byStatus: words.map(word => ({ word, count: sources.filter(row => row.statusWord === word).length })).filter(item => item.count > 0) };
}
