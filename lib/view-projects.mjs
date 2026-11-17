import strings from './strings.json' with { type: 'json' };
import { today, deviceLabel, deviceName } from './panel-data.mjs';
import { validTimeZone } from './timezone.mjs';
import { snapshotFresh } from './freshness.mjs';

const rows = value => Array.isArray(value) ? value.filter(row => row && typeof row === 'object' && !Array.isArray(row)) : [];
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const share = (part, total) => number(part) === null || !number(total) ? null : part / total;

export function clock(value, timeZone) {
  const at = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(at)) return strings.status.unknown;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: validTimeZone(timeZone) ? timeZone : undefined,
    hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(at).map(part => [part.type, part.value]));
  return `${parts.hour}:${parts.minute} ${parts.dayPeriod}`;
}

function project(row, name, timeZone) {
  const sessions = rows(row.sessions).map(session => ({
    id: String(session.id), range: { start: clock(session.start, timeZone), end: clock(session.end, timeZone) },
    total: number(session.totalTokens), subagentShare: share(session.subagentTokens, session.totalTokens),
  }));
  const total = number(row.totalTokens);
  // zero-ok: an Unknown session count adds no "more" row. The project total still covers those sessions.
  const hidden = (number(row.sessionCount) ?? 0) - sessions.length;
  const shown = sessions.some(session => session.total === null) ? null : sessions.reduce((sum, session) => sum + session.total, 0);
  return { name, total, usd: number(row.usd), sessions,
    more: hidden > 0 ? { count: hidden, total: total === null || shown === null ? null : Math.max(0, total - shown) } : null };
}

export const TOP_SESSIONS = 10;

// Today's largest sessions on one computer, across projects and across Claude Code and Codex, each
// with its largest subagents. A project lists only its largest sessions, so the ranking stops at the
// size an unlisted session could have. It never shows a session below one it cannot see.
function topSessions(source, timeZone) {
  const projects = rows(source.projects);
  const totals = [...projects, ...(source.other ? [source.other] : [])].map(row => number(row.totalTokens));
  const dayTotal = totals.includes(null) ? null : totals.reduce((sum, value) => sum + value, 0);
  // A project past the cap is no larger than the smallest listed project, and its sessions are no larger than it.
  // zero-ok: with no project left out, no unlisted session exists.
  let unseen = source.other ? Math.min(number(source.other.totalTokens) ?? Infinity, ...projects.map(row => number(row.totalTokens) ?? Infinity)) : 0;
  const listed = projects.flatMap(row => {
    const sessions = rows(row.sessions).filter(session => number(session.totalTokens) !== null);
    if (number(row.sessionCount) !== sessions.length) {
      const shown = sessions.reduce((sum, session) => sum + session.totalTokens, 0);
      // With no listed session to bound it, an unlisted one could be as large as the whole project.
      const rest = Math.max(0, (number(row.totalTokens) ?? Infinity) - shown);
      unseen = Math.max(unseen, sessions.length ? Math.min(rest, ...sessions.map(session => session.totalTokens)) : rest);
    }
    return sessions.map(session => ({ session, name: typeof row.name === 'string' ? row.name : strings.status.unknown }));
  });
  return listed.filter(({ session }) => session.totalTokens >= unseen)
    .sort((a, b) => b.session.totalTokens - a.session.totalTokens || String(a.session.id).localeCompare(String(b.session.id)))
    .slice(0, TOP_SESSIONS).map(({ session, name }) => {
      const total = session.totalTokens, inSubagents = number(session.subagentTokens);
      const subagents = inSubagents === null ? [] : rows(session.subagents).filter(row => number(row.totalTokens) !== null)
        .map(row => ({ id: String(row.id), total: row.totalTokens }));
      const named = subagents.reduce((sum, row) => sum + row.total, 0);
      // A session that worked in two projects is one row in each.
      return { id: `${session.provider}-${session.id}-${name}`, project: name,
        provider: session.provider === 'codex' ? strings.providers.codex : strings.providers.claudeCode,
        range: { start: clock(session.start, timeZone), end: clock(session.end, timeZone) },
        total, share: share(total, dayTotal),
        // Unknown when some turn did not say whether it was a subagent's.
        main: inSubagents === null ? null : Math.max(0, total - inSubagents),
        subagents, otherSubagents: inSubagents === null ? null : Math.max(0, inSubagents - named) };
    });
}

// Projects are never added across computers. A reading is current when it is
// from today and under 15 minutes old, as on the overview. An older reading
// from today is shown with its time, and one from another day is Unknown.
export function projectsView(input, { host, now = Date.now() }) {
  const snapshot = input && typeof input === 'object' ? input : {};
  const sources = rows(snapshot.projectTokens).filter(row => row.status !== 'not-connected' && (host === 'All' || row.host === host));
  return ['Mac', 'Windows', 'Linux'].flatMap(id => {
    const source = sources.find(row => row.host === id);
    if (!source) return [];
    const timeZone = validTimeZone(source.timeZone) ? source.timeZone : snapshot.timezone;
    const checked = Date.parse(source.checkedAt);
    const base = { host: id, label: deviceLabel(id), name: deviceName(snapshot, id),
      asOf: Number.isFinite(checked) ? clock(source.checkedAt, timeZone) : null };
    const fromToday = source.status === 'ok' && source.date === today(timeZone, new Date(now));
    if (!fromToday) return [{ ...base, status: 'unknown', stale: true, projects: [], sessions: [] }];
    const stale = !snapshotFresh(checked, now);
    const projects = rows(source.projects).map(row => project(row, typeof row.name === 'string' ? row.name : strings.status.unknown, timeZone));
    if (source.other) projects.push(project({ ...source.other, sessions: [], sessionCount: 0 }, strings.projects.other, timeZone));
    return [{ ...base, status: projects.length ? 'ok' : 'no-records', stale, projects, sessions: topSessions(source, timeZone) }];
  });
}
