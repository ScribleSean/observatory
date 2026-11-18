import { clock, type ViewId } from './data';

export const VIEWS: [ViewId, string][] = [['overview', 'Overview'], ['sessions', 'Sessions'], ['limits', 'Limits'], ['tokens', 'Tokens'], ['screen-time', 'Screen time'], ['drift', 'Drift'], ['settings', 'Settings']];

/** Views route on plain hash names (#sessions). Anything else is Overview. */
export function viewFromHash(hash: string): ViewId {
  const name = hash.replace(/^#/, '');
  return VIEWS.find(([id]) => id === name)?.[0] ?? 'overview';
}

type Props = { view: ViewId; onView: (view: ViewId) => void; readAt: string | null; timeZone: string; onTheme: () => void };

/** The top bar: brand, the seven views, the time of the newest read and the theme button. */
export function Nav({ view, onView, readAt, timeZone, onTheme }: Props) {
  return (
    <header className="top"><div className="wrap">
      <div className="brand"><i aria-hidden="true" /><span>Observatory</span></div>
      <nav className="nav" aria-label="Views">
        {VIEWS.map(([id, name]) => <a key={id} href={`#${id}`} className={view === id ? 'on' : ''} aria-current={view === id ? 'page' : undefined}
          onClick={event => { event.preventDefault(); onView(id); }}>{name}</a>)}
      </nav>
      <div className="tools">
        {readAt && <span className="upd">Read {clock(readAt, timeZone)}</span>}
        <button type="button" className="btn sq" title="Switch light and dark" aria-label="Switch light and dark" onClick={onTheme}>◐</button>
      </div>
    </div></header>
  );
}
