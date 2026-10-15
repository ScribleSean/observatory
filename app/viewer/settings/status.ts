import { contract, validateArgs } from '../../../lib/bridge-contract.mjs';

export type SharingChannel = 'codex-limits' | 'claude-code-tokens';
export type BridgeStatus = {
  version: 1;
  app: { version: string; build: number };
  sources: Record<'activity' | 'codex' | 'claude' | 'wispr' | 'quota', boolean>;
  skin: { current: string; bundled: string[]; custom: string[] };
  deviceName: string | null;
  startup: boolean;
  appearance: 'system' | 'light' | 'dark';
  limitsConsent: boolean;
  collectionPaused: boolean;
  pairing: { state: string; peerFingerprint: string | null; transport: string; invitationKept: boolean };
  sharing: Record<SharingChannel, { enabled: boolean; canEnable: boolean; reason: string; token: string | null }>;
};
const keys = (value: unknown, names: string[]): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) &&
  Reflect.ownKeys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const hex = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
export function validateBridgeStatus(value: unknown): BridgeStatus | null {
  try {
    if (new TextEncoder().encode(JSON.stringify(value)).length > contract.status.maxBytes ||
      !keys(value, contract.status.fields)) return null;
    const { app, sources, skin, pairing, sharing } = value;
    if (value.version !== contract.status.version || !keys(app, ['version', 'build']) || typeof app.version !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9 .+-]*$/.test(app.version) || Array.from(app.version).length > contract.status.appVersionMaxLength || !Number.isSafeInteger(app.build) || (app.build as number) < 0 ||
      !keys(sources, ['activity', 'codex', 'claude', 'wispr', 'quota']) || Object.values(sources).some(v => typeof v !== 'boolean') ||
      typeof value.startup !== 'boolean' || typeof value.limitsConsent !== 'boolean' || typeof value.collectionPaused !== 'boolean' ||
      !contract.values.appearance.includes(value.appearance as string) || !validateArgs('set-device-name', { name: value.deviceName }).ok) return null;
    const bundled = contract.actions['set-skin'].args.skin.bundled;
    if (!keys(skin, ['current', 'bundled', 'custom']) || !Array.isArray(skin.bundled) ||
      skin.bundled.length !== bundled.length || new Set(skin.bundled).size !== bundled.length || skin.bundled.some(id => !bundled.includes(id)) ||
      !Array.isArray(skin.custom) || skin.custom.length > contract.status.customSkinsMax || new Set(skin.custom).size !== skin.custom.length ||
      skin.custom.some(name => typeof name !== 'string' || !validateArgs('set-skin', { skin: name }).ok || bundled.includes(name.toLowerCase())) ||
      ![...skin.bundled, ...skin.custom].includes(skin.current)) return null;
    if (!keys(pairing, ['state', 'peerFingerprint', 'transport', 'invitationKept']) ||
      !contract.values.pairingState.includes(pairing.state as string) || !contract.values.transport.includes(pairing.transport as string) ||
      typeof pairing.invitationKept !== 'boolean' ||
      (pairing.state === 'awaiting-confirmation' ? !hex(pairing.peerFingerprint) : pairing.peerFingerprint !== null)) return null;
    if (!keys(sharing, ['codex-limits', 'claude-code-tokens'])) return null;
    for (const [channel, item] of Object.entries(sharing)) {
      if (!keys(item, ['enabled', 'canEnable', 'reason', 'token']) || typeof item.enabled !== 'boolean' || typeof item.canEnable !== 'boolean' ||
        !contract.values.sharingReason.includes(item.reason as string) ||
        (channel === 'codex-limits' && item.reason === 'source-unavailable') || (channel === 'claude-code-tokens' && item.reason === 'account-unavailable') ||
        (item.canEnable ? !hex(item.token) : item.token !== null)) return null;
    }
    return JSON.parse(JSON.stringify(value)) as BridgeStatus;
  } catch { return null; }
}
