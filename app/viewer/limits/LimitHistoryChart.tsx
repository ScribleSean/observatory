import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { STRINGS } from '../../../lib/strings.generated';
import { format } from '../../../lib/panel-data.mjs';

type Point = { host: string; t: number; r: number; x: number; source: string };
type Series = { host: string; name: string; points: Point[]; segments: Point[][] };
export type HistoryData = { provider: string; window: string; range: string; from: number; to: number; series: Series[]; resets: number[]; firstAt: number | null; startsHere: boolean; empty: boolean };

const PAD = { left: 40, right: 12, top: 10, bottom: 26 };
const DASH: Record<string, string | undefined> = { Mac: undefined, Windows: '0.1 6' };

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(240, Math.round(entries[0].contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const stamp = (t: number) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
function tickLabel(t: number, span: number) {
  const date = new Date(t);
  if (span <= 36 * 3600000) return date.toLocaleTimeString([], { hour: 'numeric' });
  if (span <= 8 * 86400000) return date.toLocaleDateString([], { weekday: 'short', hour: 'numeric' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function readout(point: (Point & { name: string }) | undefined) {
  return point ? `${format(STRINGS.limitHistory.left, { value: Math.round(point.r) })}, ${point.name}, ${stamp(point.t)}` : null;
}

export function LimitHistoryChart({ data, color, title }: { data: HistoryData; color: 'claude' | 'codex'; title: string }) {
  const { ref, width } = useWidth();
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const HEIGHT = Math.round(Math.min(300, Math.max(168, width * 0.36)));
  const visible = data.series.filter(series => !hidden.includes(series.host));
  const plotWidth = width - PAD.left - PAD.right, plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const span = Math.max(1, data.to - data.from);
  const sx = (t: number) => PAD.left + (t - data.from) / span * plotWidth;
  const sy = (r: number) => PAD.top + (1 - r / 100) * plotHeight;
  const points = visible.flatMap(series => series.points.map(point => ({ ...point, name: series.name }))).sort((a, b) => a.t - b.t);
  const tickCount = Math.max(3, Math.min(6, Math.floor(plotWidth / 80)));
  const ticks = Array.from({ length: tickCount }, (_: unknown, index: number) => data.from + span * index / (tickCount - 1));
  const shown = active !== null ? points[active] ?? null : null;
  const others = shown ? visible.filter(series => series.host !== shown.host).flatMap(series => {
    const near = series.points.reduce<Point | null>((best, point) => !best || Math.abs(point.t - shown.t) < Math.abs(best.t - shown.t) ? point : best, null);
    return near && Math.abs(near.t - shown.t) <= Math.max(20 * 60000, span / 300) ? [{ ...near, name: series.name }] : [];
  }) : [];
  const toggle = (host: string) => { setActive(null); setHidden(list => list.includes(host) ? list.filter(item => item !== host) : [...list, host]); };

  const nearest = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const t = data.from + (event.clientX - box.left - PAD.left) / plotWidth * span;
    let best = -1, distance = Infinity;
    points.forEach((point, index) => { const d = Math.abs(point.t - t); if (d < distance) { distance = d; best = index; } });
    setActive(best >= 0 ? best : null);
  };
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!points.length) return;
    const last = points.length - 1, page = Math.max(1, Math.round(points.length / 10));
    const steps: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: page, PageDown: -page };
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setActive(event.key === 'Home' ? 0 : last);
    } else if (event.key in steps) {
      event.preventDefault();
      const step = steps[event.key];
      setActive(current => Math.max(0, Math.min(last, (current ?? (step > 0 ? -1 : points.length)) + step)));
    }
    if (event.key === 'Escape') setActive(null);
  };

  return (
    <figure className="ob-history-chart" ref={ref}>
      <span id={id} className="ob-visually-hidden">{title}</span>
      {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a drawn chart cannot be a native range input, so it takes the slider role */}
      <div className="ob-history-plot" role="slider" tabIndex={points.length ? 0 : -1} aria-labelledby={id}
        aria-valuemin={0} aria-valuemax={Math.max(0, points.length - 1)} aria-valuenow={active ?? Math.max(0, points.length - 1)}
        aria-valuetext={readout(shown ?? points.at(-1)) ?? STRINGS.limitHistory.noReadings}
        onPointerMove={nearest} onPointerLeave={() => setActive(null)} onKeyDown={keys} onBlur={() => setActive(null)}>
        <svg viewBox={`0 0 ${width} ${HEIGHT}`} width="100%" aria-hidden="true">
          {([0, 50, 100] as number[]).map(value => <g key={value} className="ob-history-grid">
            <line x1={PAD.left} x2={width - PAD.right} y1={sy(value)} y2={sy(value)} />
            <text x={PAD.left - 8} y={sy(value) + 4} textAnchor="end">{value}%</text>
          </g>)}
          {ticks.map((t, index) => <text key={index} className="ob-history-tick" x={sx(t)} y={HEIGHT - 6}
            textAnchor={index === 0 ? 'start' : index === ticks.length - 1 ? 'end' : 'middle'}>{tickLabel(t, span)}</text>)}
          {!data.empty && data.firstAt !== null && sx(data.firstAt) - PAD.left > 60 && <g className="ob-history-before">
            <rect x={PAD.left} y={PAD.top} width={sx(data.firstAt) - PAD.left} height={plotHeight} />
            <text x={PAD.left + (sx(data.firstAt) - PAD.left) / 2} y={PAD.top + plotHeight / 2} textAnchor="middle">
              {data.startsHere && sx(data.firstAt) - PAD.left > 150 ? format(STRINGS.limitHistory.startsAt, { time: stamp(data.firstAt) }) : STRINGS.limitHistory.noneBefore}</text>
          </g>}
          {data.resets.map(t => <line key={t} className="ob-history-reset" x1={sx(t)} x2={sx(t)} y1={PAD.top} y2={PAD.top + plotHeight}><title>{format(STRINGS.limitHistory.resetAt, { time: stamp(t) })}</title></line>)}
          {visible.map(series => series.segments.map((segment, index) => segment.length === 1
            ? <circle key={`${series.host}${index}`} cx={sx(segment[0].t)} cy={sy(segment[0].r)} r={2.5} className={`ob-history-dot ${color}`} />
            : <g key={`${series.host}${index}`}>
              {DASH[series.host] && <polyline className="ob-history-halo" strokeDasharray={DASH[series.host]}
                points={segment.map(point => `${sx(point.t).toFixed(1)},${sy(point.r).toFixed(1)}`).join(' ')} />}
              <polyline className={`ob-history-line ${color}${DASH[series.host] ? ' dotted' : ''}`} strokeDasharray={DASH[series.host]}
                points={segment.map(point => `${sx(point.t).toFixed(1)},${sy(point.r).toFixed(1)}`).join(' ')} />
            </g>))}
          {shown && <g className="ob-history-cursor">
            <line x1={sx(shown.t)} x2={sx(shown.t)} y1={PAD.top} y2={PAD.top + plotHeight} />
            {[shown, ...others].map(point => <circle key={point.host} cx={sx(point.t)} cy={sy(point.r)} r={4.5} className={color} />)}
          </g>}
          {data.empty && <text className="ob-history-empty" x={PAD.left + plotWidth / 2} y={PAD.top + plotHeight / 2} textAnchor="middle">{STRINGS.limitHistory.noReadings}</text>}
        </svg>
        {shown && <div className="ob-history-tip" style={{ left: Math.min(Math.max(sx(shown.t) - 90, 0), width - 188) }} aria-live="polite">
          <span>{stamp(shown.t)}</span>
          {[shown, ...others].map(point => <div key={point.host} className="ob-history-tip-row">
            <span>{point.name}</span><strong>{format(STRINGS.limitHistory.left, { value: Math.round(point.r) })}</strong>
          </div>)}
        </div>}
      </div>
      <figcaption className="ob-history-legend">
        {data.series.map(series => <button type="button" key={series.host} className="ob-history-key"
          aria-pressed={!hidden.includes(series.host)} disabled={data.series.length < 2}
          title={data.series.length < 2 ? undefined : format(STRINGS.limitHistory.toggle, { device: series.name })} onClick={() => toggle(series.host)}>
          <svg width="22" height="8" aria-hidden="true"><line x1="1" x2="21" y1="4" y2="4" className={`ob-history-line ${color}${DASH[series.host] ? ' dotted' : ''}`} strokeDasharray={DASH[series.host]} /></svg>
          {series.name}
        </button>)}
        {data.resets.length > 0 && <span><svg width="10" height="12" aria-hidden="true"><line x1="5" x2="5" y1="0" y2="12" className="ob-history-reset" /></svg>{STRINGS.limitHistory.reset}</span>}
        <details className="ob-history-values">
          <summary>{STRINGS.charts.showValues}</summary>
          <table>
            <thead><tr><th scope="col">{STRINGS.limitHistory.time}</th><th scope="col">{STRINGS.limitHistory.computer}</th><th scope="col">{STRINGS.limitHistory.remaining}</th></tr></thead>
            <tbody>{points.slice(-50).reverse().map((point, index) => <tr key={index}><td>{stamp(point.t)}</td><td>{point.name}</td><td>{Math.round(point.r)}%</td></tr>)}</tbody>
          </table>
        </details>
      </figcaption>
    </figure>
  );
}

export { clock };
