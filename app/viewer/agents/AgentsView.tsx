import { STRINGS } from '../../../lib/strings.generated';
import { format, readingTime } from '../../../lib/panel-data.mjs';
import { Card } from '../components';

// What are my agents doing, per computer. Read-only: status, project and session
// names and times, from the state files Claude Code and codex-job leave behind.
export type AgentSession = { tool: string; status: string; project?: string | null; name?: string | null; startedAt?: string | null; updatedAt?: string | null };
export type AgentJob = { tool: string; status: string; project?: string | null; startedAt?: string | null; finishedAt?: string | null };
export type AgentDevice = {
  host: string; name: string; status: 'ok' | 'off' | 'unknown'; checkedAt?: string | null; stale?: boolean;
  counts?: Record<string, number>; sessions?: AgentSession[]; jobs?: AgentJob[]; claudeFound?: boolean; codexFound?: boolean;
};

const WORDS: Record<string, string> = {
  waiting: STRINGS.agents.waiting, working: STRINGS.agents.working, idle: STRINGS.agents.idle,
  done: STRINGS.agents.done, stopped: STRINGS.agents.stopped, unknown: STRINGS.agents.unknown,
};

export function StatusPill({ status }: { status: string }) {
  const known = Object.hasOwn(WORDS, status) ? status : 'unknown';
  return <span className={`ob-status ob-status-${known}`}><i aria-hidden="true" />{WORDS[known]}</span>;
}

const when = (value: string | null | undefined, now: number) => {
  const at = Date.parse(value ?? '');
  return Number.isFinite(at) ? readingTime(at, now) : STRINGS.status.unknown;
};

function Sessions({ device, now }: { device: AgentDevice; now: number }) {
  const sessions = device.sessions ?? [];
  if (!device.claudeFound && sessions.length === 0) return <p className="ob-meta">{STRINGS.agents.notFound}</p>;
  if (sessions.length === 0) return <p className="ob-meta">{STRINGS.agents.none}</p>;
  return (
    <ul className="ob-agent-list">
      {sessions.map((session, index) => (
        <li key={index} data-status={session.status}>
          <StatusPill status={session.status} />
          <span className="ob-agent-name">
            <strong>{session.project ?? STRINGS.status.unknown}</strong>
            {session.name ? <span>{session.name}</span> : null}
          </span>
          <time className="ob-meta" dateTime={session.updatedAt ?? undefined}>{format(STRINGS.agents.since, { time: when(session.updatedAt ?? session.startedAt, now) })}</time>
        </li>
      ))}
    </ul>
  );
}

function Jobs({ device, now }: { device: AgentDevice; now: number }) {
  const jobs = device.jobs ?? [];
  if (!device.codexFound && jobs.length === 0) return <p className="ob-meta">{STRINGS.agents.notFound}</p>;
  if (jobs.length === 0) return <p className="ob-meta">{STRINGS.agents.noJobs}</p>;
  return (
    <ul className="ob-agent-list">
      {jobs.map((job, index) => (
        <li key={index} data-status={job.status}>
          <StatusPill status={job.status} />
          <span className="ob-agent-name"><strong>{job.project ?? STRINGS.status.unknown}</strong></span>
          <time className="ob-meta" dateTime={job.finishedAt ?? job.startedAt ?? undefined}>
            {job.finishedAt ? format(STRINGS.agents.finished, { time: when(job.finishedAt, now) }) : format(STRINGS.agents.started, { time: when(job.startedAt, now) })}
          </time>
        </li>
      ))}
    </ul>
  );
}

export function AgentsView({ agents, now }: { agents: AgentDevice[]; now: number }) {
  return (
    <>
    <div className="ob-agents">
      {agents.map(device => (
        <Card key={device.host} label={device.name}>
          <div className="ob-row">
            <h3>{device.name}</h3>
            {device.status === 'ok' && device.stale && device.checkedAt
              ? <span className="ob-meta warn">{format(STRINGS.overview.asOf, { time: when(device.checkedAt, now) })}</span> : null}
          </div>
          {device.status === 'off' ? <p className="ob-meta">{STRINGS.agents.off}</p>
            : device.status !== 'ok' ? <p className="ob-meta">{STRINGS.status.unknown}</p>
            : <>
              <h4>{STRINGS.agents.claudeSessions}</h4>
              <Sessions device={device} now={now} />
              <h4>{STRINGS.agents.codexJobs}</h4>
              <Jobs device={device} now={now} />
            </>}
        </Card>
      ))}
    </div>
    <p className="ob-meta ob-agents-note">{STRINGS.agents.privacy}</p>
    </>
  );
}
