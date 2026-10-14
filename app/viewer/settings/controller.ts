import { contract, validateArgs } from '../../../lib/bridge-contract.mjs';
import type { Bridge, BridgeOutcome } from '../bridge';
import { validateBridgeStatus, type BridgeStatus } from './status';

export function createSettingsController(bridge: Bridge) {
  let current: BridgeStatus | null = null;
  let disposed = false;
  let refreshSequence = 0;
  const listeners = new Set<(status: BridgeStatus | null) => void>();
  const status = async (): Promise<BridgeOutcome> => {
    const sequence = ++refreshSequence;
    const result = await bridge.send('status', {});
    if (!disposed && sequence === refreshSequence) {
      current = result.ok ? validateBridgeStatus(result.value) : null;
      for (const listener of listeners) listener(current);
    }
    return result;
  };
  const stopLate = bridge.onLateResult(() => { if (!disposed) void status(); });
  const send = async (action: string, args: Record<string, unknown> = {}): Promise<BridgeOutcome> => {
    const validated = validateArgs(action, args);
    if (!validated.ok || !('args' in validated)) return { id: 0, ok: false, code: 'refused', local: true };
    const result = await bridge.send(action, validated.args as Record<string, unknown>);
    if (result.code === 'done' || action.startsWith('pairing-')) await status();
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
    getStatus: () => current,
    subscribe(listener: (status: BridgeStatus | null) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setSource: (source: string, enabled: boolean) => send('set-source', { source, enabled }),
    setSkin: (skin: string) => send('set-skin', { skin }),
    setDeviceName: (name: string) => send('set-device-name', { name: deviceName(name) }),
    setStartup: (enabled: boolean) => send('set-startup', { enabled }),
    setAppearance: (mode: string) => send('set-appearance', { mode }),
    setLimitsConsent: (enabled: boolean) => send('set-limits-consent', { enabled }),
    setSharing: (channel: string, enabled: boolean, token?: string | null) => send('set-sharing', enabled ? { channel, enabled, token } : { channel, enabled }),
    pairingIdentityCreate: () => send('pairing-identity-create'),
    pairingHostStart: (address: string, value: string | number) => send('pairing-host-start', { address, port: port(value) }),
    pairingCopyInvitation: () => send('pairing-copy-invitation'),
    pairingHostConfirm: (fingerprint: string, peerAddress: string, value: string | number) => send('pairing-host-confirm', { fingerprint, peerAddress, peerPort: port(value) }),
    pairingJoinClaim: (invitation: string) => send('pairing-join-claim', { invitation }),
    pairingJoinConfirm: () => send('pairing-join-confirm'),
    pairingCancel: () => send('pairing-cancel'),
    pairingDisconnect: () => send('pairing-disconnect'),
    pairingRepairPrepare: () => send('pairing-repair-prepare'),
    tailscaleCheck: () => send('tailscale-check'),
    checkUpdates: () => send('check-updates'),
    exportData: () => send('export-data'),
    dispose() { disposed = true; stopLate(); listeners.clear(); },
  };
}
export type SettingsController = ReturnType<typeof createSettingsController>;
