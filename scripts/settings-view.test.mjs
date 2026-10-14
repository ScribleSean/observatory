import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sampleBridgeStatus } from '../lib/sample-snapshot.mjs';
import { encodeMessage, validateMessage } from '../lib/bridge-contract.mjs';

const load = specifier => import(specifier);
const { createServer } = await load('vite');
const { default: react } = await load('@vitejs/plugin-react');
const server = await createServer({ configFile: false, root: fileURLToPath(new URL('..', import.meta.url)), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', plugins: [react()] });
after(() => server.close());
const { SettingsContent, SettingsView } = await server.ssrLoadModule('/app/viewer/settings/settings.tsx');
const { createSettingsController } = await server.ssrLoadModule('/app/viewer/settings/controller.ts');
const { createFakeBridge } = await server.ssrLoadModule('/app/viewer/settings/fake-bridge.ts');
const { validateBridgeStatus } = await server.ssrLoadModule('/app/viewer/settings/status.ts');
const { DashboardView } = await server.ssrLoadModule('/app/viewer/dashboard.tsx');
const { SKINS } = await server.ssrLoadModule('/app/viewer/skin.ts');
const { validateSkin } = await server.ssrLoadModule('/lib/skins.mjs');
const render = (status = sampleBridgeStatus(), props = {}) => renderToStaticMarkup(createElement(SettingsContent, { status, skinId: 'sage', ...props }));
const groups = ['Sources to collect', 'Accounts', 'Devices and sharing', 'Startup', 'About and updates'];
for (const skinId of ['sage', 'almanac']) {
  void test(`settings groups, labels and light skin markup in ${skinId}`, () => {
    const html = render(sampleBridgeStatus(), { skinId });
    let last = -1;
    for (const heading of groups) {
      const at = html.indexOf(`<h3>${heading}</h3>`); assert.ok(at > last); last = at;
    }
    for (const label of ['ActivityWatch', 'Codex', 'Claude Code', 'Wispr Flow', 'Codex limits', 'Claude Code limits', 'Device name', 'Save', 'Check Tailscale', 'Pair a device', 'Share Codex limits', 'Share Claude Code tokens', 'Start at login', 'Version', 'Build', 'Check for updates', 'Appearance', 'System', 'Light', 'Dark', 'Skin', 'Sage', 'Almanac', 'Instrument', 'Amber CRT', 'Studio Night', 'Export data']) assert.ok(html.includes(label), label);
    assert.equal((html.match(/type="checkbox"/g) ?? []).length, 9);
    assert.match(html, /Up to 32 characters/);
    const dashboard = renderToStaticMarkup(createElement(DashboardView, {
      demo: true, snapshot: null, loaded: true, now: 0, skinId, skin: validateSkin(SKINS[skinId]),
      section: 'settings', onSectionChange: () => {}, onSkinChange: () => {},
    }));
    assert.ok(dashboard.includes('Sources to collect'));
    assert.ok(dashboard.includes(':root:not([data-theme="light"])'));
    assert.ok(dashboard.includes(`--ob-background:#${validateSkin(SKINS[skinId]).colors.background[0]}`));
  });
}
void test('missing status renders Unknown and disables every setting', () => {
  const html = render(null, { available: false });
  for (const heading of groups) assert.ok(html.includes(heading));
  assert.ok((html.match(/Unknown/g) ?? []).length >= 10);
  assert.match(html, /Open settings inside the Observatory app/);
  for (const control of html.matchAll(/<(?:input|button|select)\b[^>]*>/g)) assert.match(control[0], /disabled=""/);
  assert.doesNotMatch(html, />0<|value="0"/);
  const view = renderToStaticMarkup(createElement(SettingsView, { demo: false, skinId: 'sage', onSkinChange: () => {} }));
  assert.match(view, /Unknown/);
});
void test('paired, confirming, identity and awaiting-confirmation variants show the right controls', () => {
  for (const [state, labels] of /** @type {Array<[string, string[]]>} */ ([['paired', ['Disconnect', 'Repair']], ['confirming', ['Confirm', 'Cancel']], ['identity-required', ['Create device identity', 'Cancel']], ['identity-ready', ['device&#x27;s address', 'device&#x27;s sync port', 'Start']]])) {
    const status = sampleBridgeStatus(); status.pairing.state = state;
    const html = render(status);
    for (const label of labels) assert.ok(html.includes(label), `${state}: ${label}`);
  }
  const status = sampleBridgeStatus();
  Object.assign(status.pairing, { state: 'awaiting-confirmation', peerFingerprint: 'ab'.repeat(32), invitationKept: true });
  const html = render(status);
  for (const label of ['Peer fingerprint', 'Peer address', 'Peer port', 'Confirm', 'Cancel', 'ab'.repeat(32)]) assert.ok(html.includes(label));
});
void test('host invitation is read-only with private sharing and clipboard warning', () => {
  const status = sampleBridgeStatus();
  Object.assign(status.pairing, { state: 'waiting', invitationKept: true });
  const invitation = 'observatory-pair:v1:U0FNUExF';
  const html = render(status, { invitation });
  assert.match(html, /<textarea readOnly=""/);
  assert.ok(html.includes(invitation));
  assert.match(html, /Share privately\. Clipboard managers may retain copied invitations\. It expires within ten minutes\./);
  assert.match(html, /Copy invitation/);
  assert.match(html, /Cancel/);
});
void test('sharing-ready controls are enabled and unavailable reasons are readable', () => {
  const status = sampleBridgeStatus();
  const unavailable = render(status);
  assert.ok(unavailable.includes('Pair a device before enabling sharing.'));
  for (const channel of Object.values(status.sharing)) Object.assign(channel, { canEnable: true, reason: 'ready', token: 'cd'.repeat(32) });
  const ready = render(status);
  assert.doesNotMatch(ready, /type="checkbox"[^>]*disabled/);
  assert.doesNotMatch(ready, /Pair a device before enabling sharing/);
  assert.doesNotMatch(ready, new RegExp('cd'.repeat(32)));
});
void test('status validator requires exact bounded shape and returns an independent copy', () => {
  const sample = sampleBridgeStatus();
  const clean = validateBridgeStatus(sample);
  assert.deepEqual(clean, sample); clean.sources.activity = false;
  assert.equal(sample.sources.activity, true);
  for (const mutate of [
    s => { s.extra = true; }, s => { s.app.path = '/synthetic'; }, s => { s.sources.extra = false; },
    s => { s.pairing.state = 'surprise'; }, s => { s.pairing.transport = 'http'; },
    s => { s.sharing['codex-limits'].token = 'AB'.repeat(32); s.sharing['codex-limits'].canEnable = true; },
    s => { s.sharing['codex-limits'].extra = true; }, s => { s.app.version = 'x'.repeat(17000); },
    s => { s.deviceName = 'bad/name'; }, s => { s.skin.custom = ['sage']; }, s => { s.skin.custom = ['bad/name']; },
    s => { s.skin.bundled = ['sage']; }, s => { s.appearance = 'custom'; }, s => { s.sources.quota = 0; },
    s => { s.pairing.peerFingerprint = 'ab'.repeat(32); }, s => { s.pairing.state = 'awaiting-confirmation'; },
  ]) {
    const value = sampleBridgeStatus(); mutate(value); assert.equal(validateBridgeStatus(value), null);
  }
  const cyclic = sampleBridgeStatus(); cyclic.app = cyclic;
  assert.equal(validateBridgeStatus(cyclic), null);
});
function recordingBridge() {
  const messages = [];
  const listeners = new Set();
  let next = 1;
  return {
    available: true, messages,
    async send(action, args) {
      const text = encodeMessage(next++, action, args);
      assert.equal(validateMessage(text).outcome, 'accepted'); messages.push(JSON.parse(text));
      return { id: next - 1, ok: true, code: 'done', ...(action === 'status' ? { value: sampleBridgeStatus() } : {}) };
    },
    onLateResult(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    emitLate() { for (const listener of listeners) listener({ id: 1, ok: true, code: 'done' }); },
    dispose() {},
  };
}
/** @type {Array<[string, unknown[]]>} */
const validCalls = [
  ['setSource', ['activity', false]], ['setSkin', ['sage']], ['setDeviceName', ['  Studio  ']], ['setDeviceName', ['   ']],
  ['setStartup', [false]], ['setAppearance', ['dark']], ['setLimitsConsent', [true]],
  ['setSharing', ['codex-limits', true, 'ab'.repeat(32)]], ['setSharing', ['claude-code-tokens', false]],
  ['pairingIdentityCreate', []], ['pairingHostStart', ['100.64.0.1', '9090']], ['pairingCopyInvitation', []],
  ['pairingHostConfirm', ['ab'.repeat(32), '192.168.1.2', '9090']],
  ['pairingJoinClaim', ['observatory-pair:v1:U0FNUExF']], ['pairingJoinConfirm', []], ['pairingCancel', []],
  ['pairingDisconnect', []], ['pairingRepairPrepare', []], ['tailscaleCheck', []], ['checkUpdates', []], ['exportData', []],
];
for (const mode of ['recording', 'fake']) {
  void test(`every controller action validates with ${mode} bridge and refreshes`, async () => {
    const recorded = recordingBridge();
    const fake = createFakeBridge(sampleBridgeStatus(), 1);
    const target = mode === 'fake' ? { ...fake, async send(action, args) { await recorded.send(action, args); return fake.send(action, args); } } : recorded;
    const controller = createSettingsController(target);
    await controller.status();
    for (const [method, args] of validCalls) {
      const before = recorded.messages.length;
      const outcome = await controller[method](...args);
      assert.notEqual(outcome.code, 'refused', method);
      if (outcome.code === 'done' || method.startsWith('pairing')) assert.equal(recorded.messages[before + 1].action, 'status', method);
      else assert.equal(recorded.messages.length, before + 1, method);
    }
    assert.ok(controller.getStatus());
    assert.deepEqual(recorded.messages.filter(m => m.action === 'set-device-name').map(m => m.args.name), ['Studio', null]);
    controller.dispose(); fake.dispose();
  });
}
void test('bad page inputs post nothing at all', async () => {
  const bridge = recordingBridge();
  const controller = createSettingsController(bridge);
  for (const [method, args] of /** @type {Array<[string, unknown[]]>} */ ([
    ...['bad/name', 'bad\\name', 'bad:name', 'a'.repeat(33), 'bad\u0001name', 'bad\u200bname', '\ud800', '😀'.repeat(17)].map(name => ['setDeviceName', [name]]),
    ['pairingJoinClaim', ['wrong:prefix']], ['pairingHostStart', ['8.8.8.8', '9090']],
    ['pairingHostStart', ['100.64.0.1', '80']], ['pairingHostStart', ['100.64.0.1', '1e4']],
    ['pairingHostConfirm', ['AB'.repeat(32), '100.64.0.2', '9090']],
    ['pairingHostConfirm', ['ab'.repeat(32), '8.8.8.8', '9090']],
    ['setSource', ['unknown', true]], ['setAppearance', ['invalid']], ['setSkin', ['bad/name']],
    ['setSharing', ['codex-limits', true, null]],
  ])) {
    const result = await controller[method](...args);
    assert.equal(result.code, 'refused', method); assert.equal(result.local, true);
    assert.equal(bridge.messages.length, 0, method);
  }
  controller.dispose();
});
void test('pairing failures refresh before returning and late results refresh status', async () => {
  const bridge = recordingBridge();
  const original = bridge.send.bind(bridge);
  for (const code of ['busy', 'cancelled', 'unavailable', 'refused', 'expired']) {
    bridge.send = async (action, args) => action === 'pairing-join-confirm' ? { id: 1, ok: false, code } : original(action, args);
    const controller = createSettingsController(bridge);
    const before = bridge.messages.length;
    assert.equal((await controller.pairingJoinConfirm()).code, code);
    assert.equal(bridge.messages[before].action, 'status');
    assert.ok(controller.getStatus());
    bridge.emitLate();
    await Promise.resolve();
    assert.equal(bridge.messages[before + 1].action, 'status');
    controller.dispose();
  }
});
void test('hosting never writes invitation into browser storage or navigation', async () => {
  const writes = [];
  const storage = { setItem: (...args) => writes.push(args), getItem: () => null, removeItem: (...args) => writes.push(args) };
  const fakeWindow = { localStorage: storage, sessionStorage: storage, indexedDB: { open: (...args) => writes.push(args) }, history: { pushState: (...args) => writes.push(args), replaceState: (...args) => writes.push(args) } };
  const old = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { value: fakeWindow, configurable: true });
  try {
    const bridge = createFakeBridge(sampleBridgeStatus(), 1);
    const controller = createSettingsController(bridge);
    const host = await controller.pairingHostStart('100.64.0.1', '9090');
    assert.match(host.value.invitation, /^observatory-pair:v1:/);
    assert.ok(render(controller.getStatus(), { invitation: host.value.invitation }).includes(host.value.invitation));
    await controller.pairingCopyInvitation();
    await controller.pairingCancel();
    assert.equal(controller.getStatus().pairing.invitationKept, false);
    assert.deepEqual(writes, []);
    controller.dispose(); bridge.dispose();
  } finally {
    if (old) Object.defineProperty(globalThis, 'window', old); else delete globalThis.window;
  }
  for (const file of ['app/viewer/bridge.ts', 'app/viewer/settings/settings.tsx', 'app/viewer/settings/controller.ts', 'app/viewer/settings/fake-bridge.ts']) {
    assert.doesNotMatch(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), /localStorage|sessionStorage|indexedDB|pushState|replaceState|navigator\.clipboard|console\./);
  }
});
