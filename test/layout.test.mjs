// The dashboard's layout, measured in real browsers: the built dashboard is served with the fictional fixture
// (lib/sample-r2.mjs) and every view is loaded at phone and desktop widths, in dark and light, at every range and
// with one, two and three computers (JOBS in scripts/harness/layout-audit.mjs). In each page scripts/harness/layout-audit.mjs measures what is on screen and
// reports anything out of line: a bar off its baseline, a label off its column, labels that touch, a scale value
// off its rule, numbers that do not end on one edge, anything outside its card, a page that scrolls sideways.
// It runs in Chromium (any Chrome, Chromium or Edge on the computer, or the one CHROME names) and in WebKit, the
// engine Safari uses (macOS with swiftc). Each engine's test skips with a reason where its browser is missing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUDIT, JOBS, VIEWS } from '../scripts/harness/layout-audit.mjs';
import { findChromium, launchChromium } from '../scripts/harness/chromium.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const run = promisify(execFile);
const chromium = findChromium();
const hasSwift = process.platform === 'darwin' && spawnSync('/usr/bin/which', ['swiftc'], { encoding: 'utf8' }).status === 0;
const skipChromium = chromium ? false : 'no Chrome, Chromium or Edge on this computer (set CHROME to one)';
const skipWebKit = process.platform !== 'darwin' ? 'WebKit views exist only on macOS' : !hasSwift ? 'swiftc is missing (install the Xcode command line tools)' : false;

// The same audit on a page knocked out of line on purpose: each of these must be reported, or the audit checks nothing.
const BROKEN = `const style = document.createElement('style');
style.textContent = '.chart>.xl{margin-left:14px}.chart>.plot.cm{margin-left:9px}.chart>.ticks span{margin-bottom:6px}.bl .n{text-align:left}.chart>.bandh{margin-left:10px}.blk>.sayline{margin-left:-40px}';
document.head.append(style);
${AUDIT}`;
const BROKEN_KINDS = ['labels', 'plot', 'scale', 'numbers', 'key', 'card'];

// The fixture's forecast follows its clock, and for a few minutes a day it is a range across two days, the longest
// it gets ("Claude may run out Fri 11 PM to Sat 12 AM" at this instant). The views are measured once more at this
// instant, so the longest forecast is checked on every run and not only when the clock happens to land there.
const LONGEST_FORECAST_AT = Date.parse('2026-11-27T19:32:00Z');
const LONGEST_FORECAST = /may run out \w{3}\s\d{1,2}\s[AP]M to \w{3}\s/;

