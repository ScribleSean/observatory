import { clock, type ViewId } from './data';

export const VIEWS: [ViewId, string][] = [['overview', 'Overview'], ['sessions', 'Sessions'], ['limits', 'Limits'], ['tokens', 'Tokens'], ['screen-time', 'Screen time'], ['drift', 'Drift'], ['settings', 'Settings']];

/** Views route on plain hash names (#sessions). Anything else is Overview. */
export function viewFromHash(hash: string): ViewId {
  const name = hash.replace(/^#/, '');
  return VIEWS.find(([id]) => id === name)?.[0] ?? 'overview';
}

type Props = { view: ViewId; onView: (view: ViewId) => void; readAt: string | null; timeZone: string; now: number; onTheme: () => void };

/** The top bar: brand, the seven views, the time of the newest read and the theme button. */
export function Nav({ view, onView, readAt, timeZone, now, onTheme }: Props) {
  return (
    <header className="top"><div className="wrap">
      <div className="brand">
        {/* The Refractor at 18 px, 60% full and on pace: lib/glance-icon.mjs markShapes(18, 'on-pace', 0.6). */}
        <svg aria-hidden="true" viewBox="0 0 18 18" width="18" height="18" stroke="currentColor">
          <line x1="2.5" y1="12" x2="12.5" y2="7" strokeWidth="4" opacity="0.28" />
          <line x1="2.5" y1="12" x2="8.5" y2="9" strokeWidth="4" />
          <line x1="1" y1="12.75" x2="2.875" y2="11.813" strokeWidth="2" />
          <line x1="7.5" y1="12" x2="5" y2="17" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="7.5" y1="12" x2="10" y2="17" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="15" cy="4" r="2" fill="currentColor" stroke="none" />
        </svg>
        <span>Observatory</span>
      </div>
      <nav className="nav" aria-label="Views">
        {VIEWS.map(([id, name]) => <a key={id} href={`#${id}`} className={view === id ? 'on' : ''} aria-current={view === id ? 'page' : undefined}
          onClick={event => { event.preventDefault(); onView(id); }}>{name}</a>)}
      </nav>
      <div className="tools">
        {readAt && <span className="upd">Read {clock(readAt, timeZone, now)}</span>}
        <button type="button" className="btn sq" title="Switch light and dark" aria-label="Switch light and dark" onClick={onTheme}>◐</button>
      </div>
    </div></header>
  );
}
