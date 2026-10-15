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
const { SettingsContent, SettingsView, presentResult, pairingDefaults } = await server.ssrLoadModule('/app/viewer/settings/settings.tsx');
const { createSettingsController, limitsConsentFlow, changeAppearance } = await server.ssrLoadModule('/app/viewer/settings/controller.ts');
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
    assert.equal((html.match(/type="checkbox"/g) ?? []).length, 8);
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
  for (const [state, labels] of /** @type {Array<[string, string[]]>} */ ([['paired', ['Disconnect', 'Prepare pairing repair']], ['awaiting-confirmation', ['Confirm', 'Cancel', 'Confirm the invitation']], ['identity-required', ['Create device identity', 'Cancel']], ['identity-ready', ['device&#x27;s address', 'device&#x27;s sync port', 'Start']]])) {
    const status = sampleBridgeStatus(); status.pairing.state = state;
    const html = render(status);
    for (const label of labels) assert.ok(html.includes(label), `${state}: ${label}`);
    if (state === 'awaiting-confirmation') assert.doesNotMatch(html, /Peer fingerprint|>Claim</);
  }
  const status = sampleBridgeStatus();
  Object.assign(status.pairing, { state: 'confirming', peerFingerprint: 'ab'.repeat(32), invitationKept: true });
  const html = render(status);
  assert.doesNotMatch(html, />Claim</);
  for (const label of ['Peer fingerprint', 'Peer address', 'Peer port', 'Confirm the peer device', 'Confirm', 'Cancel', 'ab'.repeat(32)]) assert.ok(html.includes(label));
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
  status.sharingChoice = { chosen: false, channels: { 'codex-limits': 'unavailable', 'claude-code-tokens': 'unavailable' } };
  const unavailable = render(status);
  assert.ok(unavailable.includes('Share Codex limits'));
  assert.ok(unavailable.includes('Share Claude Code tokens'));
  assert.ok(unavailable.includes('Pair a device before enabling sharing'));
  assert.ok(!unavailable.includes('Share usage records with the paired device'));
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
    s => { s.pairing.peerFingerprint = 'ab'.repeat(32); }, s => { s.pairing.state = 'confirming'; },
  ]) {
    const value = sampleBridgeStatus(); mutate(value); assert.equal(validateBridgeStatus(value), null);
  }
  const cyclic = sampleBridgeStatus(); cyclic.app = cyclic;
  assert.equal(validateBridgeStatus(cyclic), null);
});
void test('only confirming requires a lowercase peer fingerprint', () => {
  for (const [state, peerFingerprint, valid] of [
    ['confirming', 'ab'.repeat(32), true],
    ['confirming', null, false],
    ['confirming', 'AB'.repeat(32), false],
    ['confirming', 'ab'.repeat(31), false],
    ['awaiting-confirmation', 'ab'.repeat(32), false],
    ['awaiting-confirmation', null, true],
  ]) {
    const status = sampleBridgeStatus();
    Object.assign(status.pairing, { state, peerFingerprint });
    assert.equal(validateBridgeStatus(status) !== null, valid);
  }
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
    dispose() {},
  };
}
/** @type {Array<[string, unknown[]]>} */
const validCalls = [
  ['setSource', ['activity', false]], ['setSkin', ['sage']], ['setDeviceName', ['  Studio  ']], ['setDeviceName', ['   ']],
  ['setStartup', [false]], ['setAppearance', ['dark']], ['setLimitsConsent', [true]],
  ['setSharing', ['codex-limits', true, 'ab'.repeat(32)]], ['setSharing', ['claude-code-tokens', false]],
  ['pairingIdentityCreate', []], ['pairingHostStart', ['100.64.0.1', '9090']], ['pairingCopyInvitation', []],
  ['pairingHostConfirm', ['ab'.repeat(32), '100.101.102.103', '9090', true]],
  ['pairingJoinClaim', ['observatory-pair:v1:U0FNUExF']], ['pairingJoinConfirm', [false]], ['pairingCancel', []],
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
void test('pairing failures refresh before returning', async () => {
  const bridge = recordingBridge();
  const original = bridge.send.bind(bridge);
  for (const code of ['busy', 'cancelled', 'unavailable', 'refused', 'expired']) {
    bridge.send = async (action, args) => action === 'pairing-join-confirm' ? { id: 1, ok: false, code } : original(action, args);
    const controller = createSettingsController(bridge);
    const before = bridge.messages.length;
    assert.equal((await controller.pairingJoinConfirm(false)).code, code);
    assert.equal(bridge.messages[before].action, 'status');
    assert.ok(controller.getStatus());
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

void test('terminal pairing states offer another pairing attempt', () => {
  for (const state of ['cancelled', 'inactive', 'unavailable', 'identity-recovery-required']) {
    const status = sampleBridgeStatus(); status.pairing.state = state;
    assert.match(render(status), /Pair a device/);
  }
});
void test('limits disclosure requests and cancellation send nothing, confirmation sends once', async () => {
  const bridge = recordingBridge();
  const controller = createSettingsController(bridge);
  const consent = limitsConsentFlow(controller);
  const { STRINGS } = await server.ssrLoadModule('/lib/strings.generated.ts');
  const html = render(sampleBridgeStatus(), { disclosureOpen: consent.request() });
  for (const key of ['disclosureHints', 'disclosureReadings', 'disclosureSharing']) {
    assert.ok(html.includes(STRINGS.settings[key]));
  }
  assert.equal(bridge.messages.length, 0);
  assert.equal(consent.cancel(), false);
  assert.equal(consent.confirm(), null);
  assert.equal(bridge.messages.length, 0);
  consent.request(); await consent.confirm();
  assert.deepEqual(bridge.messages.map(m => [m.action, m.args]), [['set-limits-consent', { enabled: true }], ['status', {}]]);
  assert.equal(consent.confirm(), null);
  const status = sampleBridgeStatus(); status.limitsConsent = false;
  const original = bridge.send.bind(bridge);
  bridge.send = async (action, args) => {
    const result = await original(action, args);
    return action === 'set-limits-consent' ? { id: result.id, ok: false, code: 'cancelled' } : result;
  };
  consent.request();
  const cancelled = presentResult(await consent.confirm(), 'set-limits-consent', status);
  const cancelledHtml = render(status, cancelled);
  assert.match(cancelledHtml, />Cancelled</);
  assert.match(cancelledHtml, /<input[^>]*aria-checked="false"[^>]*\/>Claude Code limits/);
  controller.dispose();
});
void test('unknown switches have mixed semantics', () => {
  assert.equal((render(null).match(/aria-checked="mixed"/g) ?? []).length, 9);
});
void test('appearance callback runs only for successful demo changes', async () => {
  const controller = createSettingsController(recordingBridge());
  const modes = [];
  for (const mode of ['light', 'dark', 'system']) await changeAppearance(controller, mode, true, value => modes.push(value));
  await changeAppearance(controller, 'dark', false, value => modes.push(value));
  assert.deepEqual(modes, ['light', 'dark', 'system']);
  controller.dispose();
});
void test('late results retain their action, refresh, and replace timeout presentation', async () => {
  const { createBridge } = await server.ssrLoadModule('/app/viewer/bridge.ts');
  const win = new EventTarget();
  win.location = new URL('https://synthetic.test/dashboard.html');
  const posted = [];
  const status = sampleBridgeStatus();
  Object.assign(status.pairing, { state: 'waiting', invitationKept: true });
  const emit = (id, value) => {
    const event = new Event('observatory:bridge-result');
    Object.defineProperty(event, 'detail', { value: { id, ok: true, code: 'done', ...(value ? { value } : {}) } });
    win.dispatchEvent(event);
  };
  win.webkit = { messageHandlers: { bridge: { postMessage(text) {
    const message = JSON.parse(text); posted.push(message);
    if (message.action === 'status') emit(message.id, status);
  } } } };
  const bridge = createBridge(win, 5);
  const controller = createSettingsController(bridge);
  const presentations = [];
  controller.onLateResult((result, action) => presentations.push(presentResult(result, action, controller.getStatus())));
  const host = await controller.pairingHostStart('100.64.0.1', 9090);
  assert.equal(host.timedOut, true);
  const invitation = 'observatory-pair:v1:U0FNUExF';
  emit(host.id, { invitation });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(render(controller.getStatus(), presentations[0]).includes(invitation));
  for (const value of [{ invitation, extra: true }, { invitation: 'invalid' }, 'invalid']) {
    assert.equal(presentResult({ id: 1, ok: true, code: 'done', value }, 'pairing-host-start', status).invitation, undefined);
  }
  const source = await controller.setSource('activity', false);
  emit(source.id);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(render(controller.getStatus(), presentations[1]), />Done</);
  const tailscale = await controller.tailscaleCheck();
  emit(tailscale.id, { status: 'running' });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(presentations[2].tailscale.includes('running') || presentations[2].tailscale.includes('Running'));
  const count = posted.length;
  emit(123456);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(posted.length, count);
  assert.equal(presentations.length, 3);
  controller.dispose(); bridge.dispose();
});
void test('pairing timeout returns while its follow-up status is still pending', async () => {
  const { createBridge } = await server.ssrLoadModule('/app/viewer/bridge.ts');
  const win = new EventTarget();
  win.location = new URL('https://synthetic.test/dashboard.html');
  const posted = [];
  win.webkit = { messageHandlers: { bridge: { postMessage: text => posted.push(JSON.parse(text)) } } };
  const bridge = createBridge(win, 10);
  const controller = createSettingsController(bridge);
  let statusSettled = false;
  const send = bridge.send.bind(bridge);
  bridge.send = (action, args) => send(action, args).then(result => { if (action === 'status') statusSettled = true; return result; });
  assert.equal((await controller.pairingJoinConfirm(false)).timedOut, true);
  assert.deepEqual(posted.map(m => m.action), ['pairing-join-confirm', 'status']);
  assert.equal(statusSettled, false);
  controller.dispose(); bridge.dispose();
});

void test('collectionPaused is required and strictly boolean', () => {
  for (const collectionPaused of [false, true]) assert.ok(validateBridgeStatus({ ...sampleBridgeStatus(), collectionPaused }));
  for (const collectionPaused of [null, 0, 'false']) assert.equal(validateBridgeStatus({ ...sampleBridgeStatus(), collectionPaused }), null);
  const missing = sampleBridgeStatus();
  delete missing.collectionPaused;
  assert.equal(validateBridgeStatus(missing), null);
  assert.equal(validateBridgeStatus({ ...sampleBridgeStatus(), extra: true }), null);
});
for (const skinId of ['sage', 'almanac']) {
  void test(`collection paused Settings note in ${skinId}`, () => {
    assert.doesNotMatch(render(sampleBridgeStatus(), { skinId }), /Collection paused/);
    assert.doesNotMatch(render(null, { skinId }), /Collection paused/);
    const html = render({ ...sampleBridgeStatus(), collectionPaused: true }, { skinId });
    assert.equal((html.match(/Collection paused/g) ?? []).length, 1);
    assert.match(html, /<p class="ob-settings-paused" role="status">Collection paused<\/p><output/);
  });
}
void test('fake bridge preserves collectionPaused through setting changes', async () => {
  const bridge = createFakeBridge({ ...sampleBridgeStatus(), collectionPaused: true }, 0);
  const controller = createSettingsController(bridge);
  try {
    await controller.status();
    assert.equal(controller.getStatus().collectionPaused, true);
    await controller.setStartup(false);
    assert.equal(controller.getStatus().collectionPaused, true);
  } finally { controller.dispose(); bridge.dispose(); }
});

void test('sharing choice requires exact keys and known channel states', () => {
  for (const state of ['on', 'waiting-for-reading', 'off', 'unavailable']) {
    const value = sampleBridgeStatus();
    value.sharingChoice = { chosen: true, channels: { 'codex-limits': state, 'claude-code-tokens': state } };
    assert.ok(validateBridgeStatus(value));
  }
  for (const mutate of [
    value => { delete value.sharingChoice; },
    value => { value.sharingChoice.extra = true; },
    value => { value.sharingChoice.chosen = 1; },
    value => { value.sharingChoice.channels.extra = 'off'; },
    value => { delete value.sharingChoice.channels['codex-limits']; },
    value => { value.sharingChoice.channels['claude-code-tokens'] = 'unknown'; },
  ]) {
    const value = sampleBridgeStatus();
    mutate(value);
    assert.equal(validateBridgeStatus(value), null);
  }
});

void test('new pairing states have distinct words and accept only null fingerprints', () => {
  for (const [state, words] of [
    ['establishing-trust', 'Establishing trust'], ['active-sync', 'Active sync'],
    ['sync-stale', 'Last sync more than ten minutes ago'], ['revoked', 'Revoked'],
  ]) {
    const value = sampleBridgeStatus();
    value.pairing.state = state;
    assert.ok(validateBridgeStatus(value));
    assert.ok(render(value).includes(words));
    if (state !== 'active-sync') assert.ok(!render(value).includes('Active sync'));
    value.pairing.peerFingerprint = 'ab'.repeat(32);
    assert.equal(validateBridgeStatus(value), null);
  }
});

void test('pairing pre-fill results require exact shapes, bounded ports and contract addresses', () => {
  for (const address of [null, '100.101.102.103', 'fd7a:115c:a1e0::1234']) {
    for (const portAvailable of [null, true, false]) {
      assert.ok(pairingDefaults({ address, port: 43128, portAvailable }));
    }
    assert.ok(pairingDefaults({ peerAddress: address }, true));
  }
  const valid = { address: '100.101.102.103', port: 43128, portAvailable: false };
  for (const value of [null, [], {}, { ...valid, extra: true }, { ...valid, port: '43128' },
    { ...valid, port: 1023 }, { ...valid, port: 65536 }, { ...valid, port: 43128.5 },
    { ...valid, portAvailable: 1 }, { ...valid, address: 'example.test' },
    { address: valid.address, port: 43128 }]) assert.equal(pairingDefaults(value), null);
  for (const value of [{}, [], { peerAddress: 'example.test' }, { peerAddress: null, extra: true }]) {
    assert.equal(pairingDefaults(value, true), null);
  }
});
