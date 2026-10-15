import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { soleHost, viewHost, totals, freshness, CLOCK_SKEW_MS, demoSnapshot, compact, duration } from '../lib/panel-data.mjs';
import { activityView, activityNow, nowFromHours } from '../lib/view-activity.mjs';
import { tokensView } from '../lib/view-tokens.mjs';
import { checkTime } from '../lib/view-sources.mjs';
import { sessionCost } from '../lib/view-limits.mjs';
import { validateSkin } from '../lib/skins.mjs';
import strings from '../lib/strings.json' with { type: 'json' };

const now = Date.parse('2026-10-14T12:30:00Z');
const collectedAt = new Date(now).toISOString();
function oneDevice(host) {
  const peer = host === 'Mac' ? 'Windows' : 'Mac';
  const days = ['2026-10-13', '2026-10-14'].map(date => ({ date, seconds: 2400, hours: Array(24).fill(100),
    categories: { Editors: 2400 }, apps: { Editors: { 'Example Editor': 2400 } } }));
  const tokenDays = days.map(({ date }) => ({ date, inputTokens: 100, cacheReadTokens: 20, cacheCreationTokens: 10,
    outputTokens: 70, totalTokens: 200, apiEstimate: { usd: 0.01, coveredTokens: 200, excluded: 0 } }));
  return {
    timezone: 'UTC', collectedAt,
    activity: [{ host, status: 'ok', days }, { host: peer, status: 'not-connected' }],
    combined: { host: 'Combined', status: 'unavailable' },
    combinedTokens: { host: 'All', status: 'unavailable' },
    activityHistory: [{ host: 'Combined', status: 'unavailable', days: [] }, { host: peer, status: 'unavailable', days: [] },
      { host, status: 'ok', latestReadStatus: 'ok', trackingStatus: 'recent', asOf: collectedAt, days }],
    tokens: [{ host, status: 'ok', days: tokenDays }, { host: peer, status: 'not-connected' }],
    settings: [{ host, status: 'ok', profiles: [{ date: '2026-10-14', model: 'example', effort: 'high', speed: 'standard', totalTokens: 200 }] }],
    dictation: [], providerTokenSources: [{ host, provider: 'claude-code', status: 'ok', days: tokenDays }],
  };
}

