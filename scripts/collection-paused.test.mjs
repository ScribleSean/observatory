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

for (const mode of ['native', 'demo', 'unavailable']) {
  void test(`dashboard collection status lifecycle in ${mode}`, async () => {
    const win = new Window({ url: 'https://synthetic.test/dashboard.html' });
    const posts = [];
    if (mode !== 'unavailable') win.webkit = { messageHandlers: { bridge: { postMessage: text => posts.push(JSON.parse(text)) } } };
    let tick;
    const globals = { window: win, document: win.document, navigator: win.navigator, HTMLElement: win.HTMLElement, Node: win.Node, MutationObserver: win.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true,
      fetch: async () => ({ ok: false }), setInterval: callback => { tick = callback; return 1; }, clearInterval: () => {} };
    const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    const { createRoot } = await import('react-dom/client');
    const { default: Dashboard } = await server.ssrLoadModule('/app/viewer/dashboard.tsx');
    const container = win.document.createElement('div');
    win.document.body.append(container);
    const root = createRoot(container);
    const answer = async collectionPaused => act(async () => {
      win.dispatchEvent(new win.CustomEvent('observatory:bridge-result', { detail: { id: posts.at(-1).id, ok: true, code: 'done', value: { ...sampleBridgeStatus(), collectionPaused } } }));
    });
    try {
      await act(async () => { root.render(createElement(Dashboard, { demo: mode === 'demo' })); await new Promise(resolve => setTimeout(resolve, 20)); });
      assert.equal(posts.length, mode === 'native' ? 1 : 0);
      if (mode === 'native') {
        assert.equal(posts[0].action, 'status');
        await answer(true);
        assert.match(container.querySelector('header').textContent, /Collection paused/);
        await act(async () => win.dispatchEvent(new win.Event('observatory:snapshot-changed')));
        assert.equal(posts.length, 2);
        await answer(false);
        assert.doesNotMatch(container.textContent, /Collection paused/);
        Object.defineProperty(win.document, 'hidden', { value: true, configurable: true });
        await act(async () => tick());
        assert.equal(posts.length, 2);
        Object.defineProperty(win.document, 'hidden', { value: false, configurable: true });
        await act(async () => tick());
        assert.equal(posts.length, 3);
        await answer(true);
      } else assert.doesNotMatch(container.textContent, /Collection paused/);
      await act(async () => root.unmount());
      const count = posts.length;
      win.dispatchEvent(new win.Event('observatory:snapshot-changed'));
      assert.equal(posts.length, count);
    } finally {
      await act(async () => root.unmount());
      await win.happyDOM.close();
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  });
}
