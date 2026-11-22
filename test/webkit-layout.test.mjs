// The bar charts as Safari lays them out: the dashboard is built into a temporary folder, served with the
// fictional fixture (lib/sample-r2.mjs) and loaded in an offscreen WKWebView (scripts/harness/webkit.swift).
// Every bar must stand on its plot's baseline with its height in proportion to its value, within 1 px. Safari
// once drew these bars as short slabs at the top of the plot while Chrome drew them right, so a check in Chrome
// alone would miss it. macOS only: other systems have no WebKit view, so the test skips there with a reason.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const run = promisify(execFile);
const NOW = Date.now();
const has = command => spawnSync('/usr/bin/which', [command], { encoding: 'utf8' }).status === 0;
const skip = process.platform !== 'darwin' ? 'WebKit views exist only on macOS'
  : !has('swiftc') ? 'swiftc is missing (install the Xcode command line tools)' : false;

// For each bar plot on the page: its box, the data max it scales to, and each column's value and bar box in px.
// It polls until the view's plots have drawn and measured themselves (each viewBox is its size in px), then reads them.
const MEASURE = `const measured = () => {
  const plots = [...document.querySelectorAll('svg.bars')];
  return plots.length > 0 && plots.every(svg => Math.abs(svg.viewBox.baseVal.height - svg.getBoundingClientRect().height) < 0.5);
};
const until = Date.now() + 15000;
while (Date.now() < until && !measured()) await new Promise(resolve => setTimeout(resolve, 100));
if (!measured()) return 'error: the plots did not draw and measure. ' + document.body.innerText.slice(0, 300);
return JSON.stringify([...document.querySelectorAll('svg.bars')].map(svg => {
  const plot = svg.getBoundingClientRect();
  const hits = [...svg.parentElement.querySelectorAll('.hits > .col')].map(col => col.getBoundingClientRect().height);
  return { top: plot.top, bottom: plot.bottom, height: plot.height, max: Number(svg.dataset.max), hits,
    columns: [...svg.querySelectorAll('g[data-value]')].map(g => {
      const boxes = [...g.querySelectorAll('path.bar')].map(bar => bar.getBoundingClientRect());
      return { value: Number(g.dataset.value), top: Math.min(...boxes.map(box => box.top)), bottom: Math.max(...boxes.map(box => box.bottom)), bars: boxes.length };
    }) };
}))`;

test('in WebKit every bar stands on the baseline with its height in proportion to its value', { skip, timeout: 240000 }, async t => {
  const work = await mkdtemp(path.join(tmpdir(), 'observatory-webkit-'));
  t.after(() => rm(work, { recursive: true, force: true }));
  const tool = path.join(work, 'webkit');
  execFileSync('swiftc', ['-O', '-o', tool, path.join(root, 'scripts/harness/webkit.swift')], { stdio: 'pipe' });
  const { build } = await import('vite');
  const assets = path.join(work, 'dashboard');
  await build({ configFile: path.join(root, 'vite.config.mts'), logLevel: 'silent', build: { outDir: assets, emptyOutDir: true } });
  const { createLocalServer } = await import('../serve-local.mjs');
  const { sampleR2Combined } = await import('../lib/sample-r2.mjs');
  const dataFolder = path.join(work, 'data');
  await mkdir(path.join(dataFolder, 'public', 'local'), { recursive: true });
  await writeFile(path.join(dataFolder, 'public', 'local', 'combined.json'), JSON.stringify(sampleR2Combined(NOW)));
  const server = createLocalServer({ assets, dataFolder });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/`;

  let bars = 0;
  for (const [address, plotsAtLeast] of [['?unit=all#tokens', 1], ['?unit=all#overview', 2], ['#limits', 1]]) for (const width of [1440, 390]) {
    // Run without blocking: the server answering the page runs in this process.
    const output = (await run(tool, [base + address, String(width), '900', MEASURE], { encoding: 'utf8', timeout: 60000 })
      .catch(error => assert.fail(`${address} at ${width}: ${(error.stdout || error.message).trim()}`))).stdout.trim();
    assert.ok(!output.startsWith('error'), `${address} at ${width}: ${output}`);
    const plots = JSON.parse(output);
    assert.ok(plots.length >= plotsAtLeast, `${address} at ${width}: ${plots.length} plots`);
    for (const plot of plots) {
      assert.ok(plot.height >= 20, `${address} at ${width}: the plot is ${plot.height} px tall`);
      for (const hit of plot.hits) assert.ok(Math.abs(hit - plot.height) <= 1, `${address} at ${width}: a column is ${hit} px of a ${plot.height} px plot`);
      for (const column of plot.columns) {
        if (!column.bars) continue;
        const where = `${address} at ${width}, value ${column.value}`;
        assert.ok(Math.abs(column.bottom - plot.bottom) <= 1, `${where}: the bar ends ${plot.bottom - column.bottom} px above the baseline`);
        assert.ok(Math.abs((column.bottom - column.top) - plot.height * column.value / plot.max) <= 1,
          `${where}: ${column.bottom - column.top} px tall, ${plot.height * column.value / plot.max} px expected`);
        bars++;
      }
    }
  }
  assert.ok(bars > 100, `bars were measured (${bars})`);
});
