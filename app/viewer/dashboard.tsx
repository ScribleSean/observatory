import { STRINGS } from '../../lib/strings.generated';
import { useCallback, useEffect, useState } from 'react';
import { demoSnapshot, freshness } from '../../lib/panel-data.mjs';
import { skinCss, validateSkin } from '../../lib/skins.mjs';
import { SKINS, useSkin } from './skin';

import { EmptyState, Row } from './components';
import LimitsView from './limits/LimitsView';
import { ActivityView } from './activity/ActivityView';
import { TokensView } from './tokens/tokens';
import { SourcesView } from './sources/SourcesView';
import { DictationView } from './dictation/DictationView';
import { SetupView } from './setup/SetupView';
import { SettingsView } from './settings/settings';
import { createBridge } from './bridge';
import { createSettingsController } from './settings/controller';

type Snapshot = Record<string, unknown>;
const SECTIONS = [
  ['limits', STRINGS.sections.limits], ['activity', STRINGS.sections.activity], ['tokens', STRINGS.sections.tokens],
  ['dictation', STRINGS.sections.dictation], ['sources', STRINGS.sections.sources], ['settings', STRINGS.sections.settings],
] as const;
type Section = typeof SECTIONS[number][0];
export type DashboardSection = Section | 'setup';
export const sectionFromHash = (hash: string): DashboardSection => hash === '#setup' ? 'setup' : SECTIONS.find(([id]) => id === hash.slice(1))?.[0] ?? 'limits';

export function followSectionHash(target: Pick<Window, 'addEventListener' | 'removeEventListener'> & { location: Pick<Location, 'hash'> }, onSection: (section: DashboardSection) => void) {
  const follow = () => onSection(sectionFromHash(target.location.hash));
  target.addEventListener('hashchange', follow);
  return () => target.removeEventListener('hashchange', follow);
}

export function writeSectionHash(target: { location: Pick<Location, 'hash' | 'pathname' | 'search'>; history: Pick<History, 'state' | 'replaceState'> }, id: DashboardSection) {
  if (target.location.hash !== `#${id}`) {
    const { pathname, search } = target.location;
    target.history.replaceState(target.history.state, '', `${pathname}${search}#${id}`);
  }
}

export default function Dashboard({ demo = false, initialSkin = 'sage' }: { demo?: boolean; initialSkin?: string }) {
  const { skinId, setSkinId, skin, css, className } = useSkin(initialSkin);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(() => demo ? demoSnapshot() as Snapshot : null);
  const [loaded, setLoaded] = useState(demo);
  const [collectionPaused, setCollectionPaused] = useState(false);
  const [actionsAvailable, setActionsAvailable] = useState(demo);
  const [section, setSection] = useState<DashboardSection>(() => sectionFromHash(typeof window === 'undefined' ? '' : window.location.hash));
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => followSectionHash(window, setSection), []);

  const load = useCallback(async () => {
    if (demo) return;
    try {
      const response = await fetch('./local/usage.json', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      setSnapshot(response.ok ? await response.json() as Snapshot : null);
    } catch { setSnapshot(null); }
    setLoaded(true);
  }, [demo]);

  useEffect(() => {
    const bridge = demo ? null : createBridge();
    const controller = bridge?.available ? createSettingsController(bridge) : null;
    controller?.subscribe(status => setCollectionPaused(status?.collectionPaused === true));
    const readStatus = () => { void controller?.status(); };
    readStatus();
    const first = setTimeout(() => { setActionsAvailable(demo || bridge?.available === true); void load(); if (!controller) setCollectionPaused(false); }, 0);
    const reload = () => { void load(); readStatus(); };
    const tick = setInterval(() => { setNow(Date.now()); if (!document.hidden) reload(); }, 30000);
    window.addEventListener('observatory:snapshot-changed', reload);
    document.addEventListener('visibilitychange', reload);
    return () => { clearTimeout(first); clearInterval(tick); window.removeEventListener('observatory:snapshot-changed', reload); document.removeEventListener('visibilitychange', reload); controller?.dispose(); bridge?.dispose(); };
  }, [load, demo]);

  useEffect(() => {
    if (Object.getOwnPropertyDescriptor(window, 'observatoryDashboardReady')) return;
    Object.defineProperty(window, 'observatoryDashboardReady', { value: true, configurable: true });
  }, []);

  return <DashboardView actionsAvailable={actionsAvailable} collectionPaused={!demo && collectionPaused} demo={demo} snapshot={snapshot} loaded={loaded} now={now} skinId={skinId} skin={skin} css={css} className={className}
    section={section} onSectionChange={id => { setSection(id); writeSectionHash(window, id); }} onSkinChange={setSkinId} onSetupFinished={() => { setSection('limits'); writeSectionHash(window, 'limits'); }} />;
}

