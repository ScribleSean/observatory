// Chart data for limit history: one line per computer for one provider and window.
// Points are real readings. A line breaks where readings are too far apart, so a gap
// is drawn as a gap. Lines are never added together: limits belong to the account.

export const HISTORY_RANGES = ['today', 'week', 'month', 'all'];
export const HISTORY_WINDOWS = ['5h', 'week'];
const HOUR = 3600000, DAY = 24 * HOUR;
// Readings further apart than this break the line, by range.
const GAP = { today: 45 * 60000, week: 3 * HOUR, month: 26 * HOUR, all: 3 * DAY };
const IDS = { '5h': ['five_hour', 'primary'], week: ['seven_day', 'secondary', 'weekly'] };
const DURATION = { '5h': 300, week: 10080 };

const rows = value => Array.isArray(value) ? value.filter(row => row && typeof row === 'object') : [];

export function windowOf(point) {
  if (point.d === DURATION['5h']) return '5h';
  if (point.d === DURATION.week) return 'week';
  if (point.d === undefined || point.d === null) {
    if (IDS['5h'].includes(point.w)) return '5h';
    if (IDS.week.includes(point.w)) return 'week';
  }
  return null;
}

function startOf(range, now, earliest) {
  if (range === 'today') { const day = new Date(now); day.setHours(0, 0, 0, 0); return day.getTime(); }
  if (range === 'week') return now - 7 * DAY;
  if (range === 'month') return now - 30 * DAY;
  return Math.min(earliest ?? now - DAY, now - DAY);
}

export function limitHistorySeries(snapshot, { provider, window, range = 'week', now = Date.now() }) {
  const names = snapshot?.deviceNames && typeof snapshot.deviceNames === 'object' ? snapshot.deviceNames : {};
  const all = rows(snapshot?.limitHistory).flatMap(row => rows(row.points).map(point => ({ ...point, host: row.host })))
    .filter(point => point.p === provider && windowOf(point) === window)
    .map(point => ({ host: point.host, t: Date.parse(point.t), r: point.r, x: Date.parse(point.x), source: point.s ?? 'live' }))
    .filter(point => Number.isFinite(point.t) && point.t <= now + 5 * 60000 && typeof point.r === 'number');
  const earliest = all.length ? Math.min(...all.map(point => point.t)) : null;
  const from = startOf(range, now, earliest), to = now;
  const inRange = all.filter(point => point.t >= from && point.t <= to);
  const hosts = [...new Set(inRange.map(point => point.host))].sort((a, b) => a === 'Mac' ? -1 : b === 'Mac' ? 1 : a.localeCompare(b));
  const series = hosts.map(host => {
    const points = inRange.filter(point => point.host === host).sort((a, b) => a.t - b.t);
    // Split into segments wherever readings are too far apart.
    const segments = [];
    for (const point of points) {
      const last = segments.at(-1)?.at(-1);
      // A new segment after a gap, and at a reset, so the line never joins two different windows.
      const reset = Number.isFinite(last?.x) && Number.isFinite(point.x) && point.x !== last.x;
      if (!last || point.t - last.t > GAP[range] || reset) segments.push([point]); else segments.at(-1).push(point);
    }
    return { host, name: typeof names[host] === 'string' && names[host].trim() ? names[host].trim() : host, points, segments };
  });
  // Reset times come from the provider's own reset field. Only past resets inside the range are marked.
  const allResets = [...new Set(inRange.map(point => point.x).filter(x => Number.isFinite(x) && x >= from && x <= now))].sort((a, b) => a - b);
  // Many resets in one view (a 5-hour window over a month) would only add noise, so they are marked when there are few.
  const resets = allResets.length <= 12 ? allResets : [];
  // The freshest reading for this window, from any computer, with where and when it was observed.
  const newest = all.reduce((best, point) => !best || point.t > best.t ? point : best, null);
  const latest = newest ? { remaining: newest.r, at: new Date(newest.t).toISOString(), host: newest.host,
    name: series.find(row => row.host === newest.host)?.name ?? names[newest.host] ?? newest.host } : null;
  return { provider, window, range, from, to, series, resets, latest, empty: inRange.length === 0, total: inRange.length };
}
