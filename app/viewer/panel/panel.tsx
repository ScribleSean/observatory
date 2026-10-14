import { STRINGS, format } from '../../../lib/strings.generated';
import { useCallback, useEffect, useState } from 'react';
import { ActionBar, Card, FilterGroup, Meter, Numeral, ProviderDot, Row, TextBar } from '../components';
import type { PanelAction } from '../components/ActionBar';
export type { PanelAction } from '../components/ActionBar';
import { compact, demoSnapshot, devices, duration, freshness, limits, sourceCounts, totals } from '../../../lib/panel-data.mjs';
import { skinCss, validateSkin } from '../../../lib/skins.mjs';
import { SKINS, useSkin } from '../skin';
export { SKINS } from '../skin';

type Snapshot = Record<string, unknown>;

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

type Limit = ReturnType<typeof limits>[number];

function LimitRows({ rows, style }: { rows: Limit[]; style: string }) {
  const children = rows.map((row, index) => {
    const props = { ...row, value: row.remaining === null ? STRINGS.status.unknown : format(STRINGS.formats.percent, { value: Math.round(row.remaining) }) };
    if (style === 'numeral') return <Numeral key={index} {...props} />;
    if (style === 'text') return <TextBar key={index} {...props} filledBlock={STRINGS.formats.filledBlock} emptyBlock={STRINGS.formats.emptyBlock} />;
    return <Meter key={index} {...props} />;
  });
  if (style === 'numeral') return <div className="ob-numerals">{children}</div>;
  if (style === 'text') return <div className="ob-textbars">{children}</div>;
  return <>{children}</>;
}

export default function Panel({ demo = false, initialSkin = 'sage' }: { demo?: boolean; initialSkin?: string }) {
  const { skinId, setSkinId, skin, css, className } = useSkin(initialSkin);
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

  const refresh = () => { setBusy(true); send('refresh'); setTimeout(() => setBusy(false), 20000); };
  return <PanelView snapshot={snapshot} loaded={loaded} busy={busy} now={now} skinId={skinId} skin={skin} css={css} className={className}
    host={host} period={period} onHostChange={setHost} onPeriodChange={setPeriod} onSkinChange={setSkinId}
    onAction={action => action === 'refresh' ? refresh() : send(action)} />;
}

type PanelViewProps = {
  snapshot: Snapshot | null;
  loaded: boolean;
  busy: boolean;
  now: number;
  skinId: string;
  skin: ReturnType<typeof validateSkin>;
  css?: string;
  className?: string;
  host: string;
  period: string;
  onHostChange: (host: string) => void;
  onPeriodChange: (period: string) => void;
  onSkinChange: (skin: string) => void;
  onAction: (action: PanelAction) => void;
};

export function PanelView({ snapshot, loaded, busy, now, skinId, skin, css = skinCss(skin), className = `ob-font-${skin.font}${skin.rules ? ' ob-rules' : ''}`, host, period, onHostChange, onPeriodChange, onSkinChange, onAction }: PanelViewProps) {
  const deviceList = devices(snapshot);
  const selected = host === 'All' || deviceList.some(device => device.id === host) ? host : 'All';
  const rows = limits(snapshot, now);
  const sums = totals(snapshot, selected, period, new Date(now));
  const fresh = freshness(typeof snapshot?.collectedAt === 'string' ? snapshot.collectedAt : '', now);
  const counts = sourceCounts(snapshot);
  return (
    <main className={`ob-panel ${className}`}>
      <style>{css}</style>
      <Row as="header">
        <h1><span className="ob-mark" aria-hidden="true" />{STRINGS.app.title}</h1>
        <span className={fresh.stale && loaded ? 'ob-meta warn' : 'ob-meta'}>{!loaded ? STRINGS.labels.loading : busy ? STRINGS.labels.refreshing : snapshot ? fresh.label : STRINGS.labels.noSnapshot}</span>
      </Row>

      <Card label={STRINGS.labels.limits}>
        <Row className="ob-meta"><span>{STRINGS.labels.limits}</span><span>{STRINGS.labels.remaining}</span></Row>
        <LimitRows rows={rows} style={skin.limitStyle} />
      </Card>

      <FilterGroup label={STRINGS.devices.device} value={selected} onChange={onHostChange}
        options={[['All', STRINGS.devices.all], ...deviceList.map(device => [device.id, device.label] as [string, string])]} />
      <FilterGroup label={STRINGS.devices.period} value={period} onChange={onPeriodChange} options={PERIOD_LABELS} />

      <Card label={STRINGS.labels.totals}>
        <Row><span>{STRINGS.labels.tokens}</span></Row>
        <Row className="ob-sub"><span><ProviderDot provider="claude" />{STRINGS.providers.claudeCode}</span>
          <span className="ob-num">{sums.claudeNote || compact(sums.claudeTokens)}</span></Row>
        <Row className="ob-sub"><span><ProviderDot provider="codex" />{STRINGS.providers.codex}</span>
          <span className="ob-num">{sums.codexNote || compact(sums.codexTokens)}</span></Row>
        <div className="ob-meta ob-gap">{STRINGS.labels.apiEstimate} {sums.usd === null ? STRINGS.status.unknown : format(STRINGS.formats.usd, { value: sums.usd.toFixed(2) })}</div>
        <Row><span>{STRINGS.labels.screenTime}</span><span className="ob-num big">{sums.timeNote || duration(sums.seconds)}</span></Row>
        {sums.note && <div className="ob-meta">{sums.note}</div>}
      </Card>

      <Row className="ob-meta ob-foot">
        <span>{snapshot ? format(STRINGS.formats.sourcesRead, counts) : STRINGS.labels.waiting}</span>
        {snapshot?.demo === true && (
          <label>{STRINGS.labels.sampleData}{STRINGS.formats.separator}{STRINGS.labels.skin}{' '}
            <select value={skinId} onChange={event => onSkinChange(event.target.value)}>
              {Object.keys(SKINS).map(id => <option key={id} value={id}>{validateSkin(SKINS[id]).name}</option>)}
            </select>
          </label>
        )}
      </Row>

      <ActionBar busy={busy} onAction={onAction} />
    </main>
  );
}
