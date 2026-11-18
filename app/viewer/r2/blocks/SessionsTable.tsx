import { useState, type ReactNode } from 'react';
import type { ComponentRenderProps } from '@json-render/react';
import { ROLES } from '../../../../lib/roles.mjs';
import { UNKNOWN, buildSessions, clock, count, metric, patchScope, plural, share, useR2, type SessionRow, type SessionsVM } from '../data';

type Props = import('../../../../lib/r2-blocks.mjs').SessionsTableProps;
type Sort = NonNullable<Props['sort']>;
const MIX = ['m0', 'm1', 'm2', 'm3'];
const TOOL_NAMES: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', grok: 'Grok' };
const NO_LIMIT = 5000;

/** A row is flagged when work piled up with nothing on main, or money went out with no commit at all. */
export function flagged(row: SessionRow): boolean {
  const commits = row.onMain.of, landed = row.onMain.value, spend = row.spend.value;
  if (commits === null || landed === null) return false;
  return (row.kind === 'session' && commits > 5 && landed === 0) || (commits === 0 && spend !== null && spend > 3 && row.tool === 'claude');
}

export function SessionName({ row }: { row: SessionRow }) {
  return <>{row.name.role && <span className="role">[{row.name.role}] </span>}{row.name.object}</>;
}

function Mix({ row }: { row: SessionRow }) {
  const parts = row.spend.breakdowns.model ?? [];
  return (
    <span className="mix" title={parts.map(part => `${part.label} ${share(part.share)}`).join(', ')}>
      {parts.slice(0, 4).map((part, index) => <i key={part.key} className={MIX[index]} style={{ width: `${part.share ?? 0}%` }} />) /* zero-ok: a bar width, not a reading */}
    </span>
  );
}

function Landed({ row, merged }: { row: { onMain: SessionRow['onMain']; merged?: SessionRow['merged'] }; merged?: boolean }) {
  const commits = row.onMain.of, landed = row.onMain.value;
  if (commits === null || landed === null) return <span className="unk">{UNKNOWN}</span>;
  if (commits === 0) return <span className="fa">no commits</span>;
  return <><span style={{ color: 'var(--text)' }}>{count(landed)}</span> <span className="fa">of {count(commits)}{merged && row.merged?.value ? ` · ${count(row.merged.value)} merged` : ''}</span></>;
}

/** Running now: data, not a status light. */
function Running({ vm }: { vm: SessionsVM }) {
  const { openSession, now } = useR2();
  const { frame, rows } = vm;
  if (!frame.period.current) return null;
  return (
    <section className="blk">
      <div className="bh"><h3>Running now</h3><span className="fa">{plural(rows.length, 'session')} at the {clock(frame.generatedAt, frame.timeZone, now)} read</span></div>
      {rows.length === 0 && <div className="empty">Nothing was running at the last read.</div>}
      {rows.map(row => (
        <button key={row.key} type="button" className="li" onClick={() => openSession(row.key)}>
          <span className="t"><div><b><SessionName row={row} /></b></div><div>{[row.device, row.models[0], plural(row.subagents, 'subagent'), `since ${clock(row.startedAt, frame.timeZone, now)}`].filter(Boolean).join(' · ')}</div></span>
          <span className="n">{row.spend.text}</span>
        </button>
      ))}
    </section>
  );
}

