import { STRINGS } from '../../../lib/strings.generated';
import { compact, duration, format, freshness, limits, readingTime } from '../../../lib/panel-data.mjs';

export type LimitRow = { provider: string; name: string; window: string; remaining: number | null; note: string; low: boolean; stale: boolean };
export type DeviceToday = { host: string; name: string; missing?: boolean; collectedAt?: string | null; seconds: number | null; tokens: number | null; usd: number | null; screenTimeOn?: boolean; error?: string; freshness?: { stale: boolean };
  categories?: { name: string; seconds: number }[]; costs?: { codex?: number | null; claude?: number | null } };
export type Glance = {
  lowest: number | null;
  limits: LimitRow[]; today: DeviceToday[];
  both: { seconds: number | null; tokens: number | null; usd: number | null } | null;
};

const unknown = STRINGS.status.unknown;
const money = (value: number | null) => value === null ? unknown : format(STRINGS.formats.usd, { value: value < 100 ? value.toFixed(2) : Math.round(value).toLocaleString('en-US') });
const percent = (value: number | null) => value === null ? unknown : `${Math.round(value)}%`;

function LimitsCard({ glance, view, now }: { glance: Glance; view: Record<string, unknown> | null; now: number }) {
  const rows: LimitRow[] = view ? limits(view, now) as LimitRow[] : glance.limits;
  // Scarcest first. Limits without a current reading collapse into one quiet line.
  const current = rows.filter(row => row.remaining !== null && !row.stale).sort((a, b) => (a.remaining ?? 0) - (b.remaining ?? 0));
  const missing = rows.filter(row => row.remaining === null || row.stale);
  return (
    <section className="ob-tile" aria-labelledby="ob-tile-limits">
      <h2 id="ob-tile-limits">{STRINGS.overview.limitsTitle}</h2>
      <ul className="ob-tile-bars">
        {current.map((row, index) => (
          <li key={index}>
            <span className="ob-tile-label"><i className={`ob-dot ${row.provider}`} aria-hidden="true" />{row.name}{row.window ? <span className="ob-meta">&nbsp;{row.window}</span> : null}</span>
            <span className="ob-tile-value">
              {row.low && row.note ? <span className="ob-meta warn">{row.note}</span> : null}
              <span className={row.low ? 'ob-num warn' : 'ob-num'}>{percent(row.remaining)}</span>
            </span>
            <span className="ob-bar" aria-hidden="true"><i className={row.low ? 'warn' : row.provider} style={{ width: `${row.remaining}%` }} /></span>
          </li>
        ))}
        {missing.length > 0 && <li className="ob-tile-quiet ob-meta"><i className="ob-ring" aria-hidden="true" />
          {current.length === 0 ? STRINGS.overview.limitsNone
            : format(STRINGS.overview.limitsMissing, { names: missing.map(row => `${row.name} ${row.window}`.trim()).join(', ') })}</li>}
      </ul>
    </section>
  );
}

// A computer's today numbers count only while its own reading is from today and recent, judged when the page draws.
// The Mac panel uses the same rule.
export function deviceCurrent(device: DeviceToday, now: number) {
  const seen = Date.parse(device.collectedAt ?? '');
  return !device.missing && !device.freshness?.stale && Number.isFinite(seen) && !freshness(device.collectedAt ?? '', now).stale && sameDay(seen, now);
}

function deviceValue(device: DeviceToday, now: number, value: (device: DeviceToday) => string) {
  if (device.missing) return <span className="ob-meta" title={device.error ? format(STRINGS.today.unreachable, { reason: device.error }) : undefined}>{STRINGS.today.noSnapshot}</span>;
  if (deviceCurrent(device, now)) return <span className="ob-num">{value(device)}</span>;
  const seen = Date.parse(device.collectedAt ?? '');
  return <span className="ob-meta"><i className="ob-ring" aria-hidden="true" />{Number.isFinite(seen) ? format(STRINGS.overview.lastSeen, { time: readingTime(seen, now) }) : unknown}</span>;
}

function PerDevice({ glance, value, now }: { glance: Glance; value: (device: DeviceToday) => string; now: number }) {
  if (glance.today.length < 2) return null;
  return (
    <ul className="ob-tile-devices">
      {glance.today.map(device => <li key={device.host}><span>{device.name}</span>{deviceValue(device, now, value)}</li>)}
    </ul>
  );
}

