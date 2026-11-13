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
const render = (data = snapshot(), props = {}) => renderToStaticMarkup(createElement(LimitsView, { snapshot: data, now, ...props }));
const count = (html, pattern) => [...html.matchAll(pattern)].length;
const card = (html, title) => html.split('aria-label="' + title + ' limit left over time"')[1]?.split('</section>')[0] ?? assert.fail(title + ' card missing');

void test("a chart's header names the engine and window only, with no number, Unknown or reset note", () => {
  assert.equal(LimitsView, NamedLimitsView);
  const html = render();
  assert.equal(count(html, /<figure class="ob-history-chart"/g), 4);
  for (const name of ['Claude', 'Codex']) for (const window of ['5-hour', 'weekly']) {
    const head = card(html, name + ' ' + window);
    assert.match(head, new RegExp('<span class="ob-meta">' + window + '</span>'), name + ' ' + window);
    assert.doesNotMatch(head, /% left</, 'the home page forecast carries the number');
    assert.doesNotMatch(head, /Resets in|as of|Unknown|runs out in|ob-note|warn/);
  }
  assert.ok(!html.includes('Claude Code'), 'cards say Claude');
  assert.ok(!html.includes('Session cost'));
});

void test('no footnotes or pace sentences: the layout carries it', () => {
  const html = render();
  for (const gone of ['Lines are never added together', 'per hour', 'Resets before running out', 'Show values', 'About history'])
    assert.ok(!html.includes(gone), gone);
});

void test('a stale or low reading adds no header number, Unknown or warning tone', () => {
  const data = snapshot();
  data.claudeLimits.checkedAt = data.quota.checkedAt = iso(-30);
  data.quota.windows[0].remainingPercent = 12;
  const html = render(data);
  assert.doesNotMatch(html, /runs out in/);
  const head = card(html, 'Codex 5-hour');
  assert.doesNotMatch(head, /ob-num|ob-note|ob-unknown|warn|Unknown|12%/);
});

