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
    for (const label of ['Device', 'Period', 'Date', strings.activity.zoneCaveat.replace('{zone}', 'UTC'), strings.activity.hourlyTitle.replace('{zone}', 'UTC'), strings.activity.help, strings.activity.helpAddress, empty ? strings.activity.trackingUnavailable : strings.activity.trackingRecent]) assert.ok(html.includes(label), label);
    assert.match(html, /aria-expanded="false"/);
    assert.doesNotMatch(html, /href=|<a\b/);
    if (empty) { assert.ok(html.includes('Unknown')); assert.doesNotMatch(html, /0m/); }
  });
}
test('Now puts its window note in the page and shows a distinct meter', () => {
  const html = render(ActivityView, { snapshot: sampleSnapshot(now), now, initialHost: 'Mac', initialPeriod: 'now' });
  assert.ok(html.includes(strings.activity.nowCaveat));
  assert.match(html, /class="ob-activity-now"/);
  assert.match(html, /class="ob-bar"/);
  assert.ok(html.includes('of the last 1h 30m'));
  const empty = render(ActivityView, { snapshot: null, now, initialPeriod: 'now' });
  assert.doesNotMatch(empty, /class="ob-bar"/);
  assert.ok(empty.includes('Unknown'));
});
test('tracking help names the snapshot time zone for both times', () => {
  const snapshot = sampleSnapshot(now);
  snapshot.timezone = 'UTC';
  const html = render(ActivityView, { snapshot, now });
  assert.match(html, /Last tracking coverage: [^<]*?UTC/);
  assert.match(html, /Last successful collection: [^<]*?UTC/);
});
test('the time zone sentence lives in Details, not on its own line', () => {
  const zone = strings.activity.zoneCaveat.replace('{zone}', 'UTC');
  for (const initialPeriod of ['day', 'now']) {
    const html = render(ActivityView, { snapshot: { ...sampleSnapshot(now), timezone: 'UTC' }, now, initialPeriod });
    const id = html.match(new RegExp(`aria-controls="([^"]+)"[^>]*>${strings.activity.details}</button>`))?.[1];
    assert.ok(id, initialPeriod);
    const detail = html.match(new RegExp(`<span id="${id}" hidden="">([^<]*)</span>`))?.[1] ?? '';
    assert.ok(detail.includes(zone), initialPeriod);
    assert.equal(html.split(zone).length, 2, initialPeriod);
  }
});
