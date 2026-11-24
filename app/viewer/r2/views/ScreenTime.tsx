// Screen time: follows the device chips and the range. A day with tracking off is Unknown on its own, and a
// longer period adds the tracked days only. There is no block that splits spend by screen on or off: no
// data joins spend to screen time yet, so the view does not guess one.
import type { Frame, Num, ScreenTimeVM } from '../../../../lib/view-r2.mjs';
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
        <div className="bb">{categories.length ? <BarList items={partBars(categories)} format={hours} /> : <div className="fa">Not tracked by kind of app on these computers.</div>}</div>
      </Block></Side>
    </div>
  );
}

export function ScreenTime({ snapshot, scope, now }: { snapshot: { view: { config?: ConfigEcho[] } }; scope: Scope; now: number }) {
  const vm = buildScreenTime(snapshot, scope, { now });
  return <ScreenTimeBody vm={vm} spend={metric(snapshot, 'spend', scope, { now })} config={snapshot.view.config ?? []} now={now} />;
}
