import strings from './strings.json' with { type: 'json' };
import { limits, windowLabel, span, HIDDEN_BUCKETS, format, READING_FRESH_MS } from './panel-data.mjs';
import { quotaPace } from '../scripts/quota-pace.mjs';
import {cleanQuotaObservation} from '../scripts/quota-history.mjs';

const statuses=new Set(['ok','stale','unavailable','needs-auth','unsupported','rate-limited','not-connected']);
const stamp=value=>typeof value==='string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

export function cleanPeerQuotaForDisplay(raw,now=Date.now()) {
  if(!raw || !['Mac','Windows'].includes(raw.host) || !statuses.has(raw.status) ||
    !Number.isSafeInteger(now) || now<0 || (raw.windows!==undefined && !Array.isArray(raw.windows)) ||
    (raw.history!==undefined && !Array.isArray(raw.history)) || raw.windows?.length>32 || raw.history?.length>10000)return null;
  const current=raw.windows?.length ? cleanQuotaObservation({checkedAt:raw.checkedAt,windows:raw.windows},now) : null;
  const history=(raw.history||[]).flatMap(sample=>{
    const cleaned=cleanQuotaObservation(sample,now);
    return cleaned?[{...cleaned,windows:cleaned.windows.filter(window=>window.bucket==='codex')}]:[];
  }).filter(sample=>sample.windows.length);
  return {host:raw.host,status:raw.status,checkedAt:current?.checkedAt,receivedAt:stamp(raw.receivedAt),
    windows:(current?.windows||[]).filter(window=>window.bucket==='codex'),history};
}

const plain = value => value !== null && typeof value === 'object' &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const windows = value => Array.isArray(value) ? value.filter(row => plain(row) && typeof row.bucket === 'string' && typeof row.window === 'string').map(row => ({ ...row })) : [];
const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const timestamp = value => typeof value === 'string' ? Date.parse(value) : NaN;
const sourceFor = (snapshot, provider) => provider === 'claude' ? snapshot?.claudeLimits : provider === 'codex' ? snapshot?.quota : null;

function historySamples(snapshot, provider, source, now) {
  const host = typeof source?.observedOn === 'string' ? source.observedOn : null;
  const since = now - 2 * 3600000;
  const byTime = new Map();
  for (const row of Array.isArray(snapshot?.limitHistory) ? snapshot.limitHistory : []) {
    if (!plain(row) || (host && row.host !== host) || !Array.isArray(row.points)) continue;
    for (const point of row.points) {
      const at = plain(point) && point.p === provider ? timestamp(point.t) : NaN;
      if (!Number.isFinite(at) || at < since || at > now || typeof point.r !== 'number') continue;
      const list = byTime.get(point.t) ?? [];
      list.push({ bucket: provider, window: point.w, remainingPercent: point.r,
        ...(typeof point.x === 'string' ? { resetsAt: point.x } : {}), ...(Number.isSafeInteger(point.d) ? { durationMinutes: point.d } : {}) });
      byTime.set(point.t, list);
    }
  }
  // Claude Code reports reset times to the minute, so the same reset can read a minute apart.
  const current = new Map(windows(source?.windows).map(row => [row.window, row.resetsAt]));
  const align = row => {
    const reset = current.get(row.window);
    return typeof reset === 'string' && typeof row.resetsAt === 'string' && Math.abs(Date.parse(reset) - Date.parse(row.resetsAt)) <= 120000
      ? { ...row, resetsAt: reset } : row;
  };
  return [...byTime].map(([checkedAt, rows]) => ({ checkedAt, windows: rows.map(align) }));
}

function paceRows(source, now, snapshot, provider) {
  try {
    const own = Array.isArray(source?.history) ? source.history.filter(sample => plain(sample) && Array.isArray(sample.windows))
      .map(sample => ({ ...sample, windows: windows(sample.windows) })) : [];
    const history = own.length ? own : historySamples(snapshot, provider, source, now)
      .sort((a, b) => Date.parse(a.checkedAt) - Date.parse(b.checkedAt));
    return quotaPace({ status: source?.status, checkedAt: source?.checkedAt, windows: windows(source?.windows), history }, now);
  } catch { return []; }
}

export function limitRows(snapshot, now = Date.now()) {
  const paces = new Map();
  return limits(snapshot, now, { storedPace: false }).map(row => {
    let pace = null;
    if (row.remaining !== null) {
      const source = sourceFor(snapshot, row.provider);
      if (!paces.has(row.provider)) paces.set(row.provider, paceRows(source, now, snapshot, row.provider));
      let found = paces.get(row.provider).find(item => item.bucket === row.bucket && item.window === row.windowId);
      if (found && row.stale) found = { status: 'stale' };
      const window = windows(source?.windows).find(item => item.bucket === row.bucket && item.window === row.windowId);
      const reset = timestamp(window?.resetsAt);
      if (found) pace = { status: found.status, ratePerHour: finite(found.percentagePointsPerHour),
        observedMinutes: found.observedMinutes ?? null,
        runsOutInMinutes: found.status === 'projected' ? found.remainingMinutes : found.status === 'exhausted' ? 0 : null,
        resetInMinutes: reset > now ? Math.ceil((reset - now) / 60000) : null,
        coverage: finite(found.coverageFraction) };
    }
    const notes = row.note.split(strings.formats.separator);
    if (pace?.status === 'projected' && typeof pace.runsOutInMinutes === 'number')
      notes.splice(1, 0, format(strings.formats.runsOut, { span: span(pace.runsOutInMinutes * 60000) }));
    return { ...row, note: notes.join(strings.formats.separator), pace };
  });
}

