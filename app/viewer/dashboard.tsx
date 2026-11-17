import { STRINGS } from '../../lib/strings.generated';
import { useCallback, useEffect, useState } from 'react';
import { freshness, format, readingTime, deviceLabel } from '../../lib/panel-data.mjs';
import { shiftDemoClock } from '../../lib/demo-clock.mjs';
import { hasLastWeek } from '../../lib/view-week.mjs';
import { sessionView } from '../../lib/view-session.mjs';
import { useSkin } from './skin';

import { WeekView } from './week/WeekView';
import { SessionPanel } from './week/SessionPanel';
import { HistoryView, DETAILS, type Detail } from './history/HistoryView';
import { FilterGroup } from './components';

type Snapshot = Record<string, unknown>;
type Device = { host: string; name: string; collectedAt: string | null; stale: boolean; error?: string };
type Collision = { repo: string; count: number; line: string };
export type Summary = { generatedAt: string; generatedBy?: string; devices?: Device[]; glance: { forecast?: unknown; collisions?: Collision[] }; week?: unknown };
export type Combined = Summary & { view: Snapshot };

/** Week is home. History holds the long view, with the older detail pages under it. A session opens over Week. */
export type Route = { view: 'week' | 'history'; detail: Detail | null; session: string | null };
const HOME: Route = { view: 'week', detail: null, session: null };
const HISTORY_REFRESH_MS = 5 * 60000;
const isDetail = (value: string | undefined): value is Detail => DETAILS.some(([id]) => id === value);

export function routeFromHash(hash: string): Route {
  const [head, ...rest] = hash.replace(/^#/, '').split('/');
  if (head === 'history') return { view: 'history', detail: isDetail(rest[0]) ? rest[0] : null, session: null };
  // Links from before History had one page per section.
  if (isDetail(head)) return { view: 'history', detail: head, session: null };
  if (head === 'session' && rest[0]) return { view: 'week', detail: null, session: rest.join('/') };
  return HOME;
}

/** The period shown: last week only while some computer still has it, else this week. */
export function shownPeriod(period: 'current' | 'previous', lastWeek: boolean): 'current' | 'previous' {
  return lastWeek ? period : 'current';
}

/** Where to go when a session in the address is not (or no longer) in the data: back to Week. Null to stay. */
export function settledRoute(route: Route, { ready, found }: { ready: boolean; found: boolean }): Route | null {
  return ready && route.view === 'week' && route.session && !found ? { ...route, session: null } : null;
}

export function hashOf(route: Route): string {
  if (route.view === 'history') return route.detail ? `#history/${route.detail}` : '#history';
  return route.session ? `#session/${route.session}` : '';
}

async function fetchJson<T>(file: string): Promise<T | null> {
  try {
    const response = await fetch(`./local/${file}`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    const body = response.ok ? await response.json() as T : null;
    return body && typeof body === 'object' ? shiftDemoClock(body) : null;
  } catch { return null; }
}

// Shown only when something is wrong: a computer that stopped reporting or could not be reached.
function DeviceWarnings({ devices, now }: { devices: Device[]; now: number }) {
  const late = devices.filter(device => !device.collectedAt || freshness(device.collectedAt, now).stale || device.error);
  if (devices.length < 2 || late.length === 0) return null;
  return (
    <ul className="ob-chips" aria-label={STRINGS.labels.computers}>
      {late.map(device => <li key={device.host} className="warn" title={device.error ? format(STRINGS.today.unreachable, { reason: device.error }) : undefined}>
        <i aria-hidden="true" />{device.name || deviceLabel(device.host)}<span className="ob-meta">{device.collectedAt ? readingTime(Date.parse(device.collectedAt), now) : STRINGS.today.noSnapshot}</span>
      </li>)}
    </ul>
  );
}

// Shown only while two live sessions share a repository. The closest overlap leads.
function SameRepo({ collisions }: { collisions: Collision[] }) {
  if (collisions.length === 0) return null;
  const [first, ...rest] = collisions;
  return (
    <ul className="ob-chips" aria-label={STRINGS.labels.sameRepo}>
      <li className="warn wide"><i aria-hidden="true" /><span>{first.line}
        {rest.length > 0 && <span className="ob-meta"> {format(STRINGS.labels.sameRepoMore, { count: String(rest.length) })}</span>}</span></li>
    </ul>
  );
}

export default function Dashboard({ initialSkin = 'sage' }: { initialSkin?: string }) {
  const { css, className } = useSkin(initialSkin);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [history, setHistory] = useState<Combined | null>(null);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [route, setRoute] = useState<Route>(() => routeFromHash(window.location.hash));
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const body = await fetchJson<Summary>('summary.json');
    setSummary(body?.glance ? body : null);
    setNow(Date.now());
    setLoaded(true);
  }, []);

  useEffect(() => {
    const first = setTimeout(() => { void load(); }, 0);
    const tick = setInterval(() => { setNow(Date.now()); if (!document.hidden) void load(); }, 30000);
    const visible = () => { if (!document.hidden) void load(); };
    const follow = () => setRoute(routeFromHash(window.location.hash));
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('hashchange', follow);
    return () => { clearTimeout(first); clearInterval(tick); document.removeEventListener('visibilitychange', visible); window.removeEventListener('hashchange', follow); };
  }, [load]);

  // The full history is large, so it loads only while it is open, and refreshes slowly.
  const historyOpen = route.view === 'history';
  useEffect(() => {
    if (!historyOpen) return;
    let live = true;
    const read = async () => { setHistoryFailed(false); const body = await fetchJson<Combined>('combined.json'); if (live) { setHistory(body?.view ? body : null); setHistoryFailed(!body?.view); } };
    void read();
    const timer = setInterval(() => { if (!document.hidden) void read(); }, HISTORY_REFRESH_MS);
    return () => { live = false; clearInterval(timer); };
  }, [historyOpen]);

  const go = useCallback((next: Route) => {
    setRoute(next);
    window.history.replaceState(window.history.state, '', hashOf(next) || `${window.location.pathname}${window.location.search}`);
  }, []);
  return <DashboardView summary={summary} history={history} loaded={loaded} now={now} css={css} className={className}
    route={route} onRoute={go} historyFailed={historyFailed} />;
}