export function SessionsTable({ element }: ComponentRenderProps<Props>) {
  const { snapshot, scope, now, view, selected, openSession } = useR2();
  const props = element.props;
  const full = view === 'sessions';
  const [grouped, setGrouped] = useState(props.groupBy === 'role');
  const [sort, setSort] = useState<Sort>(props.sort ?? 'spend');
  const [role, setRole] = useState(props.role ?? null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [all, setAll] = useState(false);
  const inner = patchScope(scope, props.scope);
  const limit = full || all ? NO_LIMIT : props.limit ?? 25;
  const vm = buildSessions(snapshot, inner, { now, groupBy: grouped ? 'role' : props.groupBy === 'role' ? null : props.groupBy ?? null, role, running: props.running ?? false, sort, limit });
  if (props.running) return <Running vm={vm} />;

  const { frame, rows, totals, coverage } = vm;
  const roles = full ? (metric(snapshot, 'sessions', inner, { now }).breakdowns.role ?? []).map(part => part.key).filter(key => (ROLES as readonly string[]).includes(key)) : [];
  const most = Math.max(...rows.map(row => row.spend.value ?? 0), 0.01); // zero-ok: an Unknown row draws no bar and sets no scale
  const columns = full ? 9 : 8;
  const bar = (row: { spend: SessionRow['spend'] }, percent: number | null) => (
    <span className="shr">{row.spend.value !== null && <i style={{ width: `${Math.max(0.08, 2.6 * row.spend.value / most).toFixed(2)}em` }} />}{share(percent)}</span>
  );
  const toggle = (key: string, fallback: boolean) => setOpen(state => ({ ...state, [key]: !(state[key] ?? fallback) }));

  const line = (row: SessionRow, child = false): ReactNode[] => {
    const expanded = open[row.key] ?? false;
    const flag = flagged(row);
    return [
      <tr key={row.key} className={`${child ? 'child' : 'row'}${selected === row.key ? ' sel' : ''}`} onClick={child ? undefined : () => openSession(row.key)}>
        <td className="name">
          {!child && (row.kind === 'bundle'
            ? <button type="button" className="car" aria-expanded={expanded} aria-label={expanded ? 'Hide the sessions in this row' : 'Show the sessions in this row'} onClick={event => { event.stopPropagation(); toggle(row.key, false); }}>{expanded ? '−' : '+'}</button>
            : <span className="car" />)}
          <SessionName row={row} />{row.kind === 'bundle' && <span className="fa"> ({row.count})</span>}{row.running && <span className="fa"> · running</span>}
        </td>
        <td className="hide-s">{row.device}{row.tool !== 'claude' && ` · ${TOOL_NAMES[row.tool] ?? row.tool}`}</td>
        <td className="r hide-s">{row.subagents ? count(row.subagents) : <span className="fa">0</span>}</td>
        <td className="hide-m"><Mix row={row} /></td>
        <td className={row.spend.value === null ? 'r unk' : 'r strong'}>{row.spend.text}</td>
        <td className="r hide-s">{bar(row, row.share)}</td>
        <td>{flag ? <span className="acc">{row.onMain.of === 0 ? 'no commits' : `${count(row.onMain.value)} of ${count(row.onMain.of)}`}</span> : <Landed row={row} merged />}</td>
        <td className="r hide-s">{row.perLanded.value === null ? <span className="fa">none</span> : row.perLanded.text}</td>
        {full && <td className="hide-m">{clock(row.startedAt, frame.timeZone, now)}</td>}
      </tr>,
      ...(row.kind === 'bundle' && expanded ? row.children.map(kid => line(kid, true)) : []),
    ];
  };

  const body = rows.length === 0
    ? <tr><td colSpan={columns}><div className="empty">{coverage.unknownDays.length
      ? <><b className="unk">{UNKNOWN}</b>{coverage.unknownDays.map(row => row.name).join(', ')} could not be read for {frame.period.label}, so it has no numbers.</>
      : <><b>No sessions</b>Nothing ran in {frame.period.label}{role ? ` as ${role}` : ''}.</>}</div></td></tr>
    : grouped && vm.groups ? vm.groups.flatMap(group => {
      const shown = open[`g:${group.key}`] ?? true;
      const landed = group.onMain.value;
      const total = (vm.groups ?? []).reduce((sum, each) => sum + (each.spend.value ?? 0), 0); // zero-ok: a share of the listed groups, drawn only when known
      return [
        <tr key={`g:${group.key}`} className="grp" onClick={() => toggle(`g:${group.key}`, true)}>
          <td className="name"><button type="button" className="car" aria-expanded={shown} aria-label={`${shown ? 'Hide' : 'Show'} ${group.label} sessions`}>{shown ? '−' : '+'}</button><b>{group.label}</b> <span className="fa">{plural(group.count, 'session')}</span></td>
          <td className="hide-s" aria-hidden="true" /><td className="r hide-s">{count(group.subagents)}</td><td className="hide-m" aria-hidden="true" />
          <td className="r"><b>{group.spend.text}</b></td>
          <td className="r hide-s">{bar(group, group.spend.value !== null && total ? 100 * group.spend.value / total : null)}</td>
          <td><Landed row={group} /></td>
          <td className="r hide-s">{landed && group.spend.value !== null ? `$${(group.spend.value / landed).toFixed(2)}` : ''}</td>
          {full && <td className="hide-m" aria-hidden="true" />}
        </tr>,
        ...(shown ? group.rows.flatMap(row => line(row)) : []),
      ];
    }) : rows.flatMap(row => line(row));

  const head = (key: Sort, label: string) => full
    ? <button type="button" className={sort === key ? 'on' : ''} aria-pressed={sort === key} onClick={() => setSort(key)}>{label}{sort === key ? ' ↓' : ''}</button> : label;
  return (
    <section className={full ? 'blk' : 'blk wide'}>
      <div className="bh">
        <h3>Sessions</h3><span className="fa">{totals.count === null ? UNKNOWN : count(totals.count)} in {frame.period.label}{role ? `, ${role}` : ''}</span><span className="fill" />
        {full && <span className="tabs">
          <button type="button" className={role === null ? 'on' : ''} aria-pressed={role === null} onClick={() => setRole(null)}>All roles</button>
          {roles.map(each => <button key={each} type="button" className={role === each ? 'on' : ''} aria-pressed={role === each} onClick={() => setRole(each as typeof role)}>{each}</button>)}
        </span>}
        <button type="button" role="switch" aria-checked={grouped} className={grouped ? 'sw on' : 'sw'} onClick={() => setGrouped(!grouped)}><i /><span>Group by role</span></button>
      </div>
      <div className="tw">
        <table>
          <thead><tr>
            <th>Session</th><th className="hide-s">Device</th><th className="r hide-s">Subagents</th><th className="hide-m">Models</th>
            <th className="r">{head('spend', 'Spend')}</th><th className="r hide-s">Share of spend</th><th>{head('onMain', 'On main')}</th>
            <th className="r hide-s" title="Spend divided by commits on main">{head('perLanded', 'Per landed')}</th>{full && <th className="hide-m">{head('startedAt', 'Started')}</th>}
          </tr></thead>
          <tbody>
            {body}
            {totals.other && (
              <tr className="more" onClick={() => setAll(true)}>
                <td className="name"><button type="button" className="car" aria-label="Show every session">+</button>{plural(totals.other.count, 'more session')}</td>
                <td className="hide-s" aria-hidden="true" /><td className="r hide-s" aria-hidden="true" /><td className="hide-m" aria-hidden="true" /><td className="r strong">{totals.other.spend.text}</td><td className="r hide-s" aria-hidden="true" /><td aria-hidden="true" /><td className="r hide-s" aria-hidden="true" />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
