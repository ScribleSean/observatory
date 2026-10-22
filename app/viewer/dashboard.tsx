import { STRINGS } from '../../lib/strings.generated';
import { useCallback, useEffect, useState } from 'react';
import { freshness, format } from '../../lib/panel-data.mjs';
import { useSkin } from './skin';

import { LimitsView } from './limits/LimitsView';
import { ActivityView } from './activity/ActivityView';
import { TokensView } from './tokens/tokens';
import { SourcesView } from './sources/SourcesView';
import { Overview, type Glance } from './overview/Overview';

// The dashboard is read-only. It fetches combined.json, written every five
// minutes by scripts/tick.mjs, and draws its merged snapshot.
type Snapshot = Record<string, unknown>;
type Device = { host: string; name: string; collectedAt: string | null; stale: boolean; error?: string };
export type Combined = { generatedAt: string; generatedBy?: string; view: Snapshot; glance: Glance; devices?: Device[] };

const SECTIONS = [
  ['limits', STRINGS.sections.limits], ['activity', STRINGS.sections.activity],
  ['tokens', STRINGS.sections.tokens], ['sources', STRINGS.sections.sources],
] as const;
type Section = typeof SECTIONS[number][0];
export const sectionFromHash = (hash: string): Section => SECTIONS.find(([id]) => id === hash.slice(1))?.[0] ?? 'limits';

function DeviceChips({ devices, now }: { devices: Device[]; now: number }) {
  if (devices.length < 2) return null;
  return (
    <ul className="ob-chips" aria-label={STRINGS.labels.computers}>
      {devices.map(device => {
        const age = freshness(device.collectedAt ?? '', now);
        return (
          <li key={device.host} className={age.stale ? 'warn' : ''} title={device.error ? format(STRINGS.today.unreachable, { reason: device.error }) : undefined}>
            <i aria-hidden="true" />{device.name}<span className="ob-meta">{device.collectedAt ? age.label : STRINGS.today.noSnapshot}</span>
          </li>
        );
      })}
    </ul>
  );
}

export default function Dashboard({ initialSkin = 'sage' }: { initialSkin?: string }) {
  const { css, className, skin } = useSkin(initialSkin);
  const [combined, setCombined] = useState<Combined | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [section, setSection] = useState<Section>(() => sectionFromHash(window.location.hash));
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const follow = () => setSection(sectionFromHash(window.location.hash));
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await fetch('./local/combined.json', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      const body = response.ok ? await response.json() as Combined : null;
      setCombined(body && typeof body === 'object' && body.view ? body : null);
    } catch { setCombined(null); }
    setNow(Date.now());
    setLoaded(true);
  }, []);

  useEffect(() => {
    const first = setTimeout(() => { void load(); }, 0);
    const tick = setInterval(() => { setNow(Date.now()); if (!document.hidden) void load(); }, 30000);
    const visible = () => { if (!document.hidden) void load(); };
    document.addEventListener('visibilitychange', visible);
    return () => { clearTimeout(first); clearInterval(tick); document.removeEventListener('visibilitychange', visible); };
  }, [load]);

  return <DashboardView combined={combined} loaded={loaded} now={now} limitStyle={skin.limitStyle} css={css} className={className} section={section}
    onSectionChange={id => { setSection(id); history.replaceState(history.state, '', `#${id}`); }} />;
}

type DashboardViewProps = {
  combined: Combined | null;
  limitStyle: string;
  loaded: boolean;
  now: number;
  css: string;
  className: string;
  section: Section;
  onSectionChange: (section: Section) => void;
};

export function DashboardView({ combined, limitStyle, loaded, now, css, className, section, onSectionChange }: DashboardViewProps) {
  const snapshot = combined?.view ?? null;
  const fresh = freshness(combined?.generatedAt ?? '', now);
  // With two computers, "All" needs verified deduplication, so the pages open on this computer.
  const home = (combined?.devices?.length ?? 0) > 1 && combined?.generatedBy ? combined.generatedBy : 'All';
  return (
    <div className={`ob-dashboard ${className}`}>
      <style>{css}</style>
      <header className="ob-masthead">
        <h1><span className="ob-mark" aria-hidden="true" />{STRINGS.app.title}</h1>
        <DeviceChips devices={combined?.devices ?? []} now={now} />
        <span className={fresh.stale && loaded ? 'ob-meta warn' : 'ob-meta'}>{!loaded ? STRINGS.labels.loading : combined ? fresh.label : STRINGS.labels.noCombined}</span>
      </header>
      {combined && <Overview glance={combined.glance} view={combined.view} generatedAt={combined.generatedAt} now={now} />}
      {!combined && <div className="ob-first-run">
        {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a status message, not a form output */}
        <div className="ob-card" role="status">
          <h2>{loaded ? STRINGS.firstRun.title : STRINGS.labels.loading}</h2>
          {loaded && <><p>{STRINGS.firstRun.body}</p><p className="ob-meta">{STRINGS.firstRun.hint}</p></>}
        </div>
      </div>}
      {combined && <nav className="ob-tabs" aria-label={STRINGS.sections.navigation}>
        {SECTIONS.map(([id, name]) => (
          <button key={id} type="button" aria-current={id === section ? 'page' : undefined} className={id === section ? 'on' : ''} onClick={() => onSectionChange(id)}>{name}</button>
        ))}
      </nav>}
      {combined && <main>
        <section aria-label={SECTIONS.find(([id]) => id === section)![1]}>
          {section === 'limits' ? <LimitsView snapshot={snapshot} now={now} limitStyle={limitStyle} />
            : section === 'activity' ? <ActivityView key={home} snapshot={snapshot} now={now} initialHost={home} />
            : section === 'tokens' ? <TokensView key={home} snapshot={snapshot} now={now} initialHost={home} />
            : <SourcesView snapshot={snapshot} now={now} />}
        </section>
      </main>}
    </div>
  );
}
