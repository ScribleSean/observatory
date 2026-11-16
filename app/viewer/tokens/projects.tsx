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

type Session = Device['sessions'][number];

function SessionRow({ session }: { session: Session }) {
  const head = <>
    <span className="ob-projects-name">{session.project}<span className="ob-meta ob-sessions-when">{format(STRINGS.projects.engineAndTime, { provider: session.provider, ...session.range })}</span></span>
    <span className="ob-projects-num">{count(session.total)}</span>
    <span className="ob-projects-num">{percent(session.share)}</span>
  </>;
  // A session with no subagent tokens, or an Unknown split, has nothing to open.
  if (session.main === null || session.main === session.total) return <li><div className="ob-projects-row">{head}</div></li>;
  const part = (key: string, name: string, tokens: number) => <li key={key} className="ob-projects-row">
    <span className="ob-projects-name">{name}</span>
    <span className="ob-projects-num">{count(tokens)}</span>
    <span className="ob-projects-num">{percent(session.total ? tokens / session.total : null)}</span>
  </li>;
  return <li><details className="ob-disclosure">
    <summary className="ob-projects-row">{head}</summary>
    <ul className="ob-projects-sessions">
      {part('main', STRINGS.projects.main, session.main)}
      {session.subagents.map((agent, index) => part(agent.id, format(STRINGS.projects.subagent, { number: index + 1 }), agent.total))}
      {session.otherSubagents ? part('other', STRINGS.projects.otherSubagents, session.otherSubagents) : null}
    </ul>
  </details></li>;
}

// Today's largest sessions on each computer, with the subagents inside each.
export function SessionsCard({ devices }: { devices: Device[] }) {
  if (!devices.some(device => device.sessions.length > 0)) return null;
  return <Card label={STRINGS.projects.where} title={STRINGS.projects.where}>
    {devices.map(device => <div key={device.host} className="ob-projects">
      {devices.length > 1 && <h4 title={device.name}>{device.label}</h4>}
      {device.stale && device.asOf && <p className="ob-meta warn">{format(STRINGS.projects.asOf, { time: device.asOf })}</p>}
      {!device.sessions.length ? <p className="ob-meta">{device.status === 'no-records' ? STRINGS.status.noRecords : STRINGS.status.unknown}</p>
        : <ul className="ob-projects-list">
        <li className="ob-projects-row ob-projects-header" aria-hidden="true"><span>{STRINGS.projects.sessionHeader}</span><span className="ob-projects-num">{STRINGS.tokens.total}</span><span className="ob-projects-num">{STRINGS.projects.shareHeader}</span></li>
        {device.sessions.map(session => <SessionRow key={session.id} session={session} />)}</ul>}
    </div>)}
  </Card>;
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
