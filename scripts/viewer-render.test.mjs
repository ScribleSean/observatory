import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { demoSnapshot } from '../lib/panel-data.mjs';
import { skinCss, validateSkin } from '../lib/skins.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
// Vite is loaded by name at run time. A static import pulls its types into the
// type-aware lint program and changes how every other test file is checked.
const load = specifier => import(specifier);
const { createServer } = await load('vite');
const { default: react } = await load('@vitejs/plugin-react');
const server = await createServer({ configFile: false, root, server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', plugins: [react()] });
after(() => server.close());
const { PanelView, SKINS } = await server.ssrLoadModule('/app/viewer/panel/panel.tsx');
const { skinIdFrom, useSkin } = await server.ssrLoadModule('/app/viewer/skin.ts');
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
  const fallback = dashboard({ section: 'dictation', snapshot: { ...base.snapshot, dictation: [] } });
  assert.ok(fallback.includes('<h2 id="ob-section-limits">'));
  const navigation = fallback.match(/<nav aria-label="Sections">([\s\S]*?)<\/nav>/)?.[1];
  assert.ok(navigation);
  assert.match(navigation, /<button[^>]*aria-current="page"[^>]*>Limits<\/button>/);
  assert.ok(!sectionNames(fallback).includes('Dictation'));
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

void test('skin sources use valid query, root, then Sage', () => {
  const rootSkin = skin => ({ dataset: { skin } });
  assert.equal(skinIdFrom('?skin=almanac', rootSkin('instrument')), 'almanac');
  assert.equal(skinIdFrom('', rootSkin('amber-crt')), 'amber-crt');
  assert.equal(skinIdFrom('?demo', rootSkin('almanac')), 'almanac');
  assert.equal(skinIdFrom('?skin=instrument', rootSkin('unknown')), 'instrument');
  assert.equal(skinIdFrom('', null), 'sage');
  assert.equal(skinIdFrom('', { dataset: {} }), 'sage');
  for (const id of ['unknown', '', 'constructor', '__proto__', 'toString', ' sage', 'Sage', '%E0%A4%A', 'almanac/']) {
    assert.equal(skinIdFrom(`?skin=${id}`, rootSkin('almanac')), 'almanac');
    assert.equal(skinIdFrom('', rootSkin(id)), 'sage');
    assert.equal(skinIdFrom(`?skin=${id}`, rootSkin(id)), 'sage');
    assert.equal(skinIdFrom(`?skin=${id}`, null), 'sage');
  }
});

for (const skinId of ['sage', 'almanac']) {
  for (const { name, render, tag } of [{ name: 'panel', render: panel, tag: 'main' }, { name: 'dashboard', render: dashboard, tag: 'div' }]) {
    void test(`${name} preserves skin styles and root classes for ${skinId}`, () => {
      const skin = validateSkin(SKINS[skinId]);
      const html = render({ skinId, skin });
      const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
      assert.ok(css);
      assert.equal(css, skinCss(skin));
      assert.ok(css.includes(`--ob-background:#${skin.colors.background[0]}`));
      assert.ok(css.includes('prefers-color-scheme: dark'));
      assert.ok(css.includes(':root[data-theme="dark"]'));
      const classes = skinId === 'almanac' ? 'ob-font-serif ob-rules' : 'ob-font-sans';
      assert.ok(html.startsWith(`<${tag} class="ob-${name} ${classes}">`));
    });
  }
}

void test('skin hook renders on the server and falls back for unknown ids', () => {
  function SkinProbe({ initialSkin }) {
    const { skinId, skin, css, className } = useSkin(initialSkin);
    assert.equal(css, skinCss(skin));
    return createElement('div', { className, 'data-skin': skinId });
  }
  for (const initialSkin of ['sage', 'almanac', 'unknown', 'constructor', '__proto__']) {
    const html = renderToStaticMarkup(createElement(SkinProbe, { initialSkin }));
    const id = initialSkin === 'almanac' ? 'almanac' : 'sage';
    assert.ok(html.includes(`data-skin="${id}"`));
  }
});

const { BarChart, StackedBarChart, LineChart } = await server.ssrLoadModule('/app/viewer/components/index.ts');
const chartSeries = [{ key: 'a', label: 'Synthetic A', color: 'claude' }, { key: 'b', label: 'Synthetic B', color: 'codex' }];
const formatChartValue = value => {
  assert.equal(typeof value, 'number');
  return `${value} units`;
};
const renderChart = (Component, data, props = {}) => renderToStaticMarkup(createElement(Component, {
  title: 'Synthetic chart', data, series: Component === StackedBarChart ? chartSeries : 'accent', formatValue: formatChartValue, ...props,
}));
const chartData = [{ label: 'First', value: 4 }, { label: 'Missing', value: null }, { label: 'Last', value: 8 }];
const stackedData = [{ label: 'First', values: { a: 3, b: 5 } }, { label: 'Missing', values: { a: 99, b: null } }];

for (const Component of [BarChart, StackedBarChart, LineChart]) {
  void test(`${Component.name} renders an accessible formatted table and missing values`, () => {
    const data = Component === StackedBarChart ? stackedData : chartData;
    const html = renderChart(Component, data);
    assert.match(html, /<figure class="ob-chart">/);
    const title = html.match(/<title id="([^"]+)">Synthetic chart<\/title>/);
    assert.ok(title);
    assert.ok(html.includes(`role="img" aria-labelledby="${title[1]}"`));
    assert.match(html, /<figcaption>/);
    assert.match(html, /<div class="ob-visually-hidden"><table>/);
    assert.match(html, /<label[^>]*><input type="checkbox"\/>Show values<\/label>/);
    const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1];
    assert.ok(body);
    assert.equal((body.match(/<tr>/g) ?? []).length, data.length);
    for (const item of data) assert.ok(body.includes(item.label));
    assert.match(body, /<td>Unknown<\/td>/);
    for (const value of Component === StackedBarChart ? [3, 5, 99] : [4, 8]) assert.ok(body.includes(`${value} units`));
    assert.doesNotMatch(html, /data-(?:bar|point)="1"/);
    if (Component !== LineChart) {
      const mark = html.match(/<rect data-unknown="1"[^>]*>/)?.[0];
      assert.ok(mark);
      assert.match(mark, /class="ob-chart-unknown"/);
      assert.doesNotMatch(mark, /(?:height|width)="0"/);
    }
  });
  for (const data of [[], Component === StackedBarChart ? [{ label: 'Missing', values: { a: null, b: null } }] : [{ label: 'Missing', value: null }]]) {
    void test(`${Component.name} handles ${data.length ? 'all-null' : 'empty'} data with only a frame`, () => {
      const html = renderChart(Component, data, { formatValue: () => assert.fail('Unknown must never be formatted') });
      assert.match(html, /<figcaption>[\s\S]*Unknown/);
      const svg = html.match(/<svg[\s\S]*?<\/svg>/)?.[0];
      assert.ok(svg);
      assert.equal((svg.match(/<path/g) ?? []).length, 1);
      assert.doesNotMatch(svg, /<rect|<circle|<text/);
    });
  }
}

