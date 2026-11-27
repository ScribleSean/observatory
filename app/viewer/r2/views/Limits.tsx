// Limits: account wide, so the view ignores the device chips and the range. Each limit shows once, with
// the computer it was read on. Grok shows requests per day and its weekly limit, never dollars.
import type { Frame, GrokRequestsVM, LimitWindowVM, LimitsVM } from '../../../../lib/view-r2.mjs';
import type { Scope } from '../../../../lib/scope.mjs';
import { buildLimits, resolveBlock } from '../../../../lib/view-r2.mjs';
import { limitHistorySeries } from '../../../../lib/view-limit-history.mjs';
import { LimitMeter, NOT_REPORTED, windowNow, type Engine } from '../blocks/LimitMeter';
import { GrokRequests } from '../blocks/GrokRequests';
import { Block, BarList, Empty, StateView, Strip, Tail, UNKNOWN, addDays, clock, dateIn, dateSpan, dayClock, names, shortDate, span, weekday, type Cell, wholeTimes } from './parts';
import './more.css';

export type Reading = { at: number; used: number };
export type DevicePoints = { host: string; name: string; points: number | null };
export type LimitsData = {
  vm: LimitsVM; grok: GrokRequestsVM | null; readings: Reading[]; byDevice: DevicePoints[]; now: number; timeZone: string;
};

const HOUR = 3600000;
const pct = (value: number) => `${Math.round(value)}%`;
const weeklyOf = (engine: Engine | undefined) => engine?.windows.find(window => window.label === 'weekly' || /week|seven_day/.test(window.windowId));
const fiveHourOf = (engine: Engine | undefined) => engine?.windows.find(window => /5 hour|five_hour/.test(`${window.label} ${window.windowId}`));

/** Local midnight of a date in a time zone, as epoch milliseconds. */
export function midnight(date: string, timeZone: string) {
  const guess = Date.parse(`${date}T00:00:00Z`);
  const wall = (at: number) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(at).map(part => [part.type, part.value]));
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  };
  // Two passes settle a daylight saving change between the guess and the answer.
  const first = guess - (wall(guess) - guess);
  return guess - (wall(first) - first);
}

/** The past windows, newest first, with how each ended. A window at 100% at the reset ran out early. */
function pastRows(window: LimitWindowVM, timeZone: string) {
  const dayOf = (start: string) => start.length > 10 ? dateIn(Date.parse(start), timeZone) : start;
  return [...window.pastWindows].sort((a, b) => b.start.localeCompare(a.start)).map(past => ({
    key: dayOf(past.start), dates: dateSpan(dayOf(past.start), addDays(dayOf(past.start), 6)), used: past.used,
    ranOut: past.used !== null && past.used >= 100,
  }));
}

// A tag's height as a percent of the chart at its shortest (140px), so two tags never share a band at any width.
const TAG = 13;

/**
 * Where the "now" and "at the reset" tags start, as percents from the chart's top. The reset tag sits above its point,
 * or below it when the point is near the top. The now tag sits beside its point, or above or below it, whichever
 * keeps it out of the reset tag's band.
 */
export function tagTops(now: number, reset: number | null) {
  const resetTop = reset === null ? null : reset >= 1.2 * TAG ? reset - 1.1 * TAG : reset + 0.3 * TAG;
  const clear = (top: number) => resetTop === null || top + TAG <= resetTop || top >= resetTop + TAG;
  const nowTop = [now - 0.5 * TAG, now + 0.4 * TAG, now - 1.1 * TAG].find(clear) ?? resetTop! + TAG;
  return { now: nowTop, reset: resetTop };
}

/**
 * Where the weekly line ends and what its tag says, from the window's one stored reading and its freshness (the
 * view-model's `remaining` and `asOf`, through lib/forecast.mjs lastReading), so the strip and the chart never disagree.
 * A current reading ends at now and says "now". An old one ends when it was read and says "as of Wed 7:20 AM". With no
 * reading the value is Unknown, and the line stops at its last stored reading.
 */
