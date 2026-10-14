import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { contract, encodeMessage, validateArgs } from '../lib/bridge-contract.mjs';
import { sampleBridgeStatus } from '../lib/sample-snapshot.mjs';

const load = specifier => import(specifier);
const { createServer } = await load('vite');
const server = await createServer({ configFile: false, root: fileURLToPath(new URL('..', import.meta.url)), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
after(() => server.close());
const { createBridge } = await server.ssrLoadModule('/app/viewer/bridge.ts');
const { createFakeBridge } = await server.ssrLoadModule('/app/viewer/settings/fake-bridge.ts');
const dispatch = (target, type, field, value) => {
  const event = new Event(type);
  Object.defineProperty(event, field, { value });
  target.dispatchEvent(event);
};
function fixture(kind) {
  const win = new EventTarget();
  const posted = [];
  if (kind === 'mac') win.webkit = { messageHandlers: { bridge: { postMessage: text => posted.push(text) } } };
  if (kind === 'windows') {
    const webview = new EventTarget();
    webview.postMessage = text => posted.push(text);
    win.chrome = { webview };
  }
  return { win, posted };
}
const result = (win, id, more = {}) => dispatch(win, 'observatory:bridge-result', 'detail', { id, ok: true, code: 'done', ...more });

for (const platform of ['mac', 'windows']) {
  void test(`${platform} posts encoded text and resolves matching results`, async () => {
    const { win, posted } = fixture(platform);
    const bridge = createBridge(win);
    const first = bridge.send('set-source', { source: 'activity', enabled: false });
    const second = bridge.send('status', {});
    assert.deepEqual(posted, [encodeMessage(1, 'set-source', { source: 'activity', enabled: false }), encodeMessage(2, 'status', {})]);
    if (platform === 'windows') dispatch(win.chrome.webview, 'message', 'data', { bridgeResult: { id: 2, ok: true, code: 'done', value: sampleBridgeStatus() } });
    else result(win, 2, { value: sampleBridgeStatus() });
    result(win, 1);
    assert.equal((await first).id, 1);
    assert.deepEqual((await second).value, sampleBridgeStatus());
    bridge.dispose();
    const replacement = createBridge(win);
    const third = replacement.send('status', {});
    assert.equal(JSON.parse(posted[2]).id, 3);
    result(win, 3);
    await third;
    replacement.dispose();
  });
}
void test('invalid messages never post and absent transports are unavailable', async () => {
  const { win, posted } = fixture('mac');
  const bridge = createBridge(win);
  for (const [action, args] of [['unknown', {}], ['complete-setup', {}], ['set-source', { source: 'activity', enabled: 1 }]]) {
    assert.deepEqual(await bridge.send(action, args), { id: 0, ok: false, code: 'refused', local: true });
  }
  assert.equal(posted.length, 0);
  bridge.dispose();
  const absent = createBridge(new EventTarget());
  assert.equal(absent.available, false);
  assert.equal((await absent.send('status', {})).code, 'unavailable');
  absent.dispose();
});
void test('malformed, unknown and untrusted results cannot settle a request', async () => {
  const { win } = fixture('windows');
  const bridge = createBridge(win);
  let settled = false;
  const promise = bridge.send('status', {}).then(value => { settled = true; return value; });
  for (const malformed of [
    { id: 1, ok: true, code: 'done', extra: true }, { id: 1, ok: true, code: 'busy' },
    { id: 1, ok: false, code: 'mystery' }, { id: 2, ok: true, code: 'done' },
    { id: '1', ok: true, code: 'done' }, { id: 0, ok: true, code: 'done' },
    { id: contract.message.id.max + 1, ok: true, code: 'done' },
    { id: 1, ok: false, code: 'done' }, Object.create({ id: 1, ok: true, code: 'done' }),
  ]) {
    dispatch(win, 'observatory:bridge-result', 'detail', malformed);
    dispatch(win.chrome.webview, 'message', 'data', { bridgeResult: malformed });
  }
  const good = { id: 1, ok: true, code: 'done' };
  dispatch(win.chrome.webview, 'message', 'data', { bridgeResult: good, extra: true });
  dispatch(win.chrome.webview, 'message', 'data', JSON.stringify({ bridgeResult: good }));
  dispatch(win, 'message', 'data', { bridgeResult: good });
  dispatch(win, 'storage', 'detail', good);
  const channel = new BroadcastChannel('synthetic-settings-bridge');
  const sender = new BroadcastChannel('synthetic-settings-bridge');
  sender.postMessage(good);
  await new Promise(resolve => setTimeout(resolve, 10));
  channel.close(); sender.close();
  assert.equal(settled, false);
  result(win, 1);
  assert.equal((await promise).code, 'done');
  bridge.dispose();
});
void test('timeout is followed by one late result and unsubscribe works', async () => {
  const { win } = fixture('mac');
  const bridge = createBridge(win, 5);
  const late = [];
  const unsubscribe = bridge.onLateResult((value, action) => late.push({ value, action }));
  assert.deepEqual(await bridge.send('status', {}), { id: 1, ok: false, code: 'unavailable', timedOut: true });
  result(win, 1, { extra: true });
  assert.equal(late.length, 0);
  result(win, 1); result(win, 1);
  assert.equal(late.length, 1);
  assert.equal(late[0].action, 'status');
  result(win, 999);
  assert.equal(late.length, 1);
  await bridge.send('status', {});
  unsubscribe(); result(win, 2);
  assert.equal(late.length, 1);
  const pending = bridge.send('status', {});
  bridge.dispose();
  assert.equal((await pending).local, true);
  result(win, 3);
});
void test('transport exceptions resolve without retaining pending work', async () => {
  const { win } = fixture('mac');
  win.webkit.messageHandlers.bridge.postMessage = () => { throw new Error('Synthetic failure'); };
  const bridge = createBridge(win);
  assert.equal((await bridge.send('status', {})).code, 'unavailable');
  bridge.dispose();
});
void test('fake bridge implements actions, copied status and pairing transitions', async () => {
  const bridge = createFakeBridge(sampleBridgeStatus(), 1);
  const send = (action, args = {}) => bridge.send(action, args);
  const status = async () => (await send('status')).value;
  const initial = await status(); initial.sources.activity = false;
  assert.equal((await status()).sources.activity, true);
  for (const source of ['activity', 'codex', 'claude', 'wispr', 'quota']) {
    assert.equal((await send('set-source', { source, enabled: false })).code, 'done');
    assert.equal((await status()).sources[source], false);
  }
  for (const skin of ['sage', 'almanac', 'instrument', 'amber-crt', 'Studio Night']) {
    assert.equal((await send('set-skin', { skin })).code, 'done');
    assert.equal((await status()).skin.current, skin);
  }
  assert.equal((await send('set-skin', { skin: 'Absent' })).code, 'unavailable');
  await send('set-device-name', { name: '  Sample  ' }); assert.equal((await status()).deviceName, 'Sample');
  await send('set-device-name', { name: null }); assert.equal((await status()).deviceName, null);
  await send('set-startup', { enabled: false }); assert.equal((await status()).startup, false);
  for (const mode of ['system', 'light', 'dark']) {
    await send('set-appearance', { mode }); assert.equal((await status()).appearance, mode);
  }
  await send('set-limits-consent', { enabled: true }); assert.equal((await status()).limitsConsent, true);
  assert.equal((await send('set-sharing', { channel: 'codex-limits', enabled: true, token: 'ab'.repeat(32) })).code, 'unavailable');
  assert.equal((await send('pairing-copy-invitation')).code, 'unavailable');
  await send('pairing-identity-create'); assert.equal((await status()).pairing.state, 'identity-ready');
  const hosted = await send('pairing-host-start', { address: '100.64.0.1', port: 9090 });
  assert.equal(validateArgs('pairing-join-claim', hosted.value).ok, true);
  assert.equal((await status()).pairing.state, 'waiting');
  assert.equal((await status()).pairing.state, 'awaiting-confirmation');
  assert.equal((await status()).pairing.invitationKept, true);
  assert.equal((await send('pairing-copy-invitation')).code, 'done');
  await send('pairing-host-confirm', { fingerprint: 'ab'.repeat(32), peerAddress: '100.64.0.2', peerPort: 9090 });
  assert.equal((await status()).pairing.state, 'paired');
  assert.equal((await status()).pairing.invitationKept, false);
  await send('pairing-disconnect'); assert.equal((await status()).pairing.state, 'unpaired');
  await send('pairing-repair-prepare'); assert.equal((await status()).pairing.state, 'idle');
  await send('pairing-join-claim', hosted.value); assert.equal((await status()).pairing.state, 'confirming');
  await send('pairing-join-confirm'); assert.equal((await status()).pairing.state, 'paired');
  await send('pairing-cancel'); assert.equal((await status()).pairing.state, 'idle');
  assert.deepEqual((await send('tailscale-check')).value, { status: 'running' });
  for (const action of ['export-data', 'refresh', 'check-updates', 'open-settings']) assert.equal((await send(action)).code, 'done');
  assert.equal((await send('open-dashboard', { section: 'settings' })).code, 'done');
  for (const [action, args] of [['complete-setup', {}], ['bogus', {}], ['set-startup', { enabled: 'yes' }], ['set-device-name', { name: 'bad/name' }]]) {
    assert.equal(validateArgs(action, args).ok, false);
    assert.equal((await send(action, args)).code, 'refused');
  }
  bridge.dispose();
});
void test('fake sharing requires the channel token and supports disabling without it', async () => {
  const sample = sampleBridgeStatus();
  for (const channel of Object.values(sample.sharing)) Object.assign(channel, { canEnable: true, reason: 'ready', token: 'cd'.repeat(32) });
  const bridge = createFakeBridge(sample, 1);
  for (const channel of Object.keys(sample.sharing)) {
    assert.equal((await bridge.send('set-sharing', { channel, enabled: true, token: 'ab'.repeat(32) })).code, 'unavailable');
    assert.equal((await bridge.send('set-sharing', { channel, enabled: true, token: 'cd'.repeat(32) })).code, 'done');
    assert.equal((await bridge.send('status', {})).value.sharing[channel].enabled, true);
    assert.equal((await bridge.send('set-sharing', { channel, enabled: false })).code, 'done');
    assert.equal((await bridge.send('status', {})).value.sharing[channel].enabled, false);
  }
  bridge.dispose();
});
