import { useEffect, useRef } from 'react';
import { STRINGS } from '../../../lib/strings.generated';
import { sessionView } from '../../../lib/view-session.mjs';
import './session.css';

type View = NonNullable<ReturnType<typeof sessionView>>;

function Fanout({ data }: { data: NonNullable<View['fanout']> }) {
  return <div className="sp-fan">
    {/* A chart made of bars reads as one picture. Its values are in the hover titles. */}
    {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role */}
    <div className="sp-fan-bars" role="img" aria-label={data.peakText}>
      {data.bars.map((bar, index) => <i key={index} title={bar.label}
        style={{ height: `${Math.max(2, bar.count / (data.peak || 1) * 100)}%`, opacity: 0.45 + 0.55 * bar.count / (data.peak || 1) }} />)}
    </div>
    {data.ticks.length > 0 && <div className="sp-fan-ticks" aria-hidden="true">{data.ticks.map(tick => <span key={tick.index} style={{ left: `${tick.index / data.bars.length * 100}%` }}>{tick.text}</span>)}</div>}
  </div>;
}

/** One session, over the Week page. Esc, the close button or the dimmed page behind it closes it. */
export function SessionPanel({ summary, sessionKey, period, now, onClose }: {
  summary: Record<string, unknown>; sessionKey: string; period: 'current' | 'previous'; now: number; onClose: () => void;
}) {
  const view = sessionView(summary, sessionKey, { period, now });
  const panel = useRef<HTMLElement>(null);
  const found = view !== null;
  useEffect(() => {
    if (!found) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus();
    document.documentElement.classList.add('sp-open');
    return () => { document.documentElement.classList.remove('sp-open'); opener?.focus(); };
  }, [found, sessionKey]);
  useEffect(() => {
    if (!found) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab' || !panel.current) return;
      // Focus stays inside the panel while it is open.
      const stops = [...panel.current.querySelectorAll<HTMLElement>('button, a[href], [tabindex]:not([tabindex="-1"])')];
      if (stops.length === 0) return;
      const first = stops[0], last = stops[stops.length - 1];
      if (!panel.current.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [found, onClose]);
  if (!view) return null;
  return <div className="sp-layer">
    <button type="button" className="sp-scrim" tabIndex={-1} aria-label={STRINGS.session.close} onClick={onClose} />
    {/* A dialog element would bring its own top layer and backdrop. This panel keeps the page's own layout and focus handling. */}
    {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role */}
    <aside ref={panel} className="sp" role="dialog" aria-modal="true" aria-labelledby="sp-title" tabIndex={-1}>
      <div className="sp-head">
        <h2 id="sp-title">{view.running && <span className="wk-live"><span className="ob-visually-hidden">{STRINGS.week.runningNow}</span></span>}{view.title}</h2>
        <button type="button" className="sp-close" aria-label={STRINGS.session.close} onClick={onClose}>
          <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M1 1l8 8M9 1l-8 8" /></svg>
        </button>
      </div>
      <p className="sp-meta">{view.meta.join(STRINGS.formats.separator)}</p>
      <dl className="wk-figures four">{view.figures.map(figure => <div key={figure.label}>
        <dd className={figure.value === STRINGS.status.unknown ? 'ob-unknown' : ''}>{figure.value}</dd><dt>{figure.label}</dt></div>)}</dl>
      {view.fanout && <section className="sp-sec" aria-labelledby="sp-fan-title">
        <div className="wk-h"><h3 id="sp-fan-title">{STRINGS.session.fanout}</h3><span>{view.fanout.peakText}</span></div>
        <Fanout data={view.fanout} />
      </section>}
      {view.kinds.length > 0 && <section className="sp-sec" aria-labelledby="sp-where-title">
        <div className="wk-h"><h3 id="sp-where-title">{STRINGS.session.where}</h3></div>
        <table>
          <thead><tr><th scope="col">{STRINGS.session.work}</th><th scope="col">{STRINGS.week.models}</th>
            <th scope="col" className="r">{STRINGS.week.subagents}</th><th scope="col" className="r">{STRINGS.week.share}</th></tr></thead>
          <tbody>{view.kinds.map(kind => <tr key={kind.key}>
            <th scope="row">{kind.label}</th>
            <td className="wk-muted"><span className="sp-mix" title={kind.models.map(model => `${model.label} ${Math.round(model.part * 100)}%`).join(', ')}>
              <span className="wk-mini" aria-hidden="true">{kind.models.map(model => <i key={model.label} className={`md-${model.series}`} style={{ width: `${model.part * 100}%` }} />)}</span>
              {kind.lead}</span></td>
            <td className={`r ${kind.quiet ? 'wk-muted' : ''}`.trim()}>{kind.subagentsText}</td>
            <td className="r">{kind.shareText}</td>
          </tr>)}</tbody>
        </table>
      </section>}
      <section className="sp-sec" aria-labelledby="sp-shipped-title">
        <div className="wk-h"><h3 id="sp-shipped-title">{STRINGS.week.shipped}</h3><span className={`wk-pill ${view.shipped.tone}`}>{view.shipped.text}</span></div>
        {view.shipped.line.length > 0 && <p className="sp-line">{view.shipped.line.join(' ')}</p>}
      </section>
      {view.flags.length > 0 && <section className="sp-sec" aria-labelledby="sp-flags-title">
        <div className="wk-h"><h3 id="sp-flags-title">{STRINGS.session.flags}</h3></div>
        <ol className="wk-flags">{view.flags.map((flag, index) => <li key={flag.key}><div>
          <span className={`wk-flag-mark ${flag.tone}`} aria-hidden="true">{index + 1}</span><span><b>{flag.ownLead}</b> {flag.ownRest}</span></div></li>)}</ol>
      </section>}
    </aside>
  </div>;
}
