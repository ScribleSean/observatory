// Drift: does every computer run the same setup, and does a model answer differently than it used to?
// It compares the latest read of every computer, so it ignores the device chips and the range. The hub
// is the reference. A difference the platform forces (no screen time on Linux, WSL on Windows only) is
// "Differs by design", never a flag.
import type { DeviceChip, Scope } from '../../../../lib/scope.mjs';
import type { ConfigEcho } from '../../../../lib/r2-shape.mjs';
import type { DriftVM, Frame } from '../../../../lib/view-r2.mjs';
import { buildDrift } from '../../../../lib/view-r2.mjs';
import { Block, Empty, Side, Strip, UNKNOWN, clock, plural, span, type Cell } from './parts';
import './more.css';

type Profile = { date: string; model: string; effort: string; speed: string; totalTokens?: number };
export type SettingsRow = { host: string; status: string; profiles?: Profile[] };
export type SetupRow = { setting: string; values: Record<string, string>; state: 'same' | 'differs' | 'design' | 'alone' | 'unknown' };
export type DriftData = { vm: DriftVM; rows: SetupRow[]; reference: string | null; now: number };

const SOURCE_LABELS: [string, string][] = [['claudeCode', 'Claude Code sessions'], ['claudeLimits', 'Claude Code limits'], ['codex', 'Codex sessions'], ['codexLimits', 'Codex limits'],
  ['grokLimits', 'Grok requests'], ['screenTime', 'Screen time'], ['sessions', 'Live sessions'], ['wsl', 'WSL logs']];
// Settings a platform decides: Linux collects no screen time, and only Windows has WSL.
const BY_DESIGN: Record<string, (host: string) => boolean> = { screenTime: host => host === 'Linux', wsl: host => host === 'Windows' };

/** "claude-opus-5-5" reads as "Opus 5.5". */
export function modelLabel(model: string) {
  const parts = model.replace(/^claude-/, '').replace(/-\d{8}$/, '').split('-');
  const name = parts.filter(part => !/^\d+$/.test(part)).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  const version = parts.filter(part => /^\d+$/.test(part)).join('.');
  return version ? `${name} ${version}` : name;
}

/** One row per setting, one value per computer, from the settings echo and each computer's latest model profile. */
export function setupRows(config: ConfigEcho[], settings: SettingsRow[], hosts: string[]): SetupRow[] {
  const latest = (host: string) => {
    const row = settings.find(item => item.host === host);
    if (!row || row.status !== 'ok' || !row.profiles?.length) return null;
    const last = row.profiles.reduce((date, profile) => profile.date > date ? profile.date : date, '');
    // zero-ok: ordering only
    return row.profiles.filter(profile => profile.date === last).sort((a, b) => (b.totalTokens ?? 0) - (a.totalTokens ?? 0))[0];
  };
  const echo = (host: string) => config.find(row => row.host === host);
  const reference = config.find(row => row.role === 'hub')?.host ?? hosts[0];
  const row = (setting: string, value: (host: string) => string | null, design?: (host: string) => boolean): SetupRow => {
    const values = Object.fromEntries(hosts.map(host => [host, value(host) ?? UNKNOWN]));
    const differing = hosts.filter(host => values[host] !== UNKNOWN && values[reference] !== UNKNOWN && values[host] !== values[reference]);
    // "Same" needs two computers with a value. One value alone was compared with nothing.
    const known = hosts.filter(host => values[host] !== UNKNOWN);
    const state = known.length === 0 ? 'unknown' : known.length === 1 || values[reference] === UNKNOWN ? 'alone' : differing.length === 0 ? 'same' : design && differing.every(host => design(host) || (reference && design(reference))) ? 'design' : 'differs';
    return { setting, values, state };
  };
  const onOff = (value: boolean | undefined) => value === undefined ? null : value ? 'on' : 'off';
  return [
    row('Most used model', host => { const profile = latest(host); return profile ? modelLabel(profile.model) : null; }),
    row('Effort', host => latest(host)?.effort ?? null),
    row('Speed', host => latest(host)?.speed ?? null),
    ...SOURCE_LABELS.map(([key, label]) => row(label, host => onOff(echo(host)?.sources[key]), BY_DESIGN[key])),
    row('Session titles', host => { const value = echo(host)?.titles; return value === undefined ? null : value ? 'kept' : 'hashed away'; }),
    ...(['claude', 'codex', 'grok'] as const).map(engine => row(`${{ claude: 'Claude Code', codex: 'Codex', grok: 'Grok' }[engine]} limit tile`, host => echo(host)?.engines[engine] ?? null)),
  ];
}

type ModelDrift = { model: string; replies: number; flags: unknown[] };

