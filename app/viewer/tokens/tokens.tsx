import { useState } from 'react';
import { STRINGS, format } from '../../../lib/strings.generated';
import { compact, usd } from '../../../lib/panel-data.mjs';
import { tokensView } from '../../../lib/view-tokens.mjs';
import { projectsView } from '../../../lib/view-projects.mjs';
import { ProjectsCard } from './projects';
import { BarChart, Card, DeviceShares, FilterGroup, Row, type ChartPoint } from '../components';
import './tokens.css';

type Computed = ReturnType<typeof tokensView>;
type Block = {
  status: string;
  totals: Record<'input' | 'cached' | 'cacheWrite' | 'output' | 'total', number | null>;
  estimate: { usd: number | null; coveredTokens: number | null; totalTokens: number | null; partial: boolean };
  checkedOn: string | null;
  note?: string;
  days: Day[];
  models: { model: string; total: number | null; usd: number | null }[];
  byDevice: { host: string; label: string; status: string; note?: string; total: number | null; usd: number | null }[];
  since: string | null;
};
type Result = Omit<Computed, 'claude' | 'codex'> & { codex: Block; claude: Block };
const periods: [string, string][] = [
  ['day', STRINGS.periods.day], ['week', STRINGS.periods.week],
  ['month', STRINGS.periods.month], ['all', STRINGS.periods.all],
];
const classes = ['input', 'cached', 'cacheWrite', 'output'] as const;
const count = (value: number | null) => value === null ? STRINGS.status.unknown : compact(value);
const statusWord = (status: string) => status === 'no-records' ? STRINGS.status.noRecords : STRINGS.status.unknown;
const shortDate = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const statusNote = (status: string) => status === 'hourly-unavailable' ? STRINGS.status.hourlyUnavailable : null;
const recorded = (value: string) => value === 'unknown' ? STRINGS.status.unknown : value;
const word = (value: string) => value === 'unknown' ? STRINGS.status.unknown : value.charAt(0).toUpperCase() + value.slice(1);
const hourLabel = (hour: number) => new Date(Date.UTC(2000, 0, 1, hour)).toLocaleTimeString('en-US', { hour: 'numeric', timeZone: 'UTC' });
const shiftDate = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

type Day = { date: string; total: number | null; hours?: (number | null | undefined)[] | null };

