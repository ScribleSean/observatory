import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { act, createElement } from 'react';
import { sampleSetupStatus, setupSummary } from '../lib/view-setup.mjs';
import strings from '../lib/strings.json' with { type: 'json' };
const { createServer } = await import('vite');
const { default: react } = await import('@vitejs/plugin-react');
const server = await createServer({ configFile: false, root: fileURLToPath(new URL('..', import.meta.url)), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', plugins: [react()] });
after(() => server.close());
const allActions = new Set();
after(() => { for (const action of allActions) assert.ok(['status', 'set-source', 'set-limits-consent', 'complete-setup'].includes(action), action); });
let SetupView;
async function fixture(t, { code = 'done', demo = false, firstStatus, dashboard = false, holdRetry = false } = {}) {
  const win = new Window({ url: 'https://synthetic.test/dashboard.html#setup' });
  const globals = { window: win, document: win.document, navigator: win.navigator, HTMLElement: win.HTMLElement, HTMLInputElement: win.HTMLInputElement, Node: win.Node, Event: win.Event, MouseEvent: win.MouseEvent, IS_REACT_ACT_ENVIRONMENT: true };
  const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  const { createRoot } = await import('react-dom/client');
  SetupView ??= (await server.ssrLoadModule('/app/viewer/setup/SetupView.tsx')).SetupView;
  const { validateBridgeStatus } = await server.ssrLoadModule('/app/viewer/settings/status.ts');
  const status = sampleSetupStatus();
  const messages = [];
  const blocked = [];
  let releaseRetry;
  let finished = 0;
  let disposed = false;
  const bridge = {
    available: true,
    async send(action, args) {
      allActions.add(action); messages.push({ action, args });
      if (action === 'status' && messages.length === 1 && firstStatus) return { id: 1, ...firstStatus };
      if (action === 'status' && messages.length === 2 && holdRetry) await new Promise(resolve => { releaseRetry = resolve; });
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
  let element;
  if (dashboard) {
    win.webkit = { messageHandlers: { bridge: { postMessage(text) {
      const message = JSON.parse(text);
      void bridge.send(message.action, message.args).then(result => {
        win.dispatchEvent(new win.CustomEvent('observatory:bridge-result', { detail: { ...result, id: message.id } }));
      });
    } } } };
    const { DashboardView, sectionFromHash } = await server.ssrLoadModule('/app/viewer/dashboard.tsx');
    const { SKINS } = await server.ssrLoadModule('/app/viewer/skin.ts');
    const { validateSkin } = await server.ssrLoadModule('/lib/skins.mjs');
    element = createElement(DashboardView, {
      actionsAvailable: true, snapshot: null, loaded: true, now: 0, skinId: 'sage', skin: validateSkin(SKINS.sage),
      section: sectionFromHash(win.location.hash), onSectionChange: () => {}, onSkinChange: () => {},
    });
  } else {
    element = createElement(SetupView, { demo, ...(demo ? {} : { bridge }), onFinished: () => { finished++; }, onBlockedChange: value => blocked.push(value) });
  }
  await act(async () => root.render(element));
  await act(waitDemo);
  const button = text => [...container.querySelectorAll('button')].find(node => node.textContent === text);
  const click = async text => { assert.ok(button(text), text); await act(async () => { button(text).click(); await waitDemo(); }); };
  const toggle = async text => act(async () => [...container.querySelectorAll('label')].find(node => node.textContent === text).querySelector('input').click());
  return { win, container, messages, click, toggle, blocked, releaseRetry: async () => act(async () => releaseRetry()), finished: () => finished };
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
  for (const key of ['disclosureCommand', 'disclosureStorage', 'disclosureOff']) assert.ok(f.container.textContent.includes(strings.settings[key]));
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

for (const invalid of [false, true]) void test(`${invalid ? 'invalid' : 'unavailable'} status can retry and unblock setup`, async t => {
  const value = sampleSetupStatus();
  delete value.collectionPaused;
  const firstStatus = invalid ? { ok: true, code: 'done', value } : { ok: false, code: 'unavailable' };
  const f = await fixture(t, { firstStatus, holdRetry: true });
  assert.equal(f.container.querySelector('[role="alert"]').textContent, strings.setup.statusUnavailable);
  assert.deepEqual(f.blocked, [false, true]);
  assert.ok([...f.container.querySelectorAll('input')].every(input => input.disabled));
  const retry = () => [...f.container.querySelectorAll('button')].find(button => button.textContent === strings.setup.retry);
  assert.equal(retry().disabled, false);
  await f.click(strings.setup.retry);
  assert.equal(retry().disabled, true);
  await f.click(strings.setup.retry);
  assert.deepEqual(f.messages, [{ action: 'status', args: {} }, { action: 'status', args: {} }]);
  assert.deepEqual(f.blocked, [false, true]);
  await f.releaseRetry();
  assert.equal(f.container.querySelector('[role="alert"]'), null);
  assert.equal(retry(), undefined);
  assert.ok([...f.container.querySelectorAll('input')].every(input => !input.disabled));
  assert.deepEqual(f.blocked, [false, true, false]);
  assert.deepEqual(f.messages.map(message => message.action), ['status', 'status']);
});
void test('DashboardView at #setup restores navigation after rejected status', async t => {
  const f = await fixture(t, { dashboard: true, firstStatus: { ok: false, code: 'unavailable' } });
  assert.equal(f.win.location.hash, '#setup');
  assert.ok(f.container.querySelector('[role="alert"]'));
  assert.ok(f.container.querySelector('nav'));
  assert.deepEqual(f.messages, [{ action: 'status', args: {} }]);
});

void test('setup summary preserves unknown limits without counting them as on', () => {
  const status = sampleSetupStatus();
  status.limitsConsent = null;
  const summary = setupSummary(status);
  assert.equal(summary.rows.find(row => row.id === 'claudeLimits').on, null);
  assert.equal(summary.anyOn, false);
  assert.equal(summary.noneOn, false);
  status.limitsConsent = false;
  assert.equal(setupSummary(status).noneOn, true);
});

void test('setup renders null limits as Unknown in sources and summary', async t => {
  const status = sampleSetupStatus();
  status.limitsConsent = null;
  const f = await fixture(t, { firstStatus: { ok: true, code: 'done', value: status } });
  const label = [...f.container.querySelectorAll('label')].find(node => node.textContent === strings.settings.claudeLimits);
  assert.equal(label.querySelector('input').disabled, true);
  assert.equal(label.querySelector('input').getAttribute('aria-checked'), 'mixed');
  assert.equal(label.parentElement.querySelector('.ob-meta').textContent, 'Unknown');
  await f.click('Continue');
  await f.click('Continue');
  const row = [...f.container.querySelectorAll('.ob-setup-summary li')].find(node => node.firstElementChild.textContent === strings.settings.claudeLimits);
  assert.equal(row.lastElementChild.textContent, 'Unknown');
  // Every source is off but the limits switch is unknown, so the page does not claim that no source is on.
  assert.equal(f.container.textContent.includes(strings.setup.finishNone), false);
});