function Breakdown({ rows }: { rows: [string, string, string?][] }) {
  if (rows.length === 0) return null;
  return (
    <ul className="ob-tile-devices">
      {rows.map(([label, value, dot]) => <li key={label}><span className="ob-tile-label">{dot ? <i className={`ob-dot ${dot}`} aria-hidden="true" /> : null}{label}</span><span className="ob-num">{value}</span></li>)}
    </ul>
  );
}

function AsOf({ now, generatedAt }: { now: number; generatedAt: number }) {
  if (!sameDay(generatedAt, now)) return <p className="ob-meta warn ob-tile-foot">{format(STRINGS.overview.lastDay, { time: readingTime(generatedAt, now) })}</p>;
  const old = now - generatedAt > 15 * 60000;
  return old ? <p className="ob-meta warn ob-tile-foot">{format(STRINGS.overview.asOf, { time: readingTime(generatedAt, now) })}</p> : null;
}

// "Today" numbers belong to the day they were made. From another day they are Unknown.
function sameDay(at: number, now: number) { return new Date(at).toDateString() === new Date(now).toDateString(); }

// The headline appears only when it is known. An Unknown total is left to the rows below it.
function Hero({ value, note }: { value: string | null; note?: string }) {
  return <>{value === null ? null : <div className="ob-hero">{value}</div>}{note ? <p className="ob-meta">{note}</p> : null}</>;
}

// A cross-computer total shows only when every computer it adds up is current and shown beside it.
const allCurrent = (glance: Glance, now: number) => glance.today.every(device => deviceCurrent(device, now));

function TimeCard({ glance, now, generatedAt }: { glance: Glance; now: number; generatedAt: number }) {
  const today = sameDay(generatedAt, now);
  const total = !today ? null : glance.both ? (allCurrent(glance, now) ? glance.both.seconds : null) : glance.today[0]?.seconds ?? null;
  return (
    <section className="ob-tile" aria-labelledby="ob-tile-time">
      <h2 id="ob-tile-time">{STRINGS.overview.timeTitle}</h2>
      <Hero value={total === null ? null : duration(total)} note={glance.both && total !== null ? STRINGS.overview.bothNote : undefined} />
      {glance.both ? <PerDevice glance={glance} now={now} value={device => device.screenTimeOn === false ? STRINGS.today.screenTimeOff : device.seconds === null ? unknown : duration(device.seconds)} />
        : today ? <Breakdown rows={(glance.today[0]?.categories ?? []).map(row => [row.name, duration(row.seconds)] as [string, string])} /> : null}
      <AsOf now={now} generatedAt={generatedAt} />
    </section>
  );
}

function CostCard({ glance, now, generatedAt }: { glance: Glance; now: number; generatedAt: number }) {
  const today = sameDay(generatedAt, now);
  const none = { usd: null, tokens: null };
  const source = !today ? none : glance.both ? (allCurrent(glance, now) ? glance.both : none) : glance.today[0] ?? none;
  const notes = [source.tokens === null ? '' : format(STRINGS.overview.tokens, { value: compact(source.tokens) }),
    glance.both && (source.usd !== null || source.tokens !== null) ? STRINGS.overview.bothNote : ''].filter(Boolean);
  return (
    <section className="ob-tile" aria-labelledby="ob-tile-cost">
      <h2 id="ob-tile-cost">{STRINGS.overview.costTitle}</h2>
      <Hero value={source.usd === null ? null : money(source.usd)} note={notes.join(' · ')} />
      {glance.both ? <PerDevice glance={glance} now={now} value={device => money(device.usd)} />
        : today ? <Breakdown rows={([['claude', STRINGS.providers.claudeCode], ['codex', STRINGS.providers.codex]] as const)
          .filter(([key]) => glance.today[0]?.costs?.[key] !== undefined)
          .map(([key, label]) => [label, money(glance.today[0]?.costs?.[key] ?? null), key] as [string, string, string])} /> : null}
      <AsOf now={now} generatedAt={generatedAt} />
    </section>
  );
}

export function Overview({ glance, view = null, generatedAt, now }: { glance: Glance; view?: Record<string, unknown> | null; generatedAt: string; now: number }) {
  const made = Date.parse(generatedAt);
  const at = Number.isFinite(made) ? made : 0;
  return (
    <div className="ob-overview">
      <LimitsCard glance={glance} view={view} now={now} />
      <TimeCard glance={glance} now={now} generatedAt={at} />
      <CostCard glance={glance} now={now} generatedAt={at} />
    </div>
  );
}
