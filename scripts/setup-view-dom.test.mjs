import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { act, createElement } from 'react';
import { sampleSetupStatus } from '../lib/view-setup.mjs';
import strings from '../lib/strings.json' with { type: 'json' };
const { createServer } = await import('vite');
const { default: react } = await import('@vitejs/plugin-react');
const server = await createServer({ configFile: false, root: fileURLToPath(new URL('..', import.meta.url)), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', plugins: [react()] });
after(() => server.close());
const allActions = new Set();
after(() => { for (const action of allActions) assert.ok(['status', 'set-source', 'set-limits-consent', 'complete-setup'].includes(action), action); });
let SetupView;
async function fixture(t, { code = 'done', demo = false } = {}) {
  const win = new Window({ url: 'https://synthetic.test/dashboard.html#setup' });
  const globals = { window: win, document: win.document, navigator: win.navigator, HTMLElement: win.HTMLElement, HTMLInputElement: win.HTMLInputElement, Node: win.Node, Event: win.Event, MouseEvent: win.MouseEvent, IS_REACT_ACT_ENVIRONMENT: true };
  const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  const { createRoot } = await import('react-dom/client');
  SetupView ??= (await server.ssrLoadModule('/app/viewer/setup/SetupView.tsx')).SetupView;
  const { validateBridgeStatus } = await server.ssrLoadModule('/app/viewer/settings/status.ts');
  const status = sampleSetupStatus();
  const messages = [];
  let finished = 0;
  let disposed = false;
  const bridge = {
    available: true,
    async send(action, args) {
      allActions.add(action); messages.push({ action, args });
      if (action === 'set-source') status.sources[args.source] = args.enabled;
      if (action === 'set-limits-consent') status.limitsConsent = args.enabled;
      const resultCode = action === 'complete-setup' ? code : 'done';
      return { id: messages.length, ok: resultCode === 'done', code: resultCode, ...(action === 'status' ? { value: validateBridgeStatus(status) } : {}) };
    },
    onLateResult() { return () => {}; }, dispose() { disposed = true; },
  };
  const container = win.document.createElement('div'); win.document.body.append(container);
  const root = createRoot(container);
  t.after(async () => {
    try { await act(async () => root.unmount()); assert.equal(disposed, false); await win.happyDOM.close(); }
    finally { for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } }
  });
  const waitDemo = () => demo ? new Promise(resolve => setTimeout(resolve, 400)) : Promise.resolve();
  await act(async () => root.render(createElement(SetupView, { demo, ...(demo ? {} : { bridge }), onFinished: () => { finished++; } })));
  await act(waitDemo);
  const button = text => [...container.querySelectorAll('button')].find(node => node.textContent === text);
  const click = async text => { assert.ok(button(text), text); await act(async () => { button(text).click(); await waitDemo(); }); };
  const toggle = async text => act(async () => [...container.querySelectorAll('label')].find(node => node.textContent === text).querySelector('input').click());
  return { win, container, messages, click, toggle, finished: () => finished };
}
void test('ActivityWatch alone completes with only the permitted action sequence', async t => {
  const f = await fixture(t);
  await f.toggle('ActivityWatch'); await f.click('Continue'); await f.click('Continue'); await f.click('Finish');
  assert.deepEqual(f.messages, [
    { action: 'status', args: {} }, { action: 'set-source', args: { source: 'activity', enabled: true } },
    { action: 'status', args: {} }, { action: 'complete-setup', args: {} }, { action: 'status', args: {} },
  ]);
  assert.equal(f.finished(), 1);
});
void test('Claude Code limits requires disclosure and clears on cancel and pagehide', async t => {
  const f = await fixture(t);
  await f.toggle('Claude Code limits');
  assert.equal(f.messages.length, 1);
  for (const key of ['disclosureHints', 'disclosureReadings', 'disclosureSharing']) assert.ok(f.container.textContent.includes(strings.settings[key]));
  await f.click('Cancel'); assert.equal(f.messages.length, 1); assert.equal(f.container.querySelector('.ob-settings-disclosure'), null);
  await f.toggle('Claude Code limits'); await f.click('Turn on');
  await f.toggle('Claude Code limits');
  assert.deepEqual(f.messages.filter(row => row.action === 'set-limits-consent').map(row => row.args), [{ enabled: true }, { enabled: false }]);
  await f.toggle('Claude Code limits');
  await act(async () => f.win.dispatchEvent(new f.win.Event('pagehide')));
  assert.equal(f.container.querySelector('.ob-settings-disclosure'), null);
});
void test('unavailable completion stays on finish', async t => {
  const f = await fixture(t, { code: 'unavailable' });
  await f.click('Continue'); await f.click('Continue'); await f.click('Finish');
  assert.equal(f.container.querySelector('h3').textContent, 'Finish');
  assert.equal(f.container.querySelector('output').textContent, strings.settings.unavailable);
  assert.equal(f.finished(), 0);
});
void test('navigation sends nothing and focuses the new heading', async t => {
  const f = await fixture(t);
  assert.notEqual(f.win.document.activeElement, f.container.querySelector('h3'));
  await f.click('Continue');
  assert.equal(f.win.document.activeElement, f.container.querySelector('h3'));
  assert.equal(f.win.document.activeElement.textContent, strings.setup.pairingTitle);
  await f.click('Back'); await f.click('Continue'); await f.click('Continue'); await f.click('Back');
  assert.deepEqual(f.messages, [{ action: 'status', args: {} }]);
});
void test('demo starts with every source off and finishes without native transport', async t => {
  const f = await fixture(t, { demo: true });
  assert.equal(f.win.webkit, undefined); assert.equal(f.win.chrome?.webview, undefined);
  const inputs = [...f.container.querySelectorAll('input[type="checkbox"]')];
  assert.equal(inputs.length, 6); assert.ok(inputs.every(input => !input.checked && !input.indeterminate));
  await f.click('Continue'); await f.click('Continue'); await f.click('Finish');
  assert.equal(f.finished(), 1);
});
