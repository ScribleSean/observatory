// Grok requests per day and its weekly limit when a reading is cached. Requests are never added to
// dollars or tokens. A day with no count read is drawn hollow and reads Unknown, never 0.
import type { GrokRequestsVM } from '../../../../lib/view-r2.mjs';
import { UNKNOWN, dayClock, plural, weekday } from '../views/parts';
import '../views/more.css';

function Spark({ days, tall = false }: { days: GrokRequestsVM['days']; tall?: boolean }) {
  // zero-ok: bar height scale only, an Unknown day draws hollow
  const top = Math.max(...days.map(day => day.value ?? 0), 1);
  return (
    <div className={tall ? "spark tall" : "spark"}>
      {days.map(day => day.value === null
        ? <i key={day.date} className="z unk" style={{ height: '100%' }} title={`${weekday(day.date, true)}: Unknown, not read`} />
        : <i key={day.date} className={day.value ? undefined : 'z'} style={{ height: `${day.value ? Math.max(6, 100 * day.value / top) : 3}%` }} title={`${weekday(day.date, true)}: ${plural(day.value, 'request')}`} />)}
    </div>
  );
}

/** "64% left, resets Sat 10 AM", or Unknown until the app caches a reading. */
export function weeklyText(weekly: GrokRequestsVM['weekly'], timeZone: string) {
  if (!weekly || weekly.remaining === null) return 'Unknown until the app caches it';
  return `${Math.round(weekly.remaining)}% left${weekly.resetsAt ? `, resets ${dayClock(weekly.resetsAt, timeZone)}` : ''}`;
}

/** The compact row in a limits block: the period's count, a bar per day and the weekly limit. */
export function GrokRequestsRow({ vm, label }: { vm: GrokRequestsVM; label: string }) {
  const total = vm.total.value;
  return (
    <div className="lim">
      <div className="h"><span>Grok requests</span><span>{label}</span></div>
      <div className="h" style={{ marginTop: 2 }}>
        {total === null ? <b className="unk">{UNKNOWN}</b> : <b>{total.toLocaleString('en-US')}<small>{total === 1 ? 'request' : 'requests'}</small></b>}
        <span>{vm.weekly && vm.weekly.remaining !== null ? `weekly limit ${Math.round(vm.weekly.remaining)}% left` : 'weekly limit Unknown'}</span>
      </div>
      <Spark days={vm.days} />
    </div>
  );
}

/** The Grok block on the Limits view: the last days as bars, then the facts under them. */
export function GrokRequests({ vm, timeZone, today }: { vm: GrokRequestsVM; timeZone: string; today: string }) {
  const week = vm.days.slice(-7), weekUnknown = week.some(day => day.value === null);
  // zero-ok: shown only when no day of the week is Unknown
  const weekTotal = week.reduce((sum, day) => sum + (day.value ?? 0), 0);
  // zero-ok: picks the largest day, never shown as a value
  const peak = week.reduce<{ date: string; value: number | null } | null>((best, day) => !best || (day.value ?? 0) > (best.value ?? 0) ? day : best, null);
  const yesterday = vm.days.filter(day => day.date < today).at(-1);
  return (
    <section className="blk s4" aria-label="Grok requests">
      <div className="bh"><h3>Grok</h3><span className="fa">requests per day, last {vm.days.length} days</span></div>
      <div className="bb">
        <Spark days={vm.days} tall />
        <div className="kv" style={{ marginTop: 'var(--sp-3)' }}>
          <span>Last 7 days</span>
          <span>{weekUnknown ? `${UNKNOWN}, a day was not read` : `${plural(weekTotal, 'request')}${peak && peak.value ? `, peak ${peak.value} on ${weekday(peak.date, true)}` : ''}`}</span>
          <span>Yesterday</span>
          <span>{!yesterday || yesterday.value === null ? UNKNOWN : plural(yesterday.value, 'request')}</span>
          <span>Weekly limit</span>
          <span>{weeklyText(vm.weekly, timeZone)}</span>
        </div>
      </div>
    </section>
  );
}
