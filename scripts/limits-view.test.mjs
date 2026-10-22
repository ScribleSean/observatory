import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sampleSnapshot } from '../lib/sample-snapshot.mjs';

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
  return { timezone: 'UTC', claudeLimits: { ...source('claude', ['five_hour', 'seven_day']), sessionCost: { usd: 3.42, observedAt: iso(-1) } },
    quota: source('codex', ['primary', 'secondary']) };
};
const render = (data = snapshot(), props = {}) => renderToStaticMarkup(createElement(LimitsView, { snapshot: data, now, limitStyle: 'bar', ...props }));
// The provider cards at the top of the page, one block per window.
const nowCard = html => html.match(/<div class="ob-limits-providers">([\s\S]*?)(?:<section class="ob-history"|$)/)?.[1] ?? assert.fail('Provider cards missing');
const count = (html, pattern) => [...html.matchAll(pattern)].length;

void test('ok shows pace and projections for both providers and current session cost', () => {
  assert.equal(LimitsView, NamedLimitsView);
  const html = render();
  const current = nowCard(html);
  for (const provider of ['claude', 'codex']) {
    const lines = [...current.matchAll(new RegExp('data-provider="' + provider + '" data-window="[^"]+">([\\s\\S]*?)(?=<div class="ob-limit-window(?: warn)?" data-provider|</section>|$)', 'g'))];
    assert.equal(lines.length, 2);
    for (const line of lines) {
      assert.match(line[1], /24\.0% per hour/);
      assert.match(line[1], /runs out in about/);
    }
  }
  assert.match(html, /Session cost \(estimate\)<\/span><span class="ob-num">\$3\.42/);
});

void test('stale readings show their age without a projection', () => {
  const data = snapshot();
  data.claudeLimits.checkedAt = data.quota.checkedAt = iso(-30);
  const html = render(data);
  assert.match(nowCard(html), /The reading is too old to estimate pace/);
  assert.doesNotMatch(html, /runs out in about/);
  assert.match(html, /as of/);
});

void test('low remaining value warns on the affected row', () => {
  const data = snapshot();
  data.quota.windows[0].remainingPercent = 12;
  const html = render(data);
  assert.match(nowCard(html), /class="ob-limit-window warn" data-provider="codex" data-window="5-hour"/);
  assert.match(html, /class="ob-num big warn">12%/);
});

for (const data of [{ quota: { status: 'unavailable' } }, null]) {
  void test('unknown remains unknown for ' + (data ? 'unavailable quota' : 'null snapshot'), () => {
    // The history charts' axis labels (0% to 100%) are not readings, so they are left out of this check.
    const html = render(data).replace(/<section class="ob-history"[\s\S]*<\/section>/, '');
    assert.match(html, /Unknown/);
    assert.doesNotMatch(html, /(^|[^0-9.])0 ?%|>0</);
    assert.match(html, /Session cost \(estimate\)<\/span><span class="ob-num">Unknown/);
    for (const name of ['Claude Code', 'Codex']) assert.ok(html.includes('<section class="ob-card" aria-label="' + name + '">'));
    assert.equal(count(nowCard(html), /data-window="unknown"/g), 2);
    // One Unknown per provider row, plus the Claude session cost.
    assert.equal(count(nowCard(html), />Unknown</g), 3);
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

void test('limit history has a card for every provider and window, with the freshest reading or Unknown', () => {
  const html = render(snapshot());
  assert.equal(count(html, /<figure class="ob-history-chart"/g), 4);
  for (const name of ['Claude Code', 'Codex']) for (const window of ['5-hour', 'weekly'])
    assert.ok(html.includes(name + ' ' + window + ' limit left over time'), name + ' ' + window);
  assert.ok(html.includes('Lines are never added together'));
  assert.ok(html.includes('No readings in this range'));
});


void test('each sample window shows its projection once, in its provider card', () => {
  const html = render(sampleSnapshot(now));
  for (const [provider, name] of [['claude', 'Claude Code'], ['codex', 'Codex']]) {
    const card = html.split('<section class="ob-card" aria-label="' + name + '">')[1]?.split('</section>')[0];
    assert.ok(card);
    assert.equal(count(card, new RegExp('data-provider="' + provider + '"', 'g')), 2);
  }
  assert.equal(count(nowCard(html), /data-provider="codex" data-window="5-hour"/g), 1);
});

void test('small positive rates render below a tenth instead of zero', () => {
  const data = snapshot();
  for (const source of [data.quota, data.claudeLimits]) {
    source.history.forEach((sample, index) => {
      sample.windows = source.windows.map(row => ({ ...row, remainingPercent: row.remainingPercent + (12 - index) * 0.04 / 12 }));
    });
  }
  const html = render(data);
  assert.equal(count(nowCard(html), /&lt;0\.1% per hour/g), 4);
  assert.doesNotMatch(html, /0\.0% per hour/);
});

void test('peer without windows shows its observation time and Unknown value', () => {
  const data = snapshot();
  data.peerQuota = { host: 'Windows', status: 'ok', checkedAt: iso(-5), windows: [] };
  const html = render(data);
  const card = html.split('aria-label="Shared from Windows"')[1];
  assert.ok(card);
  assert.match(card, /Observed 5m ago/);
  assert.doesNotMatch(card, /Observation time unknown/);
  assert.match(card, /Unknown/);
  assert.equal(count(card, /data-window="unknown"/g), 1);
});
