import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

process.env.TZ = 'UTC';
const root = fileURLToPath(new URL('..', import.meta.url));
const load = specifier => import(specifier);
const { createServer } = await load('vite');
const { default: react } = await load('@vitejs/plugin-react');
const server = await createServer({ configFile: false, root, server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', plugins: [react()] });
after(() => server.close());
const { default: LimitsView, LimitsView: NamedLimitsView } = await server.ssrLoadModule('/app/viewer/limits/LimitsView.tsx');
const now = Date.parse('2026-10-14T12:00:00Z');
const iso = minutes => new Date(now + minutes * 60000).toISOString();
const snapshot = () => {
  const source = (bucket, names) => {
    const windows = names.map((window, index) => ({ bucket, window, durationMinutes: index ? 10080 : 300, remainingPercent: 40, resetsAt: iso(600) }));
    return { status: 'ok', checkedAt: iso(-1), windows,
      history: Array.from({ length: 13 }, (_, index) => ({ checkedAt: iso(-61 + index * 5),
        windows: windows.map(row => ({ ...row, remainingPercent: row.remainingPercent + (12 - index) * 2 })) })) };
  };
  return { timezone: 'UTC', claudeLimits: { ...source('claude', ['five_hour', 'seven_day']) },
    quota: source('codex', ['primary', 'secondary']) };
};
const render = (data = snapshot(), props = {}) => renderToStaticMarkup(createElement(LimitsView, { snapshot: data, now, limitStyle: 'bar', ...props }));
const count = (html, pattern) => [...html.matchAll(pattern)].length;
const card = (html, title) => html.split('aria-label="' + title + ' limit left over time"')[1]?.split('</section>')[0] ?? assert.fail(title + ' card missing');

void test('every limit window has a chart whose header shows what is left now and when it resets', () => {
  assert.equal(LimitsView, NamedLimitsView);
  const html = render();
  assert.equal(count(html, /<figure class="ob-history-chart"/g), 4);
  for (const name of ['Claude Code', 'Codex']) for (const window of ['5-hour', 'weekly']) {
    const head = card(html, name + ' ' + window);
    assert.match(head, /class="ob-num">40%</, name + ' ' + window);
    assert.match(head, /Resets in 10h 0m/);
    assert.match(head, /runs out in about/, 'the projection is said once, in the header');
  }
  assert.ok(!html.includes('Session cost'));
});

void test('no footnotes or pace sentences: the layout carries it', () => {
  const html = render();
  for (const gone of ['Lines are never added together', 'per hour', 'Resets before running out', 'Show values', 'About history'])
    assert.ok(!html.includes(gone), gone);
});

void test('a stale reading shows Unknown and its warning, never a projection', () => {
  const data = snapshot();
  data.claudeLimits.checkedAt = data.quota.checkedAt = iso(-30);
  const html = render(data);
  assert.doesNotMatch(html, /runs out in about/);
  assert.match(card(html, 'Codex 5-hour'), /class="ob-meta warn"/);
  assert.match(card(html, 'Codex 5-hour'), /class="ob-num">Unknown</);
});

void test('a low limit warns in its header', () => {
  const data = snapshot();
  data.quota.windows[0].remainingPercent = 12;
  assert.match(card(render(data), 'Codex 5-hour'), /class="ob-num warn">12%/);
});

for (const data of [{ quota: { status: 'unavailable' } }, null]) {
  void test('unknown remains unknown for ' + (data ? 'unavailable quota' : 'null snapshot'), () => {
    const html = render(data);
    assert.equal(count(html, /class="ob-num">Unknown</g), 4);
    assert.doesNotMatch(html.replace(/>(0|100)%</g, ''), /(^|[^0-9.])0 ?%/, 'the only 0% is the axis label');
    assert.ok(html.includes('No readings in this range'));
  });
}

void test('peer present shows the named platform and observation time', () => {
  const data = snapshot();
  data.peerQuota = { host: 'Windows', status: 'ok', checkedAt: iso(-5), receivedAt: iso(-2), windows: data.quota.windows };
  data.deviceNames = { Windows: 'Desk' };
  const html = render(data);
  assert.match(html, /Shared from Desk \(Windows\)/);
  assert.match(html, /Observed 5m ago/);
  assert.ok(html.includes('title="' + new Date(iso(-5)).toLocaleString() + '"'));
});

void test('peer absent has no pairing card', () => {
  assert.doesNotMatch(render(), /Shared from/);
});

void test('peer without windows shows its observation time and Unknown value', () => {
  const data = snapshot();
  data.peerQuota = { host: 'Windows', status: 'ok', checkedAt: iso(-5), windows: [] };
  const html = render(data);
  const peer = html.split('aria-label="Shared from Windows"')[1];
  assert.ok(peer);
  assert.match(peer, /Observed 5m ago/);
  assert.match(peer, /Unknown/);
});

const history = points => {
  const data = snapshot();
  data.limitHistory = points;
  return renderToStaticMarkup(createElement(LimitsView, { snapshot: data, now, limitStyle: 'bar' }));
};
const point = (host, w, minutes, r, resetMinutes, d) => ({ p: 'claude', w, o: host, t: iso(minutes), r, x: iso(resetMinutes), d });

void test('two computers are two labeled lines of one hue, the second lighter, never summed', () => {
  const line = host => [-300, -200, -100].map(minutes => point(host, 'seven_day', minutes, 60, 3000, 10080));
  const html = card(history([{ host: 'Mac', status: 'ok', points: line('Mac') }, { host: 'Windows', status: 'ok', points: line('Windows') }]), 'Claude Code weekly');
  assert.equal(count(html, /class="ob-history-line claude primary"/g), 1);
  assert.equal(count(html, /class="ob-history-line claude secondary"/g), 1);
  assert.match(html, />Mac<\/text>/);
  assert.match(html, />PC<\/text>/);
});

void test('the weekly chart draws the even-spend pace guide', () => {
  const html = card(history([{ host: 'Mac', status: 'ok', points: [-300, -100].map(minutes => point('Mac', 'seven_day', minutes, 60, 3000, 10080)) }]), 'Claude Code weekly');
  assert.equal(count(html, /class="ob-history-guide"/g), 1);
});

void test('over days, each 5-hour window is one column at its lowest, an empty window is a stub, and a window with no reading has none', () => {
  const html = card(history([{ host: 'Mac', status: 'ok', points: [
    point('Mac', 'five_hour', -900, 80, -700, 300), point('Mac', 'five_hour', -800, 30, -700, 300),
    point('Mac', 'five_hour', -400, 0, -200, 300),
  ] }]), 'Claude Code 5-hour');
  assert.equal(count(html, /<rect class="ob-history-column/g), 2);
  assert.equal(count(html, /ob-history-column claude primary empty/g), 1);
  assert.doesNotMatch(html, /<polyline/);
});
