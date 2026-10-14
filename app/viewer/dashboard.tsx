import { useCallback, useEffect, useMemo, useState } from 'react';
import { demoSnapshot, freshness } from '../../lib/panel-data.mjs';
import { skinCss, validateSkin } from '../../lib/skins.mjs';
import { SKINS } from '../panel';

type Snapshot = Record<string, unknown>;
const SECTIONS = [
  ['limits', 'Limits'], ['activity', 'Activity'], ['tokens', 'Tokens'],
  ['dictation', 'Dictation'], ['sources', 'Sources'], ['settings', 'Settings'],
] as const;
type Section = typeof SECTIONS[number][0];

function EmptyState() {
  return <div className="ob-card"><p>This section is not built yet.</p></div>;
}

export default function Dashboard({ demo = false, initialSkin = 'sage' }: { demo?: boolean; initialSkin?: string }) {
  const [skinId, setSkinId] = useState(() => Object.hasOwn(SKINS, initialSkin) ? initialSkin : 'sage');
  const skin = useMemo(() => validateSkin(SKINS[skinId]), [skinId]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(() => demo ? demoSnapshot() as Snapshot : null);
  const [loaded, setLoaded] = useState(demo);
  const [section, setSection] = useState<Section>('limits');
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
  const sections = SECTIONS.filter(([id]) => id !== 'dictation' || hasDictation);
  const title = SECTIONS.find(([id]) => id === selected)![1];
  const fresh = freshness(typeof snapshot?.collectedAt === 'string' ? snapshot.collectedAt : '', now);

  return (
    <div className={`ob-dashboard ob-font-${skin.font}${skin.rules ? ' ob-rules' : ''}`}>
      <style>{skinCss(skin)}</style>
      <header className="ob-row">
        <h1><span className="ob-mark" aria-hidden="true" />Observatory</h1>
        <span className={fresh.stale && loaded ? 'ob-meta warn' : 'ob-meta'}>{!loaded ? 'Loading' : snapshot ? fresh.label : 'No snapshot yet'}</span>
      </header>

      <div className="ob-dashboard-layout">
        <nav aria-label="Sections">
          {sections.map(([id, name]) => (
            <button key={id} type="button" aria-current={id === selected ? 'page' : undefined} className={id === selected ? 'on' : ''} onClick={() => setSection(id)}>{name}</button>
          ))}
        </nav>
        <main>
          <section aria-labelledby={`ob-section-${selected}`}>
            <h2 id={`ob-section-${selected}`}>{title}</h2>
            <EmptyState />
          </section>
        </main>
      </div>

      {demo && snapshot?.demo === true && (
        <footer className="ob-row ob-meta ob-foot">
          <label>Sample data · Skin{' '}
            <select value={skinId} onChange={event => setSkinId(event.target.value)}>
              {Object.keys(SKINS).map(id => <option key={id} value={id}>{validateSkin(SKINS[id]).name}</option>)}
            </select>
          </label>
        </footer>
      )}
    </div>
  );
}
