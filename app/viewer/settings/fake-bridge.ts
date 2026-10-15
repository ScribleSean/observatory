import { sampleBridgeStatus } from '../../../lib/sample-snapshot.mjs';
import { validateArgs } from '../../../lib/bridge-contract.mjs';
import type { Bridge, BridgeOutcome } from '../bridge';
import { validateBridgeStatus, type SharingChannel } from './status';

export function createFakeBridge(status: unknown = sampleBridgeStatus(), delayMs = 150): Bridge {
  const state = validateBridgeStatus(status);
  if (!state) throw new TypeError('Invalid sample status');
  let nextId = 1;
  let disposed = false;
  let hostPolls = 0;
  const waiters = new Map<ReturnType<typeof setTimeout>, () => void>();
  const end = (next: string) => {
    state.pairing = { state: next, peerFingerprint: null, invitationKept: false, transport: next === 'paired' ? 'tls' : 'none' };
    hostPolls = 0;
    for (const [channel, item] of Object.entries(state.sharing)) {
      const paired = next === 'paired';
      Object.assign(item, { enabled: paired && item.enabled, canEnable: paired, reason: paired ? 'ready' : 'pairing-unavailable',
        token: paired ? (channel === 'codex-limits' ? 'c0' : 'd0').repeat(32) : null });
    }
  };
  return {
    available: true,
    send(action, args) {
      const validated = validateArgs(action, args);
      if (!validated.ok || !('args' in validated)) return Promise.resolve({ id: 0, ok: false, code: 'refused', local: true });
      if (disposed) return Promise.resolve({ id: 0, ok: false, code: 'unavailable', local: true });
      const id = nextId++;
      const input = validated.args as Record<string, unknown>;
      return new Promise(resolve => {
        const timer = setTimeout(() => {
          waiters.delete(timer);
          const result: BridgeOutcome = { id, ok: true, code: 'done' };
          const unavailable = () => { result.ok = false; result.code = 'unavailable'; };
          switch (action) {
            case 'complete-setup': break;
            case 'status':
              if (state.pairing.state === 'waiting' && ++hostPolls > 1) {
                state.pairing.state = 'confirming';
                state.pairing.peerFingerprint = 'ab'.repeat(32);
              }
              result.value = structuredClone(state); break;
            case 'set-source': state.sources[input.source as keyof typeof state.sources] = input.enabled as boolean; break;
            case 'set-skin':
              if ([...state.skin.bundled, ...state.skin.custom].includes(input.skin as string)) state.skin.current = input.skin as string;
              else unavailable();
              break;
            case 'set-device-name': state.deviceName = input.name as string | null; break;
            case 'set-startup': state.startup = input.enabled as boolean; break;
            case 'set-appearance': state.appearance = input.mode as typeof state.appearance; break;
            case 'set-limits-consent': state.limitsConsent = input.enabled as boolean; break;
            case 'set-sharing': {
              const channel = state.sharing[input.channel as SharingChannel];
              if (input.enabled && (!channel.canEnable || input.token !== channel.token)) unavailable();
              else channel.enabled = input.enabled as boolean;
              break;
            }
            case 'pairing-identity-create': end('identity-ready'); break;
            case 'pairing-host-start':
              end('waiting'); state.pairing.invitationKept = true;
              result.value = { invitation: 'observatory-pair:v1:U0FNUExFLURBVEEtTk9ULUEtUkVBTC1JTlZJVEFUSU9O' }; break;
            case 'pairing-copy-invitation': if (!state.pairing.invitationKept) unavailable(); break;
            case 'pairing-host-confirm':
              if (state.pairing.state !== 'confirming' || input.fingerprint !== state.pairing.peerFingerprint) unavailable();
              else end('paired');
              break;
            case 'pairing-join-claim': end('awaiting-confirmation'); break;
            case 'pairing-join-confirm': if (state.pairing.state !== 'awaiting-confirmation') unavailable(); else end('paired'); break;
            case 'pairing-cancel': end('idle'); break;
            case 'pairing-disconnect': end('unpaired'); break;
            case 'pairing-repair-prepare': end('idle'); break;
            case 'tailscale-check': result.value = { status: 'running' }; break;
          }
          resolve(result);
        }, delayMs);
        waiters.set(timer, () => resolve({ id, ok: false, code: 'unavailable', local: true }));
      });
    },
    onLateResult() { return () => {}; },
    dispose() {
      disposed = true;
      for (const [timer, resolve] of waiters) { clearTimeout(timer); resolve(); }
      waiters.clear();
    },
  };
}
