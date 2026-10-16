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
  // The host confirms the peer device in confirming and the joiner confirms the invitation in awaiting-confirmation.
  confirming: S.pairHostConfirm, 'awaiting-confirmation': S.pairJoinConfirm, 'local-ready': S.pairLocalReady,
  acknowledged: S.pairAcknowledged, 'configuration-ready': S.pairConfigurationReady, working: S.pairWorking,
  'establishing-trust': S.pairEstablishingTrust, 'active-sync': S.pairActiveSync, 'sync-stale': S.pairSyncStale, revoked: S.pairRevoked,
  cancelled: S.pairCancelled, paired: S.pairPaired, unpaired: S.pairUnpaired, unavailable: S.pairUnavailable,
};
const tailscaleWords: Record<string, string> = {
  running: S.tailscaleRunning, offline: S.tailscaleOffline, 'needs-login': S.tailscaleNeedsLogin,
  'needs-device-approval': S.tailscaleNeedsDeviceApproval, stopped: S.tailscaleStopped, starting: S.tailscaleStarting,
  'other-user': S.tailscaleOtherUser, 'not-installed': S.tailscaleNotInstalled, unsupported: S.tailscaleUnsupported, unavailable: S.tailscaleUnavailable,
};
const reasons: Record<string, string> = { ready: S.ready, 'pairing-unavailable': S.pairingUnavailable, 'account-unavailable': S.accountUnavailable, 'source-unavailable': S.sourceUnavailable };
const sharingWords: Record<string, string> = { on: S.on, 'waiting-for-reading': S.sharingWaiting, off: S.off, unavailable: S.unknown };
const skinNames: Record<string, string> = { sage: S.sage, almanac: S.almanac, instrument: S.instrument, 'amber-crt': S.amberCrt };
const pairedStates = new Set(['paired', 'establishing-trust', 'active-sync', 'sync-stale']);
const terminal = new Set(['paired', 'unpaired', 'idle', 'cancelled', 'unavailable', 'inactive', 'identity-recovery-required', 'establishing-trust', 'active-sync', 'sync-stale', 'revoked']);
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

