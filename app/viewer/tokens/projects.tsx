import { STRINGS, format } from '../../../lib/strings.generated';
import { compact } from '../../../lib/panel-data.mjs';
import { money } from '../../../lib/view-tokens.mjs';
import { projectsView } from '../../../lib/view-projects.mjs';
import { Card } from '../components';

type Device = ReturnType<typeof projectsView>[number];
type Project = Device['projects'][number];

const count = (value: number | null) => value === null ? STRINGS.status.unknown : compact(value);
const dollars = (usd: number | null) => {
  if (usd === null) return STRINGS.status.unknown;
  if (usd > 0 && usd < 0.005) return STRINGS.tokens.underCent;
  return usd < 10 ? format(STRINGS.formats.usd, { value: money(usd) ?? '' }) : format(STRINGS.formats.usd, { value: Math.round(usd).toLocaleString('en-US') });
};
const clock = (value: unknown) => {
  const at = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hourCycle: 'h23' }) : STRINGS.status.unknown;
};
const percent = (value: number | null) => value === null ? STRINGS.status.unknown : `${Math.round(value * 100)}%`;

function ProjectRow({ project }: { project: Project }) {
  const head = <>
    <span className="ob-projects-name">{project.name}</span>
    <span className="ob-projects-num">{count(project.total)}</span>
    <span className="ob-projects-num">{dollars(project.usd)}</span>
  </>;
  if (!project.sessions.length) return <li><div className="ob-projects-row">{head}</div></li>;
  return <li><details>
    <summary className="ob-projects-row">{head}</summary>
    <ul className="ob-projects-sessions">{project.sessions.map(session => <li key={session.id} className="ob-projects-row">
      <span className="ob-projects-name">{format(STRINGS.projects.session, { start: clock(session.start), end: clock(session.end) })}</span>
      <span className="ob-projects-num">{count(session.total)}</span>
      <span className="ob-projects-num">{format(STRINGS.projects.subagents, { share: percent(session.subagentShare) })}</span>
    </li>)}</ul>
  </details></li>;
}

export function ProjectsCard({ devices }: { devices: Device[] }) {
  if (!devices.length) return null;
  return <Card label={STRINGS.projects.title}>
    <h3>{STRINGS.projects.title}</h3>
    {devices.map(device => <div key={device.host} className="ob-projects">
      {devices.length > 1 && <h4>{device.label}</h4>}
      {device.status !== 'ok' ? <p>{device.status === 'no-records' ? STRINGS.status.noRecords : STRINGS.status.unknown}</p>
        : <ul className="ob-projects-list">{device.projects.map((project, index) => <ProjectRow key={`${index}-${project.name}`} project={project} />)}</ul>}
    </div>)}
  </Card>;
}
