// Parity between the Python reader and its Node port. Delete with the Python reader.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execPython } from './test-python.mjs';
import { collectClaudeUsage } from './read-claude-usage.mjs';
import { buildFixtures } from './fixtures/read-claude-usage/build.mjs';

const script = 'scripts/read-claude-usage.py';
const batch = `
import json, runpy, sys
reader = runpy.run_path(sys.argv[1])
results = []
for root in json.load(sys.stdin):
    try:
        results.append(reader['collect'](root))
    except Exception as error:
        results.append({'crash': type(error).__name__})
print(json.dumps(results))
`;
// Python crashes on a few out-of-range dates. The Node port reads those as unavailable.
const normalize = (result) => (result.crash ? { provider: 'claude-code', status: 'unavailable' } : result);
function python(roots) {
  const output = execPython(['-c', batch, script], { input: JSON.stringify(roots), maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(output.toString()).map(normalize);
}
async function node(roots) {
  const results = [];
  for (const root of roots) results.push(await collectClaudeUsage(root));
  return results;
}
async function workspace(action) {
  const folder = await mkdtemp(path.join(tmpdir(), 'observatory-claude-parity-'));
  try {
    await action(folder);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
const line = (fields, message = {}) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: '2026-09-25T04:30:00Z',
    requestId: 'r1',
    ...fields,
    message: {
      role: 'assistant',
      id: 'm1',
      model: 'claude-sonnet-4-20250514',
      usage: { input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 },
      ...message,
    },
  });
async function writeRoots(folder, bodies) {
  const roots = [];
  for (const [index, body] of bodies.entries()) {
    const root = path.join(folder, String(index));
    await mkdir(path.join(root, 'projects', 'p'), { recursive: true });
    await writeFile(path.join(root, 'projects', 'p', 'log.jsonl'), body);
    roots.push(root);
  }
  return roots;
}
function compare(roots, expected, actual, labels) {
  assert.equal(actual.length, expected.length);
  for (const [index] of roots.entries()) assert.deepEqual(actual[index], expected[index], labels[index]);
}

test('Node and Python agree on every shared fixture', async () =>
  workspace(async (folder) => {
    const names = await buildFixtures(folder);
    const roots = names.map((name) => path.join(folder, name));
    compare(roots, python(roots), await node(roots), names);
  }));

test('Node and Python agree on timestamp parsing, zones and day boundaries', async () =>
  workspace(async (folder) => {
    const fixed = [
      '2026-09-25T04:30:00Z', '2026-09-25T04:30:00z', '2026-09-25T04:30:00+00:00', '2026-09-25T04:30:00-00:00',
      '2026-09-25T04:30:00.123Z', '2026-09-25T04:30:00.123456Z', '2026-09-25T04:30:00.12Z', '2026-09-25T04:30:00.1234567Z',
      '2026-09-25T04Z', '2026-09-25T04:30Z', '2026-09-25T04:3Z', '2026-09-25T4:30Z', '2026-09-25 04:30:00Z',
      '2026-09-25é04:30Z', '2026-09-25€04:30Z', '2026-09-25\u{1F600}04:30Z', '2026-09-25\uD80004:30Z',
      '2026-09-25T04x+00:00', '2026-09-25T04:30:00:+00:00', '2026-09-25T04:30:00:123+01:00', '2026-09-25T04:30:00x',
      '2026-09-25T04+05:99', '2026-09-25T04+00:00:00.123456', '2026-09-25T04+00:00:00:123456', '2026-09-25T04+01:00:00.5',
      '2026-09-25T04:30-23:59:59.999999', '2026-09-25T04:30+23:59:59.999999', '2026-09-25T04:30+24:00', '2026-09-25T04:30-24:00',
      '2026-09-25T04\u0000+01:00', '2026-09-25T04:30:00ZZ', 'Z026-09-25T04:30:00Z', '2026-02-29T04:30Z', '2024-02-29T04:30Z',
      '2000-02-29T04:30Z', '1900-02-29T04:30Z', '2026-13-01T04:30Z', '2026-00-01T04:30Z', '2026-09-31T04:30Z', '0000-01-01T04:30Z',
      '0001-01-01T00:00+01:00', '0001-01-01T03:00Z', '0001-01-01T06:00Z', '9999-12-31T23:59:59.999999Z', '9999-12-31T23:00-05:00',
      '2026-09-25T24:00Z', '2026-09-25T23:60Z', '2026-09-25T23:59:60Z', '2026-09-25', '2026-09-25T', '2026-09-25T04',
      '1883-11-18T16:59:59Z', '1883-11-18T17:00:00Z', '1800-01-01T00:00Z', '1066-10-14T12:00Z', '1582-10-10T12:00Z',
      '2037-11-01T05:30Z', '2037-11-01T06:30Z', '2150-03-10T06:59:59Z', '2150-03-10T07:00:00Z',
      '2026-03-08T06:59:59.999999Z', '2026-03-08T07:00:00Z', '2026-11-01T05:59:59Z', '2026-11-01T06:00:00Z',
      '２026-09-25T04:30Z', '２０２６-09-25T04:30Z', '2026-09-25T04:30:00+05:30', '2026-09-25T04:30:00-0500',
      '2026-09-25T04:30:00+05', '2026-09-25T04:30:00 +05:00', `2026-09-25T04:30:00Z${' '.repeat(57)}`,
      `2026-09-25T04:30:00Z${' '.repeat(58)}`,
    ];
    // Deterministic random mixes of valid and broken pieces.
    let seed = 12345;
    const random = (count) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % count;
    };
    const pieces = {
      date: ['2026-09-25', '2026-01-01', '2025-12-31', '2026-03-08', '2026-11-01', '1999-12-31', '2026-9-25'],
      separator: ['T', ' ', 't', 'x', 'é', ''],
      time: ['04', '04:30', '04:30:00', '04:30:00.123', '04:30:00.123456', '23:59:59', '00:00', '4:30', '04:30:00.', '04:30:'],
      zone: ['Z', '+00:00', '-04:00', '-05:00', '+14:00', '-12:00', '+05:45:30', '+05:45:30.250000', '', '+0500', 'ZZ', '-00:30'],
    };
    const generated = Array.from({ length: 400 }, () =>
      Object.values(pieces).map((options) => options[random(options.length)]).join(''),
    );
    const stamps = [...fixed, ...generated];
    const roots = await writeRoots(folder, stamps.map((timestamp) => `${line({ timestamp })}\n`));
    compare(roots, python(roots), await node(roots), stamps);
  }));

test('Node and Python agree on JSON value types, identities and model comparison', async () =>
  workspace(async (folder) => {
    const usage = (output) => `{"input_tokens": 1, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0, "output_tokens": ${output}}`;
    const raw = (output, extra = '') =>
      `{"type": "assistant", "timestamp": "2026-09-25T04:30:00Z", "requestId": "r1"${extra}, "message": {"role": "assistant", "id": "m1", "model": "claude-x", "usage": ${usage(output)}}}\n`;
    const pair = (a, b) => `${line({}, { model: a })}\n${line({}, { model: b, usage: { input_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 } })}\n`;
    const cases = {
      'integer': raw('5'),
      'float one': raw('1.0'),
      'exponent': raw('1e2'),
      'negative zero': raw('-0'),
      'big integer': raw('9007199254740993'),
      'safe maximum': raw('9007199254740991'),
      'over safe maximum': raw('9007199254740992'),
      'nan usage': raw('NaN'),
      'infinity usage': raw('Infinity'),
      'boolean usage': raw('true'),
      'string usage': raw('"5"'),
      'nan elsewhere': raw('5', ', "extra": [NaN, -Infinity]'),
      'duplicate keys': raw('5', ', "type": "user"'),
      'proto key': raw('5', ', "__proto__": {"type": "user"}'),
      'leading zero': raw('05'),
      'trailing comma': raw('5').replace('}}\n', '},}\n'),
      'single quotes': `{'type': 'user'}\n`,
      'bad escape': raw('5', ', "x": "\\q"'),
      'surrogate escape': raw('5', ', "x": "\\ud800"'),
      'control character': raw('5', ', "x": "a\tb"'),
      'invalid utf8': Buffer.concat([Buffer.from(raw('5', ', "x": "')), Buffer.from([0xff]), Buffer.from('"}\n')]).toString('latin1'),
      'crlf': raw('5').replace('\n', '\r\n'),
      'form feed line': `\f\n${raw('5')}`,
      'nbsp line': ` \n${raw('5')}`,
      'true equals one': pair(true, 1),
      'one equals float one': `${raw('1').replace('"claude-x"', '1')}${raw('2').replace('"claude-x"', '1.0')}`,
      'nan models': `${raw('1').replace('"claude-x"', 'NaN')}${raw('2').replace('"claude-x"', 'NaN')}`,
      'dict models': pair({ a: [1, 2] }, { a: [1, 2] }),
      'dict order': pair({ a: 1, b: 2 }, { b: 2, a: 1 }),
      'list models': pair([1, 'x'], [1, 'y']),
      'null models': pair(null, null),
      'big int models': `${raw('1').replace('"claude-x"', '9007199254740993')}${raw('2').replace('"claude-x"', '9007199254740992')}`,
      'model case': pair('claude-Sonnet', 'claude-Sonnet'),
      'model newline': pair('claude-x\n', 'claude-x\n'),
      'model too long': pair(`claude-${'a'.repeat(99)}`, `claude-${'a'.repeat(99)}`),
      'model longest': pair(`claude-${'a'.repeat(98)}`, `claude-${'a'.repeat(98)}`),
      'id 256 emoji': `${line({}, { id: '\u{1F600}'.repeat(256) })}\n`,
      'id 257 emoji': `${line({}, { id: '\u{1F600}'.repeat(257) })}\n`,
      'request 256': `${line({ requestId: 'r'.repeat(256) })}\n`,
      'request 257': `${line({ requestId: 'r'.repeat(257) })}\n`,
      'numeric id': `${line({}, { id: 5 })}\n`,
      'synthetic null request': `${line({ requestId: null, isApiErrorMessage: false }, { model: '<synthetic>', usage: { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 } })}\n${line({})}\n`,
      'equal snapshots later earlier': `${line({ timestamp: '2026-09-25T05:00:00Z' })}\n${line({ timestamp: '2026-09-25T03:00:00Z' })}\n`,
      'lower snapshot later': `${line({}, { usage: { input_tokens: 5, cache_read_input_tokens: 5, cache_creation_input_tokens: 0, output_tokens: 5 } })}\n${line({ timestamp: '2026-09-24T01:00:00Z' })}\n`,
      'non dict message': `${JSON.stringify({ type: 'assistant', message: 'x' })}\n`,
      'array event': '[{"type": "assistant"}]\n',
      'no trailing newline': line({}),
      'only blank lines': '\n\n  \n',
    };
    const labels = Object.keys(cases);
    const roots = await writeRoots(
      folder,
      Object.values(cases).map((body, index) => (labels[index] === 'invalid utf8' ? Buffer.from(body, 'latin1') : body)),
    );
    compare(roots, python(roots), await node(roots), labels);
  }));

test('Node and Python agree on folder shapes', async () =>
  workspace(async (folder) => {
    const valid = `${line({})}\n`;
    const roots = [];
    const make = async (name, files) => {
      const root = path.join(folder, name);
      await mkdir(root, { recursive: true });
      for (const [relative, body] of Object.entries(files)) {
        const file = path.join(root, ...relative.split('/'));
        await mkdir(path.dirname(file), { recursive: true });
        if (body !== null) await writeFile(file, body);
      }
      roots.push(root);
      return root;
    };
    await make('empty', {});
    await make('projects-file', { projects: 'x' });
    await make('jsonl-folder', { 'projects/a.jsonl/inner.jsonl': valid });
    await make('dot-jsonl', { 'projects/.jsonl': valid });
    await make('upper', { 'projects/A.JSONL': valid });
    await make('empty-projects', { 'projects/a/b': null });
    // Python sorts unicode parts by code point, which differs from UTF-16 order.
    await make('unicode-order', {
      'projects/\u{1F600}/a.jsonl': line({}, { usage: { input_tokens: 0, cache_read_input_tokens: 1, cache_creation_input_tokens: 0, output_tokens: 1 } }) + '\n',
      'projects/～/a.jsonl': line({}) + '\n' + line({}, { usage: { input_tokens: 1, cache_read_input_tokens: 1, cache_creation_input_tokens: 0, output_tokens: 1 } }) + '\n',
    });
    const relative = path.relative(process.cwd(), path.join(folder, 'empty-projects'));
    const extra = [`${roots[0]}/`, `${roots[0]}/./`, relative, path.join(folder, 'missing'), ''];
    const all = [...roots, ...extra];
    compare(all, python(all), await node(all), all.map((root) => path.basename(root) || root));
  }));
