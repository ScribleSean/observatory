import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sampleSnapshot } from '../lib/sample-snapshot.mjs';
import { validateSkin } from '../lib/skins.mjs';
import strings from '../lib/strings.json' with { type: 'json' };

const load = specifier => import(specifier);
const { createServer } = await load('vite');
const { default: react } = await load('@vitejs/plugin-react');
const server = await createServer({ configFile: false, root: fileURLToPath(new URL('..', import.meta.url)), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', plugins: [react()] });
after(() => server.close());
const { ActivityView } = await server.ssrLoadModule('/app/viewer/activity/ActivityView.tsx');
const { SKINS } = await server.ssrLoadModule('/app/viewer/skin.ts');
const now = Date.parse('2026-10-14T12:32:00Z');
const noop = () => {};
const render = (Component, props) => renderToStaticMarkup(createElement(Component, props));
for (const skinId of ['sage']) for (const empty of [false, true]) for (const Component of [ActivityView]) {
  test(`${Component.name} in ${skinId}, ${empty ? 'empty' : 'sample'}`, () => {
    const snapshot = empty ? { timezone: 'UTC' } : sampleSnapshot(now);
    const html = render(Component, { snapshot, now, skinId, skin: validateSkin(SKINS[skinId]), loaded: true, section: 'activity', onSectionChange: noop, onSkinChange: noop });
    for (const label of [strings.devices.device, strings.devices.period, strings.activity.previousDay, strings.activity.hourlyTitle]) assert.ok(html.includes(label), label);
    // Recent tracking needs no words. Anything else says so, and an unreachable source links to ActivityWatch.
    assert.equal(html.includes(strings.activity.trackingUnavailable), empty);
    assert.equal(/href="https:\/\/activitywatch\.net"/.test(html), empty);
    assert.doesNotMatch(html, /<select|ob-info|aria-expanded/);
    if (empty) { assert.ok(html.includes('Unknown')); assert.doesNotMatch(html, />0m</); }
  });
}
test('Now puts its window note in the page and shows a distinct meter', () => {
  const html = render(ActivityView, { snapshot: sampleSnapshot(now), now, initialHost: 'Mac', initialPeriod: 'now' });
  assert.match(html, /class="ob-activity-now"/);
  assert.match(html, /class="ob-bar"/);
  assert.ok(html.includes('of the last 1h 30m'));
  const empty = render(ActivityView, { snapshot: null, now, initialPeriod: 'now' });
  assert.doesNotMatch(empty, /class="ob-bar"/);
  assert.ok(empty.includes('Unknown'));
});
test('the date stepper names the day and stops at the newest one', () => {
  const html = render(ActivityView, { snapshot: { ...sampleSnapshot(now), timezone: 'UTC' }, now });
  assert.match(html, /<output aria-live="polite">Oct 14<\/output>/);
  assert.match(html, /aria-label="Next day" disabled=""/);
  assert.doesNotMatch(html, /aria-label="Previous day" disabled=""/);
  assert.doesNotMatch(render(ActivityView, { snapshot: sampleSnapshot(now), now, initialPeriod: 'all' }), /ob-stepper/);
});
