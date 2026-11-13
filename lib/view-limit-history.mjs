
const HOUR = 3600000, DAY = 24 * HOUR;
const GAP = { today: 45 * 60000, week: 3 * HOUR, month: 26 * HOUR, all: 3 * DAY };
const IDS = { '5h': ['five_hour', 'primary'], week: ['seven_day', 'secondary', 'weekly'] };
const DURATION = { '5h': 300, week: 10080, month: 43200 };
// Shortest run of readings drawn as a line. A lone reading between gaps is left out rather than
// drawn as a stray dash.
const MIN_SEGMENT = 3;

const rows = value => Array.isArray(value) ? value.filter(row => row && typeof row === 'object') : [];

export function windowOf(point) {
  if (point.d === DURATION['5h']) return '5h';
  if (point.d === DURATION.week) return 'week';
  if (point.d === DURATION.month) return 'month';
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

// The first stored reading of any limit. The All range starts every chart there.
function firstReading(snapshot, now) {
  const times = rows(snapshot?.limitHistory).flatMap(row => rows(row.points)).map(point => Date.parse(point.t)).filter(t => Number.isFinite(t) && t <= now + 5 * 60000);
  return times.length ? Math.min(...times) : null;
}

export function firstReadingDate(snapshot, now = Date.now()) {
  const first = firstReading(snapshot, now);
  if (first === null) return null;
  const day = new Date(first);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}

export function limitHistorySeries(snapshot, { provider, window, range = 'week', now = Date.now() }) {
  const names = snapshot?.deviceNames && typeof snapshot.deviceNames === 'object' ? snapshot.deviceNames : {};
  const all = rows(snapshot?.limitHistory).flatMap(row => rows(row.points).map(point => ({ ...point, host: row.host })))
    .filter(point => point.p === provider && windowOf(point) === window)
    .map(point => ({ host: point.host, t: Date.parse(point.t), r: point.r, x: Date.parse(point.x), source: point.s ?? 'live' }))
    .filter(point => Number.isFinite(point.t) && point.t <= now + 5 * 60000 && typeof point.r === 'number');
  const earliest = all.length ? Math.min(...all.map(point => point.t)) : null;
  const from = startOf(range, now, firstReading(snapshot, now)), to = now;
  const inRange = all.filter(point => point.t >= from && point.t <= to);
  // Limits are account-wide: every computer reads the same number, so readings merge into one line.
  const seen = new Set();
  const points = inRange.sort((a, b) => a.t - b.t).filter(point => !seen.has(point.t) && seen.add(point.t));
  const segments = [];
  for (const point of points) {
    const last = segments.at(-1)?.at(-1);
    // Reset times reported to the minute can differ by a minute for the same window.
    // While a limit sits unused at 100%, some providers (Codex) report a reset time that moves with the clock.
    const idle = last && last.r >= 99.5 && point.r >= 99.5;
    const reset = !idle && Number.isFinite(last?.x) && Number.isFinite(point.x) && Math.abs(point.x - last.x) > 5 * 60000;
    if (!last || point.t - last.t > GAP[range] || reset) segments.push([point]); else segments.at(-1).push(point);
  }
  const drawn = segments.filter(segment => segment.length >= MIN_SEGMENT || segments.length === 1);
  const series = points.length ? [{ host: 'All', name: '', points, segments: drawn }] : [];
  const allResets = [...new Set(inRange.map(point => point.x).filter(x => Number.isFinite(x) && x >= from && x <= now))].sort((a, b) => a - b)
    .filter((x, index, list) => index === 0 || x - list[index - 1] > 5 * 60000);
  const resets = allResets.length <= 12 ? allResets : [];
  const newest = all.reduce((best, point) => !best || point.t > best.t ? point : best, null);
  const latest = newest ? { remaining: newest.r, at: new Date(newest.t).toISOString(), host: newest.host,
    name: names[newest.host] ?? newest.host } : null;
  const firstIn = inRange.length ? Math.min(...inRange.map(point => point.t)) : null;
  const firstAt = firstIn !== null && firstIn > from ? firstIn : null;
  return { provider, window, range, from, to, series, resets, latest, firstAt, startsHere: firstAt !== null && firstAt === earliest, empty: inRange.length === 0, total: inRange.length };
}