type DashboardViewProps = {
  summary: Summary | null;
  history: Combined | null;
  loaded: boolean;
  now: number;
  css: string;
  className: string;
  route?: Route;
  onRoute: (route: Route) => void;
  historyFailed?: boolean;
  initialPeriod?: 'current' | 'previous';
};

export function DashboardView({ summary, history, loaded, now, css, className, route = HOME, onRoute, historyFailed = false, initialPeriod = 'current' }: DashboardViewProps) {
  const [chosen, setPeriod] = useState(initialPeriod);
  const [range, setRange] = useState<'month' | 'year'>('month');
  const closeSession = useCallback(() => onRoute(HOME), [onRoute]);
  const fresh = freshness(summary?.generatedAt ?? '', now);
  const ready = Boolean(summary?.glance?.forecast);
  const snapshot = history?.view ?? null;
  const feed = summary as unknown as Record<string, unknown>;
  const lastWeek = ready && hasLastWeek(feed);
  const period = shownPeriod(chosen, lastWeek);
  const sessionOpen = ready && route.view === 'week' && route.session !== null && sessionView(feed, route.session, { period, now }) !== null;
  // A session that is gone after a refresh closes its panel and leaves the address.
  useEffect(() => { const next = settledRoute(route, { ready, found: sessionOpen }); if (next) onRoute(next); }, [route, ready, sessionOpen, onRoute]);
  const computers = (summary?.devices ?? []).map(device => device.name).filter(Boolean).join(', ');
  const week = ready && route.view === 'week' ? <WeekView summary={feed} now={now} period={period} onOpen={key => onRoute({ view: 'week', detail: null, session: key })} /> : null;
  const tab = (view: Route['view'], href: string, name: string) =>
    <a href={href} className={route.view === view ? 'on' : ''} aria-current={route.view === view ? 'page' : undefined}
      onClick={event => { event.preventDefault(); onRoute({ view, detail: null, session: null }); }}>{name}</a>;
  return (
    <div className={`ob-dashboard ${className}`}>
      <style>{css}</style>
      <header className="ob-top" inert={sessionOpen || undefined}>
        <h1><span className="ob-mark" aria-hidden="true" />{STRINGS.app.title}</h1>
        {ready && <nav aria-label={STRINGS.sections.navigation}>{tab('week', '#week', STRINGS.week.nav)}{tab('history', '#history', STRINGS.sections.history)}</nav>}
        {ready && <div className="ob-top-right">
          {computers && <span>{computers}</span>}
          {summary && fresh.stale && <span className="warn">{fresh.label}</span>}
          {route.view === 'history'
            ? <FilterGroup label={STRINGS.week.range} options={[['month', STRINGS.periods.month], ['year', STRINGS.periods.year]]} value={range} onChange={id => setRange(id === 'year' ? 'year' : 'month')} />
            : lastWeek && <FilterGroup label={STRINGS.week.range} options={[['previous', STRINGS.week.lastWeek], ['current', STRINGS.week.thisWeek]]} value={period} onChange={id => setPeriod(id === 'previous' ? 'previous' : 'current')} />}
        </div>}
      </header>
      <div className="ob-notices" inert={sessionOpen || undefined}>
        <DeviceWarnings devices={summary?.devices ?? []} now={now} />
        <SameRepo collisions={fresh.stale ? [] : summary?.glance?.collisions ?? []} />
      </div>
      {!ready && <output className="ob-first-run"><span className="ob-pulse" aria-hidden="true" /><h2>{loaded ? STRINGS.firstRun.title : STRINGS.labels.loading}</h2></output>}
      {ready && <main className={fresh.stale ? 'stale' : ''} inert={sessionOpen || undefined}>
        {route.view === 'week' ? week
          : !snapshot ? <p className={historyFailed ? 'ob-meta warn' : 'ob-meta'}>{historyFailed ? STRINGS.labels.historyFailed : STRINGS.labels.loading}</p>
          : <HistoryView snapshot={snapshot} now={now} range={range} detail={route.detail} onDetail={detail => onRoute({ view: 'history', detail, session: null })} />}
      </main>}
      {sessionOpen && route.session && <SessionPanel summary={feed} sessionKey={route.session} period={period} now={now} onClose={closeSession} />}
    </div>
  );
}
