import { useEffect, useRef, useState } from 'react';
import { STRINGS, format } from '../../../lib/strings.generated';
import { compact, today } from '../../../lib/panel-data.mjs';
import { driftView, lastDays, runLabel, METRICS, MIN_BASELINE_DAYS, MIN_REPLIES } from '../../../lib/drift.mjs';
import { Card } from '../components';
import './drift.css';

const DAYS = 30;
type Metric = typeof METRICS[number];
type Point = { date: string; value: number | null; center: number | null; low: number | null; high: number | null; replies: number; flagged: boolean };
type Flag = { date: string; metric: Metric; value: number; center: number; direction: 'up' | 'down'; effort: { now: { name: string }; before: { name: string } } | null };
type ModelDrift = { model: string; replies: number; series: Record<Metric, Point[]>; flags: Flag[] };

const LABELS: Record<Metric, string> = {
  thinking: STRINGS.drift.thinking, replySeconds: STRINGS.drift.replySeconds,
  outputTokens: STRINGS.drift.outputTokens, retries: STRINGS.drift.retries,
};
const round = (value: number) => value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
export function valueText(metric: Metric, value: number | null) {
  if (value === null) return STRINGS.status.unknown;
  if (metric === 'outputTokens') return compact(Math.round(value));
  if (metric === 'retries') return format(STRINGS.drift.perHundred, { value: round(value) });
  return format(STRINGS.drift.seconds, { value: round(value) });
}
// "claude-opus-5-5" reads as "Opus 5.5". Dated names keep their date off the title.
export function modelLabel(model: string) {
  const parts = model.replace(/^claude-/, '').replace(/-\d{8}$/, '').split('-');
  const name = parts.filter(part => !/^\d+$/.test(part)).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  const version = parts.filter(part => /^\d+$/.test(part)).join('.');
  return version ? `${name} ${version}` : name;
}
// Consecutive flagged days of one measure in the same direction read as one run, newest run first.
type Run = Flag & { first: string };
export function flagRuns(flags: Flag[]): Run[] {
  const runs: Run[] = [];
  const next = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  for (const flag of [...flags].sort((a, b) => a.metric.localeCompare(b.metric) || a.date.localeCompare(b.date))) {
    const last = runs.at(-1);
    if (last && last.metric === flag.metric && last.direction === flag.direction && next(last.date) === flag.date && !flag.effort && !last.effort)
      runs[runs.length - 1] = { ...flag, first: last.first };
    else runs.push({ ...flag, first: flag.date });
  }
  return runs.sort((a, b) => b.date.localeCompare(a.date) || METRICS.indexOf(a.metric) - METRICS.indexOf(b.metric));
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(120, Math.round(entries[0].contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

function Spark({ metric, points }: { metric: Metric; points: Point[] }) {
  const { ref, width } = useWidth();
  const height = 44, pad = 4;
  const values = points.flatMap(point => [point.value, point.high, point.low]).filter((value): value is number => value !== null);
  const top = Math.max(...values, 0) || 1;
  const x = (index: number) => pad + index * (width - 2 * pad) / Math.max(1, points.length - 1);
  const y = (value: number) => pad + (1 - value / top) * (height - 2 * pad);
  const band = points.map((point, index) => ({ index, point })).filter(({ point }) => point.low !== null && point.high !== null);
  const bandPath = band.length > 1 ? `M${band.map(({ index, point }) => `${x(index)},${y(point.high!)}`).join('L')}L${[...band].reverse().map(({ index, point }) => `${x(index)},${y(point.low!)}`).join('L')}Z` : '';
  // A day with too few replies is a gap in the line, not a zero.
  const segments: string[] = [];
  let current: string[] = [];
  points.forEach((point, index) => {
    if (point.value === null) { if (current.length) segments.push(current.join('L')); current = []; return; }
    current.push(`${x(index)},${y(point.value)}`);
  });
  if (current.length) segments.push(current.join('L'));
  return <div ref={ref} className="ob-drift-spark">
    <svg width={width} height={height}>
      <title>{format(STRINGS.drift.chart, { metric: LABELS[metric] })}</title>
      {bandPath && <path className="ob-drift-band" d={bandPath} />}
      {segments.map(segment => segment.includes('L') ? <path key={segment} className="ob-drift-line" d={`M${segment}`} />
        : <circle key={segment} className="ob-drift-solo" cx={Number(segment.split(',')[0])} cy={Number(segment.split(',')[1])} r={1.75} />)}
      {points.map((point, index) => point.flagged && point.value !== null
        ? <circle key={point.date} className="ob-drift-flag" cx={x(index)} cy={y(point.value)} r={3.5} /> : null)}
    </svg>
  </div>;
}

function MetricRow({ metric, points }: { metric: Metric; points: Point[] }) {
  const latest = [...points].reverse().find(point => point.value !== null) ?? null;
  const center = [...points].reverse().find(point => point.center !== null)?.center ?? null;
  return <div className="ob-drift-row">
    <div className="ob-drift-label">
      <span>{LABELS[metric]}</span>
      <span className={`ob-num${latest?.flagged ? ' warn' : ''}`}>{valueText(metric, latest?.value ?? null)}</span>
    </div>
    <Spark metric={metric} points={points} />
    <span className="ob-meta ob-drift-normal">{center === null ? '' : format(STRINGS.drift.normal, { value: valueText(metric, center) })}</span>
  </div>;
}

function ModelCard({ entry }: { entry: ModelDrift }) {
  const judged = METRICS.some(metric => entry.series[metric].some(point => point.center !== null));
  const busy = METRICS.some(metric => entry.series[metric].some(point => point.value !== null));
  return <Card title={modelLabel(entry.model)} label={modelLabel(entry.model)} className="ob-drift-card"
    aside={<span className="ob-meta">{format(STRINGS.drift.replies, { count: compact(entry.replies), days: DAYS })}</span>}>
    {!busy ? <p className="ob-meta">{format(STRINGS.drift.tooQuiet, { count: MIN_REPLIES })}</p> : <>
      {METRICS.map(metric => <MetricRow key={metric} metric={metric} points={entry.series[metric]} />)}
      {!judged ? <p className="ob-meta">{format(STRINGS.drift.learning, { days: MIN_BASELINE_DAYS })}</p>
        : <div className="ob-drift-flags">
          <h4>{STRINGS.drift.standout}</h4>
          {entry.flags.length === 0 ? <p className="ob-meta">{STRINGS.drift.noStandout}</p> : <ul>
            {flagRuns(entry.flags).map(flag => <li key={`${flag.date}-${flag.metric}`}>
              <span className="ob-num">{runLabel(flag.first, flag.date)}</span>
              <span>{format(STRINGS.drift.flag, { metric: LABELS[flag.metric], value: valueText(flag.metric, flag.value),
                direction: flag.direction === 'up' ? STRINGS.drift.higher : STRINGS.drift.lower, normal: valueText(flag.metric, flag.center) })}
                {flag.effort && <span className="ob-meta ob-drift-effort">{format(STRINGS.drift.effortShift, { now: flag.effort.now.name, before: flag.effort.before.name })}</span>}</span>
            </li>)}
          </ul>}
        </div>}
    </>}
  </Card>;
}

export function DriftView({ snapshot, now }: { snapshot: Record<string, unknown>; now: number }) {
  const rows = Array.isArray(snapshot.modelDrift) ? snapshot.modelDrift as { status?: string }[] : [];
  const dates = lastDays(today(typeof snapshot.timezone === 'string' ? snapshot.timezone : undefined, new Date(now)), DAYS);
  const models = driftView(rows, { dates }) as unknown as ModelDrift[];
  if (!models.length) {
    const failed = rows.some(row => row?.status === 'unavailable') && !rows.some(row => row?.status === 'ok');
    return <p className={failed ? 'ob-meta warn' : 'ob-meta'}>{failed ? STRINGS.drift.unavailable : format(STRINGS.drift.noData, { days: DAYS })}</p>;
  }
  return <div className="ob-drift">{models.map(entry => <ModelCard key={entry.model} entry={entry} />)}</div>;
}
