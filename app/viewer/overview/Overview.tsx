import { STRINGS } from '../../../lib/strings.generated';
import { compact, duration, format, limits, readingTime } from '../../../lib/panel-data.mjs';

export type LimitRow = { provider: string; name: string; window: string; remaining: number | null; note: string; low: boolean; stale: boolean };
export type DeviceToday = { host: string; name: string; missing?: boolean; collectedAt?: string | null; seconds: number | null; tokens: number | null; usd: number | null; screenTimeOn?: boolean; error?: string;
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
  const current = rows.filter(row => row.remaining !== null && !row.stale);
  const lowest = current.reduce<LimitRow | null>((low, row) => low === null || (row.remaining ?? 101) < (low.remaining ?? 101) ? row : low, null);
  return (
    <section className="ob-tile" aria-labelledby="ob-tile-limits">
      <h2 id="ob-tile-limits">{STRINGS.overview.limitsTitle}</h2>
      <div className={lowest?.low ? 'ob-hero warn' : 'ob-hero'}>{percent(lowest?.remaining ?? null)}</div>
      <p className="ob-meta">{lowest ? format(STRINGS.overview.limitsCaption, { name: `${lowest.name} ${lowest.window}` }) : STRINGS.overview.limitsNone}</p>
      <ul className="ob-tile-bars">
        {rows.map((row, index) => (
          <li key={index}>
            <span className="ob-tile-label"><i className={`ob-dot ${row.provider}`} aria-hidden="true" />{row.name}{row.window ? ` ${row.window}` : ''}</span>
            <span className={row.stale ? 'ob-num ob-meta' : row.low ? 'ob-num warn' : 'ob-num'}>{percent(row.remaining)}</span>
            <span className="ob-bar" aria-hidden="true">{row.remaining !== null && <i className={row.low ? 'warn' : row.provider} style={{ width: `${row.remaining}%`, opacity: row.stale ? 0.45 : 1 }} />}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PerDevice({ glance, value }: { glance: Glance; value: (device: DeviceToday) => string; now?: number }) {
  if (glance.today.length < 2) return null;
  return (
    <ul className="ob-tile-devices">
      {glance.today.map(device => <li key={device.host}><span>{device.name}</span><span className="ob-num">{device.missing ? unknown : value(device)}</span></li>)}
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

function AsOf({ glance, now, generatedAt, onlyWhenOld = false }: { glance: Glance; now: number; generatedAt: number; onlyWhenOld?: boolean }) {
  if (!sameDay(generatedAt, now)) return <p className="ob-meta warn ob-tile-foot">{format(STRINGS.overview.lastDay, { time: readingTime(generatedAt, now) })}</p>;
  const at = Date.parse(glance.today[0]?.collectedAt ?? '');
  const old = now - generatedAt > 15 * 60000;
  return ((glance.today.length === 1 && !onlyWhenOld) || old) && Number.isFinite(at)
    ? <p className={old ? 'ob-meta warn ob-tile-foot' : 'ob-meta ob-tile-foot'}>{format(STRINGS.overview.asOf, { time: readingTime(old ? generatedAt : at, now) })}</p> : null;
}

// "Today" numbers belong to the day they were made. From another day they are Unknown.
function sameDay(at: number, now: number) { return new Date(at).toDateString() === new Date(now).toDateString(); }

function TimeCard({ glance, now, generatedAt }: { glance: Glance; now: number; generatedAt: number }) {
  const today = sameDay(generatedAt, now);
  const total = !today ? null : glance.both ? glance.both.seconds : glance.today[0]?.seconds ?? null;
  return (
    <section className="ob-tile" aria-labelledby="ob-tile-time">
      <h2 id="ob-tile-time">{STRINGS.overview.timeTitle}</h2>
      <div className="ob-hero">{total === null ? unknown : duration(total)}</div>
      <p className="ob-meta">{glance.both ? STRINGS.overview.bothNote : STRINGS.overview.topApps}</p>
      {glance.both ? <PerDevice glance={glance} now={now} value={device => device.screenTimeOn === false ? STRINGS.today.screenTimeOff : device.seconds === null ? unknown : duration(device.seconds)} />
        : <Breakdown rows={(glance.today[0]?.categories ?? []).map(row => [row.name, duration(row.seconds)] as [string, string])} />}
      <AsOf glance={glance} now={now} generatedAt={generatedAt} />
    </section>
  );
}

function CostCard({ glance, now, generatedAt }: { glance: Glance; now: number; generatedAt: number }) {
  const today = sameDay(generatedAt, now);
  const source = !today ? { usd: null, tokens: null } : glance.both ?? glance.today[0] ?? { usd: null, tokens: null };
  return (
    <section className="ob-tile" aria-labelledby="ob-tile-cost">
      <h2 id="ob-tile-cost">{STRINGS.overview.costTitle}</h2>
      <div className="ob-hero">{money(source.usd)}</div>
      <p className="ob-meta">{format(STRINGS.overview.tokens, { value: compact(source.tokens) })}{glance.both ? ` · ${STRINGS.overview.bothNote}` : ''}</p>
      {glance.both ? <PerDevice glance={glance} now={now} value={device => money(device.usd)} />
        : <Breakdown rows={([['claude', STRINGS.providers.claudeCode], ['codex', STRINGS.providers.codex]] as const)
          .filter(([key]) => glance.today[0]?.costs?.[key] !== undefined)
          .map(([key, label]) => [label, money(glance.today[0]?.costs?.[key] ?? null), key] as [string, string, string])} />}
      <AsOf glance={glance} now={now} generatedAt={generatedAt} onlyWhenOld />
      <p className="ob-meta ob-tile-foot">{STRINGS.overview.costCaption}</p>
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
