import { STRINGS, format } from '../lib/strings.generated';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, CircleArrowUp, RefreshCw, Settings } from 'lucide-react';
import { compact, demoSnapshot, devices, duration, freshness, limits, sourceCounts, totals } from '../lib/panel-data.mjs';
import { skinCss, validateSkin } from '../lib/skins.mjs';
import sage from '../native/skins/sage.json';
import almanac from '../native/skins/almanac.json';
import instrument from '../native/skins/instrument.json';
import amberCrt from '../native/skins/amber-crt.json';

type Snapshot = Record<string, unknown>;
export type PanelAction = 'refresh' | 'check-updates' | 'open-settings' | 'open-dashboard';

// Bundled skins. A person's own skin files will arrive through the shell later.
export const SKINS: Record<string, unknown> = { sage, almanac, instrument, 'amber-crt': amberCrt };

const PERIOD_LABELS: [string, string][] = [['now', STRINGS.periods.now], ['day', STRINGS.periods.day], ['week', STRINGS.periods.week], ['month', STRINGS.periods.month], ['all', STRINGS.periods.all]];

// The shell accepts these four names and nothing else. No arguments are sent.
function send(action: PanelAction) {
  const host = window as unknown as {
    webkit?: { messageHandlers?: { panelAction?: { postMessage: (value: string) => void } } };
    chrome?: { webview?: { postMessage: (value: unknown) => void } };
  };
  if (host.webkit?.messageHandlers?.panelAction) host.webkit.messageHandlers.panelAction.postMessage(action);
  else if (host.chrome?.webview) host.chrome.webview.postMessage({ panelAction: action });
  else window.dispatchEvent(new CustomEvent('observatory:panel-action', { detail: action }));
}

function Segments({ label, options, value, onChange }: { label: string; options: [string, string][]; value: string; onChange: (next: string) => void }) {
  return (
    <fieldset className="ob-segments" aria-label={label}>
      {options.map(([id, text]) => (
        <button key={id} type="button" aria-pressed={id === value} className={id === value ? 'on' : ''} onClick={() => onChange(id)}>{text}</button>
      ))}
    </fieldset>
  );
}

type Limit = ReturnType<typeof limits>[number];

function LimitRows({ rows, style }: { rows: Limit[]; style: string }) {
  const value = (row: Limit) => row.remaining === null ? STRINGS.status.unknown : format(STRINGS.formats.percent, { value: Math.round(row.remaining) });
  if (style === 'numeral') return (
    <div className="ob-numerals">
      {rows.map((row, index) => (
        <div key={index}>
          <div className={row.low ? 'ob-figure warn' : 'ob-figure'}>{value(row)}</div>
          <div><i className={`ob-dot ${row.provider}`} aria-hidden="true" />{row.name} <span className="ob-meta">{row.window}</span></div>
          <div className={row.stale ? 'ob-meta warn' : 'ob-meta'}>{row.note}</div>
        </div>
      ))}
    </div>
  );
  if (style === 'text') return (
    <div className="ob-textbars">
      {rows.map((row, index) => {
        const filled = row.remaining === null ? 0 : Math.round(row.remaining / 5);
        return (
          <div key={index} className="ob-limit">
            <div className="ob-row">
              <span>{row.name} <span className="ob-meta">{row.window}</span></span>
              <span className={row.low ? 'ob-num warn' : 'ob-num'}>{value(row)}</span>
            </div>
            <div className="ob-blocks" aria-hidden="true">{Array.from({ length: 20 }, (_, cell) => (
              <span key={cell} className={cell < filled ? (row.low ? 'warn' : row.provider) : 'ob-meta'}>{cell < filled ? STRINGS.formats.filledBlock : STRINGS.formats.emptyBlock}</span>
            ))}</div>
            <div className={row.stale ? 'ob-meta warn' : 'ob-meta'}>{row.note}</div>
          </div>
        );
      })}
    </div>
  );
  return (
    <>
      {rows.map((row, index) => (
        <div key={index} className="ob-limit">
          <div className="ob-row">
            <span><i className={`ob-dot ${row.provider}`} aria-hidden="true" />{row.name} <span className="ob-meta">{row.window}</span></span>
            <span className={row.low ? 'ob-num warn' : 'ob-num'}>{value(row)}</span>
          </div>
          <div className={row.stale ? 'ob-meta ob-indent warn' : 'ob-meta ob-indent'}>{row.note}</div>
          <div className="ob-bar" aria-hidden="true">
            {row.remaining !== null && <i className={row.low ? 'warn' : row.provider} style={{ width: `${row.remaining}%` }} />}
          </div>
        </div>
      ))}
    </>
  );
}

