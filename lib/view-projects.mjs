import strings from './strings.json' with { type: 'json' };
import { today } from './panel-data.mjs';
import { validTimeZone } from './timezone.mjs';

const STALE_MS = 15 * 60000;
const rows = value => Array.isArray(value) ? value.filter(row => row && typeof row === 'object' && !Array.isArray(row)) : [];
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const share = (part, total) => number(part) === null || !number(total) ? null : part / total;

// A time as H:MM in the time zone the computer collected in.
export function clock(value, timeZone) {
  const at = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(at)) return strings.status.unknown;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: validTimeZone(timeZone) ? timeZone : undefined,
    hour: 'numeric', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at).map(part => [part.type, part.value]));
  return `${Number(parts.hour) % 24}:${parts.minute}`;
}

function project(row, name, timeZone) {
  const sessions = rows(row.sessions).map(session => ({
    id: String(session.id), range: { start: clock(session.start, timeZone), end: clock(session.end, timeZone) },
    total: number(session.totalTokens), subagentShare: share(session.subagentTokens, session.totalTokens),
  }));
  const total = number(row.totalTokens);
  const hidden = (number(row.sessionCount) ?? 0) - sessions.length;
  const shown = sessions.reduce((sum, session) => sum + (session.total ?? 0), 0);
  return { name, total, usd: number(row.usd), sessions,
    more: hidden > 0 ? { count: hidden, total: total === null ? null : Math.max(0, total - shown) } : null };
}

// Today's tokens by project for one computer, or for each computer under All.
// Projects are never added across computers. A reading is current when it is
// from today and under 15 minutes old, as on the overview. An older reading
// from today is shown with its time, and one from another day is Unknown.
export function projectsView(input, { host, now = Date.now() }) {
  const snapshot = input && typeof input === 'object' ? input : {};
  const sources = rows(snapshot.projectTokens).filter(row => row.status !== 'not-connected' && (host === 'All' || row.host === host));
  return ['Mac', 'Windows'].flatMap(id => {
    const source = sources.find(row => row.host === id);
    if (!source) return [];
    const label = snapshot.deviceNames?.[id];
    const timeZone = validTimeZone(source.timeZone) ? source.timeZone : snapshot.timezone;
    const checked = Date.parse(source.checkedAt);
    const base = { host: id, label: typeof label === 'string' && label.trim() ? label.trim() : id === 'Mac' ? strings.devices.macOS : strings.devices.windows,
      asOf: Number.isFinite(checked) ? clock(source.checkedAt, timeZone) : null };
    const fromToday = source.status === 'ok' && source.date === today(timeZone, new Date(now));
    if (!fromToday) return [{ ...base, status: 'unknown', stale: true, projects: [] }];
    const stale = !Number.isFinite(checked) || now - checked > STALE_MS;
    const projects = rows(source.projects).map(row => project(row, typeof row.name === 'string' ? row.name : strings.status.unknown, timeZone));
    if (source.other) projects.push(project({ ...source.other, sessions: [], sessionCount: 0 }, strings.projects.other, timeZone));
    return [{ ...base, status: projects.length ? 'ok' : 'no-records', stale, projects }];
  });
}
