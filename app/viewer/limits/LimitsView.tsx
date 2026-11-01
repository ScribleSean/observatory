import { useState } from 'react';
import { STRINGS, format } from '../../../lib/strings.generated';
import { limitRows, peerLimits } from '../../../lib/view-limits.mjs';
import { limitHistorySeries } from '../../../lib/view-limit-history.mjs';
import { LimitHistoryChart, type HistoryData } from './LimitHistoryChart';
import { span } from '../../../lib/panel-data.mjs';
import { Card, FilterGroup } from '../components';
import { limitTone } from '../components/Meter';
import { Note } from '../components/Note';
import { LimitRows } from '../components/LimitRows';
import './limits.css';

const providers = [['claude', STRINGS.providers.claudeCode], ['codex', STRINGS.providers.codex]] as const;
// The same period words as Activity and Tokens.
const ranges: [string, string][] = [['today', STRINGS.periods.day], ['week', STRINGS.periods.week], ['month', STRINGS.periods.month], ['all', STRINGS.periods.all]];
const windows = [['5h', STRINGS.limitHistory.fiveHour, '5-hour'], ['week', STRINGS.limitHistory.weekly, 'weekly']] as const;

type Row = ReturnType<typeof limitRows>[number];

// The card heading carries what is left now and when it resets, on the right.
function Latest({ row }: { row: Row | undefined }) {
  const value = row && row.remaining !== null && !row.stale ? row.remaining : null;
  const tone = value === null ? '' : limitTone(row!);
  return <span className="ob-history-latest">
    {row?.note && <Note className={row.stale ? 'ob-meta warn' : 'ob-meta'} text={row.note} />}
    <span className={value === null ? 'ob-num ob-unknown' : `ob-num ${tone}`.trim()}>{value === null ? (row as { absent?: string } | undefined)?.absent ?? STRINGS.status.unknown : format(STRINGS.limitHistory.left, { value: Math.round(value) })}</span>
  </span>;
}

export function LimitsView({ snapshot, now }: { snapshot: Record<string, unknown> | null; now: number }) {
  const [range, setRange] = useState('week');
  const rows = limitRows(snapshot, now);
  const peer = peerLimits(snapshot, now);
  return <div className="ob-limits">
    <section className="ob-history" aria-label={STRINGS.limitHistory.title}>
      <div className="ob-filters"><FilterGroup label={STRINGS.limitHistory.range} options={ranges} value={range} onChange={setRange} /></div>
      <div className="ob-history-grid-cards">
        {providers.flatMap(([provider, name]) => windows.map(([window, label, rowWindow]) => {
          const data = limitHistorySeries(snapshot, { provider, window, range, now });
          const title = format(STRINGS.limitHistory.chartTitle, { provider: name, window: label });
          return <Card key={provider + window} label={title} provider={provider}
            title={<>{name}<span className="ob-meta">{label}</span></>}
            aside={<Latest row={rows.find(row => row.provider === provider && row.window === rowWindow)} />}>
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
