import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { STRINGS } from '../../../lib/strings.generated';
import { contract, validateArgs } from '../../../lib/bridge-contract.mjs';
import { sampleBridgeStatus } from '../../../lib/sample-snapshot.mjs';
import { Card, Row } from '../components';
import { createBridge, type Bridge, type BridgeOutcome } from '../bridge';
import { createFakeBridge } from './fake-bridge';
import { changeAppearance, limitsConsentFlow, createSettingsController, type SettingsController } from './controller';
import { validateBridgeStatus, type BridgeStatus, type SharingChannel } from './status';
import './settings.css';

const S = STRINGS.settings;
const pairingWords: Record<string, string> = {
  idle: S.pairIdle, 'identity-ready': S.pairIdentityReady, 'identity-required': S.pairIdentityRequired,
  'identity-recovery-required': S.pairIdentityRecoveryRequired, inactive: S.pairInactive, waiting: S.pairWaiting,
  confirming: S.pairConfirming, 'awaiting-confirmation': S.pairAwaitingConfirmation, 'local-ready': S.pairLocalReady,
  acknowledged: S.pairAcknowledged, 'configuration-ready': S.pairConfigurationReady, working: S.pairWorking,
  cancelled: S.pairCancelled, paired: S.pairPaired, unpaired: S.pairUnpaired, unavailable: S.pairUnavailable,
};
const tailscaleWords: Record<string, string> = {
  running: S.tailscaleRunning, offline: S.tailscaleOffline, 'needs-login': S.tailscaleNeedsLogin,
  'needs-device-approval': S.tailscaleNeedsDeviceApproval, stopped: S.tailscaleStopped, starting: S.tailscaleStarting,
  'other-user': S.tailscaleOtherUser, 'not-installed': S.tailscaleNotInstalled, unsupported: S.tailscaleUnsupported, unavailable: S.tailscaleUnavailable,
};
const reasons: Record<string, string> = { ready: S.ready, 'pairing-unavailable': S.pairingUnavailable, 'account-unavailable': S.accountUnavailable, 'source-unavailable': S.sourceUnavailable };
const skinNames: Record<string, string> = { sage: S.sage, almanac: S.almanac, instrument: S.instrument, 'amber-crt': S.amberCrt };
const terminal = new Set(['paired', 'unpaired', 'idle', 'cancelled', 'unavailable', 'inactive', 'identity-recovery-required']);
type Task = () => Promise<BridgeOutcome>;
type Run = (task: Task, options?: { pairing?: boolean; host?: boolean; skin?: string; name?: boolean; tailscale?: boolean; cancel?: boolean }) => void;

export function presentResult(result: BridgeOutcome, action: string, status: BridgeStatus | null) {
  const value = result.value as { invitation?: unknown; status?: unknown } | undefined;
  return {
    message: result.timedOut ? S.timedOut : S[result.code],
    invitation: action === 'pairing-host-start' && result.ok && value && typeof value === 'object' && !Array.isArray(value) &&
      Reflect.ownKeys(value).length === 1 && validateArgs('pairing-join-claim', { invitation: value.invitation }).ok &&
      status?.pairing.invitationKept ? value.invitation as string : undefined,
    tailscale: action === 'tailscale-check' && result.ok ?
      value && typeof value.status === 'string' && contract.values.tailscaleStatus.includes(value.status) ? tailscaleWords[value.status] : S.unknown : undefined,
  };
}

