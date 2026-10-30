
const HOUR = 3600000, DAY = 24 * HOUR;
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
    const segments = [];
    for (const point of points) {
      const last = segments.at(-1)?.at(-1);
      // Reset times reported to the minute can differ by a minute for the same window.
      const reset = Number.isFinite(last?.x) && Number.isFinite(point.x) && Math.abs(point.x - last.x) > 5 * 60000;
      if (!last || point.t - last.t > GAP[range] || reset) segments.push([point]); else segments.at(-1).push(point);
    }
    return { host, name: typeof names[host] === 'string' && names[host].trim() ? names[host].trim() : host, points, segments };
  });
  const allResets = [...new Set(inRange.map(point => point.x).filter(x => Number.isFinite(x) && x >= from && x <= now))].sort((a, b) => a - b)
    .filter((x, index, list) => index === 0 || x - list[index - 1] > 5 * 60000);
  const resets = allResets.length <= 12 ? allResets : [];
  const newest = all.reduce((best, point) => !best || point.t > best.t ? point : best, null);
  const latest = newest ? { remaining: newest.r, at: new Date(newest.t).toISOString(), host: newest.host,
    name: series.find(row => row.host === newest.host)?.name ?? names[newest.host] ?? newest.host } : null;
  const firstIn = inRange.length ? Math.min(...inRange.map(point => point.t)) : null;
  const firstAt = firstIn !== null && firstIn > from ? firstIn : null;
  return { provider, window, range, from, to, series, resets, latest, firstAt, startsHere: firstAt !== null && firstAt === earliest, empty: inRange.length === 0, total: inRange.length };
}

const WINDOW_MS = { '5h': 5 * HOUR, week: 7 * DAY };
// Reset times reported to the minute can differ by a minute for the same window.
const sameReset = (a, b) => Math.abs(a - b) <= 5 * 60000;

// One column per limit window: how much was left at the lowest reading taken in it.
// A reading belongs to the previous window when it reports the same reset time.
// While a limit sits unused at 100%, some providers (Codex) report a reset time that moves
// with the clock on every reading. That idle run is one unused window, not many.
// A new reset time after any use starts a new window, so an early reset is never merged away.
// A window with no reading has no column. It is never drawn as zero.
const IDLE = 99.5;
// An idle run's reset time is the clock plus the window, not a real reset, so the first use after it
// starts a new window even when its reset happens to land within minutes of the idle one.
const sameWindow = (last, point) => {
  if (last.drifting && point.r < IDLE) return false;
  return sameReset(last.end, point.x) || (last.latest >= IDLE && point.r >= IDLE);
};

export function windowColumns(points, window) {
  const length = WINDOW_MS[window];
  const columns = [];
  for (const point of [...points].filter(point => Number.isFinite(point.x)).sort((a, b) => a.t - b.t)) {
    const last = columns.at(-1);
    if (last && sameWindow(last, point)) {
      if (!sameReset(last.end, point.x)) last.drifting = true;
      if (point.r < last.low) last.low = point.r;
      last.readings++;
      last.lastAt = point.t;
      last.latest = point.r;
      last.end = Math.max(last.end, point.x);
    } else columns.push({ start: point.x - length, end: point.x, low: point.r, readings: 1, lastAt: point.t, latest: point.r });
  }
  return columns;
}

// Over long ranges a window column would be thinner than a pixel or two, so windows
// are shown per local day instead: the lowest reading of any window that ended that day.
export function dailyColumns(columns) {
  const days = new Map();
  for (const column of columns) {
    const day = new Date(column.end); day.setHours(0, 0, 0, 0);
    const key = day.getTime();
    const next = new Date(day); next.setDate(next.getDate() + 1);
    const known = days.get(key);
    if (!known) days.set(key, { start: key, end: next.getTime(), low: column.low, readings: column.readings, lastAt: column.lastAt, latest: column.latest });
    else { known.low = Math.min(known.low, column.low); known.readings += column.readings; known.lastAt = Math.max(known.lastAt, column.lastAt); }
  }
  return [...days.values()].sort((a, b) => a.start - b.start);
}

// The even-spend line for each window of one computer: 100% at the window's start, 0% at its reset.
// Above the line means usage is on track to last. Below means it would run out early.
// Each computer gets its own guides, built from its own windows.
export function paceGuide(points, window, from, to) {
  const length = WINDOW_MS[window];
  // used is false for a window nobody used: it has nothing to pace.
  return windowColumns(points, window).flatMap(({ end, low }) => {
    const start = end - length;
    const t1 = Math.max(start, from), t2 = Math.min(end, to);
    if (t2 <= t1) return [];
    const at = t => 100 * (1 - (t - start) / length);
    return [{ t1, r1: at(t1), t2, r2: at(t2), end, used: low < IDLE }];
  });
}
