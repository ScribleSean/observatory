import { useState } from 'react';
import { STRINGS } from '../../../lib/strings.generated';
import { historyView } from '../../../lib/view-history.mjs';
import { LimitsView } from '../limits/LimitsView';
import { ActivityView } from '../activity/ActivityView';
import { TokensView } from '../tokens/tokens';
import { DriftView } from '../drift/DriftView';
import { FilterGroup } from '../components';
import '../week/week.css';
import './history.css';

type View = ReturnType<typeof historyView>;
export const DETAILS = [['limits', STRINGS.sections.limits], ['activity', STRINGS.sections.activity], ['tokens', STRINGS.sections.tokens], ['drift', STRINGS.sections.drift]] as const;
export type Detail = typeof DETAILS[number][0];
const ALL_HOSTS = 'All';
const CELL = 18, SQUARE = 14, TOP = 18;

function Ticks({ ticks, count, last }: { ticks: { index: number; text: string }[]; count: number; last?: string }) {
  return <div className="hi-ticks" aria-hidden="true">
    {ticks.map(tick => <span key={tick.index} style={{ left: `${tick.index / count * 100}%` }}>{tick.text}</span>)}
    {last && <span className="end">{last}</span>}
  </div>;
}

function Heat({ data }: { data: View['heat'] }) {
  const width = data.weeks * CELL - (CELL - SQUARE), height = TOP + 7 * CELL - (CELL - SQUARE);
  return <div className="hi-heat">
    {/* Inline SVG needs an image role to expose its title as one graphic */}
    {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role */}
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="hi-heat-title">
      {data.months.map(month => <text key={month.week} x={month.week * CELL} y={10}>{month.text}</text>)}
      {data.cells.map(cell => <rect key={cell.date} x={cell.week * CELL} y={TOP + cell.weekday * CELL} width={SQUARE} height={SQUARE} rx={3}
        className={cell.level === null ? 'none' : `l${cell.level}`}><title>{cell.title}</title></rect>)}
    </svg>
  </div>;
}

function Models({ data }: { data: NonNullable<View['models']> }) {
  const W = 620, H = 180, last = data.count - 1;
  const x = (index: number) => W * index / last, y = (value: number) => H * (1 - value / (data.max * 1.08 || 1));
  const line = (values: number[]) => values.map((value, index) => `${x(index)},${y(value)}`);
  const areas = data.series.map(part => ({ d: `M${line(part.top).join(' L')} L${line(part.base).reverse().join(' L')}Z`, series: part.series, label: part.label }));
  return <>
    {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role */}
    <svg className="hi-area" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-labelledby="hi-models-title">
      {areas.map(area => <path key={area.label} d={area.d} className={`md-${area.series}`} />)}
    </svg>
    <Ticks ticks={data.ticks} count={last} last={data.last} />
    <ul className="wk-legend">{data.series.map(part => <li key={part.label}><i className={`wk-dot md-${part.series}`} aria-hidden="true" />{part.label}</li>)}</ul>
  </>;
}

function Hours({ data }: { data: NonNullable<View['hours']> }) {
  return <>
    {/* A chart made of bars reads as one picture. Its values are in the hover titles. */}
    {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role */}
    <div className="hi-bars tall" role="img" aria-labelledby="hi-hours-title">
      {data.bars.map((bar, hour) => <i key={hour} title={bar.label} style={{ height: `${bar.value / (data.max || 1) * 100}%`, opacity: 0.35 + 0.65 * bar.value / (data.max || 1) }} />)}
    </div>
    <Ticks ticks={data.ticks} count={24} />
  </>;
}

function Blocks({ data }: { data: NonNullable<View['blocks']> }) {
  // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
  return <div className="hi-blocks" role="img" aria-label={data.aside}>
    {data.days.map(day => <div key={day.id} className="hi-day" style={{ flexGrow: day.blocks.length }}>
      <div className="hi-bars">{day.blocks.map((block, index) => <i key={index} title={block.label} className={block.hit ? 'hit' : ''}
        style={{ height: `${Math.max(2, block.used)}%`, opacity: block.hit ? 0.9 : 0.4 + block.used / 170 }} />)}</div>
      <span>{day.label}</span>
    </div>)}
  </div>;
}

