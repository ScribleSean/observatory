import strings from './strings.json' with { type: 'json' };
import { sessionCost as limitsSessionCost } from './view-limits.mjs';
import { recordedDays, periodDays, today, devices, recordedSum, hasAggregateScope } from './panel-data.mjs';

const rows = value => Array.isArray(value) ? value.filter(row => row && typeof row === 'object' && !Array.isArray(row)) : [];
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const name = value => typeof value === 'string' && value.trim() ? value : 'unknown';
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const fields = { input: 'inputTokens', cached: 'cacheReadTokens', cacheWrite: 'cacheCreationTokens', output: 'outputTokens', total: 'totalTokens' };
const counts = values => Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, number(recordedSum(values, field))]));
const unknownEstimate = () => ({ usd: null, coveredTokens: null, totalTokens: null, partial: false });
const empty = status => ({ status, totals: counts([]), days: [], models: [], estimate: unknownEstimate() });
const descending = (a, b) => a === b ? 0 : a === null ? 1 : b === null ? -1 : b - a;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function estimate(days) {
  const estimates = days.map(day => day.apiEstimate);
  if (estimates.some(value => !object(value))) return unknownEstimate();
  const coveredTokens = number(recordedSum(estimates, 'coveredTokens'));
  if (coveredTokens === null || estimates.some(value =>
    value.usd === null ? value.coveredTokens !== 0 : number(value.usd) === null)) return unknownEstimate();
  const totalTokens = number(recordedSum(days, 'totalTokens'));
  const usd = coveredTokens === 0 ? null : number(estimates.reduce((sum, value) => sum + (value.usd ?? 0), 0));
  return { usd, coveredTokens, totalTokens,
    partial: estimates.some(value => value.excluded > 0) || (totalTokens !== null && coveredTokens < totalTokens) };
}

function block(days, period, anchor, used) {
  if (days.some(day => !date(day.date))) return empty('unknown');
  const selected = periodDays(days, period, anchor);
  if (!selected.length) return empty('no-records');
  const groups = new Map();
  for (const day of selected) {
    used.push(day.apiEstimate);
    for (const row of rows(day.models)) {
      const model = name(row.model);
      if (!groups.has(model)) groups.set(model, []);
      groups.get(model).push(row);
      used.push(row.apiEstimate);
    }
  }
  const models = [...groups].map(([model, values]) => ({ model, ...counts(values),
    usd: values.some(row => !object(row.apiEstimate) || row.apiEstimate.excluded > 0)
      ? null : number(recordedSum(values.map(row => row.apiEstimate), 'usd')),
  })).sort((a, b) => descending(a.total, b.total) || compare(a.model, b.model));
  return { status: 'ok', totals: counts(selected),
    days: periodDays(days, 'month', anchor).map(day => ({ date: day.date, total: number(day.totalTokens) })),
    models, estimate: estimate(selected) };
}

// One rule for session cost, shared with the Limits view (lib/view-limits.mjs).
function sessionCost(snapshot, now) {
  const cost = limitsSessionCost(snapshot, now);
  return cost ? { ...cost, status: 'ok' } : { usd: null, observedAt: null, status: 'unknown' };
}

function settingsFor(snapshot, device, period, anchor) {
  const base = { host: device.id, label: device.label };
  const source = rows(snapshot.settings).find(row => row.host === device.id);
  if (source?.status !== 'ok') return { ...base, status: 'unknown', rows: [] };
  const profiles = periodDays(rows(source.profiles), period === 'now' ? 'day' : period, anchor);
  const groups = new Map();
  for (const profile of profiles) {
    const key = JSON.stringify([name(profile.model), name(profile.effort), name(profile.speed)]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(profile);
  }
  const result = [...groups].map(([key, values]) => {
    const [model, effort, speed] = JSON.parse(key);
    return { model, effort, speed, totalTokens: number(recordedSum(values, 'totalTokens')) };
  }).sort((a, b) => descending(a.totalTokens, b.totalTokens) || compare(a.model, b.model) ||
    compare(a.effort, b.effort) || compare(a.speed, b.speed));
  return { ...base, status: result.length ? 'ok' : 'no-records', rows: result };
}

export function tokensView(input, { host, period, now = Date.now() }) {
  // No snapshot yet reads as an empty one, so every value stays Unknown.
  const snapshot = object(input) ? input : {};
  const anchor = today(snapshot.timezone, now);
  const hosts = new Set(devices(snapshot).map(device => device.id));
  for (const source of rows(snapshot.providerTokenSources))
    if (source.provider === 'claude-code' && source.status !== 'not-connected') hosts.add(source.host);
  const deviceList = ['Mac', 'Windows'].filter(host => hosts.has(host)).map(host => {
    const label = snapshot.deviceNames?.[host];
    return { id: host, label: typeof label === 'string' && label.trim() ? label.trim()
      : host === 'Mac' ? strings.devices.macOS : strings.devices.windows };
  });
  const codexUsed = [];
  const claudeUsed = [];
  let codex;
  if (period === 'now') codex = empty('hourly-unavailable');
  else if (host === 'All' && (snapshot.combinedTokens?.verification?.status !== 'verified' || !hasAggregateScope(snapshot, 'tokens')))
    codex = empty('unverified');
  else if (host === 'All' && snapshot.combinedTokens?.status !== 'ok') codex = empty('unknown');
  else if (host !== 'All' && rows(snapshot.tokens).find(row => row.host === host)?.status !== 'ok') codex = empty('unknown');
  else codex = block(recordedDays(snapshot, 'tokens', host), period, anchor, codexUsed);
  const claudeFor = host => {
    if (period === 'now') return empty('hourly-unavailable');
    const source = rows(snapshot.providerTokenSources).find(row => row.provider === 'claude-code' && row.host === host);
    return source?.status === 'ok' ? block(rows(source.days), period, anchor, claudeUsed) : empty('unknown');
  };
  const claude = host === 'All' ? empty(period === 'now' ? 'hourly-unavailable' : 'by-device') : claudeFor(host);
  claude.byDevice = host === 'All' ? deviceList.map(device => {
    const result = claudeFor(device.id);
    return { host: device.id, label: device.label, status: result.status, total: result.totals.total, usd: result.estimate.usd };
  }) : [];
  claude.sessionCost = host === 'All' ? sessionCost(snapshot, Number(now))
    : { usd: null, observedAt: null, status: 'all-only' };
  const checkedOn = date(snapshot.prices?.checkedOn) ? snapshot.prices.checkedOn : null;
  const providerChecked = used => {
    const estimates = used.filter(object);
    const checked = estimates[0]?.checked;
    return checkedOn ?? (estimates.length && date(checked) && estimates.every(value => value.checked === checked) ? checked : null);
  };
  codex.checkedOn = providerChecked(codexUsed);
  claude.checkedOn = providerChecked(claudeUsed);
  const source = snapshot.prices?.source;
  return { host, period, devices: deviceList,
    prices: { checkedOn, source: typeof source === 'string' && source.startsWith('https://') ? source : null },
    codex, claude,
    settings: (host === 'All' ? deviceList : [deviceList.find(device => device.id === host) ?? { id: host, label: host }])
      .map(device => settingsFor(snapshot, device, period, anchor)),
  };
}

export function money(usd) {
  return number(usd) === null ? null : usd.toFixed(2);
}
