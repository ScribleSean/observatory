import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sampleSetupStatus, SETUP_SOURCES } from '../lib/view-setup.mjs';
import strings from '../lib/strings.json' with { type: 'json' };
const { createServer } = await import('vite');
const { default: react } = await import('@vitejs/plugin-react');
const server = await createServer({ configFile: false, root: fileURLToPath(new URL('..', import.meta.url)), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', plugins: [react()] });
after(() => server.close());
const { SetupContent } = await server.ssrLoadModule('/app/viewer/setup/SetupView.tsx');
const { DashboardView, sectionFromHash } = await server.ssrLoadModule('/app/viewer/dashboard.tsx');
const { SKINS } = await server.ssrLoadModule('/app/viewer/skin.ts');
const { validateSkin, skinCss } = await server.ssrLoadModule('/lib/skins.mjs');
const noop = () => {};
const render = (step, props = {}) => renderToStaticMarkup(createElement(SetupContent, {
  step, status: sampleSetupStatus(), available: true, busy: false, message: '', disclosureOpen: false,
  onStep: noop, onSource: noop, onLimits: noop, onConfirm: noop, onCancel: noop, onFinish: noop, ...props,
}));
for (const skinId of ['sage', 'almanac']) void test(`wizard renders all steps in ${skinId}`, () => {
  const skin = validateSkin(SKINS[skinId]);
  const source = render(0);
  assert.equal((source.match(/type="checkbox"/g) ?? []).length, 6);
  assert.doesNotMatch(source, / checked=""|>Finish<|<a\b/);
  for (const row of [...SETUP_SOURCES, { label: strings.settings.claudeLimits, hint: strings.setup.claudeLimitsHint }]) {
    assert.ok(source.includes(row.label)); assert.ok(source.includes(row.hint));
  }
  const pairing = render(1);
  assert.ok(pairing.includes('later, in Settings'));
  assert.deepEqual([...pairing.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map(match => match[1]), ['Back', 'Continue']);
  const finish = render(2);
  assert.match(finish, />Finish<\/button>/);
  assert.equal((finish.match(/>Off</g) ?? []).length, 6);
  assert.ok(finish.includes(strings.setup.finishNone));
  for (const html of [source, pairing, finish]) {
    assert.doesNotMatch(html, /ssh|\u2014|pair Windows/i);
    assert.ok(renderToStaticMarkup(createElement('div', null, createElement('style', null, skinCss(skin)), createElement('div', { dangerouslySetInnerHTML: { __html: html } }))).includes('--ob-background'));
  }
  const dashboard = renderToStaticMarkup(createElement(DashboardView, { demo: true, snapshot: null, loaded: true, now: 0, skinId, skin, section: 'setup', onSectionChange: noop, onSkinChange: noop }));
  assert.ok(dashboard.includes(strings.setup.title));
  assert.ok(dashboard.includes('ob-setup'));
  assert.doesNotMatch(dashboard, /<nav/);
});
void test('missing status and unavailable transport keep controls disabled', () => {
  const unknown = render(2, { status: null });
  assert.equal((unknown.match(/>Unknown</g) ?? []).length, 6);
  assert.doesNotMatch(unknown, />Off</);
  assert.match(unknown, /<button[^>]*disabled=""[^>]*>Finish/);
  const offline = render(0, { available: false });
  assert.ok(offline.includes(strings.setup.appOnly));
  for (const match of offline.matchAll(/<input[^>]*>/g)) assert.match(match[0], /disabled=""/);
});
void test('setup is an exact fragment and settings remains supported', () => {
  for (const [hash, section] of [['#setup', 'setup'], ['#Setup', 'limits'], ['#setup/x', 'limits'], ['#settings', 'settings']]) assert.equal(sectionFromHash(hash), section);
});