export function pairingDefaults(value: unknown, peer = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  const names = peer ? ['peerAddress'] : ['address', 'port', 'portAvailable'];
  if (Reflect.ownKeys(data).length !== names.length || names.some(key => !Object.hasOwn(data, key))) return null;
  const address = data[peer ? 'peerAddress' : 'address'];
  if (address !== null && !validateArgs('pairing-host-start', { address, port: 43128 }).ok) return null;
  if (!peer && (!validateArgs('pairing-host-start', { address: '100.101.102.103', port: data.port }).ok ||
    ![true, false, null].includes(data.portAvailable as boolean | null))) return null;
  return { address: address as string | null, port: data.port as number, portAvailable: data.portAvailable as boolean | null };
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
  const [peerPort, setPeerPort] = useState('43128');
  const [sharing, setSharing] = useState(false);
  const [hostDefaults, setHostDefaults] = useState<ReturnType<typeof pairingDefaults>>(null);
  const hostRequested = useRef(false);
  const peerRequested = useRef(new Map<string, { attempts: number; pending: boolean; found: boolean }>());
  const activeFingerprint = useRef<string | null>(null);
  const [savedName, setSavedName] = useState(status?.deviceName);
  if (savedName !== status?.deviceName) { setSavedName(status?.deviceName); setName(status?.deviceName ?? ''); }
  const state = status?.pairing.state;
  const [previousState, setPreviousState] = useState(state);
  if (previousState !== state) {
    setPreviousState(state); if (state && terminal.has(state)) setFlow(null);
  }
  const hostOpen = flow === 'host' && !['waiting', 'confirming'].includes(state ?? '') && !pairedStates.has(state ?? '') && state !== 'revoked';
  useEffect(() => {
    if (!hostOpen) { hostRequested.current = false; return; }
    if (!controller || hostRequested.current) return;
    hostRequested.current = true;
    let active = true;
    void controller.pairingHostDefaults().then(result => {
      const defaults = result.ok ? pairingDefaults(result.value) : null;
      // Pre-fill only fields the person has not filled in.
      if (active && defaults) {
        setAddress(current => current || (defaults.address ?? '')); setPort(current => current || String(defaults.port));
        setHostDefaults(defaults);
      }
    }).catch(() => {});
    return () => { active = false; };
  }, [controller, hostOpen]);
  const fingerprint = status?.pairing.peerFingerprint ?? null;
  const [previousFingerprint, setPreviousFingerprint] = useState(fingerprint);
  if (fingerprint !== null && previousFingerprint !== fingerprint) {
    setPreviousFingerprint(fingerprint);
    setSharing(false); setPeerAddress(''); setPeerPort('43128');
  }
  useEffect(() => {
    if (previousFingerprint) peerRequested.current.delete(previousFingerprint);
  }, [previousFingerprint]);
  useEffect(() => {
    activeFingerprint.current = fingerprint;
    return () => { activeFingerprint.current = null; };
  }, [controller, fingerprint]);
  useEffect(() => {
    if (!controller || state !== 'confirming' || !fingerprint) return;
    const progress = peerRequested.current.get(fingerprint) ?? { attempts: 0, pending: false, found: false };
    if (progress.pending || progress.found || progress.attempts >= 3) return;
    peerRequested.current.set(fingerprint, progress);
    progress.attempts++; progress.pending = true;
    void controller.pairingPeerAddress().then(result => {
      const defaults = result.ok ? pairingDefaults(result.value, true) : null;
      if (activeFingerprint.current === fingerprint && defaults?.address) {
        progress.found = true;
        setPeerAddress(current => current || defaults.address!);
      }
    }).catch(() => {}).finally(() => { progress.pending = false; });
  }, [controller, fingerprint, state, raw]);
  const choiceKnown = !!status && Object.values(status.sharingChoice.channels).some(channel => channel !== 'unavailable');
  const sharingPaired = pairedStates.has(state ?? '');
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
      {disclosure && <div className="ob-settings-disclosure"><ul><li>{S.disclosureCommand}</li><li>{S.disclosureStorage}</li><li>{S.disclosureOff}</li></ul>
        {button(S.turnOn, () => run(() => { setDisclosure(false); return consent?.confirm() ?? Promise.resolve({ id: 0, ok: false, code: 'refused', local: true }); }))}
        {button(S.cancel, () => setDisclosure(consent?.cancel() ?? false))}</div>}
    </>)}
    {group(S.devices, <>
      {field(S.deviceName, name, setName)}<p className="ob-meta">{S.nameHint}</p>
      {button(S.save, () => action(c => c.setDeviceName(name), { name: true }))}
      <Row>{button(S.tailscale, () => action(c => c.tailscaleCheck(), { tailscale: true }))}<span>{tailscale}</span></Row>
      <h4>{S.pairing}</h4><p>{state ? pairingWords[state] : S.unknown}</p>
      {(!state || state === 'identity-ready' || (terminal.has(state) && !pairedStates.has(state) && state !== 'revoked')) && !flow && button(S.pairDevice, () => setFlow('choose'))}
      {flow === 'choose' && <Row>{button(S.host, () => setFlow('host'))}{button(S.join, () => setFlow('join'))}</Row>}
      {(flow === 'host' || state === 'identity-required' || state === 'identity-ready') && <>
        {state === 'identity-required' ? button(S.identity, () => pairingAction(c => c.pairingIdentityCreate())) :
          !['waiting', 'confirming', 'paired'].includes(state ?? '') && <>{field(S.address, address, setAddress)}{field(S.port, port, setPort, true)}{hostDefaults?.portAvailable === false && address === hostDefaults.address && port === String(hostDefaults.port) && <p>{S.portInUse}</p>}{button(S.start, () => pairingAction(c => c.pairingHostStart(address, port), true))}</>}
      </>}
      {invitation && <label className="ob-settings-field">{S.invitation}<textarea readOnly spellCheck={false} value={invitation} /></label>}
      {(invitation || status?.pairing.invitationKept) && <p>{S.invitationWarning}</p>}
      {status?.pairing.invitationKept && button(S.copyInvitation, () => action(c => c.pairingCopyInvitation(), { pairing: true }))}
      {choiceKnown && (state === 'confirming' || state === 'awaiting-confirmation') && <label><input type="checkbox" checked={sharing} disabled={disabled} onChange={event => setSharing(event.target.checked)} />{S.shareUsage}</label>}
      {state === 'confirming' && status?.pairing.peerFingerprint && <>
        <label className="ob-settings-field">{S.fingerprint}<input readOnly value={status.pairing.peerFingerprint} /></label>
        {field(S.peerAddress, peerAddress, setPeerAddress)}{field(S.peerPort, peerPort, setPeerPort, true)}
        {button(S.confirm, () => pairingAction(c => c.pairingHostConfirm(status.pairing.peerFingerprint!, peerAddress, peerPort, choiceKnown && sharing)))}
      </>}
      {flow === 'join' && !['awaiting-confirmation', 'local-ready', 'acknowledged', 'paired'].includes(state ?? '') && <>
        <label className="ob-settings-field">{S.invitation}<textarea value={joinText} autoComplete="off" spellCheck={false} disabled={disabled} onChange={event => onJoinTextChange(event.target.value)} /></label>
        {button(S.claim, () => pairingAction(async c => { try { return await c.pairingJoinClaim(joinText); } finally { onJoinTextChange(''); } }))}
      </>}
      {state === 'awaiting-confirmation' && button(S.confirm, () => pairingAction(c => c.pairingJoinConfirm(choiceKnown && sharing)))}
      {state === 'local-ready' && <>
        <p>{S.pairLocalReadyHelp}</p>
        {button(S.pairRetry, () => pairingAction(async c => {
          const result = await c.pairingJoinConfirm(false);
          // A lost acknowledgement can return success while pairing remains unconfirmed.
          if (result.ok && c.getStatus()?.pairing.state === 'local-ready') return { ...result, ok: false, code: 'unavailable' };
          return result;
        }))}
      </>}
      {state && pairedStates.has(state) && <Row>{button(S.disconnect, () => pairingAction(c => c.pairingDisconnect()))}{button(S.repair, () => pairingAction(c => c.pairingRepairPrepare()))}</Row>}
      {state === 'revoked' && button(S.repair, () => pairingAction(c => c.pairingRepairPrepare()))}
      {(flow || (state && !terminal.has(state))) && button(S.cancel, () => {
        onJoinTextChange(''); setFlow(null); action(c => c.pairingCancel(), { pairing: true, cancel: true });
      }, !available || !status)}
      <h4>{S.sharing}</h4>
      {choiceKnown && <>{toggle(S.shareUsage, status!.sharingChoice.chosen || Object.values(status!.sharingChoice.channels).includes('on'), enabled => action(c => c.setSharingChoice(enabled)), !sharingPaired)}
        {!sharingPaired && <p className="ob-meta">{S.pairingUnavailable}</p>}</>}
      {(['codex-limits', 'claude-code-tokens'] as SharingChannel[]).map(channel => choiceKnown ? <Row key={channel}>
        <span>{channel === 'codex-limits' ? S.shareCodexLimits : S.shareClaudeTokens}</span>
        <span>{sharingWords[status?.sharingChoice.channels[channel] ?? 'unavailable']}</span>
      </Row> : <div key={channel}>{toggle(channel === 'codex-limits' ? S.shareCodexLimits : S.shareClaudeTokens, status?.sharing[channel].enabled,
        enabled => action(c => c.setSharing(channel, enabled, status?.sharing[channel].token)), !!status && !status.sharing[channel].enabled && !status.sharing[channel].canEnable)}
        {status && !status.sharing[channel].enabled && !status.sharing[channel].canEnable && <p className="ob-meta">{reasons[status.sharing[channel].reason]}</p>}</div>)}
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
