// The round 2 dashboard: one top bar, one scope bar, the Ask row and seven views. Every view is a
// json-render spec over the block catalog, and every block reads its numbers through data.ts.
// The dashboard only reads: it fetches two local JSON files and never writes.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { shiftDemoClock } from '../../../lib/demo-clock.mjs';
import { R2Context, answerQuestion, buildFrame, defaultScope, hasHistory, patchScope, scopeFromSearch, scopeToSearch, type MetricId, type SavedView, type Scope, type Snapshot, type Ui, type ViewId } from './data';
import { Nav, VIEWS, viewFromHash } from './Nav';
import { ScopeBar } from './ScopeBar';
import { AskField } from './AskField';
import { Overview } from './views/Overview';
import { SessionPanel, Sessions } from './views/Sessions';
import { MoreView } from './blocks/more';
import { OVERVIEW, PINS, blockList, savedViewsFrom, type Pin } from './specs';
import type { Spec } from '@json-render/react';
import './r2.css';

type Theme = 'light' | 'dark' | null;
const REFRESH_MS = 5 * 60000;
const THEME_KEY = 'observatory-theme';

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

function Loading() {
  const block = (wide: string, lines: number) => (
    <section className={`blk ${wide}`}>
      <div className="bh"><span className="sk" style={{ width: '30%' }} /></div>
      <div className="bb">{Array.from({ length: lines }, (_, index) => <span key={index} className="sk" style={{ width: `${[92, 78, 85, 60, 70][index % 5]}%`, marginBottom: 12 }} />)}</div>
    </section>
  );
  return <div className="grid c12" aria-busy="true" aria-label="Loading">{block('', 2)}<div className="grid c4">{block('wide', 7)}{block('', 7)}{block('wide', 10)}{block('', 4)}</div></div>;
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
};

