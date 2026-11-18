import { UNKNOWN, periodNote, useR2, type RangeUnit, type ViewId } from './data';

const RANGES: [RangeUnit, string][] = [['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['year', 'Year'], ['all', 'All']];
// What each view does with the scope. Limits belong to the account, not to one computer. Settings ignore the scope.
const USES: Partial<Record<ViewId, { devices: boolean; range: boolean; note: string }>> = {
  limits: { devices: false, range: true, note: 'Limits are account wide, so they are not split by device' },
  settings: { devices: false, range: false, note: 'Settings apply everywhere' },
};

/** The one scope every view follows: which computers, which sources and which span of time. */
export function ScopeBar() {
  const { frame, scope, setScope, view, today } = useR2();
  const use = USES[view] ?? { devices: true, range: true, note: '' };
  const chips = frame.devices.filter(chip => chip.state !== 'not-set-up');
  const hosts = chips.map(chip => chip.host);
  const all = hosts.every(host => scope.devices.includes(host));
  const sources = frame.sources.filter(source => source.on && source.hasData && scope.sources.includes(source.id)).map(source => source.name);
  const note = periodNote(frame.period, today);
  const { back, forward } = frame.steps;
  return (
    <div className="scope"><div className="wrap">
      <div className="seg dev" inert={!use.devices || undefined} style={use.devices ? undefined : { opacity: 0.38 }}>
        {chips.length > 1 && <button type="button" className={all ? 'on' : ''} aria-pressed={all} title="Every device combined" onClick={() => setScope({ ...scope, devices: hosts })}>All</button>}
        {chips.map(chip => {
          const on = !all && scope.devices.length === 1 && scope.devices[0] === chip.host;
          // The hub's label, as the menu bar shows it: "Off", or the day and time of the last reading.
          const state = chip.off ? 'Off' : chip.state === 'stale' ? `last read ${chip.stateLabel ?? UNKNOWN}` : `Live, read ${chip.stateLabel ?? UNKNOWN}`;
          return (
            <button key={chip.host} type="button" className={on || chips.length === 1 ? 'on' : ''} aria-pressed={on} title={`${chip.name}, ${state}`} onClick={() => setScope({ ...scope, devices: [chip.host] })}>
              <span className={chip.state === 'stale' ? 'dot stale' : 'dot'} />{chip.name}{chip.state === 'stale' && <small>{state}</small>}
            </button>
          );
        })}
      </div>
      {use.note ? <span className="srcs">{use.note}</span>
        : <a className="srcs" href="#settings" title="Sources come from Settings. Off or empty ones are hidden"><span className="fa">Sources</span>&nbsp; {sources.join(', ') || 'none'}</a>}
      <div className="range" inert={!use.range || undefined} style={use.range ? undefined : { opacity: 0.38 }}>
        <div className="seg">
          {RANGES.map(([unit, name]) => <button key={unit} type="button" className={scope.range.unit === unit ? 'on' : ''} aria-pressed={scope.range.unit === unit}
            onClick={() => setScope({ ...scope, range: { unit, anchor: today } })}>{name}</button>)}
        </div>
        <div className="step">
          <button type="button" disabled={!back} title="Earlier" aria-label="Earlier" onClick={() => back && setScope({ ...scope, range: back })}>‹</button>
          <span>{frame.period.label}{note && <em>{note}</em>}</span>
          <button type="button" disabled={!forward} title="Later" aria-label="Later" onClick={() => forward && setScope({ ...scope, range: forward })}>›</button>
        </div>
      </div>
    </div></div>
  );
}
