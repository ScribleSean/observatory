import { useState } from 'react';
import { STRINGS } from '../../../lib/strings.generated';
import { dictationView } from '../../../lib/view-sources.mjs';
import { duration } from '../../../lib/panel-data.mjs';
import { Card, Row, FilterGroup, InfoControl, BarChart, EmptyState } from '../components';
import './dictation.css';

type ViewProps = { snapshot: Record<string, unknown> | null; now: number };
type PanelProps = ViewProps & {
  tool: string; host: string; period: string;
  onToolChange: (value: string) => void;
  onHostChange: (value: string) => void;
  onPeriodChange: (value: string) => void;
};

export function DictationPanel({ snapshot, now, tool, host, period, onToolChange, onHostChange, onPeriodChange }: PanelProps) {
  const view = dictationView(snapshot, { tool, host, period }, now);
  return <div className="ob-dictation">
    <FilterGroup label={STRINGS.dictation.tool} value={tool} onChange={onToolChange}
      options={[[ 'all', STRINGS.dictation.allTools ], ...view.tools.map((name: string): [string, string] => [name, name])]} />
    <FilterGroup label={STRINGS.devices.device} value={host} onChange={onHostChange}
      options={[[ 'all', STRINGS.dictation.allDevices ], ...view.devices.map((device: { id: string; label: string }): [string, string] => [device.id, device.label])]} />
    <FilterGroup label={STRINGS.devices.period} value={period} onChange={onPeriodChange}
      options={(['day', 'week', 'month', 'all'] as const).map(id => [id, STRINGS.periods[id]])} />
    <p className="ob-dictation-note">{STRINGS.dictation.caveat}{' '}<InfoControl label={STRINGS.dictation.info} detail={STRINGS.dictation.detail} /></p>
    {view.cards.length === 0 && <EmptyState text={STRINGS.dictation.noMatch} />}
    {view.cards.map(card => <Card key={card.key}>
      <h3>{card.tool}{STRINGS.formats.separator}{card.device}</h3>
      <Row><span>{card.statusWord}</span><time className="ob-meta" dateTime={card.check.iso ?? undefined} title={card.check.exact ?? undefined}>{card.check.label}</time></Row>
      {card.refusal && <p>{card.refusal}</p>}
      <dl>
        {[[STRINGS.dictation.records, card.records], [STRINGS.dictation.words, card.words], [STRINGS.dictation.audio, card.audio]].map(([label, value]) =>
          <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
      {card.chart.length > 0 && <BarChart title={STRINGS.dictation.chartTitle} data={card.chart} series="accent" formatValue={duration} />}
    </Card>)}
  </div>;
}

export function DictationView(props: ViewProps) {
  const [tool, setTool] = useState('all');
  const [host, setHost] = useState('all');
  const [period, setPeriod] = useState('week');
  return <DictationPanel {...props} tool={tool} host={host} period={period} onToolChange={setTool} onHostChange={setHost} onPeriodChange={setPeriod} />;
}
