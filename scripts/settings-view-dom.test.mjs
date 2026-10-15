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

async function fixture(t, state = 'identity-ready') {
  const win = new Window({ url: 'https://synthetic.test/dashboard.html' });
  const globals = { window: win, document: win.document, navigator: win.navigator, HTMLElement: win.HTMLElement, HTMLInputElement: win.HTMLInputElement, HTMLTextAreaElement: win.HTMLTextAreaElement, Node: win.Node, Event: win.Event, MouseEvent: win.MouseEvent, IS_REACT_ACT_ENVIRONMENT: true };
  const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  const { createRoot } = await import('react-dom/client');
  SettingsView ??= (await server.ssrLoadModule('/app/viewer/settings/settings.tsx')).SettingsView;
  const status = sampleBridgeStatus();
  Object.assign(status.pairing, { state, invitationKept: state === 'waiting' });
  status.limitsConsent = false;
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
    'Claude Code hides most of its footer keyboard hints while any custom status line is configured.',
    'Readings arrive only while a Claude Code session is responding, and only for Pro and Max subscriptions.',
    'The limits are account-wide. They are observed on this device and are not sent to a paired device.',
  ]) assert.ok(f.container.textContent.includes(text));
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
  const f = await fixture(t);
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
  await f.click('Confirm');
  assert.deepEqual(f.last('pairing-host-confirm').args, {
    fingerprint: 'ab'.repeat(32), peerAddress: '100.64.0.2', peerPort: 9090,
  });
  assert.equal(f.last('pairing-join-confirm'), undefined);
  await f.answer(f.last('pairing-host-confirm'));
});

void test('join Confirm posts join confirmation and hides claimed invitation controls', async t => {
  const f = await fixture(t, 'idle');
  await f.click('Pair a device');
  await f.click('Join with an invitation');
  await f.input(f.container.querySelector('textarea'), invitation);
  await f.click('Claim');
  Object.assign(f.status.pairing, { state: 'awaiting-confirmation', peerFingerprint: null });
  await f.answer(f.last('pairing-join-claim'));
  assert.equal(f.container.querySelector('textarea'), null);
  assert.ok(!f.container.textContent.includes('Peer fingerprint'));
  assert.ok(![...f.container.querySelectorAll('button')].some(node => node.textContent === 'Claim'));
  await f.click('Confirm');
  assert.deepEqual(f.last('pairing-join-confirm').args, {});
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
