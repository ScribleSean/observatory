import { useState } from 'react';
import { STRINGS } from '../../../lib/strings.generated';
import { weekView, TABLE_ROWS } from '../../../lib/view-week.mjs';
import { FilterGroup } from '../components';
import './week.css';

type View = ReturnType<typeof weekView>;
type Open = (key: string) => void;

function LimitCard({ head, meters, onOpen }: { head: NonNullable<View['headline']>; meters: View['meters']; onOpen: Open }) {
  return <section className="ob-card wk-limit" aria-labelledby="wk-limit-title">
    <div className="wk-h"><h2 id="wk-limit-title">{head.title}</h2>{head.resets && <span>{head.resets}</span>}</div>
    <div className="wk-fore">
      <div className={`wk-big ${head.used === null ? 'ob-unknown' : head.tone}`.trim()} data-hero="">{head.usedText}</div>
      {head.say && <div className="wk-say">{head.say.lead}{head.say.when && <> <b>{head.say.when}</b></>}{head.say.tail && ` ${head.say.tail}`}</div>}
      {head.pill && <span className="wk-pill warn">{head.pill}</span>}
    </div>
    {head.used !== null && <div className="wk-stack">
      {head.segments.map(segment => <button key={segment.key} type="button" className={`sr-${segment.series}`} style={{ width: `${segment.share}%` }}
        aria-label={`${segment.label} ${segment.text}`} title={`${segment.label} ${segment.text}`} onClick={() => onOpen(segment.key)} />)}
      {head.rest && <i className="rest" style={{ width: `${head.rest.share}%` }} title={`${head.rest.label} ${head.rest.text}`} />}
      {head.segments.length === 0 && !head.rest && <i className={head.engine} style={{ width: `${head.used}%` }} />}
    </div>}
    {head.segments.length > 0 && <ul className="wk-legend">
      {head.segments.map(segment => <li key={segment.key}><button type="button" onClick={() => onOpen(segment.key)}>
        <i className={`wk-dot sr-${segment.series}`} aria-hidden="true" /><span className="wk-legend-name">{segment.label}</span><span className="ob-num">{segment.text}</span></button></li>)}
      {head.rest && <li><i className="wk-dot rest" aria-hidden="true" /><span className="wk-legend-name">{head.rest.label}</span><span className="ob-num">{head.rest.text}</span></li>}
    </ul>}
    {meters.length > 0 && <ul className="wk-meters" aria-label={STRINGS.week.otherLimits}>
      {meters.map(meter => <li key={meter.label}>
        <div className="wk-meter-top"><span><i className={`wk-dot ${meter.engine}`} aria-hidden="true" />{meter.label}</span>
          <span className={`ob-num ${meter.used === null ? 'ob-unknown' : meter.tone}`.trim()}>{meter.usedText}</span></div>
        <div className="wk-track" aria-hidden="true">{meter.used !== null && <i className={meter.engine} style={{ width: `${meter.used}%` }} />}</div>
        <div className="wk-when">{meter.resets}</div>
      </li>)}
    </ul>}
  </section>;
}

function Sessions({ view, onTool, onOpen, all, onAll }: { view: View; onTool: (id: string) => void; onOpen: Open; all: boolean; onAll: () => void }) {
  const table = view.table!;
  return <section className="ob-card wk-sessions" aria-labelledby="wk-sessions-title">
    <div className="wk-h"><h2 id="wk-sessions-title">{table.title}</h2>
      {view.tools.length > 1 && <FilterGroup label={STRINGS.week.tool} options={view.tools.map(tool => [tool.id, tool.name])} value={view.tool ?? ''} onChange={onTool} />}</div>
    <table>
      <thead><tr>
        <th scope="col">{STRINGS.week.session}</th>{table.machines && <th scope="col" className="c-machine">{STRINGS.week.machine}</th>}<th scope="col" className="c-models">{STRINGS.week.models}</th>
        <th scope="col" className="r c-subagents">{STRINGS.week.subagents}</th><th scope="col" className="r">{STRINGS.week.share}</th>
        <th scope="col">{STRINGS.week.shipped}</th><th scope="col" className="r c-change">{STRINGS.week.perChange}</th>
      </tr></thead>
      <tbody>
        {table.rows.map(row => <tr key={row.key}>
          <th scope="row"><a className="wk-clamp" href={`#session/${row.key}`} title={row.title} onClick={event => { event.preventDefault(); onOpen(row.key); }}>
            {row.running && <span className="wk-live"><span className="ob-visually-hidden">{STRINGS.week.runningNow}</span></span>}{row.title}</a></th>
          {table.machines && <td className="c-machine wk-muted">{row.machine}</td>}
          <td className="c-models"><span className="wk-mini" title={row.models.map(model => `${model.label} ${Math.round(model.part * 100)}%`).join(', ')}>
            {row.models.map(model => <i key={model.label} className={`md-${model.series}`} style={{ width: `${model.part * 100}%` }} />)}</span></td>
          <td className={`r c-subagents ${row.subagents === null ? 'ob-unknown' : ''}`.trim()}>{row.subagentsText}</td>
          <td className="r"><span className="wk-share">{row.bar !== null && <i aria-hidden="true" style={{ width: `${Math.max(3, row.bar * 48)}px` }} />}
            <span className={row.share === null ? 'ob-unknown' : ''}>{row.shareText}</span></span></td>
          <td><span className={`wk-pill ${row.shipped.tone}`}>{row.shipped.text}</span></td>
          <td className="r c-change wk-muted">{row.perChange}</td>
        </tr>)}
        {table.more && <tr className="wk-more">
          <th scope="row">{table.more.expandable ? <button type="button" aria-expanded={all} onClick={onAll}>{table.more.label}</button> : table.more.label}</th>
          {table.machines && <td className="c-machine">{' '}</td>}<td className="c-models">{' '}</td>
          <td className="r c-subagents">{table.more.subagentsText}</td><td className="r">{table.more.shareText}</td>
          <td>{table.more.shipped}</td><td className="r c-change">{table.more.perChange}</td>
        </tr>}
      </tbody>
    </table>
  </section>;
}