type DashboardViewProps = {
  actionsAvailable?: boolean;
  collectionPaused?: boolean;
  onSetupFinished?: () => void;
  demo?: boolean;
  snapshot: Snapshot | null;
  loaded: boolean;
  now: number;
  skinId: string;
  skin: ReturnType<typeof validateSkin>;
  css?: string;
  className?: string;
  section: DashboardSection;
  onSectionChange: (section: DashboardSection) => void;
  onSkinChange: (skin: string) => void;
};

export function DashboardView({ actionsAvailable = true, collectionPaused = false, demo = false, snapshot, loaded, now, skinId, skin, css = skinCss(skin), className = `ob-font-${skin.font}${skin.rules ? ' ob-rules' : ''}`, section, onSectionChange, onSkinChange, onSetupFinished = () => {} }: DashboardViewProps) {
  const [setupBlocked, setSetupBlocked] = useState(false);
  const hasDictation = Array.isArray(snapshot?.dictation) && snapshot.dictation.some(source =>
    source && typeof source === 'object' && !Array.isArray(source) && typeof source.status === 'string' && source.status !== 'not-connected');
  const selected = section === 'dictation' && !hasDictation ? 'limits' : section;
  const sections = SECTIONS.filter(([id]) => id !== 'dictation' || hasDictation);
  const title = selected === 'setup' ? STRINGS.setup.title : SECTIONS.find(([id]) => id === selected)![1];
  const fresh = freshness(typeof snapshot?.collectedAt === 'string' ? snapshot.collectedAt : '', now);

  return (
    <div className={`ob-dashboard ${className}`}>
      <style>{css}</style>
      <Row as="header">
        <h1><span className="ob-mark" aria-hidden="true" />{STRINGS.app.title}</h1>
        {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- The paused note uses the requested span status markup. */}
        {collectionPaused && <span role="status" className="ob-meta warn">{STRINGS.settings.collectionPaused}</span>}
        <span className={fresh.stale && loaded ? 'ob-meta warn' : 'ob-meta'}>{!loaded ? STRINGS.labels.loading : snapshot ? fresh.label : STRINGS.labels.noSnapshot}</span>
      </Row>

      <div className="ob-dashboard-layout">
        {(selected !== 'setup' || !actionsAvailable || setupBlocked) && <nav aria-label={STRINGS.sections.navigation}>
          {sections.map(([id, name]) => (
            <button key={id} type="button" aria-current={id === selected ? 'page' : undefined} className={id === selected ? 'on' : ''} onClick={() => onSectionChange(id)}>{name}</button>
          ))}
        </nav>}
        <main>
          <section aria-labelledby={`ob-section-${selected}`}>
            <h2 id={`ob-section-${selected}`}>{title}</h2>
            {selected === 'setup' ? <SetupView demo={demo} onFinished={onSetupFinished} onBlockedChange={setSetupBlocked} /> : selected === 'limits' ? <LimitsView snapshot={snapshot} now={now} limitStyle={skin.limitStyle} /> : selected === 'activity' ? <ActivityView snapshot={snapshot} now={now} /> : selected === 'tokens' ? <TokensView snapshot={snapshot} now={now} /> : selected === 'sources' ? <SourcesView snapshot={snapshot} now={now} /> : selected === 'dictation' ? <DictationView snapshot={snapshot} now={now} /> : selected === 'settings' ? <SettingsView demo={demo} skinId={skinId} onSkinChange={onSkinChange} /> : <EmptyState text={STRINGS.sections.emptyState} />}
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
