// Settings: a read-only display of each computer's settings echo (view.config). The dashboard server answers
// GET and HEAD only, so nothing here changes a setting. Each row names the key to edit in that computer's
// observatory.config.json, and the next collection uses it.
import type { ReactNode } from 'react';
import type { DeviceChip, Scope } from '../../../../lib/scope.mjs';
import type { Frame, SettingsVM } from '../../../../lib/view-r2.mjs';
import { buildSessions, buildSettings } from '../../../../lib/view-r2.mjs';
import { SOURCE_SETTINGS, WEEK_STARTS_ON } from '../../../../lib/scope.mjs';
import { SESSION_DAYS } from '../../../../lib/r2-shape.mjs';
import { ROLES } from '../../../../lib/roles.mjs';
import { Block, Side, UNKNOWN, clock, dateIn, money, names, plural, shortDate } from './parts';
import './more.css';

// How often each computer collects: scripts/collect.mjs writes intervalSeconds 300 and scripts/setup.mjs
// schedules it every 5 minutes. test/r2-render-more.test.mjs keeps this in step with collect.mjs.
export const COLLECT_EVERY_MINUTES = 5;
export const CONFIG_FILE_NAME = 'observatory.config.json';
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export type RoleWeek = { role: string; sessions: number; spend: number | null; example: string | null };
export type Pin = { id: string; title: string; blocks: string[] };
export type SettingsData = { vm: SettingsVM; firstDate: string | null; roleWeek: RoleWeek[] | null; pins: Pin[] | null; now: number };

const ROLE_WORK: Record<string, string> = {
  'Chief of staff': 'Hands out work and lands it', Builder: 'Builds one app or repository', Reviewer: 'Reviews, audits or tests, changes nothing',
  Designer: 'Design work', Researcher: 'Research and search', Runner: 'Unattended runs that are not reviews',
  Sweeper: 'Small upkeep across several repositories', Ops: 'Setup and upkeep of the computers',
};

function Row({ name, state, what, value, off = false }: { name: ReactNode; state: ReactNode; what?: ReactNode; value: ReactNode; off?: boolean }) {
  return (
    <div className={`srow${what === undefined ? ' two' : ''}${off ? ' off' : ''}`}>
      <div><b>{name}</b><div className="st">{state}</div></div>
      {what !== undefined && <div className="what">{what}</div>}
      <span className="val">{value}</span>
    </div>
  );
}

const keys = (list: readonly string[]) => <span className="keys">{list.map(key => <code key={key}>sources.{key}</code>)}</span>;