function Side({ view, onOpen }: { view: View; onOpen: Open }) {
  return <div className="wk-side">
    {view.shipped && <section className="ob-card" aria-labelledby="wk-shipped-title">
      <div className="wk-h"><h2 id="wk-shipped-title">{view.shipped.title}</h2></div>
      <dl className="wk-figures two">{view.shipped.figures.map(figure => <div key={figure.label}>
        <dd className={figure.value === STRINGS.status.unknown ? 'ob-unknown' : ''}>{figure.value}</dd><dt>{figure.label}</dt></div>)}</dl>
    </section>}
    {view.running && <section className="ob-card" aria-labelledby="wk-running-title">
      <div className="wk-h"><h2 id="wk-running-title">{STRINGS.week.running}</h2><span>{view.running.aside}</span></div>
      <ul className="wk-now">
        {view.running.rows.map(row => <li key={row.key}><button type="button" onClick={() => onOpen(row.key)}>
          <span className="wk-now-text"><span className="wk-clamp" title={row.title}>{row.title}</span>
            <span className="wk-now-meta">{row.meta.map((part, index) => <span key={index} className={row.warn && index === row.meta.length - 1 ? 'warn' : ''}>{index > 0 && ' · '}{part}</span>)}</span></span>
          <span className={`ob-num ${row.rate === null ? 'ob-unknown' : ''}`.trim()}>{row.rateText}</span></button></li>)}
        {view.running.others && <li className="wk-now-others"><span>{view.running.others.label}</span><span className="ob-num">{view.running.others.rateText}</span></li>}
      </ul>
    </section>}
    {view.flags.length > 0 && <section className="ob-card" aria-labelledby="wk-flags-title">
      <div className="wk-h"><h2 id="wk-flags-title">{STRINGS.week.flags}</h2></div>
      <ol className="wk-flags">{view.flags.map((flag, index) => <li key={flag.key}><button type="button" onClick={() => onOpen(flag.session)}>
        <span className={`wk-flag-mark ${flag.tone}`} aria-hidden="true">{index + 1}</span><span><b>{flag.lead}</b> {flag.rest}</span></button></li>)}</ol>
    </section>}
  </div>;
}

/** The home page. With no limit and no session to draw, it says so in one line. */
export function WeekView({ summary, now, period, onOpen }: { summary: Record<string, unknown>; now: number; period: 'current' | 'previous'; onOpen: Open }) {
  const [tool, setTool] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const view = weekView(summary, { tool, period, now, shown: all ? Infinity : TABLE_ROWS });
  if (!view.headline && view.meters.length === 0 && !view.table) return <output className="ob-first-run"><span className="ob-pulse" aria-hidden="true" /><h2>{STRINGS.firstRun.title}</h2></output>;
  const side = view.shipped || view.running || view.flags.length > 0;
  return <div className={`wk-home ${side ? '' : 'single'}`.trim()}>
    <div className="wk-main">
      {view.headline && <LimitCard head={view.headline} meters={view.meters} onOpen={onOpen} />}
      {view.table && <Sessions view={view} onTool={id => { setTool(id); setAll(false); }} onOpen={onOpen} all={all} onAll={() => setAll(value => !value)} />}
    </div>
    {side && <Side view={view} onOpen={onOpen} />}
  </div>;
}