function Pair({ data }: { data: NonNullable<View['pair']> }) {
  return <>
    {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role */}
    <div className="hi-pair" role="img" aria-labelledby="hi-pair-title">
      {data.days.map(day => <div key={day.date} title={day.label}>
        <span className="up">{day.usd !== null && day.usd > 0 && <i style={{ height: `${day.usd / (data.maxUsd || 1) * 100}%` }} />}</span>
        <span className="down">{day.onMain !== null && day.onMain > 0 && <i style={{ height: `${day.onMain / (data.maxMain || 1) * 100}%` }} />}</span>
      </div>)}
    </div>
    <div className="hi-ticks ends" aria-hidden="true"><span>{data.first}</span><span className="end">{data.last}</span></div>
    <ul className="wk-legend"><li><i className="wk-dot claude" aria-hidden="true" />{STRINGS.history.spentKey}</li><li><i className="wk-dot accent" aria-hidden="true" />{STRINGS.history.shippedKey}</li></ul>
  </>;
}

export function HistoryView({ snapshot, now, range, detail, onDetail }: {
  snapshot: Record<string, unknown>; now: number; range: 'month' | 'year'; detail: Detail | null; onDetail: (detail: Detail | null) => void;
}) {
  const [engine, setEngine] = useState<string | null>(null);
  const view = historyView(snapshot, { range, engine, now });
  return <div className="hi">
    <section className="ob-card">
      <dl className="wk-figures row">{view.figures.map(figure => <div key={figure.label}>
        <dt>{figure.label}</dt><dd className={figure.value === STRINGS.status.unknown ? 'ob-unknown' : ''}>{figure.value}</dd></div>)}</dl>
    </section>
    <section className="ob-card" aria-labelledby="hi-heat-title">
      <div className="wk-h"><h2 id="hi-heat-title">{STRINGS.history.everyDay}</h2>
        <span className="hi-scale" aria-hidden="true">{STRINGS.history.less}{[0, 1, 2, 3, 4].map(level => <i key={level} className={`l${level}`} />)}{STRINGS.history.more}</span></div>
      <Heat data={view.heat} />
    </section>
    {(view.models || view.hours) && <div className="hi-wide">
      {view.models && <section className="ob-card" aria-labelledby="hi-models-title">
        <div className="wk-h"><h2 id="hi-models-title">{STRINGS.history.byModel}</h2></div><Models data={view.models} /></section>}
      {view.hours && <section className="ob-card" aria-labelledby="hi-hours-title">
        <div className="wk-h"><h2 id="hi-hours-title">{STRINGS.history.byHour}</h2></div><Hours data={view.hours} /></section>}
    </div>}
    {(view.blocks || view.pair) && <div className="hi-two">
      {view.blocks && <section className="ob-card" aria-labelledby="hi-blocks-title">
        <div className="wk-h"><h2 id="hi-blocks-title">{STRINGS.history.blocks}</h2>
          <span className="hi-aside">{view.blocks.aside}
            {view.engines.length > 1 && <FilterGroup label={STRINGS.history.engine} options={view.engines.map(entry => [entry.id, entry.name])} value={view.engine ?? ''} onChange={setEngine} />}</span></div>
        <Blocks data={view.blocks} /></section>}
      {view.pair && <section className="ob-card" aria-labelledby="hi-pair-title">
        <div className="wk-h"><h2 id="hi-pair-title">{STRINGS.history.spentShipped}</h2></div><Pair data={view.pair} /></section>}
    </div>}
    <nav className="hi-more" aria-label={STRINGS.sections.more}>
      <span className="ob-meta">{STRINGS.sections.more}</span>
      <FilterGroup label={STRINGS.sections.more} options={DETAILS.map(([id, name]) => [id, name])} value={detail ?? ''} onChange={id => onDetail(id === detail ? null : id as Detail)} />
    </nav>
    {detail && <section className="hi-detail" aria-label={DETAILS.find(([id]) => id === detail)![1]}>
      {detail === 'limits' ? <LimitsView snapshot={snapshot} now={now} />
        : detail === 'activity' ? <ActivityView snapshot={snapshot} now={now} initialHost={ALL_HOSTS} />
        : detail === 'drift' ? <DriftView snapshot={snapshot} now={now} />
        : <TokensView snapshot={snapshot} now={now} initialHost={ALL_HOSTS} />}
    </section>}
  </div>;
}