export function burnEnd(window: LimitWindowVM, now: number): { at: number | null; used: number | null; tag: string } {
  const used = windowNow(window, now).used;
  if (used === null) return { at: null, used: null, tag: 'now' };
  if (!window.asOf) return { at: now, used, tag: 'now' };
  const read = window.checkedAt ? Date.parse(window.checkedAt) : NaN;
  return { at: Number.isFinite(read) && read <= now ? read : null, used, tag: window.asOf };
}

function Burn({ window, readings, now, timeZone }: { window: LimitWindowVM; readings: Reading[]; now: number; timeZone: string }) {
  const state = windowNow(window, now);
  if (state.reset === null || state.length === null) return <Empty title={UNKNOWN} line="The weekly window has no reset time yet." />;
  const start = state.reset - state.length;
  const x = (at: number) => Math.max(0, Math.min(1000, 1000 * (at - start) / state.length!));
  const y = (used: number) => 100 - Math.max(0, Math.min(100, used));
  const end = burnEnd(window, now);
  // Nothing is drawn after the reading the strip shows.
  const points = readings.filter(reading => reading.at >= start && reading.at <= (end.at ?? now)).sort((a, b) => a.at - b.at);
  if (end.used !== null) points.push({ at: end.at ?? points.at(-1)?.at ?? now, used: end.used });
  if (points.length === 0) return <Empty title="No readings yet" line="The line starts with the first reading of this window." />;
  const path = points.map((point, index) => `${index ? 'L' : 'M'}${x(point.at).toFixed(0)},${y(point.used).toFixed(1)}`).join(' ');
  const last = points.at(-1)!, nowX = x(last.at);
  const tags = tagTops(y(last.used), state.projected === null ? null : y(state.projected));
  const today = dateIn(now, timeZone);
  const ticks: { date: string; left: number }[] = [];
  for (let date = addDays(dateIn(start, timeZone), 1); ; date = addDays(date, 1)) {
    const at = midnight(date, timeZone);
    if (at >= state.reset) break;
    ticks.push({ date, left: (at - start) / state.length });
    if (ticks.length > 40) break;
  }
  return (
    <div className="burn">
      <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" y1="0" x2="1000" y2="0" stroke="var(--line-strong)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
        <line x1="0" y1="50" x2="1000" y2="50" stroke="var(--line-soft)" vectorEffect="non-scaling-stroke" />
        <line x1="0" y1="100" x2="1000" y2="100" stroke="var(--line)" vectorEffect="non-scaling-stroke" />
        <line x1="0" y1="100" x2="1000" y2="0" stroke="var(--line-strong)" vectorEffect="non-scaling-stroke" />
        <path d={`${path} L${nowX.toFixed(0)},100 L${x(points[0].at).toFixed(0)},100 Z`} fill="var(--track)" opacity=".55" />
        {state.projected !== null && <path d={`M${nowX.toFixed(0)},${y(last.used).toFixed(1)} L1000,${y(state.projected).toFixed(1)}`} fill="none" stroke="var(--g2)" strokeWidth="1.5" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}
        <path d={path} fill="none" stroke="var(--text)" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="y" style={{ top: 0 }}>100%</span><span className="y" style={{ top: '50%' }}>50%</span><span className="y" style={{ top: '100%' }}>0</span>
      {ticks.map(tick => <span key={tick.date} className={`x${tick.date === today ? ' now' : ''}`} style={{ left: `${100 * tick.left}%` }}>{weekday(tick.date).split(' ')[0]}<i> {weekday(tick.date).split(' ')[1]}</i></span>)}
      {end.used !== null && <i className="pt" style={{ left: `${nowX / 10}%`, top: `${y(last.used)}%` }} />}
      <span className="tagl" style={{ left: `${nowX / 10}%`, top: `${tags.now}%`, transform: nowX > 150 ? 'translateX(calc(-100% - 8px))' : 'translateX(8px)' }}><b>{end.used === null ? UNKNOWN : pct(end.used)}</b> <span className="fa">{end.tag}</span></span>
      {tags.reset !== null && <span className="tagl" style={{ right: 0, top: `${tags.reset}%` }}><b className="mu">{pct(state.projected!)}</b> <span className="fa">at the reset</span></span>}
    </div>
  );
}

