import { STRINGS } from '../../lib/strings.generated';
import { useCallback, useEffect, useState } from 'react';
import { freshness, format, deviceLabel } from '../../lib/panel-data.mjs';
import { hasLastWeek } from '../../lib/view-week.mjs';
import { sessionView } from '../../lib/view-session.mjs';
import R2App from './r2/App';

import { WeekView } from './week/WeekView';
import { SessionPanel } from './week/SessionPanel';
import { HistoryView, DETAILS, type Detail } from './history/HistoryView';
import { FilterGroup } from './components';

type Snapshot = Record<string, unknown>;
type Device = { host: string; name: string; collectedAt: string | null; stale: boolean; error?: string; state?: string; stateLabel?: string };
type Collision = { repo: string; count: number; line: string };
export type Summary = { generatedAt: string; generatedBy?: string; devices?: Device[]; glance: { forecast?: unknown; collisions?: Collision[] }; week?: unknown };
export type Combined = Summary & { view: Snapshot };

/** Week is home. History holds the long view, with the older detail pages under it. A session opens over Week. */
export type Route = { view: 'week' | 'history'; detail: Detail | null; session: string | null };
const HOME: Route = { view: 'week', detail: null, session: null };
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

// Shown only when a computer is not current: off in the settings, late, unreachable or with no snapshot.
// The state and its label are decided once by the hub (lib/combine.mjs deviceState) and shown as stored.
function DeviceWarnings({ devices }: { devices: Device[] }) {
  const shown = devices.filter(device => device.state !== 'current');
  if (devices.length < 2 || shown.length === 0) return null;
  return (
    <ul className="ob-chips" aria-label={STRINGS.labels.computers}>
      {shown.map(device => <li key={device.host} className={device.state === 'off' ? 'off' : 'warn'} title={device.error ? format(STRINGS.today.unreachable, { reason: device.error }) : undefined}>
        <i aria-hidden="true" />{device.name || deviceLabel(device.host)}<span className="ob-meta">{device.stateLabel ?? STRINGS.status.unknown}</span>
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

/** The dashboard entry is the round 2 app. The Week and History views below stay for their tests until round 2 replaces them. */
export default function Dashboard() {
  return <R2App />;
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
        <DeviceWarnings devices={summary?.devices ?? []} />
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
