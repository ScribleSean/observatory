import { useEffect, useRef } from 'react';
import { clock, type ViewId } from './data';
import { markShapes } from '../../../lib/glance-icon.mjs';

// The header mark, from the one geometry in lib/glance-icon.mjs.
const HEADER_MARK = markShapes(18, 'on-pace', 0.6);

export const VIEWS: [ViewId, string][] = [['overview', 'Overview'], ['sessions', 'Sessions'], ['limits', 'Limits'], ['tokens', 'Tokens'], ['screen-time', 'Screen time'], ['drift', 'Drift'], ['settings', 'Settings']];

/** Views route on plain hash names (#sessions). Anything else is Overview. */
export function viewFromHash(hash: string): ViewId {
  const name = hash.replace(/^#/, '');
  return VIEWS.find(([id]) => id === name)?.[0] ?? 'overview';
}

type Props = { view: ViewId; onView: (view: ViewId) => void; readAt: string | null; timeZone: string; now: number; onTheme: () => void };

/** The top bar: brand, the seven views, the time of the newest read and the theme button. */
export function Nav({ view, onView, readAt, timeZone, now, onTheme }: Props) {
  // On a narrow screen the views scroll sideways: the current one is scrolled fully into sight.
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const reveal = () => {
      const on = nav.querySelector<HTMLElement>('a.on');
      if (!on) return;
      const left = on.offsetLeft - nav.offsetLeft, right = left + on.offsetWidth;
      if (left < nav.scrollLeft) nav.scrollLeft = left;
      else if (right > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = right - nav.clientWidth;
    };
    reveal();
    // The tabs change width as fonts load and the window resizes, so it is checked again then.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reveal);
    observer?.observe(nav);
    for (const tab of nav.querySelectorAll('a')) observer?.observe(tab);
    return () => observer?.disconnect();
  }, [view]);
  return (
    <header className="top"><div className="wrap">
      <div className="brand">
        {/* The Refractor at 18 px, 60% full and on pace, in the accent color. */}
        <svg aria-hidden="true" viewBox="0 0 18 18" width="18" height="18" dangerouslySetInnerHTML={{ __html: HEADER_MARK }} />
        <span>Observatory</span>
      </div>
      <nav className="nav" aria-label="Views" ref={navRef}>
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