export default function Panel({ demo = false, initialSkin = 'sage' }: { demo?: boolean; initialSkin?: string }) {
  const [skinId, setSkinId] = useState(() => Object.hasOwn(SKINS, initialSkin) ? initialSkin : 'sage');
  const skin = useMemo(() => validateSkin(SKINS[skinId]), [skinId]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(() => demo ? demoSnapshot() as Snapshot : null);
  const [loaded, setLoaded] = useState(demo);
  const [host, setHost] = useState('All');
  const [period, setPeriod] = useState('day');
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);

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
    const reload = () => { setBusy(false); void load(); };
    const tick = setInterval(() => { setNow(Date.now()); if (!document.hidden) void load(); }, 30000);
    window.addEventListener('observatory:snapshot-changed', reload);
    document.addEventListener('visibilitychange', reload);
    return () => { clearTimeout(first); clearInterval(tick); window.removeEventListener('observatory:snapshot-changed', reload); document.removeEventListener('visibilitychange', reload); };
  }, [load]);

  const deviceList = useMemo(() => devices(snapshot), [snapshot]);
  const selected = host === 'All' || deviceList.some(device => device.id === host) ? host : 'All';
  const rows = useMemo(() => limits(snapshot, now), [snapshot, now]);
  const sums = useMemo(() => totals(snapshot, selected, period, new Date(now)), [snapshot, selected, period, now]);
  const fresh = freshness(typeof snapshot?.collectedAt === 'string' ? snapshot.collectedAt : '', now);
  const counts = sourceCounts(snapshot);
  const refresh = () => { setBusy(true); send('refresh'); setTimeout(() => setBusy(false), 20000); };

  return (
    <main className={`ob-panel ob-font-${skin.font}${skin.rules ? ' ob-rules' : ''}`}>
      <style>{skinCss(skin)}</style>
      <header className="ob-row">
        <h1><span className="ob-mark" aria-hidden="true" />{STRINGS.app.title}</h1>
        <span className={fresh.stale && loaded ? 'ob-meta warn' : 'ob-meta'}>{!loaded ? STRINGS.labels.loading : busy ? STRINGS.labels.refreshing : snapshot ? fresh.label : STRINGS.labels.noSnapshot}</span>
      </header>

      <section className="ob-card" aria-label={STRINGS.labels.limits}>
        <div className="ob-row ob-meta"><span>{STRINGS.labels.limits}</span><span>{STRINGS.labels.remaining}</span></div>
        <LimitRows rows={rows} style={skin.limitStyle} />
      </section>

      <Segments label={STRINGS.devices.device} value={selected} onChange={setHost}
        options={[['All', STRINGS.devices.all], ...deviceList.map(device => [device.id, device.label] as [string, string])]} />
      <Segments label={STRINGS.devices.period} value={period} onChange={setPeriod} options={PERIOD_LABELS} />

      <section className="ob-card" aria-label={STRINGS.labels.totals}>
        <div className="ob-row"><span>{STRINGS.labels.tokens}</span></div>
        <div className="ob-row ob-sub"><span><i className="ob-dot claude" aria-hidden="true" />{STRINGS.providers.claudeCode}</span>
          <span className="ob-num">{sums.claudeNote || compact(sums.claudeTokens)}</span></div>
        <div className="ob-row ob-sub"><span><i className="ob-dot codex" aria-hidden="true" />{STRINGS.providers.codex}</span>
          <span className="ob-num">{sums.codexNote || compact(sums.codexTokens)}</span></div>
        <div className="ob-meta ob-gap">{STRINGS.labels.apiEstimate} {sums.usd === null ? STRINGS.status.unknown : format(STRINGS.formats.usd, { value: sums.usd.toFixed(2) })}</div>
        <div className="ob-row"><span>{STRINGS.labels.screenTime}</span><span className="ob-num big">{sums.timeNote || duration(sums.seconds)}</span></div>
        {sums.note && <div className="ob-meta">{sums.note}</div>}
      </section>

      <div className="ob-row ob-meta ob-foot">
        <span>{snapshot ? format(STRINGS.formats.sourcesRead, counts) : STRINGS.labels.waiting}</span>
        {snapshot?.demo === true && (
          <label>{STRINGS.labels.sampleData}{STRINGS.formats.separator}{STRINGS.labels.skin}{' '}
            <select value={skinId} onChange={event => setSkinId(event.target.value)}>
              {Object.keys(SKINS).map(id => <option key={id} value={id}>{validateSkin(SKINS[id]).name}</option>)}
            </select>
          </label>
        )}
      </div>

      <nav className="ob-actions" aria-label={STRINGS.actions.navigation}>
        <button type="button" aria-label={STRINGS.actions.refresh} title={STRINGS.actions.refresh} disabled={busy} onClick={refresh}><RefreshCw size={17} className={busy ? 'spin' : ''} aria-hidden="true" /></button>
        <button type="button" aria-label={STRINGS.actions.checkUpdates} title={STRINGS.actions.checkUpdates} onClick={() => send('check-updates')}><CircleArrowUp size={17} aria-hidden="true" /></button>
        <button type="button" aria-label={STRINGS.actions.settings} title={STRINGS.actions.settings} onClick={() => send('open-settings')}><Settings size={17} aria-hidden="true" /></button>
        <button type="button" className="wide" onClick={() => send('open-dashboard')}>{STRINGS.actions.openObservatory}<ArrowUpRight size={15} aria-hidden="true" /></button>
      </nav>
    </main>
  );
}
