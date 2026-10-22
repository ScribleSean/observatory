import { useState } from 'react';
import { STRINGS, format } from '../../../lib/strings.generated';
import { compact } from '../../../lib/panel-data.mjs';
import { tokensView, money } from '../../../lib/view-tokens.mjs';
import { BarChart, Card, FilterGroup, InfoControl, ProviderDot, Row } from '../components';
import './tokens.css';

type Computed = ReturnType<typeof tokensView>;
type Block = Omit<Computed['codex'], 'models'> & {
  checkedOn: string | null;
  models: { model: string; total: number | null; usd: number | null }[];
};
type Result = Omit<Computed, 'claude' | 'codex'> & {
  codex: Block;
  claude: Block & {
    byDevice: { host: string; label: string; status: string; total: number | null; usd: number | null }[];
  };
};
const periods: [string, string][] = [
  ['day', STRINGS.periods.day], ['week', STRINGS.periods.week],
  ['month', STRINGS.periods.month], ['all', STRINGS.periods.all],
];
const classes = ['input', 'cached', 'cacheWrite', 'output'] as const;
const count = (value: number | null) => value === null ? STRINGS.status.unknown : compact(value);
const dollars = (usd: number | null) => {
  if (typeof usd === 'number' && Number.isFinite(usd) && usd > 0 && usd < 0.005) return STRINGS.tokens.underCent;
  const value = money(usd);
  return value === null ? STRINGS.status.unknown : format(STRINGS.formats.usd, { value });
};
const statusWord = (status: string) => status === 'no-records' ? STRINGS.status.noRecords
  : status === 'by-device' ? STRINGS.status.byDevice : STRINGS.status.unknown;
const statusNote = (status: string) => status === 'unverified' ? STRINGS.status.allUnverified
  : status === 'by-device' ? STRINGS.tokens.deviceNote
  : status === 'hourly-unavailable' ? STRINGS.status.hourlyUnavailable : null;
const recorded = (value: string) => value === 'unknown' ? STRINGS.status.unknown : value;

function ProviderCard({ result, provider }: { result: Result; provider: 'claude' | 'codex' }) {
  const block: Block = result[provider];
  const label = provider === 'claude' ? STRINGS.providers.claudeCode : STRINGS.providers.codex;
  const note = statusNote(block.status);
  const checked = block.checkedOn ? format(STRINGS.tokens.pricesChecked, { date: block.checkedOn }) : STRINGS.tokens.pricesUnknown;
  return <Card label={label}>
    <h3><ProviderDot provider={provider} />{label}</h3>
    <div className="ob-figure">{block.status === 'ok' ? count(block.totals.total) : statusWord(block.status)}</div>
    {note && <p className="ob-tokens-note">{note}</p>}
    {block.status !== 'by-device' && <>
    <h4>{STRINGS.tokens.classes}</h4>
    <dl className="ob-tokens-classes">{classes.map(key => <div key={key}>
      <dt>{STRINGS.tokens[key]}</dt><dd>{count(block.totals[key])}</dd>
    </div>)}</dl>
    <div className="ob-tokens-estimate">
      <Row><span>{STRINGS.tokens.apiEstimate}</span><span>{dollars(block.estimate.usd)}</span></Row>
      <p className="ob-tokens-note">{checked}</p>
      {block.estimate.partial && <p className="ob-tokens-note">{format(STRINGS.tokens.partial, {
        covered: count(block.estimate.coveredTokens), total: count(block.estimate.totalTokens),
      })}</p>}
    </div>
    </>}
    {provider === 'claude' && result.host === 'All' && result.claude.byDevice.length > 0 && <div className="ob-tokens-table">
      <table>
        <thead><tr><th scope="col">{STRINGS.devices.device}</th><th scope="col">{STRINGS.tokens.total}</th><th scope="col">{STRINGS.tokens.apiEstimate}</th></tr></thead>
        <tbody>{result.claude.byDevice.map(device => <tr key={device.host}>
          <th scope="row">{device.label}</th><td>{device.status === 'ok' ? count(device.total) : statusWord(device.status)}</td><td>{dollars(device.usd)}</td>
        </tr>)}</tbody>
      </table>
      <p className="ob-tokens-note">{checked}</p>
    </div>}
    {block.models.length > 0 && <div className="ob-tokens-table">
      <table>
        <caption>{STRINGS.tokens.byModel}</caption>
        <thead><tr><th scope="col">{STRINGS.tokens.model}</th><th scope="col">{STRINGS.tokens.total}</th><th scope="col">{STRINGS.tokens.apiEstimate}</th></tr></thead>
        <tbody>{block.models.map(model => <tr key={model.model}>
          <th scope="row">{recorded(model.model)}</th><td>{count(model.total)}</td><td>{dollars(model.usd)}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    {block.days.length > 0 && <BarChart title={format(STRINGS.tokens.chartTitle, { provider: label })}
      data={block.days.map(day => ({ label: day.date.slice(5), value: day.total }))} series={provider} formatValue={compact} />}
  </Card>;
}

export function TokensSection({ result, onHostChange, onPeriodChange }: {
  result: Result;
  onHostChange: (host: string) => void;
  onPeriodChange: (period: string) => void;
}) {
  return <div className="ob-tokens">
    <FilterGroup label={STRINGS.devices.device} value={result.host} onChange={onHostChange}
      options={[['All', STRINGS.devices.all], ...result.devices.map(device => [device.id, device.label] as [string, string])]} />
    <FilterGroup label={STRINGS.devices.period} value={result.period} onChange={onPeriodChange} options={periods} />
    <div className="ob-tokens-caveat"><p>{STRINGS.tokens.caveat}</p>
      <InfoControl label={STRINGS.tokens.caveatLabel} detail={STRINGS.tokens.caveatDetail} />
    </div>
    <div className="ob-tokens-providers">
      <ProviderCard result={result} provider="claude" />
      <ProviderCard result={result} provider="codex" />
    </div>
    <Card label={STRINGS.tokens.settingsTitle}>
      <h3>{STRINGS.tokens.settingsTitle}</h3>
      {result.settings.map(device => <div key={device.host} className="ob-tokens-settings">
        {result.settings.length > 1 && <h4>{device.label}</h4>}
        {device.status !== 'ok' ? <p>{device.status === 'no-records' ? STRINGS.tokens.noSettings : STRINGS.status.unknown}</p>
          : <div className="ob-tokens-table"><table>
            <thead><tr><th scope="col">{STRINGS.tokens.model}</th><th scope="col">{STRINGS.tokens.effort}</th><th scope="col">{STRINGS.tokens.speed}</th><th scope="col">{STRINGS.tokens.total}</th></tr></thead>
            <tbody>{device.rows.map((row, index) => <tr key={index}>
              <th scope="row">{recorded(row.model)}</th><td>{recorded(row.effort)}</td><td>{recorded(row.speed)}</td><td>{count(row.totalTokens)}</td>
            </tr>)}</tbody>
          </table></div>}
      </div>)}
    </Card>
  </div>;
}

export function TokensView({ snapshot, now, initialHost = 'All', initialPeriod = 'week' }: {
  snapshot: Record<string, unknown> | null;
  now: number;
  initialHost?: string;
  initialPeriod?: string;
}) {
  const [host, setHost] = useState(initialHost);
  const [period, setPeriod] = useState(initialPeriod);
  return <TokensSection result={tokensView(snapshot, { host, period, now }) as Result} onHostChange={setHost} onPeriodChange={setPeriod} />;
}
