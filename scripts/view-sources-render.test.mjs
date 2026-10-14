import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sampleSnapshot } from '../lib/sample-snapshot.mjs';
import { validateSkin } from '../lib/skins.mjs';
import { checkTime, refusalText, statusWord } from '../lib/view-sources.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const load = specifier => import(specifier);
const { createServer } = await load('vite');
const { default: react } = await load('@vitejs/plugin-react');
const server = await createServer({ configFile: false, root, server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', plugins: [react()] });
after(() => server.close());
const { DashboardView, sectionFromHash } = await server.ssrLoadModule('/app/viewer/dashboard.tsx');
const { SKINS } = await server.ssrLoadModule('/app/viewer/skin.ts');
const { SourcesView } = await server.ssrLoadModule('/app/viewer/sources/SourcesView.tsx');
const { DictationPanel } = await server.ssrLoadModule('/app/viewer/dictation/DictationView.tsx');
const now = Date.parse('2026-10-14T12:00:00Z');
const checkedAt = '2026-10-14T11:58:00Z';
const noop = () => {};
const render = (Component, props) => renderToStaticMarkup(createElement(Component, { now, ...props }));
const panel = (snapshot, props = {}) => render(DictationPanel, { snapshot, tool: 'all', host: 'all', period: 'week', onToolChange: noop, onHostChange: noop, onPeriodChange: noop, ...props });
const codes = ['ok', 'not-connected', 'partial', 'unavailable', 'not-found', 'stale', 'needs-auth', 'unsupported', 'rate-limited'];
const source = { host: 'Mac', source: 'Synthetic A', status: 'ok', checkedAt,
  days: [{ date: '2026-10-14', transcriptions: 4, words: 120, wordRecords: 4, audioRecords: 4, audioSeconds: 120 }] };
for (const section of ['sources', 'dictation']) {
  void test(`dashboard renders sample ${section}`, () => {
    const html = render(DashboardView, { snapshot: sampleSnapshot(now), loaded: true, skinId: 'sage', skin: validateSkin(SKINS.sage), section, onSectionChange: noop, onSkinChange: noop });
    assert.ok(html.includes(section === 'sources' ? 'sources read' : 'Recorded audio time'));
    assert.ok(html.includes('Studio'));
    assert.ok(html.includes('Desk'));
    assert.ok(!html.includes('This section is not built yet.'));
  });
}
void test('all ok sources show read counts and exact observation titles', () => {
  const html = render(SourcesView, { snapshot: { quota: source, activity: [source] } });
  assert.match(html, /2 of 2 sources read/);
  assert.equal((html.match(/data-status="ok"/g) ?? []).length, 2);
  const exact = checkTime(checkedAt, now).exact;
  assert.ok(html.includes(`title="${exact}"`));
  assert.ok(html.includes(`dateTime="${new Date(checkedAt).toISOString()}"`));
  assert.ok(html.includes('Checked 2m ago'));
});
void test('mixed sources render all nine status words and normalize unknown codes', () => {
  const html = render(SourcesView, { snapshot: { activity: [...codes, 'constructor'].map(status => ({ ...source, status })) } });
  for (const status of codes) {
    assert.ok(html.includes(statusWord(status)));
    assert.equal((html.match(new RegExp(`data-status="${status}"`, 'g')) ?? []).length, 1);
  }
  assert.ok(html.includes('data-status="unknown"'));
  assert.ok(!html.includes('constructor'));
});
for (const refusal of ['synthetic-private-code', 'ancestor-refused']) {
  void test(`both views redact ${refusal}`, () => {
    const snapshot = { dictation: [{ ...source, status: 'unavailable', refusal }] };
    for (const html of [render(SourcesView, { snapshot }), panel(snapshot)]) {
      assert.ok(!html.includes(refusal));
      assert.ok(html.includes(refusalText(refusal)));
    }
  });
}
void test('missing sources and missing values never render zero', () => {
  for (const snapshot of [{}, { dictation: [{ host: 'Mac', status: 'ok', source: 'Synthetic A', days: [{ date: '2026-10-14' }] }] }]) {
    for (const html of [render(SourcesView, { snapshot }), panel(snapshot)]) {
      assert.match(html, /Unknown|No source records|No dictation records match these filters/);
      assert.doesNotMatch(html, />0<|>0m</);
    }
  }
  const html = render(SourcesView, { snapshot: {} });
  assert.equal((html.match(/No source records/g) ?? []).length, 6);
  assert.ok(html.includes('No sources are connected'));
});
void test('dictation renders all known connected statuses', () => {
  const html = panel({ dictation: codes.map(status => ({ ...source, status })) });
  for (const code of codes.filter(code => code !== 'not-connected')) assert.ok(html.includes(statusWord(code)));
  assert.ok(!html.includes('Not connected'));
});
const days = Array.from({ length: 40 }, (_, index) => ({ ...source.days[0], date: new Date(now - index * 86400000).toISOString().slice(0, 10) }));
const snapshot = { timezone: 'UTC', dictation: [{ ...source, days }, { ...source, host: 'Windows', source: 'Synthetic B', days }] };
for (const tool of ['all', 'Synthetic A', 'Synthetic B']) {
  for (const host of ['all', 'Mac', 'Windows']) {
    for (const [period, count] of [['day', 1], ['week', 7], ['month', 30], ['all', 40]]) {
      void test(`dictation filters ${tool} ${host} ${period}`, () => {
        const html = panel(snapshot, { tool, host, period });
        const matches = snapshot.dictation.filter(row => (tool === 'all' || row.source === tool) && (host === 'all' || row.host === host));
        assert.equal((html.match(/<h3>/g) ?? []).length, matches.length);
        assert.equal((html.match(/<fieldset/g) ?? []).length, 3);
        for (const row of matches) assert.ok(html.includes(`<h3>${row.source} · ${row.host === 'Mac' ? 'macOS' : 'Windows'}</h3>`));
        if (matches.length) assert.ok(html.includes(`<dd>${count * 4}</dd>`));
        assert.equal((html.match(/<figure/g) ?? []).length, period === 'day' ? 0 : matches.length);
        assert.equal((html.match(/Device histories may overlap/g) ?? []).length, 1);
        assert.ok(html.includes('Missing dates are gaps, not zeros. Transcripts, recordings and credentials are not collected.'));
        assert.ok(html.includes('aria-pressed="true"'));
      });
    }
  }
}

void test('the address hash picks a known section and falls back to Limits', () => {
  assert.equal(sectionFromHash('#sources'), 'sources');
  assert.equal(sectionFromHash('#dictation'), 'dictation');
  for (const hash of ['', '#', '#Sources', '#constructor', '#__proto__', '#sources/x']) assert.equal(sectionFromHash(hash), 'limits');
});
