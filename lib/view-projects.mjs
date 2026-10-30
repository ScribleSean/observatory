import strings from './strings.json' with { type: 'json' };
import { today } from './panel-data.mjs';

const rows = value => Array.isArray(value) ? value.filter(row => row && typeof row === 'object' && !Array.isArray(row)) : [];
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const share = (part, total) => number(part) === null || !number(total) ? null : part / total;

function project(row, name) {
  return {
    name, total: number(row.totalTokens), usd: number(row.usd), subagentShare: share(row.subagentTokens, row.totalTokens),
    sessions: rows(row.sessions).map(session => ({
      id: String(session.id), start: session.start, end: session.end,
      total: number(session.totalTokens), usd: number(session.usd), subagentShare: share(session.subagentTokens, session.totalTokens),
    })),
  };
}

// Today's tokens by project for one computer, or for each computer under All.
// Projects are never added across computers.
export function projectsView(input, { host, now = Date.now() }) {
  const snapshot = input && typeof input === 'object' ? input : {};
  const date = today(snapshot.timezone, new Date(now));
  const sources = rows(snapshot.projectTokens).filter(row => row.status !== 'not-connected' && (host === 'All' || row.host === host));
  return ['Mac', 'Windows'].flatMap(id => {
    const source = sources.find(row => row.host === id);
    if (!source) return [];
    const label = snapshot.deviceNames?.[id];
    const base = { host: id, label: typeof label === 'string' && label.trim() ? label.trim() : id === 'Mac' ? strings.devices.macOS : strings.devices.windows };
    if (source.status !== 'ok' || source.date !== date) return [{ ...base, status: 'unknown', projects: [] }];
    const projects = rows(source.projects).map(row => project(row, typeof row.name === 'string' ? row.name : strings.status.unknown));
    if (source.other) projects.push(project({ ...source.other, sessions: [] }, strings.projects.other));
    return [{ ...base, status: projects.length ? 'ok' : 'no-records', projects }];
  });
}