export function SettingsBody({ vm, firstDate, roleWeek, pins, now }: SettingsData) {
  const frame = vm.frame as Frame, timeZone = frame.timeZone;
  const nameOf = (host: string) => vm.computers.find(computer => computer.host === host)?.name ?? frame.devices.find(device => device.host === host)?.name ?? host;
  const onHosts = (on: Record<string, boolean>) => Object.entries(on).filter(([, value]) => value).map(([host]) => nameOf(host));
  const screen = Object.fromEntries(vm.computers.map(computer => [computer.host, computer.sources.screenTime === true]));
  const sources = [
    ...vm.sources.map(source => ({ id: source.id, name: source.name, reads: source.reads, on: source.on, keys: SOURCE_SETTINGS[source.id] })),
    { id: 'screenTime', name: 'Screen time', reads: 'Hours at the screen by kind of app. Not collected on Linux', on: screen, keys: ['screenTime'] as readonly string[] },
  ];
  const days = firstDate ? Math.round((Date.parse(`${dateIn(now, timeZone)}T00:00:00Z`) - Date.parse(`${firstDate}T00:00:00Z`)) / 86400000) + 1 : null;
  const devices = frame.devices;
  const stateWord = (device: DeviceChip) => device.off ? 'Off' : device.state === 'live' ? 'Live' : device.state === 'stale' ? 'Stale' : 'Not set up';
  return (
    <div className="grid more">
      <Block span={8} title="Sources" sub={`read only. To change one, edit ${CONFIG_FILE_NAME} on that computer`} foot={<>{vm.howToChange}</>}>
        {sources.map(source => {
          const on = onHosts(source.on);
          return <Row key={source.id} off={on.length === 0} name={source.name} state={on.length ? `On · ${names(on)}` : 'Off on every computer'} what={source.reads} value={keys(source.keys)} />;
        })}
      </Block>
      <Block title="Computers" sub={`each collects every ${COLLECT_EVERY_MINUTES} minutes`}>
        {devices.map(device => {
          const computer = vm.computers.find(item => item.host === device.host);
          const role = computer?.role === 'hub' ? 'Hub' : computer ? 'Read over SSH' : 'Not set up';
          return <Row key={device.host} off={device.state === 'not-set-up'} name={device.name}
            state={device.state === 'not-set-up' ? 'Not set up' : device.off ? `${role} · Off` : `${role} · ${device.state === 'stale' ? 'last read' : 'read'} ${device.stateLabel ?? clock(device.since, timeZone, now)}`}
            value={<span className={device.state === 'live' ? 'mu' : 'fa'}>{stateWord(device)}</span>} />;
        })}
      </Block>
      <Block span={8} title="Session names" sub="the role is a tag, then what the title says"
        foot={<>{vm.roleAliases.length
          ? <>Your sessions.roles map: {vm.roleAliases.map(alias => `titles starting "${alias.prefix}" read as ${alias.role}`).join(', ')}. </>
          : null}A session with no role in its title gets one from how it ran, then from the kind of work it did most.</>}>
        <div className="tw"><table>
          <thead><tr><th>Reads as</th><th>What the role does</th><th className="r hide-s">This week</th></tr></thead>
          <tbody>{ROLES.map(role => {
            const week = roleWeek?.find(row => row.role === role);
            return (
              <tr key={role}><td className="name"><span className="role">[{role}]</span> {week?.example ?? <span className="fa">no session this week</span>}</td>
                <td>{ROLE_WORK[role]}</td>
                <td className={`r hide-s${roleWeek && week ? '' : ' fa'}`}>{!roleWeek ? UNKNOWN : week ? `${plural(week.sessions, 'session')} · ${money(week.spend)}` : 'None this week'}</td></tr>
            );
          })}</tbody>
        </table></div>
      </Block>
      <Side>
      {pins && pins.length > 0 && (
        <Block title="Pinned questions" sub="saved arrangements of blocks">
          {pins.map(pin => <div key={pin.id} className="li"><span className="t"><div><b>{pin.title}</b></div><div>{pin.blocks.join(' · ')}</div></span></div>)}
        </Block>
      )}
      <Block title="Display">
        <Row name="Theme" state="Follows the system until you pick one" value={<span className="mu">Top bar button</span>} />
        <Row name="Spend basis" state="Tokens priced at public API rates" value={<span className="mu">API equivalent</span>} />
        <Row name="Week starts" state="Limit windows keep their own reset times" value={<span className="mu">{WEEKDAYS[WEEK_STARTS_ON]}</span>} />
      </Block>
      </Side>
      <Block span={12} title="Data" sub="monitor only, nothing here can stop or change a session">
        <Row name="Where it lives" state="On each computer" what={<>Every number is read from files on your own computers. Nothing is sent anywhere. The folder is set by <code>dataFolder</code> in {CONFIG_FILE_NAME}, which the hub does not share</>}
          value={<span className="fa">{UNKNOWN}</span>} />
        <Row name="History kept" state={firstDate ? `Since ${shortDate(firstDate)}, ${firstDate.slice(0, 4)}` : 'No history yet'}
          what={`Daily totals are kept for good. Session detail is kept for ${SESSION_DAYS} days`} value={<span className="mu">{days === null ? UNKNOWN : plural(days, 'day')}</span>} />
      </Block>
    </div>
  );
}

/** The earliest date any computer's ledger history keeps. */
export const firstLedgerDate = (view: { ledgerHistory?: { firstDate: string | null }[] }) =>
  (view.ledgerHistory ?? []).map(row => row.firstDate).filter((date): date is string => Boolean(date)).sort()[0] ?? null;

/** Sessions and spend per role this week, with the largest row of each role (a session or a folded run) as its example. */
export function roleWeekOf(snapshot: object, scope: Scope, now: number): RoleWeek[] {
  const week = { ...scope, range: { unit: 'week' as const, anchor: scope.range.anchor } };
  const sessions = buildSessions(snapshot, week, { now, groupBy: 'role', limit: 500 });
  return (sessions.groups ?? []).map(group => ({ role: group.key, sessions: group.count, spend: group.spend.value, example: group.rows[0]?.name.object ?? null }));
}

export function Settings({ snapshot, scope, now, pins = null }: { snapshot: { view: { ledgerHistory?: { firstDate: string | null }[] } }; scope: Scope; now: number; pins?: Pin[] | null }) {
  const vm = buildSettings(snapshot, scope, { now });
  const roleWeek = roleWeekOf(snapshot, scope, now);
  return <SettingsBody vm={vm} firstDate={firstLedgerDate(snapshot.view)} roleWeek={roleWeek} pins={pins} now={now} />;
}
