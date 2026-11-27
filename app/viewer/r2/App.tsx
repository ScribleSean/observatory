// The round 2 dashboard: one top bar, one scope bar, the Ask row and seven views. Every view is a
// json-render spec over the block catalog, and every block reads its numbers through data.ts.
// The dashboard only reads: it fetches two local JSON files and never writes.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { shiftDemoClock } from '../../../lib/demo-clock.mjs';
import { R2Context, buildFrame, defaultScope, hasHistory, scopeFromSearch, scopeToSearch, type MetricId, type SavedView, type Scope, type Snapshot, type Ui, type ViewId } from './data';
import { Nav, VIEWS, viewFromHash } from './Nav';
import { ScopeBar } from './ScopeBar';
import { AskField } from './AskField';
import { Overview } from './views/Overview';
import { MoreView } from './blocks/more';
import { OVERVIEW, askFor, blockList, fromAddress, pinsWith, savedViewsFrom, scopeFor, type Opened, type Pin } from './pins';
import { BlockBoundary } from './Boundary';
import { rememberOpener } from './opener';
import { Loading } from './Loading';
import type { Spec } from '@json-render/react';
import './r2.css';

// Sessions and its side panel load on first use, like the other views (blocks/more.tsx).
const Sessions = lazy(() => import('./views/Sessions').then(module => ({ default: module.Sessions })));
const SessionPanel = lazy(() => import('./views/Sessions').then(module => ({ default: module.SessionPanel })));

type Theme = 'light' | 'dark' | null;
const REFRESH_MS = 5 * 60000;
const THEME_KEY = 'observatory-theme';
// The page colors (--bg in r2.css), for the browser bar. app/web/index.html sets them by the system theme.
const BAR_COLOR = { light: '#efece7', dark: '#161715' };

