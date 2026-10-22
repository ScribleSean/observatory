import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { combine } from '../lib/combine.mjs';
import { ownSnapshot } from '../test/helpers.mjs';
import { sampleSnapshot } from '../lib/sample-snapshot.mjs';
import { tokensView } from '../lib/view-tokens.mjs';
import { compact } from '../lib/panel-data.mjs';
import { validateSkin } from '../lib/skins.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const load = specifier => import(specifier);
const { createServer } = await load('vite');
const { default: react } = await load('@vitejs/plugin-react');
const server = await createServer({ configFile: false, root, server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', plugins: [react()] });
after(() => server.close());
const { TokensView, TokensSection } = await server.ssrLoadModule('/app/viewer/tokens/tokens.tsx');
const { DashboardView } = await server.ssrLoadModule('/app/viewer/dashboard.tsx');
const { SKINS } = await server.ssrLoadModule('/app/viewer/skin.ts');
const now = Date.parse('2026-10-14T12:00:00Z');
const noop = () => {};
const render = (snapshot, host = 'All', period = 'week') => renderToStaticMarkup(createElement(TokensSection, {
  result: tokensView(snapshot, { host, period, now }), onHostChange: noop, onPeriodChange: noop,
}));
function card(html, label) {
  const section = html.match(new RegExp('<section class="ob-card" aria-label="' + label.replace(/[.*+?^$()|[\]\\]/g, '\\$&') + '">([\\s\\S]*?)</section>'));
  assert.ok(section, label);
  return section[1];
}
const counts = { inputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 1, outputTokens: 4, totalTokens: 10 };
const estimate = { usd: 1, coveredTokens: 10, excluded: 0, checked: '2026-10-11' };
function synthetic(apiEstimate = estimate) {
  const days = [{ date: '2026-10-14', ...counts, apiEstimate,
    models: [{ model: 'fictional', ...counts, apiEstimate }] }];
  return { timezone: 'UTC', tokens: [{ host: 'Mac', status: 'ok', days }],
    providerTokenSources: [{ provider: 'claude-code', host: 'Mac', status: 'ok', days: structuredClone(days) }] };
}

void test('sample All week keeps providers and settings per device', () => {
  const source = sampleSnapshot(now);
  const html = renderToStaticMarkup(createElement(TokensView, { snapshot: source, now }));
  const claude = card(html, 'Claude Code');
  const codex = card(html, 'Codex');
  for (const text of ['By device', 'Studio', 'Desk', 'Session cost (estimate)', '$3.42']) assert.ok(claude.includes(text), text);
  for (const provider of [claude, codex]) {
    assert.ok(provider.includes('API-equivalent (estimate)'));
    assert.ok(provider.includes('Prices checked ' + source.prices.checkedOn));
  }
  const settings = card(html, 'Recorded reasoning and speed');
  for (const label of ['Studio', 'Desk']) assert.ok(settings.includes(label));
});

void test('sample Mac week has a recorded total and estimate', () => {
  const source = sampleSnapshot(now);
  const claude = card(render(source, 'Mac'), 'Claude Code');
  assert.ok(claude.includes('>' + compact(tokensView(source, { host: 'Mac', period: 'week', now }).claude.totals.total) + '<'));
  assert.match(claude, /API-equivalent \(estimate\)<\/span><span>\$[0-9]/);
  assert.ok(!claude.includes('By device'));
});

void test('empty snapshot never manufactures zero', () => {
  const html = render({});
  assert.ok(html.includes('Unknown'));
  assert.doesNotMatch(html, />0<|>0 |\$0\.00|>0K</);
});

void test('pending Codex aggregate is unknown', () => {
  const source = sampleSnapshot(now);
  source.combinedTokens.verification.status = 'pending';
  const codex = card(render(source), 'Codex');
  assert.match(codex, /class="ob-figure">Unknown</);
  assert.ok(codex.includes('All needs verified records from every device'));
});

void test('Claude days without estimates show Unknown', () => {
  const source = synthetic();
  delete source.providerTokenSources[0].days[0].apiEstimate;
  const claude = card(render(source, 'Mac'), 'Claude Code');
  assert.match(claude, /API-equivalent \(estimate\)<\/span><span>Unknown<\/span>/);
  assert.ok(!claude.includes('$0.00'));
});

void test('unpriced models never become free', () => {
  const html = render(synthetic({ ...estimate, usd: null, coveredTokens: 0, excluded: 1 }), 'Mac');
  assert.match(html, /API-equivalent \(estimate\)<\/span><span>Unknown<\/span>/);
  assert.ok(!html.includes('$0.00'));
});

void test('partial estimate discloses covered tokens', () => {
  const html = render(synthetic({ ...estimate, coveredTokens: 5, excluded: 1 }), 'Mac');
  assert.ok(html.includes('Covers 5 of 10 tokens. Models without a price are left out.'));
});

void test('session cost 10 minutes old or older is Unknown', () => {
  const source = synthetic();
  source.claudeLimits = { sessionCost: { usd: 3.42, observedAt: new Date(now - 15 * 60000).toISOString() } };
  const claude = card(render(source, 'All'), 'Claude Code');
  assert.match(claude, /Session cost \(estimate\)<\/span><span>Unknown<\/span>/);
  assert.ok(!claude.includes('$3.42'));
});

void test('dashboard tokens section mounts the view', () => {
  const combined = combine([{ host: 'Mac', snapshot: ownSnapshot('Mac', now) }, { host: 'Windows', snapshot: ownSnapshot('Windows', now) }], { now });
  const html = renderToStaticMarkup(createElement(DashboardView, {
    combined, limitStyle: 'bar', css: '', className: '', now, loaded: true, section: 'tokens',
    skinId: 'sage', skin: validateSkin(SKINS.sage), onSectionChange: noop, onSkinChange: noop,
  }));
  card(html, 'Claude Code');
  card(html, 'Codex');
  assert.ok(!html.includes('This section is not built yet.'));
});

void test('caveat sentence appears in exactly one element', () => {
  const html = render(sampleSnapshot(now));
  assert.equal((html.match(/<p>Dollar figures are estimates at list price\. A subscription is not billed per token\.<\/p>/g) ?? []).length, 1);
});

void test('session cost appears only with initialHost All', () => {
  for (const initialHost of ['Windows', 'All']) {
    const html = renderToStaticMarkup(createElement(TokensView, { snapshot: sampleSnapshot(now), now, initialHost }));
    assert.equal(html.includes('Session cost (estimate)'), initialHost === 'All');
  }
});

void test('Codex price date is independent of missing Claude estimates', () => {
  const source = synthetic({ ...estimate, checked: '2026-10-01' });
  delete source.providerTokenSources[0].days[0].apiEstimate;
  delete source.providerTokenSources[0].days[0].models[0].apiEstimate;
  const html = render(source, 'Mac');
  assert.ok(card(html, 'Codex').includes('Prices checked 2026-10-01'));
  assert.ok(card(html, 'Claude Code').includes('Price check date Unknown'));
  assert.ok(!card(html, 'Claude Code').includes('Prices checked 2026-10-01'));
});

void test('positive estimates below half a cent do not render zero', () => {
  const html = render(synthetic({ ...estimate, usd: 0.004 }), 'Mac');
  for (const provider of ['Codex', 'Claude Code']) {
    assert.match(card(html, provider), /API-equivalent \(estimate\)<\/span><span>Under \$0\.01<\/span>/);
  }
  assert.ok(!html.includes('$0.00'));
});
