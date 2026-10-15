import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import rawPrices from './price-data.mjs';
import { loadPrices, priceDataModule, prices, rateFor } from './price-table.mjs';

const entry = () => ({ input: 1, cachedInput: 0, cacheWrite: 2, output: 3 });
const fixture = () => ({ source: 'https://example.com/prices', checkedOn: '2026-10-14', models: { synthetic: entry() } });
const normalizeNewlines = text => text.replace(/\r\n/g, '\n');

test('accepts the shipped price data', () => {
  assert.deepEqual(loadPrices(rawPrices), rawPrices);
  assert.deepEqual(prices, rawPrices);
});

test('generated module matches the source and generated text', () => {
  const source = JSON.parse(fs.readFileSync(new URL('../native/prices.json', import.meta.url), 'utf8'));
  assert.deepEqual(source, rawPrices);
  assert.equal(normalizeNewlines(fs.readFileSync(new URL('../native/prices.json', import.meta.url), 'utf8')), JSON.stringify(loadPrices(source), null, 2) + '\n');
  assert.equal(priceDataModule(loadPrices(source)), normalizeNewlines(fs.readFileSync(new URL('./price-data.mjs', import.meta.url), 'utf8')));
});

test('normalizes a CRLF generated price module to LF', () => {
  const output = priceDataModule(loadPrices(fixture()));
  assert.equal(normalizeNewlines(output.replace(/\n/g, '\r\n')), output);
});

const invalidCases = [
  ['null root', () => null],
  ['primitive root', () => 'prices'],
  ['array root', () => []],
  ['class root', () => new (class Prices {})()],
  ['custom root prototype', () => Object.create({})],
  ['unknown top-level key', value => ({ ...value, extra: true })],
  ['symbol top-level key', value => ({ ...value, [Symbol()]: true })],
  ['missing source', value => { delete value.source; return value; }],
  ['non-string source', value => ({ ...value, source: 1 })],
  ['non-https source', value => ({ ...value, source: 'http://example.com' })],
  ['missing date', value => { delete value.checkedOn; return value; }],
  ['non-string date', value => ({ ...value, checkedOn: 1 })],
  ['bad date format', value => ({ ...value, checkedOn: '2026-2-01' })],
  ['impossible date', value => ({ ...value, checkedOn: '2026-02-30' })],
  ['non-leap date', value => ({ ...value, checkedOn: '1900-02-29' })],
  ['missing models', value => { delete value.models; return value; }],
  ['null models', value => ({ ...value, models: null })],
  ['empty models', value => ({ ...value, models: {} })],
  ['array models', value => ({ ...value, models: [] })],
  ['class models', value => ({ ...value, models: new (class Models {})() })],
  ['empty model id', value => ({ ...value, models: { '': entry() } })],
  ['model id with slash', value => ({ ...value, models: { 'synthetic/model': entry() } })],
  ['uppercase model id', value => ({ ...value, models: { Synthetic: entry() } })],
  ['symbol model id', value => ({ ...value, models: { [Symbol()]: entry() } })],
  ['null model entry', value => ({ ...value, models: { synthetic: null } })],
  ['array model entry', value => ({ ...value, models: { synthetic: [] } })],
  ['class model entry', value => ({ ...value, models: { synthetic: new (class Entry {})() } })],
  ['unknown model field', value => { value.models.synthetic.extra = 0; return value; }],
  ['symbol model field', value => { value.models.synthetic[Symbol()] = 0; return value; }],
  ...['input', 'cachedInput', 'cacheWrite', 'output'].map(field => [
    `missing ${field}`, value => { delete value.models.synthetic[field]; return value; },
  ]),
  ...[NaN, Infinity, -Infinity, -1, '1', null, undefined].map(price => [
    `invalid price ${String(price)}`, value => { value.models.synthetic.input = price; return value; },
  ]),
];
for (const [name, invalid] of invalidCases) {
  test(`rejects ${String(name)}`, () => {
    assert.throws(() => loadPrices(invalid(fixture())), Error);
  });
}

test('accepts null prototypes and leap dates and freezes an independent copy', () => {
  const raw = Object.assign(Object.create(null), fixture(), { checkedOn: '2000-02-29' });
  raw.models = Object.assign(Object.create(null), { synthetic: Object.assign(Object.create(null), entry()) });
  const loaded = loadPrices(raw);
  assert.ok(Object.isFrozen(loaded));
  assert.ok(Object.isFrozen(loaded.models));
  assert.ok(Object.isFrozen(loaded.models.synthetic));
  assert.notEqual(loaded, raw);
  assert.notEqual(loaded.models, raw.models);
  assert.notEqual(loaded.models.synthetic, raw.models.synthetic);
  raw.models.synthetic.input = 9;
  assert.equal(loaded.models.synthetic.input, 1);
  assert.equal(loaded.models.synthetic.cachedInput, 0);
  assert.throws(() => { loaded.models.synthetic.input = 8; }, TypeError);
});

test('looks up exact model ids and returns null for unknown or inherited names', () => {
  assert.equal(rateFor('unknown-model'), null);
  assert.equal(rateFor('__proto__'), null);
  assert.equal(rateFor('constructor'), null);
  assert.equal(rateFor('toString'), null);
  assert.equal(rateFor(null), null);
  assert.equal(rateFor('gpt-6-astra'), prices.models['gpt-6-astra']);
  assert.ok(Object.isFrozen(rateFor('gpt-6-astra')));
  assert.equal(rateFor('gpt-' + '6-astra-extra'), null);
  assert.equal(rateFor('gpt-' + '6-ast'), null);
});

test('all fixture models are priced or deliberately unpriced', () => {
  // The source table carries these only under cloud-provider names.
  // They stay unpriced and exercise the null estimate path.
  const deliberatelyUnpriced = new Set([
    'claude-sonnet-4-20250514',
    'claude-sonnet-4',
    'claude-opus-4-1-20250805',
  ]);
  const scripts = new URL('./', import.meta.url);
  const names = new Set();
  for (const file of fs.readdirSync(scripts).filter(name => name.endsWith('.test.mjs'))) {
    const text = fs.readFileSync(new URL(file, scripts), 'utf8');
    for (const match of text.matchAll(/\b(?:gpt-[0-9][a-z0-9.-]*|claude-(?:opus|sonnet|haiku|fable)-[a-z0-9.-]*)/g)) {
      names.add(match[0].replace(/[-.]+$/, ''));
    }
  }
  const missing = [...names].filter(name => rateFor(name) === null && !deliberatelyUnpriced.has(name)).sort((a, b) => a.localeCompare(b));
  assert.deepEqual(missing, [], `Unpriced fixture models: ${missing.join(', ')}`);
});