export function SettingsView({ demo, skinId, onSkinChange, bridge }: {
  demo: boolean; skinId: string; onSkinChange: (id: string) => void; bridge?: Bridge;
}) {
  const [controller, setController] = useState<SettingsController | null>(null);
  const [status, setStatus] = useState<BridgeStatus | null>(() => demo ? validateBridgeStatus(sampleBridgeStatus()) : null);
  const [available, setAvailable] = useState(demo || !!bridge?.available);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [invitation, setInvitation] = useState('');
  const [joinText, setJoinText] = useState('');
  const [tailscale, setTailscale] = useState<string>(S.unknown);
  const generation = useRef(0);
  const running = useRef(false);
  useEffect(() => {
    const transport = bridge ?? (demo ? createFakeBridge() : createBridge());
    const next = createSettingsController(transport, () => generation.current);
    const unsubscribe = next.subscribe(value => {
      setController(next);
      setAvailable(transport.available);
      setStatus(value);
      if (value && terminal.has(value.pairing.state)) setInvitation('');
    });
    const stopResults = next.onLateResult((result, action) => {
      const presented = presentResult(result, action, next.getStatus());
      if (!running.current) setMessage(presented.message);
      if (action.startsWith('pairing-') && ['unavailable', 'expired'].includes(result.code)) setInvitation('');
      if (presented.invitation !== undefined) setInvitation(presented.invitation);
      if (presented.tailscale !== undefined) setTailscale(presented.tailscale);
      if (action === 'pairing-join-claim') setJoinText('');
    });
    void next.status();
    let polling = false;
    const poll = setInterval(() => {
      const state = next.getStatus()?.pairing.state;
      if (!polling && state && !terminal.has(state) && state !== 'identity-ready' && state !== 'identity-required') {
        polling = true;
        void next.status().finally(() => { polling = false; });
      }
    }, contract.limits.pairingPollSeconds * 1000);
    const clear = () => { generation.current++; running.current = false; setBusy(false); setInvitation(''); setJoinText(''); };
    const hide = () => flushSync(clear);
    window.addEventListener('pagehide', hide);
    return () => {
      clear();
      clearInterval(poll); window.removeEventListener('pagehide', hide);
      unsubscribe(); stopResults(); next.dispose();
      if (!bridge) transport.dispose();
    };
  }, [bridge, demo]);
  const run: Run = (task, options = {}) => {
    if (running.current && !options.cancel) return;
    if (options.cancel) { generation.current++; setInvitation(''); }
    const ticket = generation.current;
    running.current = true; setBusy(true); setMessage('');
    void task().then(result => {
      if (ticket !== generation.current) return;
      setMessage(result.timedOut ? S.timedOut : result.local && result.code === 'refused' ? (options.name ? S.nameError : S.fieldError) : S[result.code]);
      if (options.pairing && ['unavailable', 'expired'].includes(result.code)) setInvitation('');
      const presented = presentResult(result, options.host ? 'pairing-host-start' : options.tailscale ? 'tailscale-check' : '', controller?.getStatus() ?? null);
      if (presented.invitation !== undefined) setInvitation(presented.invitation);
      if (presented.tailscale !== undefined) setTailscale(presented.tailscale);
      if (result.ok && options.skin && Object.hasOwn(skinNames, options.skin)) onSkinChange(options.skin);
    }).catch(() => {
      if (ticket === generation.current) setMessage(S.unavailable);
    }).finally(() => {
      if (ticket === generation.current) { running.current = false; setBusy(false); }
    });
  };
  return <SettingsContent status={status} controller={controller} available={available} busy={busy} message={message}
    invitation={invitation} joinText={joinText} onJoinTextChange={setJoinText}
    onAppearanceChange={mode => changeAppearance(controller!, mode, demo && !bridge, value => {
      if (value === 'system') delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = value;
    })} tailscale={tailscale} skinId={skinId} run={run} />;
}

