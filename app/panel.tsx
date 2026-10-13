import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, CircleArrowUp, RefreshCw, Settings } from 'lucide-react';
import { compact, demoSnapshot, devices, duration, freshness, limits, sourceCounts, totals } from '../lib/panel-data.mjs';

type Snapshot = Record<string, unknown>;
export type PanelAction = 'refresh' | 'check-updates' | 'open-settings' | 'open-dashboard';

const PERIOD_LABELS: [string, string][] = [['now', 'Now'], ['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['all', 'All time']];

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

export default function Panel({ demo = false }: { demo?: boolean }) {
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
    <main className="ob-panel">
      <header className="ob-row">
        <h1><span className="ob-mark" aria-hidden="true" />Observatory</h1>
        <span className={fresh.stale && loaded ? 'ob-meta warn' : 'ob-meta'}>{!loaded ? 'Loading' : busy ? 'Refreshing' : snapshot ? fresh.label : 'No snapshot yet'}</span>
      </header>

      <section className="ob-card" aria-label="Limits">
        <div className="ob-row ob-meta"><span>Limits</span><span>remaining</span></div>
        {rows.map((row, index) => (
          <div key={index} className="ob-limit">
            <div className="ob-row">
              <span><i className={`ob-dot ${row.provider}`} aria-hidden="true" />{row.name} <span className="ob-meta">{row.window}</span></span>
              <span className={row.low ? 'ob-num warn' : 'ob-num'}>{row.remaining === null ? 'Unknown' : `${Math.round(row.remaining)}%`}</span>
            </div>
            <div className={row.stale ? 'ob-meta ob-indent warn' : 'ob-meta ob-indent'}>{row.note}</div>
            <div className="ob-bar" aria-hidden="true">
              {row.remaining !== null && <i className={row.low ? 'warn' : row.provider} style={{ width: `${row.remaining}%` }} />}
            </div>
          </div>
        ))}
      </section>

      <Segments label="Device" value={selected} onChange={setHost}
        options={[['All', 'All'], ...deviceList.map(device => [device.id, device.label] as [string, string])]} />
      <Segments label="Period" value={period} onChange={setPeriod} options={PERIOD_LABELS} />

      <section className="ob-card" aria-label="Totals">
        <div className="ob-row"><span>Tokens</span></div>
        <div className="ob-row ob-sub"><span><i className="ob-dot claude" aria-hidden="true" />Claude Code</span>
          <span className="ob-num">{sums.claudeNote || compact(sums.claudeTokens)}</span></div>
        <div className="ob-row ob-sub"><span><i className="ob-dot codex" aria-hidden="true" />Codex</span>
          <span className="ob-num">{sums.codexNote || compact(sums.codexTokens)}</span></div>
        <div className="ob-meta ob-gap">Codex API-equivalent (estimate) {sums.usd === null ? 'Unknown' : `$${sums.usd.toFixed(2)}`}</div>
        <div className="ob-row"><span>Screen time</span><span className="ob-num big">{sums.timeNote || duration(sums.seconds)}</span></div>
        {sums.note && <div className="ob-meta">{sums.note}</div>}
      </section>

      <div className="ob-row ob-meta ob-foot">
        <span>{snapshot ? `${counts.read} of ${counts.total} sources read` : 'Waiting for the first collection'}</span>
        {snapshot?.demo === true && <span>Sample data</span>}
      </div>

      <nav className="ob-actions" aria-label="Actions">
        <button type="button" aria-label="Refresh" title="Refresh" disabled={busy} onClick={refresh}><RefreshCw size={17} className={busy ? 'spin' : ''} aria-hidden="true" /></button>
        <button type="button" aria-label="Check for updates" title="Check for updates" onClick={() => send('check-updates')}><CircleArrowUp size={17} aria-hidden="true" /></button>
        <button type="button" aria-label="Settings" title="Settings" onClick={() => send('open-settings')}><Settings size={17} aria-hidden="true" /></button>
        <button type="button" className="wide" onClick={() => send('open-dashboard')}>Open Observatory<ArrowUpRight size={15} aria-hidden="true" /></button>
      </nav>
    </main>
  );
}
