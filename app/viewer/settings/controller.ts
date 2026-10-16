import { contract, validateArgs } from '../../../lib/bridge-contract.mjs';
import type { Bridge, BridgeOutcome } from '../bridge';
import { pairedStates, validateBridgeStatus, type BridgeStatus } from './status';

// Settings adds presentation metadata without changing the bridge outcome contract.
export type SettingsOutcome = BridgeOutcome & { unknown?: boolean };

export function joinConfirmOutcome(result: BridgeOutcome, after: BridgeStatus | null): { outcome: BridgeOutcome; unknown: boolean } {
  if (result.timedOut || result.code !== 'done') return { outcome: result, unknown: false };
  const state = after?.pairing.state;
  if (state && (state === 'acknowledged' || pairedStates.has(state))) {
    return { outcome: result, unknown: false };
  }
  return { outcome: { ...result, ok: false, code: 'unavailable' }, unknown: state !== 'local-ready' };
}

const mapJoinConfirm = (result: BridgeOutcome, read: BridgeOutcome | null): SettingsOutcome => {
  const { outcome, unknown } = joinConfirmOutcome(result, read?.ok ? validateBridgeStatus(read.value) : null);
  return { ...outcome, unknown };
};

export function createSettingsController(bridge: Bridge, getGeneration: () => number = () => 0) {
  let current: BridgeStatus | null = null;
  let disposed = false;
  let refreshSequence = 0;
  const requestGenerations = new Map<number, number>();
  const request = async (action: string, args: Record<string, unknown>) => {
    const ticket = getGeneration();
    const result = await bridge.send(action, args);
    if (!disposed && result.timedOut) requestGenerations.set(result.id, ticket);
    return result;
  };
  const listeners = new Set<(status: BridgeStatus | null) => void>();
  const status = async (): Promise<BridgeOutcome> => {
    const sequence = ++refreshSequence;
    const result = await request('status', {});
    if (!disposed && sequence === refreshSequence) {
      current = result.ok ? validateBridgeStatus(result.value) : null;
      for (const listener of listeners) listener(current);
    }
    return result;
  };
  const lateListeners = new Set<(result: SettingsOutcome, action: string) => void>();
  const stopLate = bridge.onLateResult((result, action) => {
    const ticket = requestGenerations.get(result.id);
    requestGenerations.delete(result.id);
    if (disposed || ticket !== getGeneration()) return;
    void status().catch(() => null).then(read => {
      const outcome = action === 'pairing-join-confirm' ? mapJoinConfirm(result, read) : result;
      if (!disposed && ticket === getGeneration()) for (const listener of lateListeners) listener(outcome, action);
    });
  });
  const send = async (action: string, args: Record<string, unknown> = {}): Promise<SettingsOutcome> => {
    const validated = validateArgs(action, args);
    if (!validated.ok || !('args' in validated)) return { id: 0, ok: false, code: 'refused', local: true };
    const result = await request(action, validated.args as Record<string, unknown>);
    if (result.timedOut) void status().catch(() => {});
    else if (action === 'pairing-join-confirm') return mapJoinConfirm(result, await status().catch(() => null));
    else if (result.code === 'done' || action.startsWith('pairing-')) await status();
    return result;
  };
  const port = (value: string | number) => typeof value === 'number' ? value : /^[0-9]+$/.test(value) ? Number(value) : NaN;
  const deviceName = (text: string) => {
    if (/[\p{Cc}\p{Cf}]/u.test(text)) return text;
    const chars = Array.from(text);
    while (chars.length && contract.whiteSpace.includes(chars[0].codePointAt(0)!)) chars.shift();
    while (chars.length && contract.whiteSpace.includes(chars[chars.length - 1].codePointAt(0)!)) chars.pop();
    return chars.length ? text : null;
  };
  return {
    status,
    onLateResult(listener: (result: SettingsOutcome, action: string) => void) { lateListeners.add(listener); return () => { lateListeners.delete(listener); }; },
    getStatus: () => current,
    subscribe(listener: (status: BridgeStatus | null) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setSource: (source: string, enabled: boolean) => send('set-source', { source, enabled }),
    setSkin: (skin: string) => send('set-skin', { skin }),
    setDeviceName: (name: string) => send('set-device-name', { name: deviceName(name) }),
    setStartup: (enabled: boolean) => send('set-startup', { enabled }),
    setAppearance: (mode: string) => send('set-appearance', { mode }),
    setLimitsConsent: (enabled: boolean) => send('set-limits-consent', { enabled }),
    setSharingChoice: (enabled: boolean) => send('set-sharing-choice', { enabled }),
    setSharing: (channel: string, enabled: boolean, token?: string | null) => send('set-sharing', enabled ? { channel, enabled, token } : { channel, enabled }),
    pairingIdentityCreate: () => send('pairing-identity-create'),
    pairingHostDefaults: () => send('pairing-host-defaults'),
    pairingPeerAddress: () => request('pairing-peer-address', {}),
    pairingHostStart: (address: string, value: string | number) => send('pairing-host-start', { address, port: port(value) }),
    pairingCopyInvitation: () => send('pairing-copy-invitation'),
    pairingHostConfirm: (fingerprint: string, peerAddress: string, value: string | number, sharing: boolean) => send('pairing-host-confirm', { fingerprint, peerAddress, peerPort: port(value), sharing }),
    pairingJoinClaim: (invitation: string) => send('pairing-join-claim', { invitation }),
    pairingJoinConfirm: (sharing: boolean) => send('pairing-join-confirm', { sharing }),
    pairingCancel: () => send('pairing-cancel'),
    pairingDisconnect: () => send('pairing-disconnect'),
    pairingRepairPrepare: () => send('pairing-repair-prepare'),
    tailscaleCheck: () => send('tailscale-check'),
    checkUpdates: () => send('check-updates'),
    exportData: () => send('export-data'),
    completeSetup: () => send('complete-setup'),
    dispose() { disposed = true; stopLate(); listeners.clear(); lateListeners.clear(); requestGenerations.clear(); },
  };
}
export type SettingsController = ReturnType<typeof createSettingsController>;

export function limitsConsentFlow(controller: SettingsController) {
  let open = false;
  return {
    request() { open = true; return open; },
    cancel() { open = false; return open; },
    confirm() {
      if (!open) return null;
      open = false;
      return controller.setLimitsConsent(true);
    },
  };
}

export async function changeAppearance(controller: SettingsController, mode: string, demo: boolean, apply: (mode: string) => void) {
  const result = await controller.setAppearance(mode);
  if (demo && result.code === 'done') apply(mode);
  return result;
}