function calendar(timeZone) {
  const options = { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  let formatter;
  try { formatter = new Intl.DateTimeFormat('en-CA', { ...options, timeZone: timeZone ?? 'UTC' }); }
  catch { formatter = new Intl.DateTimeFormat('en-CA', { ...options, timeZone: 'UTC' }); }
  return at => {
    const parts = Object.fromEntries(formatter.formatToParts(at).map(part => [part.type, part.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: parts.hour, minute: parts.minute };
  };
}

function historySlots(period, now, samples, local) {
  const today = local(now).date;
  if (period === 'now') return Array.from({ length: 12 }, (_, index) => {
    const start = now - (12 - index) * 300000;
    const parts = local(start);
    return { label: `${parts.hour}:${parts.minute}`, contains: at => at >= start && (at < start + 300000 || index === 11 && at === now) };
  });
  if (period === 'day') return Array.from({ length: 24 }, (_, index) => {
    const hour = String(index).padStart(2, '0');
    return { label: hour, contains: at => { const parts = local(at); return parts.date === today && parts.hour === hour; } };
  });
  const end = Date.parse(today + 'T00:00:00Z');
  const earliest = Math.min(...samples.map(sample => Date.parse(local(sample.at).date + 'T00:00:00Z')));
  const count = period === 'week' ? 7 : period === 'month' ? 30 : period === 'all' ? Math.min(400, Math.floor((end - earliest) / 86400000) + 1) : 0;
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(end - (count - 1 - index) * 86400000).toISOString().slice(0, 10);
    return { label: date.slice(5), contains: at => local(at).date === date };
  });
}

export function limitHistory(snapshot, provider, period, now = Date.now()) {
  const result = { provider, period, windows: [] };
  const source = sourceFor(snapshot, provider);
  if (!source) return result;
  const samples = [...(Array.isArray(source.history) ? source.history : []), { checkedAt: source.checkedAt, windows: source.windows }]
    .flatMap(sample => {
      const at = timestamp(sample?.checkedAt);
      if (!Number.isFinite(at) || at > now || !Array.isArray(sample?.windows)) return [];
      const valid = windows(sample.windows).filter(row => !HIDDEN_BUCKETS.includes(row.bucket.toLowerCase()) &&
        finite(row.remainingPercent) !== null && row.remainingPercent >= 0 && row.remainingPercent <= 100);
      return valid.length ? [{ at, windows: valid }] : [];
    }).sort((a, b) => a.at - b.at);
  if (!samples.length) return result;
  const slots = historySlots(period, now, samples, calendar(snapshot?.timezone));
  const distinct = new Map();
  for (const sample of samples) for (const row of sample.windows) distinct.set(JSON.stringify([row.bucket, row.window]), row);
  const duration = row => finite(row.durationMinutes) !== null && row.durationMinutes > 0 ? row.durationMinutes : Infinity;
  result.windows = [...distinct.values()].sort((a, b) => duration(a) - duration(b) || a.window.localeCompare(b.window))
    .map(row => ({ bucket: row.bucket, windowId: row.window, label: windowLabel(row.durationMinutes),
      points: slots.map(slot => {
        let value = null;
        for (const sample of samples) if (slot.contains(sample.at)) {
          const match = sample.windows.find(item => item.bucket === row.bucket && item.window === row.window);
          if (match) value = match.remainingPercent;
        }
        return { label: slot.label, value };
      }) }));
  return result;
}

export function peerLimits(snapshot, now = Date.now()) {
  const peer = cleanPeerQuotaForDisplay(snapshot?.peerQuota, now);
  if (!peer) return null;
  const platform = peer.host === 'Mac' ? strings.devices.macOS : strings.devices.windows;
  const name = snapshot?.deviceNames?.[peer.host];
  const rawAt = timestamp(snapshot?.peerQuota?.checkedAt);
  const observedAt = peer.checkedAt ?? (Number.isFinite(rawAt) && rawAt <= now ? new Date(rawAt).toISOString() : null);
  const at = timestamp(observedAt);
  const rows = peer.windows.map(row => {
    const expired = timestamp(row.resetsAt) <= now;
    return { provider: 'codex', name: strings.providers.codex,
      window: windowLabel(row.durationMinutes), windowId: row.window, remaining: expired ? null : row.remainingPercent,
      low: !expired && row.remainingPercent < 20, ...(expired ? { note: strings.limits.resetPending } : {}) };
  });
  if (!rows.length) rows.push({ provider: 'codex', name: strings.providers.codex, window: '', windowId: '', remaining: null, low: false });
  return { host: peer.host, device: typeof name === 'string' && name.trim() ? format(strings.limits.deviceNamed, { name: name.trim(), platform }) : platform,
    status: peer.status, observedAt, receivedAt: peer.receivedAt ?? null,
    stale: !(peer.status === 'ok' && at <= now && now - at < READING_FRESH_MS), rows };
}
