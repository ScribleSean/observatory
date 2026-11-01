import { devicePeriodIncomplete, deviceCompleteDays, deviceReadingReference, deviceReadingNote, viewHost, recordedDays, periodDays, today, devices, recordedSum, deviceLabel, deviceName } from './panel-data.mjs';
import { statusWord } from './view-sources.mjs';

const rows = value => Array.isArray(value) ? value.filter(row => row && typeof row === 'object' && !Array.isArray(row)) : [];
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const name = value => typeof value === 'string' && value.trim() ? value : 'unknown';
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const fields = { input: 'inputTokens', cached: 'cacheReadTokens', cacheWrite: 'cacheCreationTokens', output: 'outputTokens', total: 'totalTokens' };
const hours = value => Array.isArray(value) && value.length === 24 && value.every(hour => number(hour) !== null) ? value : null;
function wallClock(timeZone) {
  let formatter;
  try { formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }); }
  catch { return null; }
  return time => {
    const parts = Object.fromEntries(formatter.formatToParts(time).map(part => [part.type, part.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
  };
}

export function maskHours(days, readingAt, timeZone, now) {
  const wall = wallClock(timeZone);
  const at = typeof readingAt === 'string' ? Date.parse(readingAt) : NaN;
  const read = wall && Number.isFinite(at) ? wall(Math.min(at, Number(now))) : null;
  const present = wall ? wall(Number(now)) : null;
  return days.map(day => !day.hours ? day : { ...day, hours: day.hours.map((value, hour) =>
    present && day.date === present.date && hour > present.hour ? undefined
      : read && (day.date < read.date || (day.date === read.date && hour <= read.hour)) ? value : null) });
}
const dayTotals = days => days.map(day => ({ date: day.date, total: number(day.totalTokens), hours: hours(day.hours) }));
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
  const usd = coveredTokens === 0 ? null : number(recordedSum(estimates.filter(value => value.usd !== null), 'usd'));
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
    days: dayTotals(periodDays(days, 'all', anchor).filter(day => day.date <= anchor)),
    models, estimate: estimate(selected) };
}

function settingsFor(snapshot, device, period, anchor, now) {
  const base = { host: device.id, label: device.label };
  const source = rows(snapshot.settings).find(row => row.host === device.id);
  if (!['ok', 'stale'].includes(source?.status)) return { ...base, status: 'unknown', rows: [] };
  if (devicePeriodIncomplete(snapshot, source, period, anchor, now))
    return { ...base, status: 'unknown', rows: [], note: deviceReadingNote(source, deviceReadingReference(snapshot, now)) };
  const profiles = periodDays(deviceCompleteDays(snapshot, source, now, 'profiles'), period === 'now' ? 'day' : period, anchor);
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

export function tokensView(input, { host, period, date: selectedDate = null, now = Date.now() }) {
  const snapshot = object(input) ? input : {};
  const dataHost = viewHost(snapshot, host);
  const anchor = date(selectedDate) ? selectedDate : today(snapshot.timezone, now);
  const hosts = new Set(devices(snapshot).map(device => device.id));
  for (const source of rows(snapshot.providerTokenSources))
    if (source.provider === 'claude-code' && source.status !== 'not-connected') hosts.add(source.host);
  const deviceList = ['Mac', 'Windows'].filter(host => hosts.has(host)).map(host => ({ id: host, label: deviceLabel(host), name: deviceName(snapshot, host) }));
  const codexUsed = [];
  const claudeUsed = [];
  const noteFor = (source, incomplete, result) => incomplete ? deviceReadingNote(source, deviceReadingReference(snapshot, now))
    : result.status === 'unknown' && source && !['ok', 'stale'].includes(source.status) ? statusWord(source.status) : '';
  const codexFor = host => {
    const source = rows(snapshot.tokens).find(row => row.host === host);
    const incomplete = devicePeriodIncomplete(snapshot, source, period, anchor, now);
    const days = recordedDays(snapshot, 'tokens', host, now);
    const result = period === 'now' ? empty('hourly-unavailable')
      : ['ok', 'stale'].includes(source?.status) && !incomplete ? block(days, period, anchor, codexUsed) : empty('unknown');
    if (period !== 'now' && result.status === 'unknown')
      result.days = dayTotals(periodDays(days, 'all', anchor).filter(day => day.date <= anchor));
    result.days = maskHours(result.days, source?.checkedAt ?? snapshot.collectedAt, snapshot.timezone, now);
    result.note = noteFor(source, incomplete, result);
    return result;
  };
  const claudeFor = host => {
    const source = rows(snapshot.providerTokenSources).find(row => row.provider === 'claude-code' && row.host === host);
    if (period === 'now') return { ...empty('hourly-unavailable'), note: deviceReadingNote(source, deviceReadingReference(snapshot, now)) };
    const incomplete = devicePeriodIncomplete(snapshot, source, period, anchor, now);
    const days = deviceCompleteDays(snapshot, source, now);
    const result = ['ok', 'stale'].includes(source?.status) && !incomplete ? block(days, period, anchor, claudeUsed) : empty('unknown');
    if (incomplete) result.days = dayTotals(periodDays(days, 'all', anchor).filter(day => day.date <= anchor));
    result.days = maskHours(result.days, source?.checkedAt ?? snapshot.collectedAt, snapshot.timezone, now);
    result.note = noteFor(source, incomplete, result);
    return result;
  };
  const provider = blockFor => {
    if (dataHost !== 'All') return { ...blockFor(dataHost), byDevice: [] };
    return { ...empty(period === 'now' ? 'hourly-unavailable' : deviceList.length ? 'by-device' : 'unknown'), note: '', byDevice: deviceList.map(device => {
      const result = blockFor(device.id);
      return { host: device.id, label: device.label, status: result.status, note: result.note, total: result.totals.total, usd: result.estimate.usd };
    }) };
  };
  const codex = provider(codexFor);
  const claude = provider(claudeFor);
  const checkedOn = date(snapshot.prices?.checkedOn) ? snapshot.prices.checkedOn : null;
  const providerChecked = used => {
    const estimates = used.filter(object);
    const checked = estimates[0]?.checked;
    return checkedOn ?? (estimates.length && date(checked) && estimates.every(value => value.checked === checked) ? checked : null);
  };
  codex.checkedOn = providerChecked(codexUsed);
  claude.checkedOn = providerChecked(claudeUsed);
  const source = snapshot.prices?.source;
  return { host, period, anchor, devices: deviceList,
    prices: { checkedOn, source: typeof source === 'string' && source.startsWith('https://') ? source : null },
    codex, claude,
    settings: (dataHost === 'All' ? deviceList : [deviceList.find(device => device.id === dataHost) ?? { id: dataHost, label: deviceLabel(dataHost) }])
      .map(device => settingsFor(snapshot, device, period, anchor, now)),
  };
}