export function LimitsBody({ vm, grok, readings, byDevice, now, timeZone }: LimitsData) {
  const claude = vm.engines.find(engine => engine.engine === 'claude');
  const codex = vm.engines.find(engine => engine.engine === 'codex');
  const weekly = weeklyOf(claude), fiveHour = fiveHourOf(claude);
  if (!claude && !codex && !grok) return <StateView title="No limits are on" line="Turn on claudeLimits, codexLimits or grokLimits under sources in observatory.config.json. See Settings." />;
  const state = weekly ? windowNow(weekly, now) : null;
  const past = weekly ? pastRows(weekly, timeZone) : [];
  const lastFour = past.slice(0, 4).filter(row => row.used !== null);
  const ranOut = lastFour.filter(row => row.ranOut);
  const five = fiveHour ? windowNow(fiveHour, now) : null;
  const readOn = weekly?.readOn ? `read on ${weekly.readOn}` : null;
  const lastWeek = grok?.days.slice(-7) ?? [];
  const grokWeek = lastWeek.some(day => day.value === null) ? null : lastWeek.reduce((sum, day) => sum + day.value!, 0);
  const cells: Cell[] = [
    state && state.used !== null
      ? { label: 'Claude Code weekly limit', value: pct(state.used), unit: 'used', accent: state.used >= 100 && !weekly?.asOf,
        // The stored reset label, never a countdown. An old reading says when it was read.
        context: wholeTimes(weekly?.asOf ?? weekly?.forecastResets ?? (state.reset ? `Resets ${dayClock(state.reset, timeZone, now)}` : readOn ?? '')) }
      : { label: 'Claude Code weekly limit', value: claude ? UNKNOWN : 'Off', unknown: true, context: claude ? weekly?.checkedAt ? `not reported since ${shortDate(dateIn(Date.parse(weekly.checkedAt), timeZone))}` : 'no reading yet' : 'turned off in settings' },
    state && state.gone !== null && state.length
      ? { label: 'Week gone', value: pct(100 * state.gone), context: `${span(state.gone * state.length)} of 7d` }
      : { label: 'Week gone', value: UNKNOWN, context: 'no reset time read' },
    state && state.projected !== null
      ? { label: 'Projected at the reset', value: pct(state.projected), accent: state.projected >= 100, context: weekly?.forecastText ? wholeTimes(weekly.forecastText) : UNKNOWN }
      : { label: 'Projected at the reset', value: UNKNOWN, context: 'not enough readings yet' },
    lastFour.length
      ? { label: 'Weeks that ran out early', value: String(ranOut.length), unit: `of the last ${lastFour.length}`, context: ranOut.length ? `last in the week of ${shortDate(ranOut[0].key)}` : 'every recorded week lasted' }
      : { label: 'Weeks that ran out early', value: UNKNOWN, context: 'no past weeks recorded' },
    fiveHour?.state === 'absent'
      ? { label: 'Claude Code 5 hour', value: NOT_REPORTED, unknown: true, context: '' }
      : five && five.used !== null
      ? { label: 'Claude Code 5 hour', value: pct(five.used), unit: 'used', context: wholeTimes(fiveHour?.asOf ?? fiveHour?.forecastResets ?? (five.reset ? `Resets ${dayClock(five.reset, timeZone, now)}` : '')) }
      : { label: 'Claude Code 5 hour', value: UNKNOWN, context: fiveHour?.checkedAt ? `not in the ${clock(fiveHour.checkedAt, timeZone, now)} read` : 'not reported by the app' },
    grok
      ? { label: 'Grok requests', value: grokWeek === null ? UNKNOWN : String(grokWeek), unit: 'last 7 days',
        context: grok.weekly && grok.weekly.remaining !== null ? `weekly limit ${Math.round(100 - grok.weekly.remaining)}% used` : 'weekly limit Unknown' }
      : { label: 'Grok', value: 'Off', unknown: true, context: 'off, or no requests read' },
  ];
  const stale = byDevice.filter(device => device.points === null).map(device => device.name);
  const pointsOk = byDevice.some(device => device.points !== null);
  const today = dateIn(now, timeZone);
  return (
    <div className="grid more">
      <p className="sayline" aria-label="Forecast">{wholeTimes(vm.headline)}</p>
      {claude?.signIn && (
        <Block span={12} title={`Claude Code is signed out on ${claude.signIn.on}`}>
          <Empty title="Sign in to read its limits" line={claude.signIn.line} />
        </Block>
      )}
      <Strip cells={cells} />
      {weekly && (
        <Block span={8} title="Will the week last?" sub={`Claude Code weekly${state?.reset && state.length ? `, ${dateSpan(dateIn(state.reset - state.length, timeZone), dateIn(state.reset, timeZone))}` : ''}${readOn ? `, ${readOn}` : ''}`}
          right={<span className="lg"><span><i style={{ background: 'var(--text)' }} />Used</span><span><i style={{ background: 'var(--g2)' }} />Projected</span><span><i style={{ background: 'var(--line-strong)' }} />Even pace</span></span>}>
          <div className="bb"><Burn window={weekly} readings={readings} now={now} timeZone={timeZone} /></div>
        </Block>
      )}
      {weekly && (
        <Block title="Past weeks" sub="used at the reset">
          {past.length === 0 ? <Empty title="No past weeks" line="A week shows here once its reset has passed." /> : (
            <div className="tw"><table><tbody>
              <tr><td className="name">{state?.reset && state.length ? dateSpan(dateIn(state.reset - state.length, timeZone), dateIn(state.reset - HOUR, timeZone)) : 'This week'}
                <div className="sub">{weekly?.forecastText ? wholeTimes(weekly.forecastText) : UNKNOWN}</div></td>
                {/* zero-ok: meter width only, the cell beside it reads Unknown */}
                <td style={{ width: '34%' }} aria-hidden="true"><div className="meter" style={{ margin: 0 }}><i style={{ width: `${state?.used ?? 0}%` }} /></div></td>
                <td className="r strong">{state?.used === null || !state ? UNKNOWN : pct(state.used)}</td></tr>
              {past.slice(0, 6).map(row => (
                <tr key={row.key}><td className="name">{row.dates}
                  <div className="sub">{row.used === null ? UNKNOWN : row.ranOut ? <span className="acc">Ran out before the reset</span> : 'Lasted to the reset'}</div></td>
                  {/* zero-ok: meter width only, the cell beside it reads Unknown */}
                  <td style={{ width: '34%' }} aria-hidden="true"><div className="meter" style={{ margin: 0 }}><i style={{ width: `${row.used ?? 0}%`, ...(row.ranOut ? { background: 'var(--accent)' } : {}) }} /></div></td>
                  <td className={`r strong${row.used === null ? ' fa' : ''}`}>{row.used === null ? UNKNOWN : pct(row.used)}</td></tr>
              ))}
            </tbody></table></div>
          )}
        </Block>
      )}
      <Tail>
      {weekly && (
        <Block title="This week by device" sub="points of the weekly limit"
          foot={stale.length ? <><span className="dot stale" />{names(stale)} could not be read for every day of this window</> : undefined}>
          <div className="bb">{pointsOk && state?.used !== null
            ? <BarList items={byDevice.map(device => ({ key: device.host, label: device.name, value: device.points }))} format={value => value === null ? UNKNOWN : value < 0.05 ? '0' : `${value.toFixed(1)} pts`} max={state?.used ?? 100} />
            : <Empty title={UNKNOWN} line="The weekly limit or this window's spend has not been read." />}</div>
        </Block>
      )}
      {grok && <GrokRequests vm={grok} timeZone={timeZone} today={today} now={now} />}
      {claude && (fiveHour && (five?.used !== null || fiveHour.state === 'absent')
        ? <Block title="Claude Code 5 hour"><LimitMeter engine={claude} windowId={fiveHour.windowId} now={now} timeZone={timeZone} /></Block>
        : <Block title="Claude Code 5 hour"><Empty title={UNKNOWN} line={fiveHour?.checkedAt ? `The app did not report this window in the ${clock(fiveHour.checkedAt, timeZone, now)} read. It shows here when it does.` : 'The app has not reported this window. It shows here when it does.'} /></Block>)}
      {codex && (
        <Block title={`Codex${codex.plan ? `, ${codex.plan} plan` : ''}`}>
          {codex.windows.length ? <LimitMeter engine={codex} now={now} timeZone={timeZone} /> : <Empty title={UNKNOWN} line="Codex has not reported a limit yet." />}
        </Block>
      )}
      </Tail>
    </div>
  );
}