type ContentProps = {
  status: unknown; controller?: SettingsController | null; available?: boolean; busy?: boolean; message?: string;
  invitation?: string; joinText?: string; onJoinTextChange?: (value: string) => void;
  disclosureOpen?: boolean; initialFlow?: 'choose' | 'host' | 'join' | null;
  onAppearanceChange?: (mode: string) => Promise<BridgeOutcome>; tailscale?: string; skinId: string; run?: Run;
};
export function SettingsContent({ status: raw, controller, available = true, busy = false, message = '', invitation = '',
  joinText = '', onJoinTextChange = () => {}, disclosureOpen = false, initialFlow = null, onAppearanceChange, tailscale = S.unknown, skinId, run = () => {} }: ContentProps) {
  const status = validateBridgeStatus(raw);
  const disabled = !available || !status || busy;
  const [name, setName] = useState(status?.deviceName ?? '');
  const [disclosure, setDisclosure] = useState(disclosureOpen);
  const consent = useMemo(() => controller ? limitsConsentFlow(controller) : null, [controller]);
  const [flow, setFlow] = useState<'choose' | 'host' | 'join' | null>(initialFlow);
  const [address, setAddress] = useState('');
  const [port, setPort] = useState('');
  const [peerAddress, setPeerAddress] = useState('');
  const [peerPort, setPeerPort] = useState('');
  const [savedName, setSavedName] = useState(status?.deviceName);
  if (savedName !== status?.deviceName) { setSavedName(status?.deviceName); setName(status?.deviceName ?? ''); }
  const state = status?.pairing.state;
  const [previousState, setPreviousState] = useState(state);
  if (previousState !== state) { setPreviousState(state); if (state && terminal.has(state)) setFlow(null); }
  const action = (task: (c: SettingsController) => Promise<BridgeOutcome>, options?: Parameters<Run>[1]) => {
    if (controller) run(() => task(controller), options);
  };
  const button = (label: string, onClick: () => void, blocked = disabled) => <button type="button" disabled={blocked} onClick={onClick}>{label}</button>;
  const group = (label: string, children: ReactNode) => <Card label={label}><h3>{label}</h3>{children}</Card>;
  const toggle = (label: string, value: boolean | undefined, change: (enabled: boolean) => void, blocked = false) => <div className="ob-row ob-settings-toggle">
    <label className="ob-settings-switch"><input type="checkbox" aria-checked={value === undefined ? 'mixed' : value} ref={input => { if (input) input.indeterminate = value === undefined; }} checked={value ?? false} disabled={disabled || blocked} onChange={event => change(event.target.checked)} />{label}</label>
    <span className="ob-meta">{value === undefined ? S.unknown : value ? S.on : S.off}</span>
  </div>;
  const field = (label: string, value: string, change: (value: string) => void, numeric = false) => <label className="ob-settings-field">{label}
    <input value={value} disabled={disabled} autoComplete="off" spellCheck={false} inputMode={numeric ? 'numeric' : 'text'} onChange={event => change(event.target.value)} placeholder={!status ? S.unknown : undefined} />
  </label>;
  const pairingAction = (task: (c: SettingsController) => Promise<BridgeOutcome>, host = false) => action(task, { pairing: true, host });
  return <div className="ob-settings" data-skin={skinId} aria-busy={busy}>
    {!available && <p>{S.appOnly}</p>}
    {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- The paused note uses the requested paragraph status markup. */}
    {status?.collectionPaused === true && <p className="ob-settings-paused" role="status">{S.collectionPaused}</p>}
    <output aria-live="polite">{busy ? S.working : message}</output>
    {group(S.sources, <>{(['activity', 'codex', 'claude', 'wispr'] as const).map(source => <div key={source}>{toggle(S[source], status?.sources[source], enabled => action(c => c.setSource(source, enabled)))}</div>)}</>)}
    {group(S.accounts, <>
      {toggle(S.codexLimits, status?.sources.quota, enabled => action(c => c.setSource('quota', enabled)))}
      {toggle(S.claudeLimits, status?.limitsConsent, enabled => enabled ? setDisclosure(consent?.request() ?? false) : action(c => c.setLimitsConsent(false)))}
      {disclosure && <div className="ob-settings-disclosure"><ul><li>{S.disclosureHints}</li><li>{S.disclosureReadings}</li><li>{S.disclosureSharing}</li></ul>
        {button(S.turnOn, () => run(() => { setDisclosure(false); return consent?.confirm() ?? Promise.resolve({ id: 0, ok: false, code: 'refused', local: true }); }))}
        {button(S.cancel, () => setDisclosure(consent?.cancel() ?? false))}</div>}
    </>)}
    {group(S.devices, <>
      {field(S.deviceName, name, setName)}<p className="ob-meta">{S.nameHint}</p>
      {button(S.save, () => action(c => c.setDeviceName(name), { name: true }))}
      <Row>{button(S.tailscale, () => action(c => c.tailscaleCheck(), { tailscale: true }))}<span>{tailscale}</span></Row>
      <h4>{S.pairing}</h4><p>{state ? pairingWords[state] : S.unknown}</p>
      {(!state || (terminal.has(state) && state !== 'paired')) && !flow && button(S.pairDevice, () => setFlow('choose'))}
      {flow === 'choose' && <Row>{button(S.host, () => setFlow('host'))}{button(S.join, () => setFlow('join'))}</Row>}
      {(flow === 'host' || state === 'identity-required' || state === 'identity-ready') && <>
        {state === 'identity-required' ? button(S.identity, () => pairingAction(c => c.pairingIdentityCreate())) :
          !['waiting', 'awaiting-confirmation', 'paired'].includes(state ?? '') && <>{field(S.address, address, setAddress)}{field(S.port, port, setPort, true)}{button(S.start, () => pairingAction(c => c.pairingHostStart(address, port), true))}</>}
      </>}
      {invitation && <label className="ob-settings-field">{S.invitation}<textarea readOnly spellCheck={false} value={invitation} /></label>}
      {(invitation || status?.pairing.invitationKept) && <p>{S.invitationWarning}</p>}
      {status?.pairing.invitationKept && button(S.copyInvitation, () => action(c => c.pairingCopyInvitation(), { pairing: true }))}
      {state === 'awaiting-confirmation' && status?.pairing.peerFingerprint && <>
        <label className="ob-settings-field">{S.fingerprint}<input readOnly value={status.pairing.peerFingerprint} /></label>
        {field(S.peerAddress, peerAddress, setPeerAddress)}{field(S.peerPort, peerPort, setPeerPort, true)}
        {button(S.confirm, () => pairingAction(c => c.pairingHostConfirm(status.pairing.peerFingerprint!, peerAddress, peerPort)))}
      </>}
      {flow === 'join' && state !== 'confirming' && state !== 'paired' && <>
        <label className="ob-settings-field">{S.invitation}<textarea value={joinText} autoComplete="off" spellCheck={false} disabled={disabled} onChange={event => onJoinTextChange(event.target.value)} /></label>
        {button(S.claim, () => pairingAction(async c => { try { return await c.pairingJoinClaim(joinText); } finally { onJoinTextChange(''); } }))}
      </>}
      {state === 'confirming' && button(S.confirm, () => pairingAction(c => c.pairingJoinConfirm()))}
      {state === 'paired' && <Row>{button(S.disconnect, () => pairingAction(c => c.pairingDisconnect()))}{button(S.repair, () => pairingAction(c => c.pairingRepairPrepare()))}</Row>}
      {(flow || (state && !terminal.has(state))) && button(S.cancel, () => {
        onJoinTextChange(''); setFlow(null); action(c => c.pairingCancel(), { pairing: true, cancel: true });
      }, !available || !status)}
      <h4>{S.sharing}</h4>
      {(['codex-limits', 'claude-code-tokens'] as SharingChannel[]).map(channel => {
        const item = status?.sharing[channel];
        return <div key={channel}>{toggle(channel === 'codex-limits' ? S.shareCodexLimits : S.shareClaudeTokens, item?.enabled,
          enabled => action(c => c.setSharing(channel, enabled, item?.token)), !!item && !item.enabled && !item.canEnable)}
          {item && !item.enabled && !item.canEnable && <p className="ob-meta">{reasons[item.reason]}</p>}</div>;
      })}
    </>)}
    {group(S.startup, toggle(S.startAtLogin, status?.startup, enabled => action(c => c.setStartup(enabled))))}
    {group(S.about, <>
      <Row><span>{S.version}</span><span>{status?.app.version ?? S.unknown}</span></Row>
      <Row><span>{S.build}</span><span>{status?.app.build ?? S.unknown}</span></Row>
      {button(S.checkUpdates, () => action(c => c.checkUpdates()))}
      <label className="ob-settings-field">{S.appearance}<select disabled={disabled} value={status?.appearance ?? ''} onChange={event => { const mode = event.target.value; action(c => onAppearanceChange ? onAppearanceChange(mode) : c.setAppearance(mode)); }}>
        {!status && <option value="">{S.unknown}</option>}{(['system', 'light', 'dark'] as const).map(mode => <option key={mode} value={mode}>{S[mode]}</option>)}
      </select></label>
      <label className="ob-settings-field">{S.skin}<select disabled={disabled} value={status?.skin.current ?? ''} onChange={event => { const skin = event.target.value; action(c => c.setSkin(skin), { skin }); }}>
        {!status && <option value="">{S.unknown}</option>}{status?.skin.bundled.map(id => <option key={id} value={id}>{skinNames[id]}</option>)}
        {status?.skin.custom.map(name => <option key={name} value={name}>{name}</option>)}
      </select></label>
      {button(S.exportData, () => action(c => c.exportData()))}
    </>)}
  </div>;
}