function chartData(days: Day[], period: string, anchor: string | null): ChartPoint[] | null {
  if (!anchor || !/^\d{4}-\d{2}-\d{2}$/.test(anchor)) return null;
  if (period === 'day') {
    const hours = days.find(day => day.date === anchor)?.hours;
    return hours ? hours.map((value, hour) => ({ label: hourLabel(hour), value })) : null;
  }
  const byDay = new Map(days.map(day => [day.date, day.total]));
  const first = days.map(day => day.date).filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort((a, b) => a.localeCompare(b))[0];
  if (!first) return null;
  const length = period === 'week' ? 7 : period === 'month' ? 30
    : Math.max(7, Math.round((Date.parse(`${anchor}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86400000) + 1);
  return Array.from({ length }, (_, index) => {
    const date = shiftDate(anchor, index - length + 1);
    return { label: date.slice(5), date, value: byDay.has(date) ? byDay.get(date) ?? null : undefined };
  });
}

function ProviderCard({ result, provider }: { result: Result; provider: 'claude' | 'codex' }) {
  const block: Block = result[provider];
  const label = provider === 'claude' ? STRINGS.providers.claudeCode : STRINGS.providers.codex;
  const notes = [statusNote(block.status), block.note].filter(Boolean);
  const checked = block.checkedOn ? format(STRINGS.tokens.pricesChecked, { date: block.checkedOn }) : STRINGS.tokens.pricesUnknown;
  const data = chartData(block.days, result.period, result.anchor);
  const chartTitle = format(result.period === 'day' ? STRINGS.tokens.hourlyTitle : STRINGS.tokens.chartTitle, { provider: label });
  const known = block.status === 'ok';
  const both = result.host === 'All' && block.byDevice.length > 1;
  const meta = [block.since ? format(STRINGS.formats.since, { date: shortDate(block.since) }) : '', both && known ? STRINGS.overview.bothNote : ''].filter(Boolean);
  return <Card label={label} title={label} provider={provider}>
    <div className="ob-tokens-head">
      <div className={known ? 'ob-hero' : 'ob-hero ob-unknown'}>{known ? count(block.totals.total) : statusWord(block.status)}</div>
      {meta.length > 0 && <p className="ob-meta">{meta.join(STRINGS.formats.separator)}</p>}
      {notes.map(note => <p key={note} className="ob-meta">{note}</p>)}
      {both && <DeviceShares color={provider} rows={block.byDevice.map((device: Block['byDevice'][number]) => ({ host: device.host, label: device.label,
        value: device.status === 'ok' ? device.total : null,
        text: device.status === 'ok' ? [count(device.total), usd(device.usd)].join(STRINGS.formats.separator) : device.note || statusWord(device.status) }))} />}
    </div>
    <div>{data && <BarChart quietTitle title={chartTitle} data={data} series={provider} formatValue={compact} />}</div>
    <details className="ob-disclosure ob-tokens-breakdown">
      <summary>{STRINGS.tokens.breakdown}</summary>
      <h4>{STRINGS.tokens.classes}</h4>
      <dl className="ob-tokens-classes">{classes.map(key => <div key={key}>
        <dt>{STRINGS.tokens[key]}</dt><dd>{count(block.totals[key])}</dd>
      </div>)}</dl>
      <div className="ob-tokens-estimate">
        <Row><span>{STRINGS.tokens.apiEstimate}</span><span className="ob-num">{usd(block.estimate.usd)}</span></Row>
        <p className="ob-meta">{checked}</p>
        {block.estimate.partial && <p className="ob-meta">{format(STRINGS.tokens.partial, {
          covered: count(block.estimate.coveredTokens), total: count(block.estimate.totalTokens),
        })}</p>}
      </div>
      {block.models.length > 0 && <div className="ob-tokens-table">
        <h4>{STRINGS.tokens.byModel}</h4>
        <table>
          <thead><tr><th scope="col">{STRINGS.tokens.model}</th><th scope="col">{STRINGS.tokens.total}</th><th scope="col">{STRINGS.tokens.apiEstimate}</th></tr></thead>
          <tbody>{block.models.map(model => <tr key={model.model}>
            <th scope="row">{recorded(model.model)}</th><td>{count(model.total)}</td><td>{usd(model.usd)}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    </details>
  </Card>;
}

export function TokensSection({ result, projects = [], onHostChange, onPeriodChange }: {
  result: Result;
  now?: number;
  projects?: ReturnType<typeof projectsView>;
  onHostChange: (host: string) => void;
  onPeriodChange: (period: string) => void;
}) {
  const showProjects = result.period === 'day' && projects.length > 0;
  return <div className="ob-tokens">
    <div className="ob-filters">
      {result.devices.length > 1 && <FilterGroup label={STRINGS.devices.device} value={result.host} onChange={onHostChange}
        options={[['All', STRINGS.devices.all], ...result.devices.map(device => [device.id, device.label] as [string, string])]} />}
      <FilterGroup label={STRINGS.devices.period} value={result.period} onChange={onPeriodChange} options={periods} />
    </div>
    <div className="ob-tokens-providers">
      <ProviderCard result={result} provider="claude" />
      <ProviderCard result={result} provider="codex" />
    </div>
    <div className="ob-tokens-lower">
      {showProjects && <ProjectsCard devices={projects} />}
      <Card label={STRINGS.tokens.settingsTitle} title={STRINGS.tokens.settingsTitle}>
        {result.settings.map(device => <div key={device.host} className="ob-tokens-settings">
          {result.settings.length > 1 && <h4>{device.label}</h4>}
          {device.status !== 'ok' ? <p className="ob-meta">{device.status === 'no-records' ? STRINGS.tokens.noSettings : STRINGS.status.unknown}</p>
            : <div className="ob-tokens-table"><table>
              <thead><tr><th scope="col">{STRINGS.tokens.model}</th><th scope="col">{STRINGS.tokens.effort}</th><th scope="col">{STRINGS.tokens.speed}</th><th scope="col">{STRINGS.tokens.total}</th></tr></thead>
              <tbody>{device.rows.map((row, index) => <tr key={index}>
                <th scope="row">{recorded(row.model)}</th><td>{word(row.effort)}</td><td>{word(row.speed)}</td><td>{count(row.totalTokens)}</td>
              </tr>)}</tbody>
            </table></div>}
        </div>)}
      </Card>
    </div>
  </div>;
}

export function TokensView({ snapshot, now, initialHost = 'All', initialPeriod = 'day' }: {
  snapshot: Record<string, unknown> | null;
  now: number;
  initialHost?: string;
  initialPeriod?: string;
}) {
  const [host, setHost] = useState(initialHost);
  const [period, setPeriod] = useState(initialPeriod);
  return <TokensSection result={tokensView(snapshot, { host, period, now }) as Result} projects={projectsView(snapshot, { host, now })} onHostChange={setHost} onPeriodChange={setPeriod} now={now} />;
}