/** Spend per computer since the window opened, as points of the weekly limit. Unknown for a computer with an unread day. */
export function devicePoints(view: { ledgerHistory?: { host: string; status?: string; days: { date: string; status: string; apiUsd: number | null }[] }[]; deviceNames?: Record<string, string> },
  window: LimitWindowVM | undefined, now: number, timeZone: string, off: string[] = []): DevicePoints[] {
  if (!window) return [];
  const state = windowNow(window, now);
  if (state.used === null || state.reset === null || state.length === null) return [];
  const first = dateIn(state.reset - state.length, timeZone), last = dateIn(now, timeZone);
  // A computer turned off adds nothing and is not listed. One whose history could not be read is Unknown, never 0.
  const rows = (view.ledgerHistory ?? []).filter(row => !off.includes(row.host) && row.status !== 'not-connected').map(row => {
    const days = row.days.filter(day => day.date >= first && day.date <= last);
    const unknown = (row.status !== undefined && row.status !== 'ok') || days.some(day => day.status !== 'ok' || day.apiUsd === null);
    // zero-ok: summed only when every day is known, else usd is null
    return { host: row.host, name: view.deviceNames?.[row.host] ?? row.host, usd: unknown ? null : days.reduce((sum, day) => sum + (day.apiUsd ?? 0), 0) };
  });
  // A share of an Unknown whole is Unknown, so one unread computer makes every part Unknown.
  if (rows.some(row => row.usd === null)) return rows.map(row => ({ host: row.host, name: row.name, points: null }));
  const total = rows.reduce((sum, row) => sum + row.usd!, 0);
  return rows.map(row => ({ host: row.host, name: row.name, points: total <= 0 ? null : state.used! * row.usd! / total }));
}

