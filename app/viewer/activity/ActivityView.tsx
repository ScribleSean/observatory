import { useState } from 'react';
import { STRINGS } from '../../../lib/strings.generated';
import { activityView } from '../../../lib/view-activity.mjs';
import { duration } from '../../../lib/panel-data.mjs';
import { Card, FilterGroup, Row, BarChart } from '../components';
import './activity.css';

type Props = { snapshot: Record<string, unknown> | null; now: number; initialHost?: string; initialPeriod?: string; initialDate?: string };
const shortDate = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

// Steps through the recorded dates, newest on the right, in the same pill as the filters.
function DateStepper({ dates, value, onChange }: { dates: string[]; value: string; onChange: (date: string) => void }) {
  const index = dates.indexOf(value);
  return <div className="ob-segments ob-stepper">
    <button type="button" aria-label={STRINGS.activity.previousDay} disabled={index < 0 || index >= dates.length - 1} onClick={() => onChange(dates[index + 1])}>‹</button>
    <output aria-live="polite">{shortDate(value)}</output>
    <button type="button" aria-label={STRINGS.activity.nextDay} disabled={index <= 0} onClick={() => onChange(dates[index - 1])}>›</button>
  </div>;
}

export function ActivityView({ snapshot, now, initialHost = 'All', initialPeriod = 'day', initialDate }: Props) {
  const [host, setHost] = useState(initialHost);
  const [period, setPeriod] = useState(initialPeriod);
  const [date, setDate] = useState(initialDate);
  const view = activityView(snapshot, { host, period, date, now });
  const tracking = view.tracking.status === 'recent' ? null : view.tracking;
  return <div className="ob-activity">
    <div className="ob-filters">
      {view.devices.length > 2 && <FilterGroup label={STRINGS.devices.device} options={view.devices as [string, string][]} value={host} onChange={setHost} />}
      <FilterGroup label={STRINGS.devices.period} options={Object.entries(STRINGS.periods)} value={period} onChange={setPeriod} />
      {['day', 'week', 'month'].includes(period) && <DateStepper dates={view.dates as string[]} value={view.anchor as string} onChange={setDate} />}
    </div>
    <div className="ob-activity-grid">
      <Card label={STRINGS.labels.screenTime} title={STRINGS.labels.screenTime} className="ob-activity-summary">
        <div className={view.total === null ? 'ob-hero ob-unknown' : 'ob-hero'}>{duration(view.total)}</div>
        {period === 'now' && view.total !== null && view.windowSeconds !== null && <div className="ob-activity-now">
          <div className="ob-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, view.total / view.windowSeconds * 100)}%`, background: 'var(--ob-accent)' }} /></div>
          <span className="ob-meta">{view.windowLabel}</span>
        </div>}
        {view.note && <p className="ob-meta">{view.note}</p>}
        {tracking && <p className={tracking.status === 'unknown' ? 'ob-meta' : 'ob-meta warn'}>{tracking.label}
          {tracking.status === 'unavailable' && <>{STRINGS.formats.separator}<a href={`https://${STRINGS.activity.helpAddress}`} target="_blank" rel="noreferrer">{STRINGS.activity.helpAddress}</a></>}</p>}
        {/* The categories and their recorded apps sit under the total they add up to. */}
        {view.categories === null ? <p className="ob-meta">{STRINGS.activity.noCategories}</p> : <ul className="ob-activity-list">{view.categories.map(category => <li key={category.name}>
          {category.apps.length > 0 ? <details className="ob-disclosure">
            <summary><span>{category.label}</span><span className="ob-num">{duration(category.seconds)}</span></summary>
            <ul className="ob-activity-apps" aria-label={STRINGS.activity.recordedApps}>
              {category.apps.map((app: { name: string; seconds: number }) => <li key={app.name}><Row><span>{app.name}</span><span className="ob-num">{duration(app.seconds)}</span></Row></li>)}
            </ul>
          </details> : <Row><span>{category.label}</span><span className="ob-num">{duration(category.seconds)}</span></Row>}
        </li>)}</ul>}
        {view.noTracking && <p className="ob-meta">{STRINGS.activity.noTracking}</p>}
      </Card>
      {/* The chart follows the period: one day by hour, a range by day. */}
      {view.hourly === null && <Card label={STRINGS.activity.dailyTitle}><BarChart title={STRINGS.activity.dailyTitle} data={view.series} series="accent" formatValue={duration} /></Card>}
      {view.hourly !== null && <Card label={view.hourlyTitle}><BarChart title={view.hourlyTitle} data={view.hourly} series="accent" formatValue={duration} /></Card>}
    </div>
  </div>;
}
