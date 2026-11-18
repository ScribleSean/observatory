import { useEffect, useRef } from 'react';
import type { Spec } from '@json-render/react';
import { UNKNOWN, buildSessions, clock, count, share, useR2, type SessionRow } from '../data';
import { SpecView } from '../registry';
import { SESSIONS } from '../pins';
import { BarList } from '../blocks/Breakdown';
import { SessionName, flagged } from '../blocks/SessionsTable';

const MIX = ['m0', 'm1', 'm2', 'm3'];
const TOOL_NAMES: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', grok: 'Grok' };

export function Sessions() {
  return <SpecView spec={SESSIONS.spec as Spec} />;
}

function find(rows: SessionRow[], key: string): SessionRow | null {
  for (const row of rows) { if (row.key === key) return row; const kid = find(row.children, key); if (kid) return kid; }
  return null;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Where Tab goes inside the open panel: past the last control it wraps to the first, and Shift+Tab the other way. Null leaves it to the browser. */
export function trapTab(count: number, current: number, back: boolean): number | null {
  if (count === 0) return null;
  if (back && current <= 0) return count - 1;
  if (!back && (current === count - 1 || current < 0)) return 0;
  return null;
}

/** One session, broken down. It opens over any view and changes nothing: the dashboard only reads. */
export function SessionPanel() {
  const { snapshot, scope, now, selected, openSession } = useR2();
  const vm = selected ? buildSessions(snapshot, scope, { now, limit: 5000 }) : null;
  const row = vm && selected ? find(vm.rows, selected) : null;
  const zone = vm?.frame.timeZone ?? 'UTC';
  const models = row?.spend.breakdowns.model ?? [], kinds = row?.spend.breakdowns.kind ?? [], repos = row?.onMain.breakdowns.repo ?? [];
  const panel = useRef<HTMLDialogElement | null>(null);
  const shown = row !== null;
  // Opening moves focus into the panel and keeps Tab inside it. Closing hands focus back to whatever opened it.
  useEffect(() => {
    if (!shown) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.querySelector<HTMLElement>('.x')?.focus();
    const keepFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !panel.current) return;
      const controls = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const next = trapTab(controls.length, controls.indexOf(document.activeElement as HTMLElement), event.shiftKey);
      if (next !== null) { event.preventDefault(); controls[next]?.focus(); }
    };
    document.addEventListener('keydown', keepFocus);
    return () => { document.removeEventListener('keydown', keepFocus); if (before?.isConnected) before.focus(); };
  }, [shown]);
  // A session that leaves the list (a refresh, a new range) closes the panel instead of leaving the page inert.
  useEffect(() => { if (selected && vm && !row) openSession(null); }, [selected, vm, row, openSession]);
  const flags = !row ? [] : row.onMain.of === 0 ? ['No commits in this range'] : row.onMain.value === 0 ? ['Commits exist only on branches, none on main'] : [];
  return (
    <>
      <div className={row ? 'scrim on' : 'scrim'} onClick={() => openSession(null)} aria-hidden="true" />
      {/* A dialog element kept in the page (not showModal), so it can slide in and out. App.tsx makes the page behind it inert. */}
      <dialog ref={panel} open={row ? true : undefined} className={row ? 'panel on' : 'panel'} aria-modal="true" aria-label="Session" aria-hidden={!row} inert={!row || undefined}>
        {row && vm && <>
          <div className="ph">
            <button type="button" className="btn sq x" aria-label="Close" onClick={() => openSession(null)}>×</button>
            <h2><SessionName row={row} />{row.kind === 'bundle' && <span className="fa"> ({row.count})</span>}</h2>
            <div className="fa" style={{ fontSize: 'var(--fs-small)' }}>
              {[row.device, TOOL_NAMES[row.tool] ?? row.tool, row.running ? 'running at the last read' : null, `started ${clock(row.startedAt, zone, now)}`, vm.frame.period.label].filter(Boolean).join(' · ')}
            </div>
          </div>
          <div className="sec"><div className="pk">
            <div><b className={row.spend.value === null ? 'unk' : ''}>{row.spend.text}</b><span><i className="mark" />{share(row.share) || UNKNOWN} of spend</span></div>
            <div><b>{count(row.onMain.value)}<small> of {count(row.onMain.of)}</small></b><span>commits on main</span></div>
            <div><b>{row.perLanded.value === null ? 'none' : row.perLanded.text}</b><span>per landed change</span></div>
            <div><b>{count(row.subagents)}</b><span>subagents</span></div>
          </div></div>
          {(flags.length > 0 || flagged(row)) && <div className="sec"><h4>Flags</h4>
            {flags.map(text => <div key={text} className="flag"><span className="flagdot" /><span>{text}</span></div>)}
          </div>}
          <div className="sec"><h4>Spend by model</h4>
            {models.length === 0 ? <div className="unk">{UNKNOWN}</div> : <>
              <div className="stack">{models.slice(0, 4).map((part, index) => <i key={part.key} className={MIX[index]} style={{ width: `${part.share ?? 0}%` }} />) /* zero-ok: a bar width, not a reading */}</div>
              <BarList parts={models} accent />
            </>}
          </div>
          <div className="sec"><h4>Spend by kind of work</h4>{kinds.length === 0 ? <div className="unk">{UNKNOWN}</div> : <BarList parts={kinds} accent />}</div>
          <div className="sec"><h4>Repos touched</h4>
            {repos.length ? <BarList parts={repos} accent={false} /> : <div className="mu">{row.repos.length ? row.repos.join(', ') : 'None recorded'}</div>}
          </div>
          <div className="sec"><div className="kv">
            {row.kind === 'session' && <><span>Session id</span><span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-small)' }}>{row.key.split('.').at(-1)}</span></>}
            <span>Sessions</span><span>{count(row.count)}</span>
            <span>Monitor only</span><span>Nothing here can stop or change a session</span>
          </div></div>
        </>}
      </dialog>
    </>
  );
}
