import { STRINGS } from '../../lib/strings.generated';
import { useCallback, useEffect, useState } from 'react';
import { freshness, format, readingTime, deviceLabel } from '../../lib/panel-data.mjs';
import { shiftDemoClock } from '../../lib/demo-clock.mjs';
import { useSkin } from './skin';

import { LimitsView } from './limits/LimitsView';
import { ActivityView } from './activity/ActivityView';
import { TokensView } from './tokens/tokens';
import { Forecast, type Outlook } from './forecast/Forecast';
import { FilterGroup } from './components';

type Snapshot = Record<string, unknown>;
type Device = { host: string; name: string; collectedAt: string | null; stale: boolean; error?: string };
type Collision = { repo: string; count: number; line: string };
export type Summary = { generatedAt: string; generatedBy?: string; devices?: Device[]; glance: { forecast?: Outlook; collisions?: Collision[] } };
export type Combined = Summary & { view: Snapshot };

const SECTIONS = [['limits', STRINGS.sections.limits], ['activity', STRINGS.sections.activity], ['tokens', STRINGS.sections.tokens]] as const;
type Section = typeof SECTIONS[number][0];
const ALL_HOSTS = 'All';
const HISTORY_REFRESH_MS = 5 * 60000;
export const sectionFromHash = (hash: string): Section | null => SECTIONS.find(([id]) => id === hash.slice(1))?.[0] ?? null;

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
        <i aria-hidden="true" />{deviceLabel(device.host)}<span className="ob-meta">{device.collectedAt ? readingTime(Date.parse(device.collectedAt), now) : STRINGS.today.noSnapshot}</span>
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
  const [section, setSection] = useState<Section | null>(() => sectionFromHash(window.location.hash));
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
    const follow = () => setSection(sectionFromHash(window.location.hash));
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('hashchange', follow);
    return () => { clearTimeout(first); clearInterval(tick); document.removeEventListener('visibilitychange', visible); window.removeEventListener('hashchange', follow); };
  }, [load]);

  // The full history is large, so it loads only while it is open, and refreshes slowly.
  const historyOpen = section !== null;
  useEffect(() => {
    if (!historyOpen) return;
    let live = true;
    const read = async () => { setHistoryFailed(false); const body = await fetchJson<Combined>('combined.json'); if (live) { setHistory(body?.view ? body : null); setHistoryFailed(!body?.view); } };
    void read();
    const timer = setInterval(() => { if (!document.hidden) void read(); }, HISTORY_REFRESH_MS);
    return () => { live = false; clearInterval(timer); };
  }, [historyOpen]);

  const choose = (id: Section | null) => { setSection(id); writeHash(id); };
  return <DashboardView summary={summary} history={history} loaded={loaded} now={now} css={css} className={className}
    section={section} onSectionChange={choose} historyFailed={historyFailed} />;
}

function writeHash(id: Section | null) {
  window.history.replaceState(window.history.state, '', id ? `#${id}` : `${window.location.pathname}${window.location.search}`);
}

type DashboardViewProps = {
  summary: Summary | null;
  history: Combined | null;
  loaded: boolean;
  now: number;
  css: string;
  className: string;
  section: Section | null;
  onSectionChange: (section: Section | null) => void;
  historyFailed?: boolean;
};

export function DashboardView({ summary, history, loaded, now, css, className, section, onSectionChange, historyFailed = false }: DashboardViewProps) {
  const fresh = freshness(summary?.generatedAt ?? '', now);
  const outlook = summary?.glance?.forecast ?? null;
  const snapshot = history?.view ?? null;
  return (
    <div className={`ob-dashboard ${className}`}>
      <style>{css}</style>
      <header className="ob-masthead">
        <h1><span className="ob-mark" aria-hidden="true" />{STRINGS.app.title}</h1>
        <DeviceWarnings devices={summary?.devices ?? []} now={now} />
        <SameRepo collisions={fresh.stale ? [] : summary?.glance?.collisions ?? []} />
        {summary && fresh.stale && <span className="ob-meta warn">{fresh.label}</span>}
      </header>
      {outlook ? <Forecast outlook={outlook} stale={fresh.stale} />
        : <output className="ob-first-run"><span className="ob-pulse" aria-hidden="true" /><h2>{loaded ? STRINGS.firstRun.title : STRINGS.labels.loading}</h2></output>}
      {outlook && <nav className="ob-history-nav" aria-label={STRINGS.sections.navigation}>
        <button type="button" className={`ob-history-toggle ${section ? 'on' : ''}`} aria-expanded={section !== null}
          onClick={() => onSectionChange(section ? null : 'limits')}>{STRINGS.sections.history}</button>
        {section && <FilterGroup label={STRINGS.sections.history} options={SECTIONS.map(([id, name]) => [id, name])} value={section} onChange={id => onSectionChange(id as Section)} />}
      </nav>}
      {section && <main>
        <section aria-label={SECTIONS.find(([id]) => id === section)![1]}>
          {!snapshot ? <p className={historyFailed ? 'ob-meta warn' : 'ob-meta'}>{historyFailed ? STRINGS.labels.historyFailed : STRINGS.labels.loading}</p>
            : section === 'limits' ? <LimitsView snapshot={snapshot} now={now} />
            : section === 'activity' ? <ActivityView snapshot={snapshot} now={now} initialHost={ALL_HOSTS} />
            : <TokensView snapshot={snapshot} now={now} initialHost={ALL_HOSTS} />}
        </section>
      </main>}
    </div>
  );
}