/** Everything but the fetching, so it can be drawn on the server by the tests. */
export function R2Shell({ snapshot, now, loaded, saved = [], initialHash = '', initialSearch = '', initialTheme = null, initialPin = 'overview' }: ShellProps) {
  const [view, setView] = useState<ViewId>(() => viewFromHash(initialHash));
  const [search, setSearch] = useState(initialSearch);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [pinId, setPinId] = useState(initialPin);
  const [question, setQuestion] = useState<string | null>(null);
  const [missed, setMissed] = useState(false);
  const [hidden, setHidden] = useState<string[]>([]);
  const [menu, setMenu] = useState<'pins' | 'blocks' | null>(null);
  const [openMetric, setOpenMetric] = useState<MetricId | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const ask = useRef<HTMLInputElement | null>(null);

  const ready = snapshot !== null && hasHistory(snapshot);
  const base = useMemo(() => snapshot && ready ? defaultScope(snapshot, { now }) : null, [ready, snapshot, now]);
  const scope = useMemo(() => base && search ? scopeFromSearch(search, base) : base, [base, search]);
  const pins = useMemo<Pin[]>(() => [...PINS, ...saved.filter(row => !PINS.some(pin => pin.id === row.id))], [saved]);
  const pin = pins.find(row => row.id === pinId) ?? OVERVIEW;

  // The address holds the view (a plain hash name) and the scope (the search text), so a link reopens the same screen.
  const visit = useCallback((nextView: ViewId, nextSearch: string) => {
    setView(nextView); setSearch(nextSearch);
    const target = `${window.location.pathname}${nextSearch}#${nextView}`;
    if (`${window.location.pathname}${window.location.search}${window.location.hash || '#overview'}` !== target) window.history.pushState(null, '', target);
  }, []);
  const searchOf = useCallback((next: Scope) => base && scopeToSearch(next) === scopeToSearch(base) ? '' : scopeToSearch(next), [base]);
  const setScope = useCallback((next: Scope) => visit(view, searchOf(next)), [visit, view, searchOf]);
  const go = useCallback((next: ViewId) => { setSelected(null); setMenu(null); visit(next, search); window.scrollTo(0, 0); }, [visit, search]);

  useEffect(() => {
    const follow = () => { setView(viewFromHash(window.location.hash)); setSearch(window.location.search); };
    window.addEventListener('popstate', follow); window.addEventListener('hashchange', follow);
    return () => { window.removeEventListener('popstate', follow); window.removeEventListener('hashchange', follow); };
  }, []);

  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme; else delete document.documentElement.dataset.theme;
  }, [theme]);
  const flipTheme = () => {
    const dark = theme ? theme === 'dark' : !window.matchMedia('(prefers-color-scheme: light)').matches;
    const next = dark ? 'light' : 'dark';
    setTheme(next);
    try { window.localStorage.setItem(THEME_KEY, next); } catch { /* The choice lasts for this visit only. */ }
  };

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (event.key === 'Escape') { if (selected) setSelected(null); else setMenu(null); }
      if (event.key === '/' && !typing) { event.preventDefault(); ask.current?.focus(); }
    };
    const click = (event: MouseEvent) => { if (!(event.target instanceof Element && event.target.closest('[data-menu]'))) setMenu(null); };
    document.addEventListener('keydown', key); document.addEventListener('click', click);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('click', click); };
  }, [selected]);

  const openPin = (next: Pin, asked: string | null, miss = false) => {
    setPinId(next.id); setHidden([]); setQuestion(asked ?? next.question); setMissed(miss); setOpenMetric(null); setSelected(null); setMenu(null);
    if (!scope || !base) return;
    const ranged = next.range ? patchScope(scope, { range: { ...next.range, anchor: base.range.anchor } }) : scope;
    visit('overview', searchOf(ranged)); window.scrollTo(0, 0);
  };
  const onAsk = (text: string) => {
    const answer = answerQuestion(text, { savedViews: pins });
    const found = answer.view ? pins.find(row => row.id === answer.view?.id) : null;
    if (found) openPin(found, text); else openPin(OVERVIEW, text, true);
  };

  const zone = (snapshot?.view as { timezone?: string } | undefined)?.timezone ?? 'UTC';
  const readAt = typeof snapshot?.generatedAt === 'string' ? snapshot.generatedAt : null;
  const title = VIEWS.find(([id]) => id === view)?.[1] ?? '';
  const blocks = blockList(pin.spec as Spec);
  const ui: Ui | null = snapshot && ready && scope && base ? {
    snapshot, scope, now, view, today: base.range.anchor, frame: buildFrame(snapshot, scope, { now }), openMetric, selected, setScope,
    toggleMetric: id => setOpenMetric(current => current === id ? null : id), openSession: setSelected,
  } : null;

  return (
    <div className="r2">
      <Nav view={view} onView={go} readAt={readAt} timeZone={zone} onTheme={flipTheme} />
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
              {pins.map(row => <button key={row.id} type="button" className={row.id === pin.id && view === 'overview' ? 'on' : ''} aria-pressed={row.id === pin.id && view === 'overview'} onClick={() => openPin(row, null)}>{row.title}</button>)}
            </div>
            <div className="pinsel rel" data-menu>
              <button type="button" className="btn" aria-expanded={menu === 'pins'} onClick={() => setMenu(menu === 'pins' ? null : 'pins')}><span>{view === 'overview' ? pin.title : 'Pinned'}</span><small>▾</small></button>
              {menu === 'pins' && <div className="menu left">
                {pins.map(row => <button key={row.id} type="button" className={row.id === pin.id ? 'on' : ''} onClick={() => openPin(row, null)}><u>{row.id === pin.id ? '✓' : ''}</u>{row.title}</button>)}
              </div>}
            </div>
            <span className="grow" />
            {view === 'overview' && <div className="rel" data-menu>
              <button type="button" className="btn" aria-expanded={menu === 'blocks'} onClick={() => setMenu(menu === 'blocks' ? null : 'blocks')}>Blocks<small>{blocks.length - hidden.length} of {blocks.length}</small></button>
              {menu === 'blocks' && <div className="menu">
                {blocks.map(block => {
                  const on = !hidden.includes(block.key);
                  return <button key={block.key} type="button" className={on ? 'on' : ''} aria-pressed={on} onClick={() => setHidden(on ? [...hidden, block.key] : hidden.filter(key => key !== block.key))}><u>{on ? '✓' : ''}</u>{block.name}</button>;
                })}
                <hr /><button type="button" onClick={() => openPin(OVERVIEW, null)}><u />Reset to Overview</button>
              </div>}
            </div>}
          </div>
          <main>
            {view === 'overview' ? <Overview pin={pin} hidden={hidden} question={question} missed={missed} onClear={() => openPin(OVERVIEW, null)} />
              : view === 'sessions' ? <Sessions /> : <MoreView title={title} />}
          </main>
        </div>
        <SessionPanel />
      </R2Context>}
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
    // Saved views are optional: the route answers 404 until a view has been composed.
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
