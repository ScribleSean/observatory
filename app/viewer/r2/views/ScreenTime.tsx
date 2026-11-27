// Screen time: follows the device chips and the range. A day with tracking off is Unknown on its own, and a
// longer period adds the tracked days only. There is no block that splits spend by screen on or off: no
// data joins spend to screen time yet, so the view does not guess one.
import type { Frame, MyAppsVM, Num, ScreenTimeVM } from '../../../../lib/view-r2.mjs';
import type { ConfigEcho } from '../../../../lib/r2-shape.mjs';
import type { Scope } from '../../../../lib/scope.mjs';
import { buildScreenTime, metric } from '../../../../lib/view-r2.mjs';
import { Block, BarList, Columns, Side, StateView, Strip, UNKNOWN, bucketWord, clock, dateIn, dayColumns, hours, labelSteps, money, names, partBars, plural, share, timeAxis, type Cell, type Column } from './parts';
import './more.css';

export type ScreenTimeData = { vm: ScreenTimeVM; spend: Num | null; config: ConfigEcho[]; now: number };

const AI = 'AI apps';

export function ScreenTimeBody({ vm, spend, config, now }: ScreenTimeData) {
  const frame = vm.frame as Frame, { period } = frame, timeZone = frame.timeZone;
  const selected = frame.devices.filter(device => device.selected);
  const on = (host: string) => config.find(row => row.host === host)?.sources.screenTime === true;
  const tracked = selected.filter(device => on(device.host)), off = selected.filter(device => !on(device.host));
  if (tracked.length === 0) {
    if (selected.length === 1) return <StateView title={`Off on ${selected[0].name}`} line="Screen time is not collected on this computer. Turn it on with sources.screenTime in its observatory.config.json." />;
    return <StateView title="Screen time is off" line="Turn it on with sources.screenTime in observatory.config.json on each computer. See Settings." />;
  }
  const staleToday = period.unit === 'day' && period.current && tracked.length === 1 && tracked[0].state === 'stale';
  if (staleToday) return <StateView title={UNKNOWN} line={`${tracked[0].name} was last read at ${clock(tracked[0].since, timeZone, now)} and has no screen time for today yet.`} />;
  const total = vm.total.value;
  if (total === 0) return <StateView title="No screen time" line={`Nothing was tracked in ${period.label}.`} />;
  const trackedDays = vm.days.filter(day => day.tracked && day.seconds.value !== null).length;
  const categories = vm.total.breakdowns.category ?? [];
  const ai = categories.find(part => part.key === AI || part.label === AI);
  const spendHour = spend && spend.value !== null && total ? spend.value / (total / 3600) : null;
  const cells: Cell[] = [
    { label: 'Screen time', value: hours(total), context: `${period.label}, ${names(tracked.map(device => device.name))}${vm.total.sumLabel ? `, ${vm.total.sumLabel}` : ''}` },
    { label: 'Per day', value: total === null || !trackedDays ? UNKNOWN : hours(total / trackedDays), context: trackedDays ? `average over ${plural(trackedDays, 'tracked day')}` : 'no tracked day' },
    { label: 'In AI apps', value: ai && ai.value !== null && total ? share(ai.value, total) : UNKNOWN, unit: 'of screen time', context: ai ? hours(ai.value) : 'not tracked by kind of app' },
    { label: 'Spend per screen hour', mark: true, value: money(spendHour), context: 'agents also run while the screen is off' },
  ];
  const stale = tracked.filter(device => device.state === 'stale');
  const footParts = [
    ...(selected.length > 1 && off.length ? [`${names(off.map(device => device.name))} ${off.length === 1 ? 'has' : 'have'} screen time off`] : []),
    ...stale.map(device => `${device.name} was last read at ${clock(device.since, timeZone, now)}`),
  ];
  const foot = footParts.length ? <>{stale.length > 0 && <span className="dot stale" />}{tracked.length < selected.length ? `${names(tracked.map(device => device.name))} only. ` : ''}{footParts.join('. ')}.</> : undefined;
  const today = dateIn(now, timeZone);
  const hourly = period.unit === 'day';
  const columns: Column[] = hourly
    ? (vm.hours ?? Array(24).fill(null)).map((value, hour) => ({ key: String(hour), label: hour === 0 ? '12a' : hour === 12 ? '12p' : hour < 12 ? `${hour}a` : `${hour - 12}p`, n: hour,
      value: vm.hours ? value : null, full: `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}` }))
    : dayColumns(period, new Map(vm.days.map(day => [day.date, day.tracked === false ? 0 : day.seconds.value])), today);
  return (
    <div className="grid more">
      <Strip cells={cells} foot={foot} four />
      <Block span={8} title="Hours at the screen" sub={`per ${bucketWord(period.unit)}, ${names(tracked.map(device => device.name))}`}>
        <Columns columns={columns} format={hours} axis={timeAxis} steps={hourly ? [1, 3, 6, 12] : labelSteps(period.unit)} hint={hourly ? 'Hover a bar for its minutes' : 'Hover a bar for its hours'} />
      </Block>
      <Side><Block span={4} title="By kind of app" sub="share of screen time">
        <div className="bb kinds">{categories.length ? <BarList items={partBars(categories)} format={hours} /> : <div className="fa">Not tracked by kind of app on these computers.</div>}</div>
      </Block></Side>
      <MyApps vm={vm.myApps} period={period.label} />
    </div>
  );
}

