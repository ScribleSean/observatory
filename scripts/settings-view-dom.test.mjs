import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { act, createElement } from 'react';
import { sampleBridgeStatus } from '../lib/sample-snapshot.mjs';

const load = specifier => import(specifier);
const { createServer } = await load('vite');
const { default: react } = await load('@vitejs/plugin-react');
const server = await createServer({ configFile: false, root: fileURLToPath(new URL('..', import.meta.url)), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', plugins: [react()] });
after(() => server.close());
let SettingsView;
const invitation = 'observatory-pair:v1:U0FNUExF';

async function fixture(t, state = 'identity-ready', placeholder = false) {
  const win = new Window({ url: 'https://synthetic.test/dashboard.html' });
  const globals = { window: win, document: win.document, navigator: win.navigator, HTMLElement: win.HTMLElement, HTMLInputElement: win.HTMLInputElement, HTMLTextAreaElement: win.HTMLTextAreaElement, Node: win.Node, Event: win.Event, MouseEvent: win.MouseEvent, IS_REACT_ACT_ENVIRONMENT: true };
  const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  const { createRoot } = await import('react-dom/client');
  SettingsView ??= (await server.ssrLoadModule('/app/viewer/settings/settings.tsx')).SettingsView;
  const status = sampleBridgeStatus();
  Object.assign(status.pairing, { state, invitationKept: state === 'waiting' });
  status.limitsConsent = false;
  if (placeholder) status.sharingChoice = { chosen: false, channels: { 'codex-limits': 'unavailable', 'claude-code-tokens': 'unavailable' } };
  const messages = [];
  const listeners = new Set();
  let failStatus = false;
  const bridge = {
    available: true,
    send(action, args) {
      const id = messages.length + 1;
      let resolve;
      const promise = new Promise(done => { resolve = done; });
      const request = { id, action, args, answer: (more = {}) => resolve({ id, ok: true, code: 'done', ...more }) };
      messages.push(request);
      if (action === 'status') request.answer(failStatus ? { ok: false, code: 'unavailable' } : { value: structuredClone(status) });
      return promise;
    },
    onLateResult(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() {},
  };
  const container = win.document.createElement('div');
  win.document.body.append(container);
  let root = createRoot(container);
  const mount = () => root.render(createElement(SettingsView, { demo: false, skinId: 'sage', onSkinChange() {}, bridge }));
  t.after(async () => {
    try { await act(async () => root.unmount()); await win.happyDOM.close(); }
    finally {
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  });
  await act(async () => mount());
  const button = label => {
    const found = [...container.querySelectorAll('button')].find(node => node.textContent === label);
    assert.ok(found, label);
    return found;
  };
  const click = async label => act(async () => button(label).click());
  const input = async (node, value) => act(async () => {
    const prototype = node.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, value);
    node.dispatchEvent(new win.Event('input', { bubbles: true }));
  });
  const last = action => messages.filter(message => message.action === action).at(-1);
  const answer = async (request, more) => act(async () => request.answer(more));
  const late = async (request, more = {}) => act(async () => {
    for (const listener of listeners) listener({ id: request.id, ok: true, code: 'done', ...more }, request.action);
  });
  const host = async () => {
    const fields = [...container.querySelectorAll('label')];
    await input(fields.find(node => node.textContent === "This device's address").querySelector('input'), '100.64.0.1');
    await input(fields.find(node => node.textContent === "This device's sync port").querySelector('input'), '9090');
    await click('Start');
    return last('pairing-host-start');
  };
  const hosted = async () => {
    const request = await host();
    Object.assign(status.pairing, { state: 'waiting', invitationKept: true });
    await answer(request, { value: { invitation } });
    assert.equal(container.querySelector('textarea[readonly]').value, invitation);
    return request;
  };
  const hide = async () => act(async () => {
    win.dispatchEvent(new win.Event('pagehide'));
    assert.ok(!container.innerHTML.includes(invitation));
    assert.ok([...container.querySelectorAll('textarea')].every(node => node.value === ''));
  });
  return { win, container, status, messages, button, click, input, last, answer, late, host, hosted, hide,
    failStatus: () => { failStatus = true; },
    remount: async () => act(async () => { root.unmount(); root = createRoot(container); mount(); }),
  };
}

void test('host invitation is synchronously removed from the DOM by pagehide', async t => {
  const f = await fixture(t);
  await f.hosted();
  await f.hide();
});

for (const timedOut of [false, true]) {
  void test(`Cancel rejects an earlier ${timedOut ? 'late' : 'on-time'} host result`, async t => {
    const f = await fixture(t);
    await f.hosted();
    await f.click('Cancel');
    assert.equal(f.container.querySelector('textarea[readonly]'), null);
    await f.answer(f.last('pairing-cancel'));
    Object.assign(f.status.pairing, { state: 'identity-ready', invitationKept: false });
    await f.click('Check for updates');
    await f.answer(f.last('check-updates'));
    const request = await f.host();
    if (timedOut) await f.answer(request, { ok: false, code: 'unavailable', timedOut: true });
    await f.click('Cancel');
    Object.assign(f.status.pairing, { state: 'waiting', invitationKept: true });
    await f.answer(f.last('pairing-cancel'));
    if (timedOut) await f.late(request, { value: { invitation } });
    else await f.answer(request, { value: { invitation } });
    assert.equal(f.container.querySelector('textarea[readonly]'), null);
    assert.ok(!f.container.innerHTML.includes(invitation));
  });
}

void test('late results restore invitation and Done but do not replace a running action message', async t => {
  const f = await fixture(t);
  const request = await f.host();
  Object.assign(f.status.pairing, { state: 'waiting', invitationKept: true });
  await f.answer(request, { ok: false, code: 'unavailable', timedOut: true });
  await f.late(request, { value: { invitation } });
  assert.equal(f.container.querySelector('textarea[readonly]').value, invitation);
  const source = f.container.querySelector('input[type=checkbox]');
  await act(async () => source.click());
  const change = f.last('set-source');
  await f.answer(change, { ok: false, code: 'unavailable', timedOut: true });
  await f.late(change);
  assert.equal(f.container.querySelector('output').textContent, 'Done');
  await act(async () => source.click());
  const second = f.last('set-source');
  await f.answer(second, { ok: false, code: 'unavailable', timedOut: true });
  await f.click('Check for updates');
  await f.late(second, { ok: false, code: 'busy' });
  assert.equal(f.container.querySelector('output').textContent, 'Working');
  await f.hide();
  assert.equal(f.container.querySelector('output').textContent, '');
  await f.answer(f.last('check-updates'));
  assert.equal(f.container.querySelector('output').textContent, '');
});

void test('Copy busy and cancelled retain invitation, remount retains only the Copy control', async t => {
  const f = await fixture(t);
  await f.hosted();
  for (const code of ['busy', 'cancelled']) {
    await f.click('Copy invitation');
    await f.answer(f.last('pairing-copy-invitation'), { ok: false, code });
    assert.equal(f.container.querySelector('textarea[readonly]').value, invitation);
    assert.equal(f.button('Copy invitation').disabled, false);
  }
  await f.remount();
  assert.equal(f.container.querySelector('textarea[readonly]'), null);
  assert.equal(f.button('Copy invitation').disabled, false);
  assert.match(f.container.textContent, /Clipboard managers may retain copied invitations/);
});

void test('the invitation warning appears once before and after a failed status read', async t => {
  const f = await fixture(t);
  await f.hosted();
  const warning = 'Share privately. Clipboard managers may retain copied invitations. It expires within ten minutes.';
  const warningCount = () => f.container.textContent.split(warning).length - 1;
  assert.equal(warningCount(), 1);
  assert.equal(f.button('Copy invitation').disabled, false);
  f.failStatus();
  await f.click('Check for updates');
  await f.answer(f.last('check-updates'));
  assert.equal(f.container.querySelector('textarea[readonly]').value, invitation);
  assert.equal(warningCount(), 1);
  assert.equal(f.container.querySelectorAll('input[aria-checked="mixed"]').length, 9);
  assert.ok(![...f.container.querySelectorAll('button')].some(node => node.textContent === 'Copy invitation'));
});

void test('typed join text survives status refresh and clears on Cancel and pagehide', async t => {
  const f = await fixture(t, 'idle');
  const join = async () => {
    await f.click('Pair a device');
    await f.click('Join with an invitation');
    assert.equal(f.container.querySelector('textarea').value, '');
    await f.input(f.container.querySelector('textarea'), invitation);
  };
  await join();
  await f.click('Check for updates');
  await f.answer(f.last('check-updates'));
  assert.equal(f.container.querySelector('textarea').value, invitation);
  await f.click('Cancel');
  await f.answer(f.last('pairing-cancel'));
  await join();
  assert.equal(f.container.querySelector('textarea').value, invitation);
  await f.hide();
  assert.equal(f.container.querySelector('textarea').value, '');
});

void test('disclosure confirmation obeys the single action gate', async t => {
  const f = await fixture(t);
  const consent = [...f.container.querySelectorAll('label')].find(node => node.textContent === 'Claude Code limits').querySelector('input');
  await act(async () => consent.click());
  for (const text of [
    "Each collection runs Claude Code's own usage command and keeps only the 5-hour and weekly limit percentages and their reset times. The command uses the installed Claude Code sign-in and a small fixed set of environment variables, and nothing else from it is kept. If Claude Code reports no limits for the account, they show as Unknown.",
    "The readings are kept in this device's data folder and are not sent to a paired device. Export data includes them. A session cost is recorded only when the optional status line bridge reports one.",
    "Nothing is added to Claude Code's settings. Turn this switch off to stop the readings. If the status line bridge was installed separately, readings continue until it is removed.",
  ]) assert.ok(f.container.textContent.includes(text));
  assert.ok(!f.container.textContent.includes('footer keyboard hints'));
  assert.ok(!f.container.textContent.includes('only while a Claude Code session is responding'));
  const turnOn = f.button('Turn on');
  await act(async () => {
    f.button('Check for updates').click();
    turnOn.click();
  });
  assert.equal(f.messages.filter(message => message.action === 'set-limits-consent').length, 0);
  assert.ok(f.container.querySelector('.ob-settings-disclosure'));
  await f.answer(f.last('check-updates'));
  await act(async () => { turnOn.click(); turnOn.click(); });
  assert.deepEqual(f.messages.filter(message => message.action === 'set-limits-consent').map(message => message.args), [{ enabled: true }]);
  assert.equal(f.container.querySelector('.ob-settings-disclosure'), null);
  await f.answer(f.last('set-limits-consent'));
});

void test('host Confirm posts the status fingerprint and peer endpoint', async t => {
  const f = await fixture(t, 'identity-ready', true);
  await f.hosted();
  Object.assign(f.status.pairing, { state: 'confirming', peerFingerprint: 'ab'.repeat(32) });
  await f.click('Check for updates');
  await f.answer(f.last('check-updates'));
  const field = label => [...f.container.querySelectorAll('label')].find(node => node.textContent === label)?.querySelector('input');
  assert.equal(field('Peer fingerprint').value, 'ab'.repeat(32));
  assert.equal(field("This device's address"), undefined);
  assert.equal(field("This device's sync port"), undefined);
  await f.input(field('Peer address'), '100.64.0.2');
  await f.input(field('Peer port'), '9090');
  assert.equal(fieldFor(f, 'Share usage records with the paired device'), undefined);
  await f.click('Confirm');
  assert.deepEqual(f.last('pairing-host-confirm').args, {
    fingerprint: 'ab'.repeat(32), peerAddress: '100.64.0.2', peerPort: 9090, sharing: false,
  });
  assert.equal(f.last('pairing-join-confirm'), undefined);
  await f.answer(f.last('pairing-host-confirm'));
});

void test('join Confirm posts join confirmation and hides claimed invitation controls', async t => {
  const f = await fixture(t, 'idle', true);
  await f.click('Pair a device');
  await f.click('Join with an invitation');
  await f.input(f.container.querySelector('textarea'), invitation);
  await f.click('Claim');
  Object.assign(f.status.pairing, { state: 'awaiting-confirmation', peerFingerprint: null });
  await f.answer(f.last('pairing-join-claim'));
  assert.equal(f.container.querySelector('textarea'), null);
  assert.ok(!f.container.textContent.includes('Peer fingerprint'));
  assert.ok(![...f.container.querySelectorAll('button')].some(node => node.textContent === 'Claim'));
  assert.equal(fieldFor(f, 'Share usage records with the paired device'), undefined);
  await f.click('Confirm');
  assert.deepEqual(f.last('pairing-join-confirm').args, { sharing: false });
  assert.equal(f.last('pairing-host-confirm'), undefined);
  await f.answer(f.last('pairing-join-confirm'));
  for (const state of ['local-ready', 'acknowledged', 'paired']) {
    f.status.pairing.state = state;
    await f.click('Check for updates');
    await f.answer(f.last('check-updates'));
    assert.equal(f.container.querySelector('textarea'), null);
    assert.ok(![...f.container.querySelectorAll('button')].some(node => node.textContent === 'Claim'));
  }
});

const localReadyHelp = 'This device saved the pairing, but the other device has not confirmed that it received it. Keep pairing open on the other device and choose Try again. If the other device has closed pairing, make a new invitation there and join with it.';

void test('local-ready retries without sharing after a checked confirmation and remains retryable until acknowledged', async t => {
  const f = await fixture(t, 'awaiting-confirmation');
  const checkbox = fieldFor(f, 'Share usage records with the paired device');
  await act(async () => checkbox.click());
  assert.equal(checkbox.checked, true);
  await f.click('Confirm');
  assert.deepEqual(f.last('pairing-join-confirm').args, { sharing: true });
  await f.answer(f.last('pairing-join-confirm'));
  f.status.pairing.state = 'local-ready';
  await refresh(f);
  assert.ok([...f.container.querySelectorAll('p')].some(node => node.textContent === localReadyHelp));
  assert.equal(f.button('Try again').disabled, false);
  assert.equal(f.button('Cancel').disabled, false);
  const before = f.messages.length;
  await f.click('Try again');
  assert.deepEqual(f.messages.slice(before).map(({ action, args }) => ({ action, args })), [
    { action: 'pairing-join-confirm', args: { sharing: false } },
  ]);
  assert.equal(f.button('Try again').disabled, true);
  await f.answer(f.last('pairing-join-confirm'), { ok: false, code: 'unavailable' });
  assert.equal(f.button('Try again').disabled, false);
  assert.ok(f.container.textContent.includes(localReadyHelp));
  f.status.pairing.state = 'acknowledged';
  await refresh(f);
  assert.ok(![...f.container.querySelectorAll('button')].some(node => node.textContent === 'Try again'));
  assert.ok(!f.container.textContent.includes(localReadyHelp));
});

for (const state of ['awaiting-confirmation', 'acknowledged', 'configuration-ready', 'paired']) {
  void test(`pairing ${state} does not show local-ready recovery`, async t => {
    const f = await fixture(t, state);
    assert.ok(![...f.container.querySelectorAll('button')].some(node => node.textContent === 'Try again'));
    assert.ok(!f.container.textContent.includes(localReadyHelp));
  });
}

for (const state of ['waiting', 'confirming', 'awaiting-confirmation', 'local-ready', 'acknowledged']) {
  void test(`pairing polls in ${state} and stops when paired`, async t => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const f = await fixture(t, 'waiting');
    Object.assign(f.status.pairing, { state, peerFingerprint: state === 'confirming' ? 'ab'.repeat(32) : null });
    const count = () => f.messages.filter(message => message.action === 'status').length;
    const tick = async () => act(async () => t.mock.timers.tick(10000));
    await tick();
    const before = count();
    await tick();
    assert.ok(count() > before);
    Object.assign(f.status.pairing, { state: 'paired', peerFingerprint: null });
    await tick();
    const paired = count();
    await tick();
    assert.equal(count(), paired);
  });
}

const fieldFor = (f, label) => [...f.container.querySelectorAll('label')].find(node => node.textContent === label)?.querySelector('input');

void test('opening host requests defaults once and fills editable fields with a port warning', async t => {
  const f = await fixture(t, 'idle');
  assert.equal(f.last('pairing-host-defaults'), undefined);
  await f.click('Pair a device');
  await f.click('Host on this device');
  const request = f.last('pairing-host-defaults');
  assert.ok(request);
  await f.answer(request, { value: { address: '100.101.102.103', port: 43128, portAvailable: false } });
  assert.equal(fieldFor(f, "This device's address").value, '100.101.102.103');
  assert.equal(fieldFor(f, "This device's sync port").value, '43128');
  assert.match(f.container.textContent, /This port is in use/);
  await f.click('Check for updates');
  await f.answer(f.last('check-updates'));
  assert.equal(f.messages.filter(message => message.action === 'pairing-host-defaults').length, 1);
  await f.input(fieldFor(f, "This device's sync port"), '43129');
  assert.doesNotMatch(f.container.textContent, /This port is in use/);
  await f.click('Start');
  assert.deepEqual(f.last('pairing-host-start').args, { address: '100.101.102.103', port: 43129 });
});

for (const value of [
  { address: '100.101.102.103', port: 43128, portAvailable: false, extra: true },
  { address: 'example.test', port: 43128, portAvailable: true },
  { address: '100.101.102.103', port: '43128', portAvailable: null },
]) {
  void test('invalid host defaults leave both fields empty', async t => {
    const f = await fixture(t);
    await openHost(f);
    await f.answer(f.last('pairing-host-defaults'), { value });
    assert.equal(fieldFor(f, "This device's address").value, '');
    assert.equal(fieldFor(f, "This device's sync port").value, '');
    assert.doesNotMatch(f.container.textContent, /This port is in use/);
  });
}

void test('null defaults leave the address empty without a warning', async t => {
  const f = await fixture(t);
  await openHost(f);
  await f.answer(f.last('pairing-host-defaults'), { value: { address: null, port: 43128, portAvailable: null } });
  assert.equal(fieldFor(f, "This device's address").value, '');
  assert.equal(fieldFor(f, "This device's sync port").value, '43128');
  assert.doesNotMatch(f.container.textContent, /This port is in use/);
});

void test('delayed host defaults preserve edited fields', async t => {
  const f = await fixture(t);
  await openHost(f);
  await f.input(fieldFor(f, "This device's address"), 'fd7a:115c:a1e0::1234');
  await f.answer(f.last('pairing-host-defaults'), { value: { address: '100.101.102.103', port: 43128, portAvailable: true } });
  assert.equal(fieldFor(f, "This device's address").value, 'fd7a:115c:a1e0::1234');
});

for (const host of [true, false]) {
  void test(`pairing ${host ? 'host' : 'join'} sends the checked sharing choice`, async t => {
    const f = await fixture(t, 'awaiting-confirmation');
    if (host) {
      Object.assign(f.status.pairing, { state: 'confirming', peerFingerprint: 'ab'.repeat(32) });
      await f.click('Check for updates');
      await f.answer(f.last('check-updates'));
      await f.answer(f.last('pairing-peer-address'), { value: { peerAddress: 'fd7a:115c:a1e0::1234' } });
      assert.equal(fieldFor(f, 'Peer address').value, 'fd7a:115c:a1e0::1234');
      assert.equal(fieldFor(f, 'Peer port').value, '43128');
      await f.click('Check for updates');
      await f.answer(f.last('check-updates'));
      assert.equal(f.messages.filter(message => message.action === 'pairing-peer-address').length, 1);
    }
    const boxes = [...f.container.querySelectorAll('label')].filter(node => node.textContent === 'Share usage records with the paired device');
    const checkbox = boxes[0].querySelector('input');
    assert.equal(checkbox.checked, false);
    await act(async () => checkbox.click());
    await f.click('Confirm');
    assert.deepEqual(f.last(host ? 'pairing-host-confirm' : 'pairing-join-confirm').args, host ?
      { fingerprint: 'ab'.repeat(32), peerAddress: 'fd7a:115c:a1e0::1234', peerPort: 43128, sharing: true } : { sharing: true });
  });
}

void test('one sharing switch posts the choice and channel rows have no switches', async t => {
  const f = await fixture(t, 'paired');
  for (const label of ['Share Codex limits', 'Share Claude Code tokens']) assert.equal(fieldFor(f, label), undefined);
  const choice = fieldFor(f, 'Share usage records with the paired device');
  await act(async () => choice.click());
  assert.deepEqual(f.last('set-sharing-choice').args, { enabled: true });
  assert.equal(f.last('set-sharing'), undefined);
  f.status.sharingChoice = { chosen: true, channels: { 'codex-limits': 'on', 'claude-code-tokens': 'waiting-for-reading' } };
  await f.answer(f.last('set-sharing-choice'));
  assert.equal(choice.checked, true);
  assert.match(f.container.textContent, /Waiting for a reading/);
});

async function refresh(f) {
  await f.click('Check for updates');
  await f.answer(f.last('check-updates'));
}
async function openHost(f) {
  await f.click('Pair a device');
  await f.click('Host on this device');
}

void test('identity-ready opens without requesting defaults until Host is clicked', async t => {
  const f = await fixture(t);
  assert.equal(f.last('pairing-host-defaults'), undefined);
  await refresh(f);
  assert.equal(f.last('pairing-host-defaults'), undefined);
  await openHost(f);
  await f.answer(f.last('pairing-host-defaults'), { ok: false, code: 'unavailable' });
  await refresh(f);
  assert.equal(f.messages.filter(m => m.action === 'pairing-host-defaults').length, 1);
});

void test('placeholder sharing uses per-channel tokens and disabled reasons', async t => {
  const f = await fixture(t, 'paired', true);
  assert.equal(fieldFor(f, 'Share usage records with the paired device'), undefined);
  for (const [channel, label] of [['codex-limits', 'Share Codex limits'], ['claude-code-tokens', 'Share Claude Code tokens']]) {
    Object.assign(f.status.sharing[channel], { enabled: false, canEnable: true, reason: 'ready', token: 'ab'.repeat(32) });
    await refresh(f);
    await act(async () => fieldFor(f, label).click());
    assert.deepEqual(f.last('set-sharing').args, { channel, enabled: true, token: 'ab'.repeat(32) });
    await f.answer(f.last('set-sharing'));
    Object.assign(f.status.sharing[channel], { enabled: false, canEnable: false, reason: 'pairing-unavailable', token: null });
    await refresh(f);
    assert.equal(fieldFor(f, label).disabled, true);
    assert.match(f.container.textContent, /Pair a device before enabling sharing/);
  }
  assert.equal(f.last('set-sharing-choice'), undefined);
});

void test('real sharing reflects legacy on channels and disables while unpaired', async t => {
  const f = await fixture(t, 'paired');
  f.status.sharingChoice = { chosen: false, channels: { 'codex-limits': 'on', 'claude-code-tokens': 'unavailable' } };
  await refresh(f);
  const choice = fieldFor(f, 'Share usage records with the paired device');
  assert.equal(choice.checked, true);
  assert.match(f.container.textContent, /Share Codex limitsOn/);
  assert.match(f.container.textContent, /Share Claude Code tokensUnknown/);
  await act(async () => choice.click());
  assert.deepEqual(f.last('set-sharing-choice').args, { enabled: false });
  await f.answer(f.last('set-sharing-choice'));
  for (const state of ['paired', 'establishing-trust', 'active-sync', 'sync-stale', 'idle', 'revoked']) {
    f.status.pairing.state = state;
    await refresh(f);
    assert.equal(choice.disabled, ['idle', 'revoked'].includes(state));
  }
  assert.match(f.container.textContent, /Pair a device before enabling sharing/);
});

for (const successAt of [1, 2, 3, null]) {
  void test(`peer address retries on refresh and stops at ${successAt ?? 'three failures'}`, async t => {
    const f = await fixture(t, 'waiting');
    Object.assign(f.status.pairing, { state: 'confirming', peerFingerprint: 'ab'.repeat(32) });
    await refresh(f);
    const count = () => f.messages.filter(m => m.action === 'pairing-peer-address').length;
    for (let attempt = 1; attempt <= (successAt ?? 3); attempt++) {
      assert.equal(count(), attempt);
      const result = attempt === successAt ? { value: { peerAddress: '100.64.0.2' } } :
        attempt === 1 ? { ok: false, code: 'unavailable' } :
        attempt === 2 ? { value: { peerAddress: null } } : { value: { peerAddress: 'invalid.test' } };
      await f.answer(f.last('pairing-peer-address'), result);
      assert.equal(count(), attempt);
      await refresh(f);
    }
    await refresh(f);
    assert.equal(count(), successAt ?? 3);
    assert.equal(fieldFor(f, 'Peer address').value, successAt ? '100.64.0.2' : '');
  });
}

void test('peer defaults preserve typing and new fingerprints reset peer fields and sharing', async t => {
  const f = await fixture(t, 'waiting');
  Object.assign(f.status.pairing, { state: 'confirming', peerFingerprint: 'ab'.repeat(32) });
  await refresh(f);
  const old = f.last('pairing-peer-address');
  await f.input(fieldFor(f, 'Peer address'), '100.64.0.3');
  await f.answer(old, { value: { peerAddress: '100.64.0.2' } });
  assert.equal(fieldFor(f, 'Peer address').value, '100.64.0.3');
  await act(async () => fieldFor(f, 'Share usage records with the paired device').click());
  assert.equal(fieldFor(f, 'Share usage records with the paired device').checked, true);
  await f.input(fieldFor(f, 'Peer port'), '43129');
  Object.assign(f.status.pairing, { state: 'working', peerFingerprint: null });
  await refresh(f);
  Object.assign(f.status.pairing, { state: 'confirming', peerFingerprint: 'ab'.repeat(32) });
  await refresh(f);
  assert.equal(fieldFor(f, 'Peer address').value, '100.64.0.3');
  assert.equal(fieldFor(f, 'Peer port').value, '43129');
  assert.equal(fieldFor(f, 'Share usage records with the paired device').checked, true);
  assert.equal(f.messages.filter(m => m.action === 'pairing-peer-address').length, 1);
  f.status.pairing.peerFingerprint = 'cd'.repeat(32);
  await refresh(f);
  assert.equal(fieldFor(f, 'Peer address').value, '');
  assert.equal(fieldFor(f, 'Peer port').value, '43128');
  assert.equal(fieldFor(f, 'Share usage records with the paired device').checked, false);
  await f.answer(f.last('pairing-peer-address'), { value: { peerAddress: '100.64.0.4' } });
  assert.equal(fieldFor(f, 'Peer address').value, '100.64.0.4');
  f.status.pairing.peerFingerprint = 'ab'.repeat(32);
  await refresh(f);
  assert.equal(fieldFor(f, 'Peer address').value, '');
  assert.equal(f.messages.filter(m => m.action === 'pairing-peer-address').length, 3);
  await f.answer(f.last('pairing-peer-address'), { value: { peerAddress: '100.64.0.5' } });
  assert.equal(fieldFor(f, 'Peer address').value, '100.64.0.5');
});

void test('host warning follows both exact defaults and typed fields survive state changes', async t => {
  const f = await fixture(t);
  await openHost(f);
  await f.answer(f.last('pairing-host-defaults'), { value: { address: '100.64.0.1', port: 43128, portAvailable: false } });
  assert.match(f.container.textContent, /This port is in use/);
  await f.input(fieldFor(f, "This device's address"), '100.64.0.2');
  assert.doesNotMatch(f.container.textContent, /This port is in use/);
  await f.input(fieldFor(f, "This device's address"), '100.64.0.1');
  assert.match(f.container.textContent, /This port is in use/);
  await f.input(fieldFor(f, "This device's sync port"), '43129');
  assert.doesNotMatch(f.container.textContent, /This port is in use/);
  f.status.pairing.state = 'working';
  await refresh(f);
  assert.equal(fieldFor(f, "This device's address").value, '100.64.0.1');
  assert.equal(fieldFor(f, "This device's sync port").value, '43129');
});

void test('revoked offers repair instead of a new pairing', async t => {
  const f = await fixture(t, 'revoked');
  assert.ok(![...f.container.querySelectorAll('button')].some(node => node.textContent === 'Pair a device'));
  await f.click('Prepare pairing repair');
  assert.ok(f.last('pairing-repair-prepare'));
});
