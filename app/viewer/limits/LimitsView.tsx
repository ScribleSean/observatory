import { useState } from 'react';
import { STRINGS, format } from '../../../lib/strings.generated';
import { limitRows, limitHistory, peerLimits, sessionCost } from '../../../lib/view-limits.mjs';
import { span } from '../../../lib/panel-data.mjs';
import { Card, Row, ProviderDot, FilterGroup, InfoControl, LineChart } from '../components';
import { LimitRows } from '../components/LimitRows';
import './limits.css';

const providers = [['claude', STRINGS.providers.claudeCode], ['codex', STRINGS.providers.codex]] as const;
const periods: [string, string][] = Object.entries(STRINGS.periods);
type HistoryWindow = { bucket: string; windowId: string; label: string; points: { label: string; value: number | null }[] };
const percent = (value: number) => format(STRINGS.formats.percent, { value: Math.round(value) });
const paceMessages: Record<string, string> = {
  'resets-first': STRINGS.limits.resetsFirst,
  exhausted: STRINGS.limits.exhausted,
  stale: STRINGS.limits.stale,
  'insufficient-history': STRINGS.limits.insufficientHistory,
  'no-recent-consumption': STRINGS.limits.noRecentConsumption,
  'reset-unknown': STRINGS.limits.resetUnknown,
  'reset-pending': STRINGS.limits.resetPending,
  'awaiting-observation': STRINGS.limits.awaitingObservation,
};

function paceSentence(pace: ReturnType<typeof limitRows>[number]['pace']) {
  if (!pace) return STRINGS.status.unknown;
  if (pace.status === 'projected' && pace.runsOutInMinutes !== null)
    return format(STRINGS.formats.runsOut, { span: span(pace.runsOutInMinutes * 60000) });
  return paceMessages[pace.status] ?? STRINGS.status.unknown;
}

export function LimitsView({ snapshot, now, limitStyle, initialPeriod = 'day' }: {
  snapshot: Record<string, unknown> | null;
  now: number;
  limitStyle: string;
  initialPeriod?: string;
}) {
  const [period, setPeriod] = useState(initialPeriod);
  const rows = limitRows(snapshot, now);
  const cost = sessionCost(snapshot, now);
  const peer = peerLimits(snapshot, now);
  return <div className="ob-limits">
    <div className="ob-limits-now">
      <Card label={STRINGS.periods.now}>
        <Row><h3>{STRINGS.periods.now}</h3><span className="ob-meta">{STRINGS.limits.nowCaption}</span></Row>
        <div className="ob-limits-providers">
          {providers.map(([provider, name]) => <div key={provider}>
            <h4><ProviderDot provider={provider} />{name}</h4>
            {rows.filter(row => row.provider === provider).map((row, index) => <div key={index}
              className={row.low ? 'ob-limits-pace warn' : 'ob-limits-pace'} data-provider={provider} data-window={row.window || 'unknown'}>
              {row.remaining === null ? <Row><span className="ob-num big">{STRINGS.status.unknown}</span><span className="ob-meta">{row.note}</span></Row> : <>
                <span className="ob-num big">{typeof row.pace?.ratePerHour === 'number' ? format(STRINGS.limits.perHour, { value: row.pace.ratePerHour.toFixed(1) }) : STRINGS.status.unknown}</span>
                <div className="ob-meta">{row.window}</div>
                <div className={row.stale ? 'ob-meta warn' : 'ob-meta'}>{paceSentence(row.pace)}</div>
                <div className={row.low ? 'ob-num warn' : 'ob-num'}>{percent(row.remaining)}</div>
              </>}
            </div>)}
          </div>)}
        </div>
      </Card>
    </div>
    <div className="ob-limits-providers">
      {providers.map(([provider, name]) => <Card key={provider} label={name}>
        <h3><ProviderDot provider={provider} />{name}</h3>
        <LimitRows rows={rows.filter(row => row.provider === provider)} style={limitStyle} />
        {provider === 'claude' && <Row className="ob-limits-cost ob-meta"><span>{STRINGS.limits.sessionCost}</span>
          <span className="ob-num">{cost ? format(STRINGS.formats.usd, { value: cost.usd.toFixed(2) }) : STRINGS.status.unknown}</span></Row>}
      </Card>)}
    </div>
    <Card label={STRINGS.limits.history}>
      <h3>{STRINGS.limits.history}</h3>
      <FilterGroup label={STRINGS.devices.period} options={periods} value={period} onChange={setPeriod} />
      <div className="ob-limits-providers">
        {providers.map(([provider, name]) => {
          const history = limitHistory(snapshot, provider, period, now) as { windows: HistoryWindow[] };
          return <div key={provider}>
            <h4><ProviderDot provider={provider} />{name}</h4>
            {history.windows.length ? history.windows.map(window => <LineChart key={window.bucket + window.windowId}
              title={format(STRINGS.limits.chartTitle, { provider: name, window: window.label })}
              series={provider} data={window.points.map(({ label, value }) => ({ label, value }))} min={0} max={100} formatValue={percent} />)
              : <div className="ob-meta">{STRINGS.status.unknown}</div>}
          </div>;
        })}
      </div>
      <div className="ob-meta ob-limits-caveat">{STRINGS.limits.historyCaveat}{' '}
        <InfoControl label={STRINGS.limits.historyInfo} detail={STRINGS.limits.historyDetail} />
      </div>
    </Card>
    {peer && <Card label={format(STRINGS.limits.sharedFrom, { device: peer.device })}>
      <h3>{format(STRINGS.limits.sharedFrom, { device: peer.device })}</h3>
      <div className={peer.stale ? 'ob-meta warn' : 'ob-meta'} title={peer.observedAt ? new Date(peer.observedAt).toLocaleString() : undefined}>
        {peer.observedAt ? format(STRINGS.limits.observed, { span: span(now - Date.parse(peer.observedAt)) }) : STRINGS.limits.observationUnknown}
      </div>
      <LimitRows rows={peer.rows.map(row => ({ ...row, bucket: 'codex', stale: peer.stale, note: '' }))} style={limitStyle} />
    </Card>}
  </div>;
}

export default LimitsView;
