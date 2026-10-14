import { STRINGS } from '../../lib/strings.generated';
import { useCallback, useEffect, useState } from 'react';
import { demoSnapshot, freshness } from '../../lib/panel-data.mjs';
import { skinCss, validateSkin } from '../../lib/skins.mjs';
import { SKINS, useSkin } from './skin';

import { EmptyState, Row } from './components';
import { ActivityView } from './activity/ActivityView';

type Snapshot = Record<string, unknown>;
const SECTIONS = [
  ['limits', STRINGS.sections.limits], ['activity', STRINGS.sections.activity], ['tokens', STRINGS.sections.tokens],
  ['dictation', STRINGS.sections.dictation], ['sources', STRINGS.sections.sources], ['settings', STRINGS.sections.settings],
] as const;
type Section = typeof SECTIONS[number][0];

export default function Dashboard({ demo = false, initialSkin = 'sage' }: { demo?: boolean; initialSkin?: string }) {
  const { skinId, setSkinId, skin, css, className } = useSkin(initialSkin);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(() => demo ? demoSnapshot() as Snapshot : null);
  const [loaded, setLoaded] = useState(demo);
  const [section, setSection] = useState<Section>(() => {
    const hash = typeof location !== 'undefined' ? location.hash.slice(1) : '';
    return SECTIONS.find(([id]) => id === hash)?.[0] ?? 'limits';
  });
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    if (demo) return;
    try {
      const response = await fetch('./local/usage.json', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      setSnapshot(response.ok ? await response.json() as Snapshot : null);
    } catch { setSnapshot(null); }
    setLoaded(true);
  }, [demo]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const reload = () => { void load(); };
    const tick = setInterval(() => { setNow(Date.now()); if (!document.hidden) void load(); }, 30000);
    window.addEventListener('observatory:snapshot-changed', reload);
    document.addEventListener('visibilitychange', reload);
    return () => { clearTimeout(first); clearInterval(tick); window.removeEventListener('observatory:snapshot-changed', reload); document.removeEventListener('visibilitychange', reload); };
  }, [load]);

  useEffect(() => {
    try { Object.defineProperty(window, 'observatoryDashboardReady', { value: true, configurable: true }); } catch { /* The shell may already have defined the flag. */ }
  }, []);

  const hasDictation = Array.isArray(snapshot?.dictation) && snapshot.dictation.some(source =>
    source && typeof source === 'object' && !Array.isArray(source) && typeof source.status === 'string' && source.status !== 'not-connected');
  const selected = section === 'dictation' && !hasDictation ? 'limits' : section;
  if (selected !== section) setSection(selected);
  return <DashboardView demo={demo} snapshot={snapshot} loaded={loaded} now={now} skinId={skinId} skin={skin} css={css} className={className}
    section={selected} onSectionChange={setSection} onSkinChange={setSkinId} />;
}

type DashboardViewProps = {
  demo?: boolean;
  snapshot: Snapshot | null;
  loaded: boolean;
  now: number;
  skinId: string;
  skin: ReturnType<typeof validateSkin>;
  css?: string;
  className?: string;
  section: Section;
  onSectionChange: (section: Section) => void;
  onSkinChange: (skin: string) => void;
};

export function DashboardView({ demo = false, snapshot, loaded, now, skinId, skin, css = skinCss(skin), className = `ob-font-${skin.font}${skin.rules ? ' ob-rules' : ''}`, section, onSectionChange, onSkinChange }: DashboardViewProps) {
  const hasDictation = Array.isArray(snapshot?.dictation) && snapshot.dictation.some(source =>
    source && typeof source === 'object' && !Array.isArray(source) && typeof source.status === 'string' && source.status !== 'not-connected');
  const selected = section === 'dictation' && !hasDictation ? 'limits' : section;
  const sections = SECTIONS.filter(([id]) => id !== 'dictation' || hasDictation);
  const title = SECTIONS.find(([id]) => id === selected)![1];
  const fresh = freshness(typeof snapshot?.collectedAt === 'string' ? snapshot.collectedAt : '', now);

  return (
    <div className={`ob-dashboard ${className}`}>
      <style>{css}</style>
      <Row as="header">
        <h1><span className="ob-mark" aria-hidden="true" />{STRINGS.app.title}</h1>
        <span className={fresh.stale && loaded ? 'ob-meta warn' : 'ob-meta'}>{!loaded ? STRINGS.labels.loading : snapshot ? fresh.label : STRINGS.labels.noSnapshot}</span>
      </Row>

      <div className="ob-dashboard-layout">
        <nav aria-label={STRINGS.sections.navigation}>
          {sections.map(([id, name]) => (
            <button key={id} type="button" aria-current={id === selected ? 'page' : undefined} className={id === selected ? 'on' : ''} onClick={() => onSectionChange(id)}>{name}</button>
          ))}
        </nav>
        <main>
          <section aria-labelledby={`ob-section-${selected}`}>
            <h2 id={`ob-section-${selected}`}>{title}</h2>
            {selected === 'activity' ? <ActivityView snapshot={snapshot} now={now} /> : <EmptyState text={STRINGS.sections.emptyState} />}
          </section>
        </main>
      </div>

      {demo && snapshot?.demo === true && (
        <Row as="footer" className="ob-meta ob-foot">
          <label>{STRINGS.labels.sampleData}{STRINGS.formats.separator}{STRINGS.labels.skin}{' '}
            <select value={skinId} onChange={event => onSkinChange(event.target.value)}>
              {Object.keys(SKINS).map(id => <option key={id} value={id}>{validateSkin(SKINS[id]).name}</option>)}
            </select>
          </label>
        </Row>
      )}
    </div>
  );
}