void test('stack heights sum to the known total and partial stacks do not affect the maximum', () => {
  const html = renderChart(StackedBarChart, stackedData);
  assert.match(html, /<text[^>]*>8 units<\/text>/);
  const stack = html.match(/<g data-stack="0">([\s\S]*?)<\/g>/)?.[1];
  assert.ok(stack);
  const heights = [...stack.matchAll(/height="([\d.]+)"/g)].map(match => Number(match[1]));
  assert.equal(heights.length, 2);
  assert.ok(Math.abs(heights.reduce((sum, value) => sum + value, 0) - 128) < 0.01);
  assert.deepEqual([...stack.matchAll(/data-series="([^"]+)"/g)].map(match => match[1]), ['a', 'b']);
});

void test('line paths stop at missing points and restart after the gap', () => {
  const html = renderChart(LineChart, [{ label: 'A', value: 2 }, { label: 'B', value: 4 }, { label: 'C', value: null }, { label: 'D', value: 3 }, { label: 'E', value: 5 }]);
  const paths = [...html.matchAll(/class="ob-chart-line" d="([^"]+)"/g)].map(match => match[1]);
  assert.equal(paths.length, 2);
  for (const path of paths) assert.match(path, /^M[\d.]+ [\d.]+L[\d.]+ [\d.]+$/);
  assert.equal((html.match(/<circle/g) ?? []).length, 4);
  assert.doesNotMatch(html, /data-point="2"/);
});

void test('charts use skin styles, scalable frames and thinned labels', () => {
  const source = readFileSync(`${root}/app/viewer/components/charts.tsx`, 'utf8');
  assert.doesNotMatch(source, /#(?:[\da-f]{6}|[\da-f]{3})\b|rgb\(|(?:from\s*|import\s*\()['"]recharts['"]/i);
  const css = readFileSync(`${root}/app/viewer/panel/panel.css`, 'utf8');
  assert.match(css, /\.ob-chart-unknown\s*\{[^}]*stroke-dasharray:/);
  assert.match(css, /figcaption:has\(input:checked\)/);
  assert.doesNotMatch(source, /<table\b[^>]*\bstyle\s*=[^>]*\bdisplay\s*:/);
  assert.doesNotMatch(source, /<table\b[^>]*\bclassName=["']ob-visually-hidden["']/);
  assert.doesNotMatch(css, /[^{}]*\btable\b[^{}]*\{[^}]*\bdisplay\s*:/);
  assert.doesNotMatch(css, /[^{}]*\.ob-visually-hidden[^{}]*\{[^}]*\bdisplay\s*:/);
  const html = renderChart(BarChart, Array.from({ length: 40 }, (_, index) => ({ label: `Item ${index}`, value: index })));
  assert.match(html, /viewBox="0 0 320 180" width="100%"/);
  assert.ok((html.match(/text-anchor="start"/g) ?? []).length <= 12);
});

void test('explicit bounds and known zero values remain finite and formatted', () => {
  const html = renderChart(LineChart, [{ label: 'A', value: 10 }, { label: 'B', value: 20 }], { min: 10, max: 30 });
  assert.match(html, /cy="152"/);
  assert.match(html, /cy="88"/);
  assert.match(html, />30 units<\/text>/);
  for (const Component of [BarChart, LineChart]) {
    const zero = renderChart(Component, [{ label: 'Zero', value: 0 }]);
    assert.match(zero, /<td>0 units<\/td>/);
    assert.doesNotMatch(zero, /NaN|Infinity|Unknown/);
  }
});

void test('skin attributes accept bundled names and otherwise fall back to Sage', async () => {
  const { skinIdFromAttribute } = await server.ssrLoadModule('/app/viewer/skin.ts');
  for (const value of ['almanac', 'amber-crt']) assert.equal(skinIdFromAttribute(value), value);
  for (const value of [undefined, '', 'bogus', 'constructor', '__proto__', 'Sage']) {
    assert.equal(skinIdFromAttribute(value), 'sage');
  }
});

void test('skin observer applies the attribute fallback to state', () => {
  const source = readFileSync(`${root}/app/viewer/skin.ts`, 'utf8');
  assert.match(source, /new MutationObserver\(\(\) => \{\s*setSkinId\(skinIdFromAttribute\(root\.dataset\.skin\)\);\s*\}\)/);
});

void test('dashboard follows hash changes and removes its listener on cleanup', async () => {
  const { followSectionHash } = await server.ssrLoadModule('/app/viewer/dashboard.tsx');
  const listeners = new Map();
  const target = {
    location: { hash: '#dictation' },
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: (name, listener) => {
      assert.equal(listeners.get(name), listener);
      listeners.delete(name);
    },
  };
  const sections = [];
  const cleanup = followSectionHash(target, section => sections.push(section));
  assert.deepEqual(sections, []);
  for (const hash of ['#tokens', '#bogus', '#setup', '#Setup']) {
    target.location.hash = hash;
    listeners.get('hashchange')?.();
  }
  assert.deepEqual(sections, ['tokens', 'limits', 'setup', 'limits']);
  cleanup();
  target.location.hash = '#activity';
  listeners.get('hashchange')?.();
  assert.deepEqual(sections, ['tokens', 'limits', 'setup', 'limits']);
  assert.equal(listeners.size, 0);
});

void test('dashboard writes section hashes preserving query and history state', async () => {
  const { writeSectionHash } = await server.ssrLoadModule('/app/viewer/dashboard.tsx');
  const calls = [];
  const state = { entry: 'existing' };
  const target = {
    location: { pathname: '/dashboard.html', search: '?demo', hash: '#limits' },
    history: {
      state,
      replaceState: (...args) => calls.push(args),
    },
  };
  writeSectionHash(target, 'activity');
  assert.deepEqual(calls, [[state, '', '/dashboard.html?demo#activity']]);
  assert.equal(calls[0][0], state);
  target.location.hash = '#activity';
  writeSectionHash(target, 'activity');
  assert.equal(calls.length, 1);
});

void test('Dashboard follows hashes in an effect and writes them from navigation', () => {
  const source = readFileSync(`${root}/app/viewer/dashboard.tsx`, 'utf8');
  const stateful = source.slice(source.indexOf('export default function Dashboard('), source.indexOf('type DashboardViewProps'));
  assert.match(stateful, /useEffect\(\(\) => followSectionHash\(window, setSection\), \[\]\)/);
  assert.match(stateful, /onSectionChange=\{id => \{\s*setSection\(id\)\s*\W+\s*writeSectionHash\(window, id\)/);
  assert.match(stateful, /onSetupFinished=\{\(\) => \{\s*setSection\('limits'\)\s*\W+\s*writeSectionHash\(window, 'limits'\)/);
  assert.equal((stateful.match(/writeSectionHash\(/g) ?? []).length, 2);
});

void test('dashboard paused note is in the header including setup', () => {
  for (const section of ['limits', 'setup']) {
    const html = dashboard({ section, collectionPaused: true });
    assert.equal((html.match(/Collection paused/g) ?? []).length, 1);
    assert.match(html, /<header[^>]*>[\s\S]*<span class="ob-meta warn">Collection paused<\/span>[\s\S]*<\/header>/);
    assert.doesNotMatch(dashboard({ section, collectionPaused: false }), /Collection paused/);
  }
});
