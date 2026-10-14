import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadPrices } from './price-table.mjs';

const targets = [new URL('../native/prices.json', import.meta.url), new URL('./price-data.mjs', import.meta.url)];
const beforeImport = targets.map(file => fs.readFileSync(file));
const { mapPrices, diffPrices } = await import('./price-refresh.mjs');
const sourceUrl = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const options = { today: '2026-10-15', sourceUrl };
const rate = () => ({ input: 1, cachedInput: 0.1, cacheWrite: 2, output: 3 });
const current = () => ({ source: sourceUrl, checkedOn: '2026-10-14', models: { synthetic: rate() } });
const entry = (extra = {}) => ({
  litellm_provider: 'openai', mode: 'chat', input_cost_per_token: 0.000004,
  cache_read_input_token_cost: 2e-7, cache_creation_input_token_cost: 0.000005,
  output_cost_per_token: 0.0000201234567, ...extra,
});

test('import leaves both price files unchanged', () => {
  targets.forEach((file, index) => assert.deepEqual(fs.readFileSync(file), beforeImport[index]));
});

test('maps eligible models, preserves exact current keys and reports missing models', () => {
  const old = current();
  old.models.legacy = rate();
  const source = {
    'gpt-6-sol': entry(),
    'claude-opus-5': entry({ litellm_provider: 'anthropic' }),
    '/gpt-6-sol': entry(),
    'gpt-6-luna': entry({ litellm_provider: 'other' }),
    'gpt-6-astra': entry({ mode: 'embedding' }),
    'pattern-miss': entry(),
    legacy: entry({ litellm_provider: 'other', mode: 'other' }),
  };
  const original = structuredClone(source);
  const result = mapPrices(source, old, options);
  assert.deepEqual(Object.keys(result.prices.models), ['claude-opus-5', 'gpt-6-sol', 'legacy']);
  assert.deepEqual(result.prices.models['gpt-6-sol'], { input: 4, cachedInput: 0.2, cacheWrite: 5, output: 20.123457 });
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(result.dropped, [{ id: 'synthetic', reason: 'missing from source' }]);
  assert.deepEqual(loadPrices(result.prices), result.prices);
  assert.equal(result.prices.checkedOn, options.today);
  assert.equal(result.prices.source, sourceUrl);
  assert.deepEqual(source, original);
  assert.deepEqual(old.models.synthetic, rate());
});

for (const field of ['input_cost_per_token', 'cache_read_input_token_cost', 'cache_creation_input_token_cost', 'output_cost_per_token']) {
  test(`reports invalid ${field} and drops invalid current entries`, () => {
    for (const value of [undefined, -1, NaN, Infinity, '1', null]) {
      const invalid = entry({ [field]: value });
      if (value === undefined) delete invalid[field];
      const result = mapPrices({ 'gpt-6-sol': entry(), synthetic: invalid, 'claude-opus-5': { ...invalid, litellm_provider: 'anthropic' } }, current(), options);
      assert.deepEqual(Object.keys(result.prices.models), ['gpt-6-sol']);
      assert.deepEqual(result.skipped.map(item => item.id), ['claude-opus-5', 'synthetic']);
      assert.ok(result.skipped.every(item => item.reason.includes(field)));
      assert.deepEqual(result.dropped, [result.skipped[1]]);
    }
  });
}

test('accepts explicit zero and refuses an empty resulting table', () => {
  const result = mapPrices({ synthetic: entry({ input_cost_per_token: 0 }) }, current(), options);
  assert.equal(result.prices.models.synthetic.input, 0);
  assert.throws(() => mapPrices({}, current(), options), /non-empty/);
});

test('diff reports added, removed, changed and date lines', () => {
  const old = current();
  old.models.removed = rate();
  const next = { ...current(), checkedOn: options.today, models: { synthetic: { ...rate(), input: 4 }, added: rate() } };
  assert.deepEqual(diffPrices(old, next), [
    'added added input 1 cachedInput 0.1 cacheWrite 2 output 3',
    'removed removed', 'changed synthetic input 1 -> 4', 'checkedOn 2026-10-14 -> 2026-10-15',
  ]);
  assert.deepEqual(diffPrices(old, old), []);
});

test('child process dry run uses script-relative paths and writes nothing', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'observatory-price-test-'));
  const before = targets.map(file => fs.readFileSync(file));
  try {
    const source = path.join(folder, 'source.json');
    fs.writeFileSync(source, JSON.stringify({ 'gpt-6-sol': entry() }));
    const child = spawnSync(process.execPath, [fileURLToPath(new URL('./price-refresh.mjs', import.meta.url)), '--from', source, '--today', options.today], { cwd: folder, encoding: 'utf8', timeout: 10_000 });
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /Dry run\. Pass --write to save\./);
    assert.match(child.stdout, /Skipped: 0/);
    assert.match(child.stdout, /Dropped:/);
    targets.forEach((file, index) => assert.deepEqual(fs.readFileSync(file), before[index]));
    assert.deepEqual(fs.readdirSync(folder), ['source.json']);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test('no collector mentions the refresh and no production script imports it', () => {
  const directory = new URL('./', import.meta.url);
  const production = fs.readdirSync(directory)
    .filter(name => name.endsWith('.mjs') && !name.endsWith('.test.mjs') && name !== 'price-refresh.mjs');
  const read = name => fs.readFileSync(new URL(name, directory), 'utf8');
  const collectors = production.filter(name => name.startsWith('collect-') && read(name).includes('price-refresh'));
  assert.deepEqual(collectors, []);
  const importers = production.filter(name => /(?:from\s*|import\s*\(?\s*)['"][^'"\n]*price-refresh[^'"\n]*['"]/.test(read(name)));
  assert.deepEqual(importers, []);
});

test('refresh does not import collectors', () => {
  const source = fs.readFileSync(new URL('./price-refresh.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /(?:from\s*|import\s*\(?\s*)['"][^'"\n]*collect-[^'"\n]*\.mjs['"]/);
});
