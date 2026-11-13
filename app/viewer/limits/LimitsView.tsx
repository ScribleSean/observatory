import { useState } from 'react';
import { STRINGS, format } from '../../../lib/strings.generated';
import { limitRows, peerLimits } from '../../../lib/view-limits.mjs';
import { firstReadingDate, limitHistorySeries } from '../../../lib/view-limit-history.mjs';
import { LimitHistoryChart, type HistoryData } from './LimitHistoryChart';
import { span } from '../../../lib/panel-data.mjs';
import { Card, FilterGroup } from '../components';
import { LimitRows } from '../components/LimitRows';
import './limits.css';

const providers = [['claude', STRINGS.providers.claude], ['codex', STRINGS.providers.codex]] as const;
const ranges: [string, string][] = [['today', STRINGS.periods.day], ['week', STRINGS.periods.week], ['month', STRINGS.periods.month], ['all', STRINGS.periods.all]];
const windows = [['5h', STRINGS.limitHistory.fiveHour, '5-hour'], ['week', STRINGS.limitHistory.weekly, 'weekly'], ['month', STRINGS.limitHistory.monthly, '30-day']] as const;


export function LimitsView({ snapshot, now }: { snapshot: Record<string, unknown> | null; now: number }) {
  const [range, setRange] = useState('week');
  const rows = limitRows(snapshot, now);
  const peer = peerLimits(snapshot, now);
  const since = range === 'all' ? firstReadingDate(snapshot, now) : null;
  return <div className="ob-limits">
    <section className="ob-history" aria-label={STRINGS.limitHistory.title}>
      <div className="ob-filters"><FilterGroup label={STRINGS.limitHistory.range} options={ranges} value={range} onChange={setRange} />
        {since && <span className="ob-meta">{format(STRINGS.formats.since, { date: new Date(`${since}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) })}</span>}</div>
      <div className="ob-history-grid-cards">
        {providers.flatMap(([provider, name]) => windows.map(([window, label, rowWindow]) => {
          const data = limitHistorySeries(snapshot, { provider, window, range, now });
          const row = rows.find(item => item.provider === provider && item.window === rowWindow);
          // Only windows the provider reports now get a chart: an old window it no longer has is noise.
          if (!row || (row as { absent?: string }).absent || (data.empty && row.remaining === null)) return null;
          const title = format(STRINGS.limitHistory.chartTitle, { provider: name, window: label });
          return <Card key={provider + window} label={title} provider={provider}
            title={<>{name}<span className="ob-meta">{label}</span></>}
>
            <LimitHistoryChart data={data as unknown as HistoryData} color={provider} title={title} window={window} />
          </Card>;
        }))}
      </div>
    </section>
    {peer && <Card label={format(STRINGS.limits.sharedFrom, { device: peer.device })} title={format(STRINGS.limits.sharedFrom, { device: peer.device })}>
      <div className={peer.stale ? 'ob-meta warn' : 'ob-meta'} title={peer.observedAt ? new Date(peer.observedAt).toLocaleString() : undefined}>
        {peer.observedAt ? format(STRINGS.limits.observed, { span: span(now - Date.parse(peer.observedAt)) }) : STRINGS.limits.observationUnknown}
      </div>
      <div className="ob-peer-rows"><LimitRows rows={peer.rows.map(row => ({ ...row, bucket: 'codex', stale: peer.stale, note: '' }))} /></div>
    </Card>}
  </div>;
}

export default LimitsView;
