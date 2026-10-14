import { useState } from 'react';
import { STRINGS, format } from '../../../lib/strings.generated';
import { activityView } from '../../../lib/view-activity.mjs';
import { duration } from '../../../lib/panel-data.mjs';
import { Card, FilterGroup, InfoControl, Row, BarChart } from '../components';
import './activity.css';

type Props = { snapshot: Record<string, unknown> | null; now: number; initialHost?: string; initialPeriod?: string; initialDate?: string };
const formatTime = (time: string | null, zone: string | null) => {
  if (!time) return STRINGS.status.unknown;
  try {
    if (zone) return new Date(time).toLocaleString(undefined, { timeZone: zone, timeZoneName: 'short' });
  } catch { /* Fall back to the named local time zone. */ }
  return new Date(time).toLocaleString(undefined, { timeZoneName: 'short' });
};

export function ActivityView({ snapshot, now, initialHost = 'All', initialPeriod = 'day', initialDate }: Props) {
  const [host, setHost] = useState(initialHost);
  const [period, setPeriod] = useState(initialPeriod);
  const [date, setDate] = useState(initialDate);
  const view = activityView(snapshot, { host, period, date, now });
  const help = [view.tracking.detail,
    format(STRINGS.activity.lastCoverage, { time: formatTime(view.tracking.through, view.timeZone) }),
    format(STRINGS.activity.lastCollection, { time: formatTime(view.tracking.asOf, view.timeZone) }),
    STRINGS.activity.help, STRINGS.activity.helpAddress].join(' ');
  return <div className="ob-activity">
    <div className="ob-activity-filters">
      <FilterGroup label={STRINGS.devices.device} options={view.devices as [string, string][]} value={host} onChange={setHost} />
      <FilterGroup label={STRINGS.devices.period} options={Object.entries(STRINGS.periods)} value={period} onChange={setPeriod} />
      {['day', 'week', 'month'].includes(period) && <label>{STRINGS.activity.date}{' '}
        <select value={view.anchor} onChange={event => setDate(event.target.value)}>
          {view.dates.map(day => <option key={day} value={day}>{day}</option>)}
        </select>
      </label>}
    </div>
    <Card label={STRINGS.labels.screenTime}>
      <Row><span>{STRINGS.labels.screenTime}</span><span className="ob-num big">{duration(view.total)}</span></Row>
      {view.note && <p className="ob-meta">{view.note}</p>}
      {period === 'now' && view.total !== null && view.windowSeconds !== null && <div className="ob-activity-now">
        <div className="ob-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, view.total / view.windowSeconds * 100)}%`, background: 'var(--ob-accent)' }} /></div>
        <span className="ob-meta">{view.windowLabel}</span>
      </div>}
    </Card>
    <p className="ob-meta">{view.caveat}</p>
    <InfoControl label={STRINGS.activity.details} detail={view.info} />
    <div className="ob-activity-grid">
      <Card label={STRINGS.activity.dailyTitle}><BarChart title={STRINGS.activity.dailyTitle} data={view.series} series="accent" formatValue={duration} /></Card>
      {view.hourly !== null && <Card label={view.zoneLabel}><BarChart title={view.zoneLabel} data={view.hourly} series="accent" formatValue={duration} /></Card>}
      <Card label={STRINGS.activity.categoriesTitle}>
        <h3>{STRINGS.activity.categoriesTitle}</h3>
        {view.categories === null ? <p>{STRINGS.activity.noCategories}</p> : view.categories.map(category => <div key={category.name}>
          <Row><span>{category.label}</span><span className="ob-num">{duration(category.seconds)}</span></Row>
          {category.apps.length > 0 && <details><summary>{STRINGS.activity.recordedApps}</summary>
            {category.apps.map((app: { name: string; seconds: number }) => <Row key={app.name}><span>{app.name}</span><span className="ob-num">{duration(app.seconds)}</span></Row>)}
          </details>}
        </div>)}
        {view.noTracking && <p className="ob-meta">{STRINGS.activity.noTracking}</p>}
      </Card>
      <Card label={STRINGS.activity.trackingTitle}>
        <h3>{STRINGS.activity.trackingTitle}</h3>
        <p>{view.tracking.label}</p>
        <InfoControl label={STRINGS.activity.helpTitle} detail={help} />
      </Card>
    </div>
  </div>;
}
