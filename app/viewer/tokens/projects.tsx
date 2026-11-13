import { STRINGS, format } from '../../../lib/strings.generated';
import { compact, usd } from '../../../lib/panel-data.mjs';
import { projectsView } from '../../../lib/view-projects.mjs';
import { Card } from '../components';

type Device = ReturnType<typeof projectsView>[number];
type Project = Device['projects'][number];

const count = (value: number | null) => value === null ? STRINGS.status.unknown : compact(value);
const percent = (value: number | null) => value === null ? STRINGS.status.unknown : `${Math.round(value * 100)}%`;

function ProjectRow({ project }: { project: Project }) {
  const head = <>
    <span className="ob-projects-name">{project.name}</span>
    <span className="ob-projects-num">{count(project.total)}</span>
    <span className="ob-projects-num">{usd(project.usd)}</span>
  </>;
  if (!project.sessions.length) return <li><div className="ob-projects-row">{head}</div></li>;
  return <li><details className="ob-disclosure">
    <summary className="ob-projects-row">{head}</summary>
    <ul className="ob-projects-sessions">{project.sessions.map(session => <li key={session.id} className="ob-projects-row">
      <span className="ob-projects-name">{format(STRINGS.projects.session, session.range)}</span>
      <span className="ob-projects-num">{count(session.total)}</span>
      <span className="ob-projects-num">{format(STRINGS.projects.subagents, { share: percent(session.subagentShare) })}</span>
    </li>)}
    {project.more && <li className="ob-projects-row">
      <span className="ob-projects-name">{format(STRINGS.projects.more, { count: project.more.count })}</span>
      <span className="ob-projects-num">{count(project.more.total)}</span>
      <span />
    </li>}</ul>
  </details></li>;
}

export function ProjectsCard({ devices }: { devices: Device[] }) {
  if (!devices.length) return null;
  return <Card label={STRINGS.projects.title} title={STRINGS.projects.title}>
    {devices.map(device => <div key={device.host} className="ob-projects">
      {devices.length > 1 && <h4 title={device.name}>{device.label}</h4>}
      {device.stale && device.asOf && <p className="ob-meta warn">{format(STRINGS.projects.asOf, { time: device.asOf })}</p>}
      {device.status !== 'ok' ? <p className="ob-meta">{device.status === 'no-records' ? STRINGS.status.noRecords : STRINGS.status.unknown}</p>
        : <ul className="ob-projects-list">
          <li className="ob-projects-row ob-projects-header" aria-hidden="true"><span>{STRINGS.projects.project}</span><span className="ob-projects-num">{STRINGS.tokens.total}</span><span className="ob-projects-num">{STRINGS.tokens.cost}</span></li>
          {device.projects.map((project, index) => <ProjectRow key={`${index}-${project.name}`} project={project} />)}</ul>}
    </div>)}
  </Card>;
}
