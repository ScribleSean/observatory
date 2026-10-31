import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { format, generatedStrings, normalizeNewlines, validateStrings } from './build-strings.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('normalizes CRLF and lone CR to LF', () => {
  const normalized = normalizeNewlines('first\r\nsecond\rthird\n');
  assert.equal(normalized, 'first\nsecond\nthird\n');
  assert.ok(!normalized.includes('\r'));
});

test('generated strings contain no carriage returns', () => {
  for (const [path, content] of generatedStrings()) assert.ok(!content.includes('\r'), path);
});

test('the generated strings module is current', () => {
  const generated = generatedStrings();
  assert.equal(generated.size, 1);
  for (const [path, expected] of generated) assert.equal(read(path).replace(/\r\n/g, '\n'), expected, path);
});

for (const [name, raw] of [
  ['non-string', { app: { title: 4 } }],
  ['nested object', { app: { title: { nested: 'value' } } }],
  ['bad key', { app: { 'bad-key': 'value' } }],
  ['bad group', { App: { title: 'value' } }],
  ['em dash', { app: { title: '\u2014' } }],
  ['semicolon', { app: { title: ';' } }],
  ['control character', { app: { title: '\n' } }],
  ['empty string', { app: { title: '' } }],
  ...['{name', 'name}', '{Name}', '{{name}}', '{bad-key}', '{}'].map(value => [`placeholder ${value}`, { app: { title: value } }]),
]) {
  if (typeof name !== 'string') throw new Error('Test name must be a string');
  test(`validation refuses ${name}`, () => assert.throws(() => validateStrings(raw)));
}

test('format fills repeated placeholders including zero and refuses missing values', () => {
  assert.equal(format('{name}: {value} {name}', { name: 'Example', value: 0 }), 'Example: 0 Example');
  assert.throws(() => format('{missing}', {}), /Missing placeholder: missing/);
  assert.throws(() => format('{constructor}', {}), /Missing placeholder/);
});

const unchanged = ['Now', 'Day', 'Week', 'Month', 'All time', 'Unknown', 'Open Observatory', 'Check for updates', 'Refresh', 'Settings', 'Screen time', 'Hourly totals are not collected yet', 'All needs verified records from every device', 'Turn on codexLimits in observatory.config.json', 'Not collected yet', 'No records', 'By device'];

test('views read shared wording instead of literal labels', () => {
  for (const path of ['app/viewer/dashboard.tsx', 'app/viewer/components/ActionBar.tsx', 'app/viewer/components/Card.tsx', 'app/viewer/components/EmptyState.tsx', 'app/viewer/components/FilterGroup.tsx', 'app/viewer/components/InfoControl.tsx', 'app/viewer/components/Meter.tsx', 'app/viewer/components/Numeral.tsx', 'app/viewer/components/ProviderDot.tsx', 'app/viewer/components/Row.tsx', 'app/viewer/components/TextBar.tsx']) {
    const source = read(path);
    for (const value of unchanged) {
      assert.ok(!source.includes(`'${value}'`) && !source.includes(`"${value}"`), `${path}: ${value}`);
      assert.ok(!source.includes(`>${value}<`) && !source.includes(`>${value}{`), `${path}: JSX ${value}`);
    }
  }
});

test('panel formatting preserves fixed synthetic outputs', async () => {
  const { span, windowLabel, freshness } = await import('../lib/panel-data.mjs');
  const now = Date.parse('2026-10-14T12:00:00Z');
  assert.equal(span(3 * 3600000 + 5 * 60000), '3h 5m');
  assert.equal(windowLabel(300), '5-hour');
  assert.equal(freshness(new Date(now - 5 * 60000).toISOString(), now).label, 'Updated 5m ago');
});