const signed = (seconds: number) => `${seconds > 0 ? '+' : seconds < 0 ? '−' : '±'}${hours(Math.abs(seconds))}`;

/** Time per "my apps" label, its change on the earlier period, a bar per day, week or month, and its share of screen
 * time. Beside it, how much browser time the rules matched. Both count the labeled days only, and say so when some
 * days in the range are not labeled. */
function MyApps({ vm, period }: { vm: MyAppsVM; period: string }) {
  const partly = vm.unlabeledDays > 0;
  const only = vm.only ? `${names(vm.only)} only` : null;
  const sub = vm.rows.length ? [period, only, vm.compareLabel].filter(Boolean).join(', ') : only ?? undefined;
  // zero-ok: bar height scale only
  const top = Math.max(...vm.rows.flatMap(row => row.days.map(day => day.seconds ?? 0)), 1);
  const empty = !vm.rules ? 'No apps named yet.' : !vm.labeledDays ? `Not labeled for ${period}.` : `None of your apps used in ${period}.`;
  const compare = vm.compareLabel !== null;
  const note = vm.browser.hidden > vm.browser.unmatched / 2 ? 'Most of it has no page title to match.'
    : vm.browser.unmatchedShare !== null && vm.browser.unmatchedShare > 0.5 ? 'Most of it matched none of your apps.' : null;
  return <>
    <Block span={8} title="My apps" sub={sub} foot={partly ? `${plural(vm.unlabeledDays, 'day')} not labeled` : undefined} label="My apps">
      {vm.rows.length ? <div className="tw"><table className="myapps">
        <thead><tr><th>App</th><th className="r">Time</th>{compare && <th className="r">Change</th>}<th className="hide-s trend">Per {vm.trendUnit}</th><th className="r" title={vm.only ? `Of ${names(vm.only)}'s screen time` : undefined}>Of screen time</th></tr></thead>
        <tbody>{vm.rows.map(row => (
          <tr key={row.label}><td className="name">{row.label}</td>
            <td className="r strong">{hours(row.seconds)}</td>
            {compare && <td className={`r${row.delta === null ? ' fa' : row.delta > 0 ? ' acc' : ''}`}>{row.delta === null ? UNKNOWN : signed(row.delta)}</td>}
            <td className="hide-s trend" aria-label={`${row.label} per ${vm.trendUnit}`}><span className="mini">{row.days.map(day => (
              <i key={day.date} title={day.later ? undefined : `${vm.trendUnit === 'day' ? day.date : `${vm.trendUnit} of ${day.date}`}: ${day.seconds === null ? UNKNOWN : hours(day.seconds)}`} className={day.later ? 'f' : day.seconds === null ? 'u' : undefined}
                style={{ height: day.seconds === null ? undefined : `${Math.max(day.seconds ? 8 : 0, 100 * day.seconds / top)}%` }} />))}</span></td>
            <td className="r fa">{vm.labeledSeconds ? share(row.seconds, vm.labeledSeconds) : UNKNOWN}</td></tr>))}
        </tbody></table></div> : <div className="bb fa">{empty}</div>}
    </Block>
    <Side><Block span={4} title="Browser time" sub={['matched to my apps', only, partly ? `on ${plural(vm.labeledDays, 'labeled day')}` : null].filter(Boolean).join(', ')} label="Browser time">
      <div className="bb">{vm.labeledDays && vm.browser.seconds > 0 ? <>
        <BarList items={[{ key: 'matched', label: 'Matched', value: vm.browser.matched }, { key: 'unmatched', label: 'Not matched', value: vm.browser.unmatched }]} format={hours} />
        {note && <p className="fa note">{note}</p>}
      </> : <span className="fa">{vm.rules ? `No labeled browser time in ${period}.` : 'No apps named yet.'}</span>}</div>
    </Block></Side>
  </>;
}

export function ScreenTime({ snapshot, scope, now }: { snapshot: { view: { config?: ConfigEcho[] } }; scope: Scope; now: number }) {
  const vm = buildScreenTime(snapshot, scope, { now });
  return <ScreenTimeBody vm={vm} spend={metric(snapshot, 'spend', scope, { now })} config={snapshot.view.config ?? []} now={now} />;
}