async function fetchJson(file: string): Promise<unknown> {
  try {
    const response = await fetch(`./local/${file}`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    const body: unknown = response.ok ? await response.json() : null;
    return body && typeof body === 'object' ? shiftDemoClock(body as { demo?: boolean; generatedAt?: string }) : null;
  } catch { return null; }
}

function storedTheme(): Theme {
  try { const value = window.localStorage.getItem(THEME_KEY); return value === 'light' || value === 'dark' ? value : null; } catch { return null; }
}

type ShellProps = {
  snapshot: Snapshot | null;
  now: number;
  loaded: boolean;
  saved?: SavedView[];
  initialHash?: string;
  initialSearch?: string;
  initialTheme?: Theme;
  initialPin?: string;
  initialAsk?: string;
  initialSelected?: string | null;
};

/** The search text for a scope: empty when it is the default scope, so a plain link stays plain. */
function searchFor(next: Scope, base: Scope): string {
  return scopeToSearch(next) === scopeToSearch(base) ? '' : scopeToSearch(next);
}

/** Everything but the fetching, so it can be drawn on the server by the tests. */
export function R2Shell({ snapshot, now, loaded, saved = [], initialHash = '', initialSearch = '', initialTheme = null, initialPin = 'overview', initialAsk, initialSelected = null }: ShellProps) {
  const ready = snapshot !== null && hasHistory(snapshot);
  const base = useMemo(() => snapshot && ready ? defaultScope(snapshot, { now }) : null, [ready, snapshot, now]);
  const zone = (snapshot?.view as { timezone?: string } | undefined)?.timezone ?? 'UTC';
  const pins = useMemo<Pin[]>(() => pinsWith(saved), [saved]);
  // A question in the props is asked once on the first draw, the same way the Ask field asks it.
  const [first] = useState<Opened | null>(() => initialAsk ? askFor(initialAsk, pins, { now, timeZone: zone }) : null);
  const firstSearch = first && base ? searchFor(scopeFor(first.pin, initialSearch ? scopeFromSearch(initialSearch, base) : base, base.range.anchor), base) : initialSearch;
  const [view, setView] = useState<ViewId>(() => first ? 'overview' : viewFromHash(initialHash));
  const [search, setSearch] = useState(firstSearch);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [opened, setOpened] = useState<Opened>(() => first ?? { pin: pins.find(row => row.id === initialPin) ?? OVERVIEW, question: null, missed: false, answer: null });
  const [hidden, setHidden] = useState<string[]>([]);
  const [menu, setMenu] = useState<'pins' | 'blocks' | null>(null);
  const [openMetric, setOpenMetric] = useState<MetricId | null>(null);
  const [selected, setSelected] = useState<string | null>(initialSelected);
  const ask = useRef<HTMLInputElement | null>(null);
  const menuButtons = useRef<Record<'pins' | 'blocks', HTMLButtonElement | null>>({ pins: null, blocks: null });

  const scope = useMemo(() => base && search ? scopeFromSearch(search, base) : base, [base, search]);
  // A listed pin is read from the current list, so a saved view that changes on disk is drawn as it is now.
  const pin = pins.find(row => row.id === opened.pin.id && !opened.answer) ?? opened.pin;
  const { question, missed } = opened;

  // The address holds the view (a plain hash name) and the scope (the search text), so a link reopens the same screen.
  const visit = useCallback((nextView: ViewId, nextSearch: string) => {
    setView(nextView); setSearch(nextSearch);
    const target = `${window.location.pathname}${nextSearch}#${nextView}`;
    if (`${window.location.pathname}${window.location.search}${window.location.hash || '#overview'}` !== target) window.history.pushState(null, '', target);
  }, []);
  const searchOf = useCallback((next: Scope) => base ? searchFor(next, base) : scopeToSearch(next), [base]);
  const setScope = useCallback((next: Scope) => visit(view, searchOf(next)), [visit, view, searchOf]);
  const go = useCallback((next: ViewId) => { setSelected(null); setMenu(null); visit(next, search); window.scrollTo(0, 0); }, [visit, search]);

  useEffect(() => {
    const follow = () => { const next = fromAddress(window.location.hash, window.location.search); setView(next.view); setSearch(next.search); };
    window.addEventListener('popstate', follow); window.addEventListener('hashchange', follow);
    return () => { window.removeEventListener('popstate', follow); window.removeEventListener('hashchange', follow); };
  }, []);

  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme; else delete document.documentElement.dataset.theme;
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'))
      meta.content = BAR_COLOR[theme ?? (meta.media.includes('dark') ? 'dark' : 'light')];
  }, [theme]);
  const flipTheme = () => {
    const dark = theme ? theme === 'dark' : !window.matchMedia('(prefers-color-scheme: light)').matches;
    const next = dark ? 'light' : 'dark';
    setTheme(next);
    try { window.localStorage.setItem(THEME_KEY, next); } catch { /* The choice lasts for this visit only. */ }
  };

  // A menu closed from the keyboard, or by choosing in it, hands focus back to the button that opened it.
  const closeMenu = useCallback((refocus: boolean) => {
    setMenu(current => { if (current && refocus) menuButtons.current[current]?.focus(); return null; });
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (event.key === 'Escape') { if (selected) setSelected(null); else closeMenu(true); }
      if (event.key === '/' && !typing && !selected) { event.preventDefault(); ask.current?.focus(); }
    };
    const click = (event: MouseEvent) => { if (!(event.target instanceof Element && event.target.closest('[data-menu]'))) closeMenu(false); };
    document.addEventListener('keydown', key); document.addEventListener('click', click);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('click', click); };
  }, [selected, closeMenu]);

  const open = (next: Opened) => {
    const fromMenu = menu !== null;
    setOpened(next); setHidden([]); setOpenMetric(null); setSelected(null); closeMenu(fromMenu);
    if (!scope || !base) return;
    visit('overview', searchOf(scopeFor(next.pin, scope, base.range.anchor, base))); window.scrollTo(0, 0);
  };
  const openPin = (next: Pin) => open({ pin: next, question: next.question, missed: false, answer: null });
  const onAsk = (text: string) => open(askFor(text, pins, { now, timeZone: zone }));

  const readAt = typeof snapshot?.generatedAt === 'string' ? snapshot.generatedAt : null;
  const title = VIEWS.find(([id]) => id === view)?.[1] ?? '';
  const blocks = blockList(pin.spec as Spec);
  const ui: Ui | null = snapshot && ready && scope && base ? {
    snapshot, scope, now, view, today: base.range.anchor, frame: buildFrame(snapshot, scope, { now }), openMetric, selected, setScope,
    toggleMetric: id => setOpenMetric(current => current === id ? null : id), openSession: id => { if (id) rememberOpener(); setSelected(id); },
  } : null;

  return (
    <div className="r2">
      {/* While the session panel is open, the page behind it takes no focus or clicks. */}
      <div className="page" inert={ui && selected ? true : undefined}>
      <Nav view={view} onView={go} readAt={readAt} timeZone={zone} now={now} onTheme={flipTheme} />
      {!ui && <>
        <div className="scope"><div className="wrap" /></div>
        <div className="wrap"><main>
          {!loaded ? <Loading /> : <div className="grid c12"><section className="blk"><div className="empty">
            {snapshot ? <><b>No history yet</b>This snapshot has no daily history. The next collection writes it.</> : <><b>No data yet</b>The dashboard has not read a snapshot from this computer.</>}
          </div></section></div>}
        </main></div>
      </>}
      {ui && <R2Context value={ui}>
        <ScopeBar />
        <div className="wrap">
          <div className="vbar">
            <AskField inputRef={ask} onAsk={onAsk} />
            <div className="pins">
              {pins.map(row => <button key={row.id} type="button" className={row.id === pin.id && view === 'overview' ? 'on' : ''} aria-pressed={row.id === pin.id && view === 'overview'} onClick={() => openPin(row)}>{row.title}</button>)}
            </div>
            <div className="pinsel rel" data-menu>
              <button ref={node => { menuButtons.current.pins = node; }} type="button" className="btn" aria-haspopup="true" aria-expanded={menu === 'pins'} aria-controls="pins-menu" onClick={() => setMenu(menu === 'pins' ? null : 'pins')}><span>{view === 'overview' ? pin.title : 'Pinned'}</span><small>▾</small></button>
              {menu === 'pins' && <div className="menu left" id="pins-menu">
                {pins.map(row => <button key={row.id} type="button" className={row.id === pin.id ? 'on' : ''} aria-pressed={row.id === pin.id} onClick={() => openPin(row)}><u>{row.id === pin.id ? '✓' : ''}</u>{row.title}</button>)}
              </div>}
            </div>
            <span className="grow" />
            {view === 'overview' && <div className="rel" data-menu>
              <button ref={node => { menuButtons.current.blocks = node; }} type="button" className="btn" aria-haspopup="true" aria-expanded={menu === 'blocks'} aria-controls="blocks-menu" onClick={() => setMenu(menu === 'blocks' ? null : 'blocks')}>Blocks<small>{blocks.length - hidden.length} of {blocks.length}</small></button>
              {menu === 'blocks' && <div className="menu" id="blocks-menu">
                {blocks.map(block => {
                  const on = !hidden.includes(block.key);
                  return <button key={block.key} type="button" className={on ? 'on' : ''} aria-pressed={on} onClick={() => setHidden(on ? [...hidden, block.key] : hidden.filter(key => key !== block.key))}><u>{on ? '✓' : ''}</u>{block.name}</button>;
                })}
                <hr /><button type="button" onClick={() => openPin(OVERVIEW)}><u />Reset to Overview</button>
              </div>}
            </div>}
          </div>
          <main>
            {view === 'overview' ? <Overview pin={pin} hidden={hidden} question={question} missed={missed} answer={opened.answer} onClear={() => openPin(OVERVIEW)} />
              : view === 'sessions' ? <BlockBoundary key="sessions" name="Sessions"><Suspense fallback={<Loading />}><Sessions /></Suspense></BlockBoundary> : <MoreView title={title} />}
          </main>
        </div>
      </R2Context>}
      </div>
      {/* The panel is closed until a session is chosen, so it has nothing to show while its code loads. */}
      {ui && <R2Context value={ui}><BlockBoundary key={selected ?? 'none'} name="The session panel"><Suspense fallback={null}><SessionPanel /></Suspense></BlockBoundary></R2Context>}
    </div>
  );
}

/** The dashboard entry: reads the combined snapshot and any saved views, then refreshes slowly. */
export default function R2App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [saved, setSaved] = useState<SavedView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    // Saved views are optional: the route answers an empty list until a view has been composed.
    const [combined, views] = await Promise.all([fetchJson('combined.json'), fetchJson('views.json')]);
    setSnapshot(combined as Snapshot | null); setSaved(savedViewsFrom(views)); setNow(Date.now()); setLoaded(true);
  }, []);

  useEffect(() => {
    const first = setTimeout(() => { void load(); }, 0);
    const timer = setInterval(() => { if (!document.hidden) void load(); }, REFRESH_MS);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [load]);

  return <R2Shell snapshot={snapshot} now={now} loaded={loaded} saved={saved} initialHash={window.location.hash} initialSearch={window.location.search} initialTheme={storedTheme()} />;
}
