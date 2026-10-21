import { STRINGS } from '../../lib/strings.generated';
import { useCallback, useEffect, useState } from 'react';
import { compact, duration, format, freshness } from '../../lib/panel-data.mjs';
import { useSkin } from './skin';

import { Card, Row } from './components';
import { LimitsView } from './limits/LimitsView';
import { ActivityView } from './activity/ActivityView';
import { TokensView } from './tokens/tokens';
import { SourcesView } from './sources/SourcesView';

// The dashboard is read-only. It fetches combined.json, written every five
// minutes by scripts/tick.mjs, and draws its merged snapshot.
type Snapshot = Record<string, unknown>;
type DeviceToday = { host: string; name: string; missing?: boolean; seconds: number | null; tokens: number | null; screenTimeOn?: boolean; freshness: { label: string; stale: boolean }; error?: string };
type Glance = { today: DeviceToday[]; both: { seconds: number | null; tokens: number | null } | null };
export type Combined = { generatedAt: string; view: Snapshot; glance: Glance };

const SECTIONS = [
  ['limits', STRINGS.sections.limits], ['activity', STRINGS.sections.activity], ['tokens', STRINGS.sections.tokens],
  ['sources', STRINGS.sections.sources],
] as const;
type Section = typeof SECTIONS[number][0];
export const sectionFromHash = (hash: string): Section => SECTIONS.find(([id]) => id === hash.slice(1))?.[0] ?? 'limits';

const value = (amount: number | null, show: (n: number) => string) => amount === null ? STRINGS.status.unknown : show(amount);

export function TodaySummary({ glance }: { glance: Glance }) {
  return (
    <div className="ob-today"><Card label={STRINGS.today.title}>
      <h2>{STRINGS.today.title}</h2>
      <table>
        <thead><tr><th scope="col" /><th scope="col">{STRINGS.today.screenTime}</th><th scope="col">{STRINGS.today.tokens}</th><th scope="col" /></tr></thead>
        <tbody>
          {glance.today.map(device => (
            <tr key={device.host}>
              <th scope="row">{device.name}</th>
              <td>{device.screenTimeOn === false ? STRINGS.today.screenTimeOff : value(device.seconds, duration)}</td>
              <td>{value(device.tokens, compact)}</td>
              <td className={device.freshness.stale ? 'ob-meta warn' : 'ob-meta'}>
                {device.missing ? STRINGS.today.noSnapshot : device.freshness.label}
                {device.error ? `${STRINGS.formats.separator}${format(STRINGS.today.unreachable, { reason: device.error })}` : ''}
              </td>
            </tr>
          ))}
          {glance.both && (
            <tr className="ob-today-both">
              <th scope="row">{STRINGS.today.both}</th>
              <td>{value(glance.both.seconds, duration)}</td>
              <td>{value(glance.both.tokens, compact)}</td>
              <td className="ob-meta">{STRINGS.today.notDeduplicated}</td>
            </tr>
          )}
        </tbody>
      </table>
    </Card></div>
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
  const title = SECTIONS.find(([id]) => id === section)![1];
  const fresh = freshness(combined?.generatedAt ?? '', now);
  return (
    <div className={`ob-dashboard ${className}`}>
      <style>{css}</style>
      <Row as="header">
        <h1><span className="ob-mark" aria-hidden="true" />{STRINGS.app.title}</h1>
        <span className={fresh.stale && loaded ? 'ob-meta warn' : 'ob-meta'}>{!loaded ? STRINGS.labels.loading : combined ? fresh.label : STRINGS.labels.noCombined}</span>
      </Row>
      {combined && <TodaySummary glance={combined.glance} />}
      <div className="ob-dashboard-layout">
        <nav aria-label={STRINGS.sections.navigation}>
          {SECTIONS.map(([id, name]) => (
            <button key={id} type="button" aria-current={id === section ? 'page' : undefined} className={id === section ? 'on' : ''} onClick={() => onSectionChange(id)}>{name}</button>
          ))}
        </nav>
        <main>
          <section aria-labelledby={`ob-section-${section}`}>
            <h2 id={`ob-section-${section}`}>{title}</h2>
            {section === 'limits' ? <LimitsView snapshot={snapshot} now={now} limitStyle={limitStyle} />
              : section === 'activity' ? <ActivityView snapshot={snapshot} now={now} />
              : section === 'tokens' ? <TokensView snapshot={snapshot} now={now} />
              : <SourcesView snapshot={snapshot} now={now} />}
          </section>
        </main>
      </div>
    </div>
  );
}
