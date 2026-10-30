import { useState } from 'react';
import { STRINGS, format } from '../../../lib/strings.generated';
import { limitRows, peerLimits } from '../../../lib/view-limits.mjs';
import { limitHistorySeries } from '../../../lib/view-limit-history.mjs';
import { LimitHistoryChart, type HistoryData } from './LimitHistoryChart';
import { span } from '../../../lib/panel-data.mjs';
import { Card, Row, ProviderDot, FilterGroup } from '../components';
import { LimitRows } from '../components/LimitRows';
import './limits.css';

const providers = [['claude', STRINGS.providers.claudeCode], ['codex', STRINGS.providers.codex]] as const;
const ranges: [string, string][] = [['today', STRINGS.limitHistory.today], ['week', STRINGS.limitHistory.week], ['month', STRINGS.limitHistory.month], ['all', STRINGS.limitHistory.all]];
const windows = [['5h', STRINGS.limitHistory.fiveHour, '5-hour'], ['week', STRINGS.limitHistory.weekly, 'weekly']] as const;
const percent = (value: number) => format(STRINGS.formats.percent, { value: Math.round(value) });

type Row = ReturnType<typeof limitRows>[number];

// The chart header carries what the old side cards said: how much is left now and when it resets.
function ChartHead({ provider, name, label, row }: { provider: string; name: string; label: string; row: Row | undefined }) {
  const value = row && row.remaining !== null && !row.stale ? row.remaining : null;
  return <div className="ob-history-head">
    <h4><ProviderDot provider={provider} />{name}<span className="ob-meta">{label}</span></h4>
    <div className="ob-history-latest">
      {row?.note && <span className={row.stale ? 'ob-meta warn' : 'ob-meta'}>{row.note}</span>}
      <span className={row?.low && value !== null ? 'ob-num warn' : 'ob-num'}>{value === null ? STRINGS.status.unknown : percent(value)}</span>
    </div>
  </div>;
}

export function LimitsView({ snapshot, now, limitStyle }: {
  snapshot: Record<string, unknown> | null;
  now: number;
  limitStyle: string;
}) {
  const [range, setRange] = useState('week');
  const rows = limitRows(snapshot, now);
  const peer = peerLimits(snapshot, now);
  return <div className="ob-limits">
    <section className="ob-history" aria-labelledby="ob-history-title">
      <Row><h3 id="ob-history-title">{STRINGS.limitHistory.title}</h3>
        <FilterGroup label={STRINGS.limitHistory.range} options={ranges} value={range} onChange={setRange} /></Row>
      <div className="ob-history-grid-cards">
        {providers.flatMap(([provider, name]) => windows.map(([window, label, rowWindow]) => {
          const data = limitHistorySeries(snapshot, { provider, window, range, now });
          const title = format(STRINGS.limitHistory.chartTitle, { provider: name, window: label });
          return <Card key={provider + window} label={title}>
            <ChartHead provider={provider} name={name} label={label} row={rows.find(row => row.provider === provider && row.window === rowWindow)} />
            <LimitHistoryChart data={data as unknown as HistoryData} color={provider} title={title} window={window} />
          </Card>;
        }))}
      </div>
    </section>
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