const load = specifier => import(specifier);
const { createServer } = await load('vite');
const { default: react } = await load('@vitejs/plugin-react');
const server = await createServer({ configFile: false, root: fileURLToPath(new URL('..', import.meta.url)),
  server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', plugins: [react()] });
after(() => server.close());
const { PanelView, SKINS } = await server.ssrLoadModule('/app/viewer/panel/panel.tsx');
const noop = () => {};

for (const host of ['Windows', 'Mac']) {
  test(`${host} sole host resolves All without changing the selected filter`, () => {
    const snapshot = oneDevice(host);
    assert.equal(soleHost(snapshot), host);
    assert.equal(viewHost(snapshot, 'All'), host);
    assert.equal(viewHost(snapshot, host), host);
    assert.equal(viewHost(snapshot, 'Other'), 'Other');
    assert.deepEqual(activityNow(snapshot, 'All', now), activityNow(snapshot, host, now));
    assert.equal(activityNow(snapshot, 'All', now).reason, 'ok');
    for (const period of ['day', 'week', 'now']) {
      const options = { period, now };
      const all = activityView(snapshot, { ...options, host: 'All' });
      assert.deepEqual(all, activityView(snapshot, { ...options, host }));
      assert.equal(all.total, period === 'now' ? 200 : period === 'week' ? 4800 : 2400);
      assert.equal(all.note, '');
      assert.equal(all.tracking.detail, strings.activity.trackingRecentDetail);
      const tokens = tokensView(snapshot, { ...options, host: 'All' });
      const device = tokensView(snapshot, { ...options, host });
      assert.deepEqual(tokens.codex, device.codex);
      assert.deepEqual(tokens.claude.totals, device.claude.totals);
      assert.deepEqual(tokens.settings, device.settings);
      assert.equal(tokens.settings.length, 1);
      assert.equal(tokens.settings[0].host, host);
      assert.deepEqual(tokens.claude.byDevice, []);
      assert.equal(tokens.host, 'All');
      const cost = sessionCost(snapshot, now);
      assert.deepEqual(tokens.claude.sessionCost, cost ? { ...cost, status: 'ok' } : { usd: null, observedAt: null, status: 'unknown' });
      if (period === 'now') continue;
      const sums = totals(snapshot, 'All', period, new Date(now));
      assert.deepEqual(sums, totals(snapshot, host, period, new Date(now)));
      assert.equal(sums.codexTokens, period === 'week' ? 400 : 200);
      assert.equal(sums.claudeTokens, sums.codexTokens);
      const html = renderToStaticMarkup(createElement(PanelView, { snapshot, loaded: true, busy: false, now,
        skinId: 'sage', skin: validateSkin(SKINS.sage), host: 'All', period,
        onHostChange: noop, onPeriodChange: noop, onSkinChange: noop, onAction: noop }));
      const card = html.match(/<section[^>]*aria-label="Totals"[\s\S]*?<\/section>/)?.[0];
      assert.ok(card, html);
      assert.ok(card.includes(`>${compact(sums.codexTokens)}<`));
      assert.ok(card.includes(`>${duration(sums.seconds)}<`));
      assert.doesNotMatch(card, /Unknown|By device/);
      assert.match(html, /aria-pressed="true"[^>]*>All<\/button>/);
    }
  });
}

test('sole host rejects missing snapshots and paired or retired host evidence', () => {
  for (const value of [null, undefined, {}, [], 'Mac', 1, demoSnapshot(now)]) {
    assert.equal(soleHost(value), null);
    assert.equal(viewHost(value, 'All'), 'All');
  }
  const mutations = [
    snapshot => { snapshot.peerQuota = {}; },
    snapshot => { snapshot.combined.status = 'ok'; },
    snapshot => { snapshot.combined.days = [{ date: '2026-10-14' }]; },
    snapshot => { snapshot.activityHistory[0].days = [{ date: '2026-10-14' }]; },
    snapshot => { snapshot.activityHistory[0].status = 'ok'; },
    snapshot => { snapshot.activity.push({ host: 'Ubuntu', status: 'ok' }); },
    snapshot => { snapshot.activity.push({ host: 'Ubuntu', status: 'not-connected', days: [{ date: '2026-10-14', seconds: 1 }] }); },
    snapshot => { snapshot.combinedTokens.verification = { status: 'verified' }; },
    snapshot => { snapshot.combinedTokens.status = 'ok'; },
    snapshot => { snapshot.activity.push({ host: 'Mac', status: 'ok' }); },
    snapshot => { snapshot.activityHistory[1].days = [{ date: '2026-10-14' }]; },
  ];
  for (const mutate of mutations) {
    const snapshot = oneDevice('Windows');
    mutate(snapshot);
    assert.equal(soleHost(snapshot), null);
    assert.equal(viewHost(snapshot, 'All'), 'All');
  }
  for (const key of ['activity', 'tokens', 'settings', 'dictation', 'providerTokenSources']) {
    assert.equal(soleHost({ [key]: [{ host: 'Mac', status: 'unavailable' }] }), 'Mac');
    assert.equal(soleHost({ [key]: [{ host: 'Mac', status: 'not-connected' }] }), null);
    const snapshot = oneDevice('Windows');
    snapshot[key].push({ host: 'Ubuntu', status: 'ok' });
    assert.equal(soleHost(snapshot), null);
  }
  assert.equal(soleHost({ activityHistory: [{ host: 'Mac', status: 'ok' }] }), 'Mac');
  assert.equal(soleHost({ activityHistory: [{ host: 'Mac', days: [{}] }] }), 'Mac');
});

test('two-host All keeps verified Combined values and Claude By device', () => {
  const snapshot = demoSnapshot(now);
  assert.equal(soleHost(snapshot), null);
  assert.equal(snapshot.combinedTokens.verification.status, 'verified');
  for (const period of ['day', 'week']) {
    const pick = days => period === 'day' ? days.filter(day => day.date === '2026-10-14')
      : days.filter(day => day.date >= '2026-10-08' && day.date <= '2026-10-14');
    const seconds = pick(snapshot.combined.days).reduce((sum, day) => sum + day.seconds, 0);
    const tokens = pick(snapshot.combinedTokens.days).reduce((sum, day) => sum + day.totalTokens, 0);
    assert.equal(activityView(snapshot, { host: 'All', period, now }).total, seconds);
    const result = tokensView(snapshot, { host: 'All', period, now });
    assert.equal(result.codex.totals.total, tokens);
    assert.equal(result.claude.status, 'by-device');
    assert.equal(result.claude.byDevice.length, 2);
    const sums = totals(snapshot, 'All', period, new Date(now));
    assert.equal(sums.seconds, seconds);
    assert.equal(sums.codexTokens, tokens);
    assert.equal(sums.claudeNote, strings.status.byDevice);
  }
});

test('freshness and check time share the two minute clock allowance', () => {
  assert.equal(CLOCK_SKEW_MS, 120000);
  for (const ahead of [30000, 120000, 121000]) {
    const stamp = new Date(now + ahead).toISOString();
    assert.deepEqual(freshness(stamp, now), { label: ahead <= 120000 ? strings.status.updatedNow : strings.status.updateAhead, stale: ahead > 120000 });
    assert.equal(checkTime(stamp, now).label, ahead <= 120000 ? strings.sources.checkedNow : strings.sources.checkAhead);
  }
  for (const stamp of ['', undefined, 'garbage']) {
    assert.deepEqual(freshness(stamp, now), { label: strings.status.updatedUnknown, stale: true });
    assert.equal(checkTime(stamp, now).label, strings.sources.checkUnknown);
  }
});

test('Now tolerates clock skew across an hour boundary but rejects three minutes', () => {
  const snapshot = oneDevice('Windows');
  const clock = Date.parse('2026-10-14T11:59:45Z');
  for (const ahead of [30000, 120000, 180000]) {
    const result = nowFromHours({ days: snapshot.activity[0].days, readingAt: new Date(clock + ahead).toISOString(), timeZone: 'UTC', now: clock });
    assert.equal(result.reason, ahead <= 120000 ? 'ok' : 'ahead');
  }
});