/** Readings of the Claude Code weekly limit as percent used, from the limit history the hub keeps. */
export function weeklyReadings(view: object, now: number): Reading[] {
  const series = limitHistorySeries(view, { provider: 'claude', window: 'week', range: 'week', now });
  return (series.series[0]?.points ?? []).map((point: { t: number; r: number }) => ({ at: point.t, used: 100 - point.r }));
}

export function Limits({ snapshot, scope, now }: { snapshot: { view: Record<string, unknown> & { timezone?: string }; devices?: { host: string; state?: string }[] }; scope: Scope; now: number }) {
  const vm = buildLimits(snapshot, scope, { now });
  const timeZone = (vm.frame as Frame).timeZone;
  const grok = vm.engines.some(engine => engine.engine === 'grok') ? resolveBlock('GrokRequests', { scope: { range: { unit: 'month' } } }, snapshot, scope, { now }) as GrokRequestsVM | null : null;
  const weekly = weeklyOf(vm.engines.find(engine => engine.engine === 'claude'));
  return <LimitsBody vm={vm} grok={grok} readings={weeklyReadings(snapshot.view, now)} byDevice={devicePoints(snapshot.view as never, weekly, now, timeZone, (snapshot.devices ?? []).filter(device => device.state === 'off').map(device => device.host))} now={now} timeZone={timeZone} />;
}