/** The built dashboard served with the fictional fixture, once for both engines. */
let served;
function serve() {
  served ??= (async () => {
    const work = await mkdtemp(path.join(tmpdir(), 'observatory-layout-'));
    const { build } = await import('vite');
    const assets = path.join(work, 'dashboard');
    await build({ configFile: path.join(root, 'vite.config.mts'), logLevel: 'silent', build: { outDir: assets, emptyOutDir: true } });
    const { createLocalServer } = await import('../serve-local.mjs');
    const { sampleR2Combined } = await import('../lib/sample-r2.mjs');
    const dataFolder = path.join(work, 'data');
    await mkdir(path.join(dataFolder, 'public', 'local'), { recursive: true });
    await writeFile(path.join(dataFolder, 'public', 'local', 'combined.json'), JSON.stringify(sampleR2Combined(Date.now())));
    const server = createLocalServer({ assets, dataFolder });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const fixture = now => writeFile(path.join(dataFolder, 'public', 'local', 'combined.json'), JSON.stringify(sampleR2Combined(now)));
    return { work, server, fixture, base: `http://127.0.0.1:${server.address().port}/` };
  })();
  return served;
}
test.after(async () => {
  if (!served) return;
  const { work, server } = await served;
  server.closeAllConnections?.();
  server.close();
  await rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

/** Fails with every problem the pages reported, and unless the pages held enough to measure. */
function judge(engine, results, least = { cards: 300, plots: 70, bars: 1200, ticks: 170, labels: 380, values: 60, numbers: 1200, empties: 4 }) {
  const problems = [], counts = {};
  for (const { job, result } of results) {
    const where = `${job.address} at ${job.width} px, ${job.scheme}`;
    if (result.error) { problems.push(`${where}: ${result.error}`); continue; }
    for (const [key, value] of Object.entries(result.counts)) counts[key] = (counts[key] ?? 0) + value;
    for (const problem of result.problems) problems.push(`${where}: ${problem}`);
  }
  assert.equal(problems.length, 0, `${engine}: ${problems.length} layout problems\n${problems.slice(0, 30).join('\n')}`);
  for (const [key, floor] of Object.entries(least)) assert.ok(counts[key] >= floor, `${engine}: ${counts[key]} ${key} were measured, ${floor} expected at least`);
}
function judgeBroken(engine, result) {
  assert.ok(!result.error, `${engine}: ${result.error}`);
  for (const kind of BROKEN_KINDS) assert.ok(result.problems.some(problem => problem.startsWith(`${kind}:`)), `${engine}: a page knocked out of line reports a ${kind} problem (${result.problems.join(' | ')})`);
}

test('in Chromium every view is in line at every width, range and theme', { skip: skipChromium, timeout: 600000 }, async t => {
  const { base, fixture } = await serve();
  const page = await launchChromium(chromium);
  t.after(() => page.close());
  const results = [];
  for (const job of JOBS) {
    await page.open(base + job.address, { width: job.width, height: 900, scheme: job.scheme });
    results.push({ job, result: JSON.parse(await page.evaluate(AUDIT)) });
  }
  judge('Chromium', results);
  await page.open(`${base}#overview`, { width: 1280, height: 900, scheme: 'dark' });
  judgeBroken('Chromium', JSON.parse(await page.evaluate(BROKEN)));

  // Every view at the narrowest widths with the longest forecast, the fixture and the page's clock at the same instant.
  // The WebKit test reads the same server, so the current fixture goes back afterwards.
  await fixture(LONGEST_FORECAST_AT);
  const longest = [];
  try {
    for (const width of [320, 375]) for (const address of VIEWS) {
      const job = { address, width, scheme: 'dark' };
      await page.open(base + address, { width, height: 900, scheme: 'dark', now: LONGEST_FORECAST_AT });
      longest.push({ job, result: JSON.parse(await page.evaluate(AUDIT)) });
      if (address === '#overview') {
        const forecast = await page.evaluate(`return [...document.querySelectorAll('.lim .h span.pace')].map(span => span.textContent).join(' | ');`);
        assert.match(forecast, LONGEST_FORECAST, `Chromium: the fixture at ${new Date(LONGEST_FORECAST_AT).toISOString()} shows a forecast range (${forecast})`);
      }
    }
  } finally {
    await fixture(Date.now());
  }
  judge('Chromium, longest forecast', longest, { cards: VIEWS.length * 2 });
});

test('in WebKit every view is in line at every width, range and theme', { skip: skipWebKit, timeout: 900000 }, async () => {
  const { base, work } = await serve();
  const tool = path.join(work, 'webkit');
  execFileSync('swiftc', ['-O', '-o', tool, path.join(root, 'scripts/harness/webkit.swift')], { stdio: 'pipe' });
  // One process measures every page. Run without blocking: the server answering the pages runs in this process.
  const batch = async (jobs, script) => {
    const file = path.join(work, `jobs-${jobs.length}.json`);
    await writeFile(file, JSON.stringify(jobs.map(job => ({ url: base + job.address, width: job.width, height: 900, scheme: job.scheme }))));
    const { stdout } = await run(tool, ['--batch', file, script], { encoding: 'utf8', timeout: 840000, maxBuffer: 64e6 })
      .catch(error => assert.fail(`WebKit: ${(error.stdout || error.message).trim().split('\n').at(-1)}`));
    const lines = stdout.trim().split('\n');
    assert.equal(lines.length, jobs.length, `WebKit: ${lines.length} of ${jobs.length} pages answered`);
    return lines.map((line, index) => ({ job: jobs[index], result: JSON.parse(line) }));
  };
  // 320 px is measured in Chromium only: the WebKit on the CI runners lays these cards out narrower than Safari on a
  // current Mac does at that width, so the result there would not say what a phone shows.
  judge('WebKit', await batch(JOBS.filter(job => job.width >= 375), AUDIT), { cards: 280, plots: 70, bars: 1200, ticks: 170, labels: 380, values: 60, numbers: 1200, empties: 4 });
  judgeBroken('WebKit', (await batch([{ address: '#overview', width: 1280, scheme: 'dark' }], BROKEN))[0].result);
});
