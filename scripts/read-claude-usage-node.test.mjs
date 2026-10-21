import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, mkdir, writeFile, appendFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fileSymlinkOrSkip } from './test-file-symlink.mjs';
import {
  collectClaudeUsage,
  MAX_FILES,
  MAX_LINES,
  MAX_LINE_BYTES,
  MAX_TOTAL_BYTES,
} from './read-claude-usage.mjs';
import { buildFixtures } from './fixtures/read-claude-usage/build.mjs';

const fixtures = fileURLToPath(new URL('./fixtures/read-claude-usage/', import.meta.url));
const event = (id, requestId, usage, { timestamp = '2026-09-25T04:30:00Z', model = 'claude-sonnet-4-20250514', type = 'assistant' } = {}) =>
  JSON.stringify({ type, timestamp, requestId, message: { role: 'assistant', id, model, usage, content: 'PRIVATE' } }) + '\n';
const usage = (input_tokens, cache_read_input_tokens, cache_creation_input_tokens, output_tokens) => ({
  input_tokens,
  cache_read_input_tokens,
  cache_creation_input_tokens,
  output_tokens,
});
async function read(root, options) {
  const data = await collectClaudeUsage(root, options);
  for (const day of data.days ?? []) {
    assert.equal(day.hours.length, 24);
    assert.ok(day.hours.every((value) => Number.isSafeInteger(value) && value >= 0));
    assert.equal(day.hours.reduce((total, value) => total + value, 0), day.totalTokens);
    for (const model of day.models) assert.equal(Object.hasOwn(model, 'hours'), false);
  }
  return data;
}
async function fixture(action) {
  const root = await mkdtemp(path.join(tmpdir(), 'observatory-claude-'));
  try {
    await action(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
async function log(root, name, body) {
  const file = path.join(root, 'projects', 'a', name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body);
  return file;
}

test('keeps the deliberate history caps and the 4 MiB line cap', () => {
  assert.equal(MAX_TOTAL_BYTES, 2 * 1024 * 1024 * 1024);
  assert.equal(MAX_FILES, 10_000);
  assert.equal(MAX_LINES, 3_000_000);
  assert.equal(MAX_LINE_BYTES, 4 * 1024 * 1024);
});
test('reads a synthetic history larger than the old 128 MiB cap completely', async () =>
  fixture(async (root) => {
    const line = Buffer.from(JSON.stringify({ type: 'user', pad: 'x'.repeat(1024 * 1024 - 25) }) + '\n');
    assert.equal(line.length, 1024 * 1024);
    const file = await log(root, 'large.jsonl', '');
    for (let index = 0; index < 130; index++) await appendFile(file, line);
    await appendFile(file, event('m1', 'r1', usage(1, 2, 3, 4)));
    assert.ok((await stat(file)).size > 128 * 1024 * 1024);
    const data = await read(root);
    assert.equal(data.status, 'ok');
    assert.equal(data.days.reduce((total, day) => total + day.requestCount, 0), 1);
  }));
for (const limit of ['MAX_TOTAL_BYTES', 'MAX_FILES', 'MAX_LINES']) {
  test(`${limit} accepts histories below and at its cap and fails closed above it`, async () =>
    fixture(async (root) => {
      const valid = event('m1', 'r1', usage(1, 2, 3, 4));
      const cap = limit === 'MAX_TOTAL_BYTES' ? Buffer.byteLength(valid) + 1 : 2;
      for (const offset of [-1, 0, 1]) {
        if (limit === 'MAX_FILES') {
          await log(root, `${offset + 1}.jsonl`, offset === -1 ? valid : '{}\n');
        } else {
          await log(root, 'one.jsonl', valid + '\n'.repeat(offset + 1));
        }
        const data = await read(root, { limits: { [limit]: cap } });
        if (offset === 1) assert.deepEqual(data, { provider: 'claude-code', status: 'unavailable' });
        else {
          assert.equal(data.status, 'ok');
          assert.equal(data.days[0].requestCount, 1);
        }
      }
    }));
}

test('keeps the final monotone streamed snapshot and separately counts cache categories', async () =>
  fixture(async (root) => {
    await log(root, 'one.jsonl', event('m1', 'r1', usage(1, 0, 0, 2)) + event('m1', 'r1', usage(4, 8, 16, 1093)));
    const data = await read(root);
    assert.equal(data.status, 'ok');
    assert.deepEqual(data.days[0].models[0], {
      model: 'claude-sonnet-4-20250514',
      inputTokens: 4,
      cacheReadTokens: 8,
      cacheCreationTokens: 16,
      outputTokens: 1093,
      totalTokens: 1121,
      requestCount: 1,
    });
  }));
test('requires Claude assistant envelopes, rejects malformed nonblank lines, and assigns midnight streams to their first day', async () =>
  fixture(async (root) => {
    await log(root, 'one.jsonl', event('m1', 'r1', usage(1, 0, 0, 2), { type: 'system' }));
    assert.equal((await read(root)).status, 'unavailable');
    await rm(path.join(root, 'projects'), { recursive: true });
    await log(root, 'one.jsonl', '{bad json}\n');
    assert.equal((await read(root)).status, 'unavailable');
    await rm(path.join(root, 'projects'), { recursive: true });
    await log(
      root,
      'one.jsonl',
      event('m1', 'r1', usage(1, 0, 0, 2), { timestamp: '2026-09-25T03:59:59Z' }) +
        event('m1', 'r1', usage(2, 0, 0, 3), { timestamp: '2026-09-25T04:00:01Z' }),
    );
    const data = await read(root);
    assert.equal(data.days.length, 1);
    assert.equal(data.days[0].date, '2026-09-24');
    assert.equal(data.days[0].hours[23], 5);
    assert.equal(data.days[0].requestCount, 1);
  }));
test('hour boundary streams use the earliest instant across timestamp offsets and file order', async () =>
  fixture(async (root) => {
    for (const earlier of [usage(1, 0, 0, 2), usage(4, 0, 0, 8)]) {
      await log(root, 'a-later.jsonl', event('m1', 'r1', usage(4, 0, 0, 8), { timestamp: '2026-09-25T01:00:01-04:00' }));
      await log(root, 'z-earlier.jsonl', event('m1', 'r1', earlier, { timestamp: '2026-09-25T04:59:59Z' }));
      const data = await read(root);
      const day = data.days[0];
      assert.equal(data.days.length, 1);
      assert.equal(day.date, '2026-09-25');
      assert.equal(day.requestCount, 1);
      assert.deepEqual(day.hours, [12, ...Array(23).fill(0)]);
    }
  }));
test('repeated daylight saving hours compare instants and share the same bucket', async () =>
  fixture(async (root) => {
    await log(
      root,
      'one.jsonl',
      event('m1', 'r1', usage(1, 0, 0, 2), { timestamp: '2026-11-01T01:59:00-04:00' }) +
        event('m1', 'r1', usage(4, 0, 0, 8), { timestamp: '2026-11-01T01:01:00-05:00' }) +
        event('m2', 'r2', usage(2, 0, 0, 3), { timestamp: '2026-11-01T01:30:00-05:00' }),
    );
    const day = (await read(root)).days[0];
    assert.equal(day.hours[1], 17);
    assert.equal(day.requestCount, 2);
  }));
test('withholds when an assistant envelope lacks numeric usage while non-assistant events stay out of scope', async () =>
  fixture(async (root) => {
    const missing = JSON.stringify({ type: 'assistant', timestamp: '2026-09-25T04:30:00Z', requestId: 'r2', message: { role: 'assistant', id: 'm2' } }) + '\n';
    const ignored = JSON.stringify({ type: 'system', message: { role: 'assistant', id: 'm3' } }) + '\n';
    await log(root, 'one.jsonl', event('m1', 'r1', usage(1, 0, 0, 2)) + ignored + missing);
    assert.equal((await read(root)).status, 'unavailable');
  }));
test('excludes recognized zero-usage client API errors without counting a request', async () =>
  fixture(async (root) => {
    const client = JSON.parse(event('client-error', undefined, usage(0, 0, 0, 0), { model: '<synthetic>' }));
    client.isApiErrorMessage = true;
    const valid = event('m1', 'r1', usage(1, 2, 3, 4));
    await log(root, 'one.jsonl', valid + JSON.stringify(client) + '\n');
    const data = await read(root);
    assert.equal(data.status, 'ok');
    assert.equal(data.days[0].totalTokens, 10);
    assert.equal(data.days[0].requestCount, 1);
    assert.equal(data.days[0].models.length, 1);
    await log(root, 'one.jsonl', JSON.stringify(client) + '\n');
    assert.equal((await read(root)).status, 'unavailable');
  }));
test('client error recognition does not excuse uncertain usage or malformed envelopes', async () =>
  fixture(async (root) => {
    const client = JSON.parse(event('client-error', undefined, usage(0, 0, 0, 0), { model: '<synthetic>' }));
    client.isApiErrorMessage = true;
    const changes = [
      (value) => {
        value.isApiErrorMessage = false;
        value.message.usage.output_tokens = 1;
      },
      (value) => {
        value.isApiErrorMessage = 1;
      },
      (value) => {
        value.message.model = '<other>';
      },
      (value) => {
        value.message.model = 'claude-sonnet-4-20250514';
      },
      (value) => {
        value.message.usage.output_tokens = 1;
      },
      (value) => {
        value.message.usage.input_tokens = -1;
      },
      (value) => {
        value.message.usage.output_tokens = false;
      },
      (value) => {
        delete value.message.usage.cache_read_input_tokens;
      },
      (value) => {
        delete value.message.id;
      },
      (value) => {
        value.timestamp = 'invalid';
      },
      (value) => {
        value.message.role = 'user';
      },
    ];
    for (const change of changes) {
      const altered = structuredClone(client);
      change(altered);
      await log(root, 'one.jsonl', event('m1', 'r1', usage(1, 2, 3, 4)) + JSON.stringify(altered) + '\n');
      assert.equal((await read(root)).status, 'unavailable');
    }
  }));
test('excludes zero-usage client placeholders that carry no request identity', async () =>
  fixture(async (root) => {
    const placeholder = JSON.parse(event('client-placeholder', undefined, usage(0, 0, 0, 0), { model: '<synthetic>' }));
    placeholder.isApiErrorMessage = false;
    await log(root, 'one.jsonl', event('m1', 'r1', usage(1, 2, 3, 4)) + JSON.stringify(placeholder) + '\n');
    const data = await read(root);
    assert.equal(data.status, 'ok');
    assert.equal(data.days[0].totalTokens, 10);
    assert.equal(data.days[0].requestCount, 1);
    const unflagged = structuredClone(placeholder);
    delete unflagged.isApiErrorMessage;
    await log(root, 'one.jsonl', event('m1', 'r1', usage(1, 2, 3, 4)) + JSON.stringify(unflagged) + '\n');
    assert.equal((await read(root)).status, 'unavailable');
  }));
test('other assistant records retain normal request and usage accounting', async () =>
  fixture(async (root) => {
    for (const [model, flag, output] of [
      ['<synthetic>', true, 3],
      ['<synthetic>', false, 0],
      ['<synthetic>', 1, 0],
      ['claude-sonnet-4-20250514', true, 0],
    ]) {
      const record = JSON.parse(event('m1', 'r1', usage(0, 0, 0, output), { model }));
      record.isApiErrorMessage = flag;
      await log(root, 'one.jsonl', JSON.stringify(record) + '\n');
      const data = await read(root);
      assert.equal(data.status, 'ok');
      assert.equal(data.days[0].totalTokens, output);
      assert.equal(data.days[0].requestCount, 1);
    }
  }));
test('uses the earliest date when file order places an older lower snapshot last', async () =>
  fixture(async (root) => {
    await log(root, 'a-later.jsonl', event('m1', 'r1', usage(4, 0, 0, 8), { timestamp: '2026-09-25T04:30:00Z' }));
    await log(root, 'z-earlier.jsonl', event('m1', 'r1', usage(1, 0, 0, 2), { timestamp: '2026-09-25T03:30:00Z' }));
    const data = await read(root);
    assert.equal(data.status, 'ok');
    assert.equal(data.days[0].date, '2026-09-24');
    assert.equal(data.days[0].totalTokens, 12);
  }));
test('deduplicates copied logs, keeps separate identities, and retains old dates', async () =>
  fixture(async (root) => {
    const first = event('m1', 'r1', usage(1, 2, 3, 4), { timestamp: '2024-01-01T03:00:00Z' });
    await log(root, 'one.jsonl', first + event('m2', 'r2', usage(5, 0, 0, 6), { timestamp: '2024-01-01T03:00:00Z' }));
    await log(root, 'nested/copy.jsonl', first);
    const data = await read(root);
    assert.equal(data.days.length, 1);
    assert.equal(data.days[0].requestCount, 2);
    assert.equal(data.days[0].totalTokens, 21);
    assert.equal(data.days[0].date, '2023-12-31');
  }));
test('fails closed for absent assistant usage, malformed identity, invalid counters, and incomparable snapshots', async () =>
  fixture(async (root) => {
    const fresh = () => rm(path.join(root, 'projects'), { recursive: true });
    await log(root, 'empty.jsonl', '{}\n');
    assert.equal((await read(root)).status, 'unavailable');
    await log(root, 'bad.jsonl', event('m', '', usage(1, 0, 0, 1)));
    assert.equal((await read(root)).status, 'unavailable');
    await fresh();
    await log(root, 'bad.jsonl', event('m', 'r', usage(-1, 0, 0, 1)));
    assert.equal((await read(root)).status, 'unavailable');
    await fresh();
    await log(root, 'bad.jsonl', event('m', 'r', usage(2, 0, 0, 1)) + event('m', 'r', usage(1, 1, 0, 1)));
    assert.equal((await read(root)).status, 'unavailable');
    await fresh();
    await log(root, 'bad.jsonl', event('m', 'r', usage(2 ** 53, 0, 0, 1)));
    assert.equal((await read(root)).status, 'unavailable');
    await fresh();
    await log(root, 'bad.jsonl', event('m', 'r', usage(1, 0, 0, 1)) + event('m', 'r', usage(2, 0, 0, 2), { model: 'claude-opus-4-1-20250805' }));
    assert.equal((await read(root)).status, 'unavailable');
  }));
test('reports missing projects as not-found', async () =>
  fixture(async (root) => {
    assert.equal((await read(root)).status, 'not-found');
  }));
test('refuses file symlink logs without leaking content', async (t) =>
  fixture(async (root) => {
    const outside = path.join(root, 'outside.jsonl');
    await writeFile(outside, event('m', 'r', usage(1, 0, 0, 1)));
    const linked = path.join(root, 'projects', 'a', 'linked.jsonl');
    await mkdir(path.dirname(linked), { recursive: true });
    if (!(await fileSymlinkOrSkip(t, outside, linked))) return;
    const output = JSON.stringify(await read(root));
    assert.equal(JSON.parse(output).status, 'unavailable');
    assert.ok(!output.includes('PRIVATE'));
    assert.ok(!output.includes('outside'));
  }));
test('reports a missing root as unavailable', async () =>
  assert.equal((await read('/definitely-not-an-observatory-claude-root')).status, 'unavailable'));
test('withholds the entire report when project enumeration is unreadable or disappears', async () =>
  fixture(async (root) => {
    await log(root, 'visible.jsonl', event('m1', 'r1', usage(1, 2, 3, 4)));
    await log(root, 'restricted/hidden.jsonl', event('m2', 'r2', usage(2, 4, 6, 8)));
    assert.equal((await read(root)).days[0].totalTokens, 30);
    const projects = path.join(fs.realpathSync(root), 'projects');
    const readdir = fs.promises.readdir;
    const results = [];
    for (const [blocked, code] of [
      [path.join(projects, 'a', 'restricted'), 'EACCES'],
      [projects, 'EACCES'],
      [path.join(projects, 'a', 'restricted'), 'ENOENT'],
    ]) {
      const denied = mock.method(fs.promises, 'readdir', (folder, ...rest) => {
        if (path.resolve(folder) === blocked) return Promise.reject(Object.assign(Error('Synthetic enumeration failure'), { code }));
        return readdir(folder, ...rest);
      });
      try {
        results.push(await collectClaudeUsage(root));
      } finally {
        denied.mock.restore();
      }
    }
    assert.deepEqual(results, Array(3).fill({ provider: 'claude-code', status: 'unavailable' }));
  }));

test('matches the recorded Python output for every synthetic fixture', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'observatory-claude-fixtures-'));
  try {
    const built = await buildFixtures(folder);
    assert.ok(built.length >= 14);
    for (const name of built) {
      const expected = JSON.parse(await readFile(path.join(fixtures, `expected-${name}.json`), 'utf8'));
      assert.deepEqual(await read(path.join(folder, name)), expected, name);
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
test('the command prints the same JSON as the module', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'observatory-claude-command-'));
  try {
    await buildFixtures(folder);
    const script = fileURLToPath(new URL('./read-claude-usage.mjs', import.meta.url));
    const output = execFileSync(process.execPath, [script, path.join(folder, 'several-projects')], { encoding: 'utf8' });
    const expected = JSON.parse(await readFile(path.join(fixtures, 'expected-several-projects.json'), 'utf8'));
    assert.deepEqual(JSON.parse(output), expected);
    assert.match(output, /^\{"provider": "claude-code", "status": "ok", /);
    const missing = execFileSync(process.execPath, [script], { encoding: 'utf8' });
    assert.equal(missing, '{"provider": "claude-code", "status": "unavailable"}\n');
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
