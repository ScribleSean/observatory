import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { demoSnapshot } from '../lib/panel-data.mjs';
import { validateSkin } from '../lib/skins.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
// Vite is loaded by name at run time. A static import pulls its types into the
// type-aware lint program and changes how every other test file is checked.
const load = specifier => import(specifier);
const { createServer } = await load('vite');
const { default: react } = await load('@vitejs/plugin-react');
const server = await createServer({ configFile: false, root, server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', plugins: [react()] });
after(() => server.close());
const { PanelView, SKINS } = await server.ssrLoadModule('/app/viewer/panel/panel.tsx');
const { DashboardView } = await server.ssrLoadModule('/app/viewer/dashboard.tsx');
const now = Date.parse('2026-10-14T12:00:00Z');
const noop = () => {};
const base = { snapshot: demoSnapshot(now), loaded: true, busy: false, now, skinId: 'sage', skin: validateSkin(SKINS.sage), host: 'All', period: 'day', onHostChange: noop, onPeriodChange: noop, onSkinChange: noop, onAction: noop };
const panel = props => renderToStaticMarkup(createElement(PanelView, { ...base, ...props }));
const dashboard = props => renderToStaticMarkup(createElement(DashboardView, { ...base, demo: true, section: 'limits', onSectionChange: noop, ...props }));

for (const skinId of ['sage', 'almanac', 'amber-crt']) {
  void test(`panel labels and provider rows in ${skinId}`, () => {
    const html = panel({ skinId, skin: validateSkin(SKINS[skinId]) });
    for (const label of ['Limits', 'Totals', 'Device', 'Period', 'Refresh', 'Check for updates', 'Settings']) assert.ok(html.includes(`aria-label="${label}"`), label);
    for (const label of ['Now', 'Day', 'Week', 'Month', 'All time', 'Open Observatory', 'Sample data']) assert.ok(html.includes(label), label);
    for (const provider of ['claude', 'codex']) assert.equal((html.match(new RegExp(`data-provider="${provider}"`, 'g')) ?? []).length, 2);
    assert.equal((html.match(/data-window="5-hour"/g) ?? []).length, 2);
    assert.equal((html.match(/data-window="weekly"/g) ?? []).length, 2);
    assert.equal((html.match(/<nav class="ob-actions"[\s\S]*?<\/nav>/)?.[0].match(/<button/g) ?? []).length, 4);
  });
}

function sectionNames(html) {
  const nav = html.match(/<nav aria-label="Sections">([\s\S]*?)<\/nav>/);
  assert.ok(nav);
  return [...nav[1].matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map(match => match[1]);
}

void test('dashboard sections omit disconnected dictation and preserve their order', () => {
  assert.deepEqual(sectionNames(dashboard({ snapshot: { ...base.snapshot, dictation: [] } })), ['Limits', 'Activity', 'Tokens', 'Sources', 'Settings']);
  assert.deepEqual(sectionNames(dashboard({ snapshot: { ...base.snapshot, dictation: [{ status: 'ok' }] } })), ['Limits', 'Activity', 'Tokens', 'Dictation', 'Sources', 'Settings']);
});

for (const skinId of ['sage', 'almanac', 'amber-crt']) {
  void test(`unavailable values stay Unknown in ${skinId}`, () => {
    const html = panel({ skinId, skin: validateSkin(SKINS[skinId]), snapshot: { quota: { status: 'unavailable' }, tokens: [], activity: [], providerTokenSources: [] } });
    assert.ok(html.includes('Unknown'));
    assert.doesNotMatch(html, /0%|>0<|>0m<|\$0\.00/);
    assert.equal((html.match(/data-window="unknown"/g) ?? []).length, 2);
  });
}

function tsxFiles(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? tsxFiles(`${path}/${entry.name}`) : entry.name.endsWith('.tsx') ? [`${path}/${entry.name}`] : []);
}

void test('viewer JSX has no literal user-visible English', () => {
  for (const path of [...tsxFiles(`${root}/app/viewer`), `${root}/app/panel.tsx`]) {
    const source = readFileSync(path, 'utf8');
    assert.doesNotMatch(source, /(?<!=)>\s*[A-Za-z][^<>{}]*</, path);
    assert.doesNotMatch(source, /\b(?:aria-label|title|label|placeholder)\s*=\s*(?:["'][^"']*["']|\{\s*["'][^"']*["']\s*\})/, path);
  }
});