export function DriftBody({ vm, rows, reference, now }: DriftData) {
  const models = vm.models as ModelDrift[];
  const frame = vm.frame as Frame, timeZone = frame.timeZone;
  const devices = frame.devices.filter((device: DeviceChip) => device.state !== 'not-set-up');
  const differs = rows.filter(row => row.state === 'differs');
  const refName = devices.find(device => device.host === reference)?.name ?? reference ?? UNKNOWN;
  const oldest = devices.filter(device => device.since).sort((a, b) => Date.parse(a.since!) - Date.parse(b.since!))[0];
  const flags = models.reduce((sum, model) => sum + model.flags.length, 0);
  const off = devices.filter(device => device.off), stale = devices.filter(device => device.state === 'stale' && !device.off);
  // A computer is compared when it gave at least one value. A setting is compared when two computers gave one.
  const read = devices.filter(device => rows.some(row => row.values[device.host] !== UNKNOWN));
  const unread = devices.filter(device => !read.includes(device));
  const compared = rows.filter(row => row.state !== 'alone' && row.state !== 'unknown');
  const names = (list: DeviceChip[]) => list.map(device => device.name).join(list.length === 2 ? ' and ' : ', ');
  const cells: Cell[] = [
    compared.length === 0
      ? { label: 'Settings that differ', value: UNKNOWN, context: read.length === 1 ? `only ${read[0].name} has been read` : 'no two computers have been read' }
      : { label: 'Settings that differ', value: String(differs.length), unit: `of ${compared.length}`, accent: differs.length > 0,
        context: differs.length ? devices.filter(device => device.host !== reference && differs.some(row => row.values[device.host] !== row.values[reference ?? ''])).map(device => device.name).join(', ') + ` against ${refName}`
          : compared.length < rows.length ? `${rows.length - compared.length} could not be compared` : 'every computer matches' },
    { label: 'Computers compared', value: String(read.length), unit: `of ${devices.length}`, context: unread.length ? `${names(unread)} not read` : `${refName} is the reference` },
    oldest ? { label: 'Oldest read', value: clock(oldest.since, timeZone, now), context: `${oldest.name}, ${span(now - Date.parse(oldest.since!))} ago` } : { label: 'Oldest read', value: UNKNOWN, context: 'no computer read yet' },
    models.length ? { label: 'Model drift flags', value: String(flags), accent: flags > 0, context: `across ${plural(models.length, 'model')}, last 30 days` } : { label: 'Model drift flags', value: UNKNOWN, context: 'no replies read yet' },
  ];
  return (
    <div className="grid more">
      <Strip cells={cells} four />
      <Block span={8} title="Setup drift" sub="is every computer running the same setup?"
        foot={off.length || stale.length ? <><span className="dot stale" />{[
          ...(off.length ? [`${names(off)} ${off.length === 1 ? 'is' : 'are'} off, so ${off.length === 1 ? 'its' : 'their'} values are ${off.every(device => unread.includes(device)) ? UNKNOWN : 'from the last read'}`] : []),
          ...stale.map(device => device.since ? `${device.name} values are from the ${clock(device.since, timeZone, now)} read` : `${device.name} has not been read`),
        ].join('. ')}</> : <>Values from each computer&apos;s observatory.config.json and its latest sessions</>}>
        <div className="tw"><table>
          <thead><tr><th>Setting</th>{devices.map(device => <th key={device.host}>{device.name}</th>)}<th>State</th></tr></thead>
          <tbody>{rows.map(row => (
            <tr key={row.setting}><td className="name">{row.setting}</td>
              {devices.map(device => {
                const value = row.values[device.host];
                return <td key={device.host} className={value === UNKNOWN ? 'fa' : row.state === 'differs' && device.host !== reference && value !== row.values[reference ?? ''] ? 'acc' : undefined}>{value}</td>;
              })}
              <td>{row.state === 'differs' ? <><span className="flagdot" style={{ marginRight: 6 }} /><span className="acc">Differs</span></> : <span className="fa">{row.state === 'design' ? 'Differs by design' : row.state === 'unknown' ? UNKNOWN : row.state === 'alone' ? 'Not compared' : 'Same'}</span>}</td></tr>
          ))}</tbody>
        </table></div>
      </Block>
      <Side>
      <Block title="Model drift" sub="last 30 days">
        {models.length === 0 ? <Empty title={UNKNOWN} line="No replies have been read on any computer yet. This shows when a model answers differently than it used to." /> : (
          <div className="mlist">{models.map(model => (
            <div key={model.model} className="li"><span className="t"><div><b>{modelLabel(model.model)}</b></div><div>{plural(model.replies, 'reply')}</div></span>
              <span className={`n${model.flags.length ? ' acc' : ' fa'}`}>{model.flags.length ? plural(model.flags.length, 'flag') : 'Steady'}</span></div>
          ))}</div>
        )}
      </Block>
      <Block title="Last read" sub="the values above are from these reads">
        {devices.map(device => (
          <div key={device.host} className="li"><span className="t"><div><b>{device.name}</b></div><div>{device.host === reference ? 'Hub' : 'Read over SSH'}</div></span>
            <span className={device.state === 'stale' ? 'fa' : 'mu'}>{device.state === 'stale' && <span className="dot stale" style={{ marginRight: 6 }} />}{device.off ? 'Off' : clock(device.since, timeZone, now)}</span></div>
        ))}
      </Block>
      </Side>
    </div>
  );
}

export function Drift({ snapshot, scope, now }: { snapshot: { view: { config?: ConfigEcho[]; settings?: SettingsRow[] } }; scope: Scope; now: number }) {
  const vm = buildDrift(snapshot, scope, { now });
  const hosts = (vm.frame as Frame).devices.filter(device => device.state !== 'not-set-up').map(device => device.host);
  const config = snapshot.view.config ?? [];
  return <DriftBody vm={vm} rows={setupRows(config, snapshot.view.settings ?? [], hosts)} reference={config.find(row => row.role === 'hub')?.host ?? hosts[0] ?? null} now={now} />;
}
