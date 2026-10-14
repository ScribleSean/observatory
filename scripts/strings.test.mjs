import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { format, generatedStrings, validateStrings } from './build-strings.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('all three generated strings files are current', () => {
  const generated = generatedStrings();
  assert.equal(generated.size, 3);
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

const unchanged = ['Now', 'Day', 'Week', 'Month', 'All time', 'Unknown', 'Open Observatory', 'Check for updates', 'Refresh', 'Settings', 'Codex API-equivalent (estimate)', 'Screen time', 'Hourly totals are not collected yet', 'All needs verified records from every device', 'Turn on limits in Settings', 'Not collected yet', 'No records', 'By device', 'remaining', 'Sample data'];

test('existing rendered wording remains unchanged', () => {
  const strings = validateStrings(JSON.parse(read('lib/strings.json')));
  const values = Object.values(strings).flatMap(Object.values);
  for (const value of unchanged) assert.ok(values.includes(value), value);
  assert.equal(strings.formats.separator, ' · ');
});

test('views read shared wording instead of literal labels', () => {
  for (const path of ['app/viewer/panel/panel.tsx', 'app/viewer/dashboard.tsx', 'app/viewer/components/ActionBar.tsx', 'app/viewer/components/Card.tsx', 'app/viewer/components/EmptyState.tsx', 'app/viewer/components/FilterGroup.tsx', 'app/viewer/components/InfoControl.tsx', 'app/viewer/components/Meter.tsx', 'app/viewer/components/Numeral.tsx', 'app/viewer/components/ProviderDot.tsx', 'app/viewer/components/Row.tsx', 'app/viewer/components/TextBar.tsx']) {
    const source = read(path);
    for (const value of unchanged) {
      assert.ok(!source.includes(`'${value}'`) && !source.includes(`"${value}"`), `${path}: ${value}`);
      assert.ok(!source.includes(`>${value}<`) && !source.includes(`>${value}{`), `${path}: JSX ${value}`);
    }
  }
});

test('shared formatter refuses missing and inherited placeholders', async () => {
  const { format: sharedFormat } = await import('../lib/format.mjs');
  assert.equal(format, sharedFormat);
  assert.throws(() => sharedFormat('{missing}', {}), /Missing placeholder: missing/);
  assert.throws(() => sharedFormat('{constructor}', {}), /Missing placeholder: constructor/);
});

test('panel formatting preserves fixed synthetic outputs', async () => {
  const { span, windowLabel, freshness } = await import('../lib/panel-data.mjs');
  const now = Date.parse('2026-10-14T12:00:00Z');
  assert.equal(span(3 * 3600000 + 5 * 60000), '3h 5m');
  assert.equal(windowLabel(300), '5-hour');
  assert.equal(freshness(new Date(now - 5 * 60000).toISOString(), now).label, 'Updated 5m ago');
});
