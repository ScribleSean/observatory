import strings from './strings.json' with { type: 'json' };
import { sampleBridgeStatus } from './sample-snapshot.mjs';

export const SETUP_STEPS = ['sources', 'pairing', 'finish'];
export const SETUP_SOURCES = ['activity', 'codex', 'claude', 'wispr', 'quota'].map(id => ({
  id, label: strings.settings[id === 'quota' ? 'codexLimits' : id], hint: strings.setup[`${id}Hint`],
}));
export const clampStep = index => Math.max(0, Math.min(2, Math.trunc(Number(index)) || 0));
export const stepLabel = index => strings.setup.stepLabel.replace('{step}', String(clampStep(index) + 1)).replace('{count}', String(SETUP_STEPS.length));
export function setupSummary(status) {
  const rows = SETUP_SOURCES.map(({ id, label }) => ({ id, label, on: status?.sources[id] }));
  rows.push({ id: 'claudeLimits', label: strings.settings.claudeLimits, on: status?.limitsConsent });
  return { rows, anyOn: rows.some(row => row.on === true) };
}
export function sampleSetupStatus() {
  const status = structuredClone(sampleBridgeStatus());
  for (const { id } of SETUP_SOURCES) status.sources[id] = false;
  status.limitsConsent = false;
  status.pairing = { state: 'idle', peerFingerprint: null, transport: 'none', invitationKept: false };
  for (const channel of Object.keys(status.sharing)) {
    status.sharing[channel] = { enabled: false, canEnable: false, reason: 'pairing-unavailable', token: null };
  }
  return status;
}