for (const data of [{ quota: { status: 'unavailable' } }, null]) {
  void test('unknown remains unknown for ' + (data ? 'unavailable quota' : 'null snapshot'), () => {
    const html = render(data);
    assert.equal(count(html, /<figure class="ob-history-chart"/g), 0, 'no reading and no history draws no chart');
    assert.equal(count(html, /class="ob-num[^"]*">0%/g), 0, 'never a fabricated zero');
    assert.doesNotMatch(html, /(^|[^0-9.])0 ?%/);
    const kept = data ? { ...data, limitHistory: [{ host: 'Mac', status: 'ok', points: [-30, -20, -10].map(minutes => ({ p: 'codex', w: 'primary', o: 'Mac', t: iso(minutes), r: 50, x: iso(200), d: 300 })) }] } : null;
    if (kept) assert.equal(count(render(kept), /<figure class="ob-history-chart"/g), 0, 'history alone for a window the provider does not report draws no chart');
  });
}

void test('peer present shows the named platform and observation time', () => {
  const data = snapshot();
  data.peerQuota = { host: 'Windows', status: 'ok', checkedAt: iso(-5), receivedAt: iso(-2), windows: data.quota.windows };
  data.deviceNames = { Windows: 'Desk' };
  const html = render(data);
  assert.match(html, /Shared from PC/);
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
  const peer = html.split('aria-label="Shared from PC"')[1];
  assert.ok(peer);
  assert.match(peer, /Observed 5m ago/);
  assert.match(peer, /Unknown/);
});

const history = points => {
  const data = snapshot();
  data.limitHistory = points;
  return renderToStaticMarkup(createElement(LimitsView, { snapshot: data, now }));
};
const point = (host, w, minutes, r, resetMinutes, d) => ({ p: 'claude', w, o: host, t: iso(minutes), r, x: iso(resetMinutes), d });

void test('two computers are one merged line, never summed, with no per-computer key', () => {
  const line = (host, offset) => [-300, -200, -100].map(minutes => point(host, 'seven_day', minutes + offset, 60, 3000, 10080));
  const html = card(history([{ host: 'Mac', status: 'ok', points: line('Mac', 0) }, { host: 'Windows', status: 'ok', points: line('Windows', 50) }]), 'Claude weekly');
  assert.equal(count(html, /class="ob-history-line claude primary"/g), 1);
  assert.equal(count(html, /ob-history-line claude secondary/g), 0);
  assert.doesNotMatch(html, /ob-history-key|ob-history-end/);
  assert.equal(count(html, /<tr><th scope="row">/g), 6, 'both computers\' readings, one row each');
  assert.doesNotMatch(html, /1[2-9]\d%|[2-9]\d\d%/, 'no summed values');
});

void test('no pace guide and no reset rule are drawn', () => {
  const html = card(history([{ host: 'Mac', status: 'ok', points: [-300, -100].map(minutes => point('Mac', 'seven_day', minutes, 60, 3000, 10080)) }]), 'Claude weekly');
  assert.doesNotMatch(html, /ob-history-guide|ob-history-reset/);
  const crossed = card(history([{ host: 'Mac', status: 'ok', points: [[-500, -300], [-450, -300], [-400, -300], [-300, 100], [-250, 100], [-200, 100]].map(([minutes, reset]) => point('Mac', 'five_hour', minutes, 50, reset, 300)) }]), 'Claude 5-hour');
  assert.doesNotMatch(crossed, /ob-history-guide|ob-history-reset/);
});

void test('a gap inside one window is joined by one faint dotted line, and a reset is not joined', () => {
  const run = (resets) => card(history([{ host: 'Mac', status: 'ok', points: [-500, -490, -480, -250, -240, -230].map((minutes, index) => point('Mac', 'five_hour', minutes, 50, resets[index < 3 ? 0 : 1], 300)) }]), 'Claude 5-hour');
  const same = run([-100, -100]);
  assert.equal(count(same, /<line class="ob-history-gap claude"/g), 1);
  assert.equal(count(same, /<polyline class="ob-history-line claude primary"/g), 2);
  assert.equal(count(run([-100, -100 + 4]), /ob-history-gap/g), 1, 'reset times within 5 minutes are one window');
  const reset = run([-350, 100]);
  assert.equal(count(reset, /ob-history-gap/g), 0, 'no join across a reset');
  assert.equal(count(reset, /<polyline class="ob-history-line claude primary"/g), 2);
});

void test('over days, a 5-hour limit is one line, never a column per window', () => {
  const html = card(history([{ host: 'Mac', status: 'ok', points: [-500, -450, -400, -350].map(minutes => point('Mac', 'five_hour', minutes, 50, -200, 300)) }]), 'Claude 5-hour');
  assert.equal(count(html, /<polyline class="ob-history-line claude primary"/g), 1);
  assert.doesNotMatch(html, /ob-history-column|<rect/);
});

void test('a window the provider does not report has no chart unless it has readings', () => {
  const data = snapshot();
  data.quota.windows = [{ bucket: 'codex', window: 'primary', durationMinutes: 43200, remainingPercent: 70, resetsAt: iso(600) }];
  const html = render(data);
  assert.equal(count(html, /aria-label="Codex [^"]* limit left over time"/g), 1);
  assert.ok(!html.includes('aria-label="Codex 5-hour limit left over time"') && !html.includes('aria-label="Codex weekly limit left over time"'));
  assert.match(card(html, 'Codex 30-day'), /<span class="ob-meta">30-day<\/span>/);
  assert.doesNotMatch(card(html, 'Codex 30-day'), /70%/);
  const kept = history([{ host: 'Mac', status: 'ok', points: [-30, -20, -10].map(minutes => ({ p: 'codex', w: 'secondary', o: 'Mac', t: iso(minutes), r: 50, x: iso(200), d: 10080 })) }]);
  assert.ok(kept.includes('aria-label="Codex weekly limit left over time"'));
});
