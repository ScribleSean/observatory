import { useState } from 'react';
import { STRINGS, format } from '../../../lib/strings.generated';
import { limitRows, peerLimits } from '../../../lib/view-limits.mjs';
import { limitHistorySeries } from '../../../lib/view-limit-history.mjs';
import { LimitHistoryChart, type HistoryData } from './LimitHistoryChart';
import { span } from '../../../lib/panel-data.mjs';
import { Card, Row, ProviderDot, FilterGroup, InfoControl } from '../components';
import { LimitRows } from '../components/LimitRows';
import './limits.css';

const providers = [['claude', STRINGS.providers.claudeCode], ['codex', STRINGS.providers.codex]] as const;
const ranges: [string, string][] = [['today', STRINGS.limitHistory.today], ['week', STRINGS.limitHistory.week], ['month', STRINGS.limitHistory.month], ['all', STRINGS.limitHistory.all]];
const windows = [['5h', STRINGS.limitHistory.fiveHour], ['week', STRINGS.limitHistory.weekly]] as const;
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

// Limit % over time for each provider and window, one line per computer.
// The freshest reading leads each card, with the computer and time it came from.
function LimitHistorySection({ snapshot, now }: { snapshot: Record<string, unknown> | null; now: number }) {
  const [range, setRange] = useState('week');
  return <section className="ob-history" aria-labelledby="ob-history-title">
    <Row><h3 id="ob-history-title">{STRINGS.limitHistory.title}</h3>
      <FilterGroup label={STRINGS.limitHistory.range} options={ranges} value={range} onChange={setRange} /></Row>
    <div className="ob-history-grid-cards">
      {providers.flatMap(([provider, name]) => windows.map(([window, label]) => {
        const data = limitHistorySeries(snapshot, { provider, window, range, now });
        const latest = data.latest;
        const title = format(STRINGS.limitHistory.chartTitle, { provider: name, window: label });
        return <Card key={provider + window} label={title}>
          <div className="ob-history-head">
            <h4><ProviderDot provider={provider} />{name} <span className="ob-meta">{label}</span></h4>
            <div className="ob-history-latest">
              <span className="ob-num">{latest ? percent(latest.remaining) : STRINGS.status.unknown}</span>
              <span className="ob-meta">{latest ? format(STRINGS.limitHistory.from, { device: latest.name, time: new Date(latest.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }) : STRINGS.limitHistory.noReadings}</span>
            </div>
          </div>
          <LimitHistoryChart data={data as unknown as HistoryData} color={provider} title={title} />
        </Card>;
      }))}
    </div>
    <p className="ob-meta ob-limits-caveat">{STRINGS.limitHistory.caveat}{' '}
      <InfoControl label={STRINGS.limits.historyInfo} detail={STRINGS.limits.historyDetail} /></p>
  </section>;
}

export function LimitsView({ snapshot, now, limitStyle }: {
  snapshot: Record<string, unknown> | null;
  now: number;
  limitStyle: string;
}) {
  const rows = limitRows(snapshot, now);
  const peer = peerLimits(snapshot, now);
  // Where each provider's reading came from: the computer and the time it was observed.
  const names = (snapshot?.deviceNames ?? {}) as Record<string, string>;
  const origin = (provider: string) => {
    const source = (provider === 'claude' ? snapshot?.claudeLimits : snapshot?.quota) as { observedOn?: string; checkedAt?: string } | undefined;
    const at = Date.parse(source?.checkedAt ?? '');
    return source?.observedOn && Number.isFinite(at)
      ? format(STRINGS.limitHistory.from, { device: names[source.observedOn] ?? source.observedOn, time: new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) })
      : null;
  };
  return <div className="ob-limits">
    <div className="ob-limits-providers">
      {providers.map(([provider, name]) => <Card key={provider} label={name}>
        <div className="ob-limits-card-head">
          <h3><ProviderDot provider={provider} />{name}</h3>
          {origin(provider) && <span className="ob-meta">{origin(provider)}</span>}
        </div>
        {rows.filter(row => row.provider === provider).map((row, index) => <div key={index}
          className={row.low ? 'ob-limit-window warn' : 'ob-limit-window'} data-provider={provider} data-window={row.window || 'unknown'}>
          <div className="ob-limit-window-head">
            <span className="ob-limit-window-name">{row.window || STRINGS.status.unknownWindow}</span>
            <span className={row.low ? 'ob-num big warn' : 'ob-num big'}>{row.remaining === null ? STRINGS.status.unknown : percent(row.remaining)}</span>
          </div>
          {/* An Unknown value draws an empty track, never a bar at zero. */}
          <div className="ob-bar" aria-hidden="true">{row.remaining !== null && <i className={row.low ? 'warn' : provider} style={{ width: `${row.remaining}%`, opacity: row.stale ? 0.45 : 1 }} />}</div>
          <div className={row.stale ? 'ob-meta warn' : 'ob-meta'}>{row.note}</div>
          {row.remaining !== null && <div className="ob-meta">
            {/* The reset line already says when a projected window runs out, so the pace line does not repeat it. */}
            {[typeof row.pace?.ratePerHour === 'number' ? format(STRINGS.limits.perHour, { value: row.pace.ratePerHour > 0 && row.pace.ratePerHour < 0.05 ? STRINGS.limits.belowTenth : row.pace.ratePerHour.toFixed(1) }) : null,
              row.pace?.status === 'projected' ? null : paceSentence(row.pace)].filter(Boolean).join(STRINGS.formats.separator)}
          </div>}
        </div>)}
      </Card>)}
    </div>
    <LimitHistorySection snapshot={snapshot} now={now} />
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
