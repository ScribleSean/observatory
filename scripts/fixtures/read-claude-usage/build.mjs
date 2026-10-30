// Each fixture is a Claude folder. All content is fictional.
import { mkdir, writeFile, symlink } from 'node:fs/promises';
import path from 'node:path';

const usage = (input, cacheRead, cacheCreation, output) => ({
  input_tokens: input,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheCreation,
  output_tokens: output,
});
const event = (id, requestId, values, { timestamp = '2026-09-25T04:30:00Z', model = 'claude-sonnet-4-20250514', type = 'assistant', extra = {} } = {}) =>
  JSON.stringify({ type, timestamp, requestId, ...extra, message: { role: 'assistant', id, model, usage: values, content: 'synthetic' } }) + '\n';
const user = (text = 'synthetic') => JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n';

export const FIXTURES = {
  'several-projects': {
    'projects/alpha/one.jsonl':
      user() +
      event('m1', 'r1', usage(10, 200, 30, 40), { timestamp: '2026-09-20T14:05:00Z' }) +
      event('m2', 'r2', usage(1, 2, 3, 4), { timestamp: '2026-09-20T15:59:59.999Z', model: 'claude-opus-4-1-20250805' }) +
      '\n' +
      event('m3', 'r3', usage(7, 0, 0, 9), { timestamp: '2026-09-21T09:00:00+02:00', model: 'claude-haiku-3-5' }),
    'projects/beta/nested/two.jsonl':
      event('m4', 'r4', usage(5, 5, 5, 5), { timestamp: '2026-09-21T23:30:00-04:00' }) +
      event('m5', 'r5', usage(2, 0, 0, 1), { timestamp: '2026-09-22T12:00:00.123456+00:00', model: 'not-a-claude-model' }),
    'projects/gamma/notes.txt': 'not a log\n',
  },
  duplicates: {
    'projects/a/first.jsonl':
      event('m1', 'r1', usage(1, 0, 0, 2), { timestamp: '2026-09-25T03:59:59Z' }) +
      event('m1', 'r1', usage(3, 4, 0, 20), { timestamp: '2026-09-25T04:00:10Z' }) +
      event('m2', 'r2', usage(6, 0, 0, 6)) +
      event('m2', 'r3', usage(6, 0, 0, 6)) +
      event('m3', 'r2', usage(1, 1, 1, 1)),
    'projects/b/copy.jsonl':
      event('m1', 'r1', usage(3, 4, 0, 20), { timestamp: '2026-09-25T04:00:10Z' }) +
      event('m2', 'r2', usage(6, 0, 0, 6), { timestamp: '2026-09-25T02:00:00Z' }),
  },
  'midnight-and-dst': {
    'projects/a/days.jsonl':
      event('m1', 'r1', usage(1, 0, 0, 1), { timestamp: '2026-03-08T06:59:59Z' }) +
      event('m2', 'r2', usage(2, 0, 0, 2), { timestamp: '2026-03-08T07:00:00Z' }) +
      event('m3', 'r3', usage(3, 0, 0, 3), { timestamp: '2026-11-01T05:30:00Z' }) +
      event('m4', 'r4', usage(4, 0, 0, 4), { timestamp: '2026-11-01T06:30:00Z' }) +
      event('m5', 'r5', usage(5, 0, 0, 5), { timestamp: '2026-12-31T23:59:59-05:00' }) +
      event('m6', 'r6', usage(6, 0, 0, 6), { timestamp: '2027-01-01T05:00:00Z' }) +
      event('m7', 'r7', usage(7, 0, 0, 7), { timestamp: '1850-06-01T04:57:00Z' }) +
      event('m8', 'r8', usage(8, 0, 0, 8), { timestamp: '2099-07-04T03:59:00Z' }) +
      event('m9', 'r9', usage(9, 0, 0, 9), { timestamp: '2026-09-25T04x+05:99' }),
  },
  'skipped-entries': {
    'projects/a/mixed.jsonl':
      user() +
      '   \t\n' +
      '\x0b\x0c\r\n' +
      JSON.stringify({ type: 'system', note: NaN }).replace('null', 'NaN') + '\n' +
      '[1, 2, 3]\n' +
      '"text"\n' +
      JSON.stringify({ type: 'summary', message: { role: 'assistant' } }) + '\r\n' +
      event('client-error', undefined, usage(0, 0, 0, 0), { model: '<synthetic>', extra: { isApiErrorMessage: true } }) +
      event('placeholder', undefined, usage(0, 0, 0, 0), { model: '<synthetic>', extra: { isApiErrorMessage: false } }) +
      event('m1', 'r1', usage(1, 2, 3, 4)) +
      event('m2', 'r2', usage(0, 0, 0, 0), { model: '<synthetic>' }).trimEnd(),
  },
  'order-matters': {
    // Python sorts paths by parts, so proj/ comes before proj-x/.
    'projects/proj/z.jsonl': event('m1', 'r1', usage(1, 0, 0, 1)) + event('m1', 'r1', usage(1, 1, 0, 1)),
    'projects/proj-x/a.jsonl': event('m1', 'r1', usage(0, 1, 0, 1)),
  },
  'malformed-line': {
    'projects/a/one.jsonl': event('m1', 'r1', usage(1, 0, 0, 1)) + '{bad json}\n',
  },
  'float-usage': {
    'projects/a/one.jsonl': event('m1', 'r1', usage(1, 0, 0, 1)).replace('"output_tokens":1', '"output_tokens":1.0'),
  },
  'byte-order-mark': {
    'projects/a/one.jsonl': '﻿' + event('m1', 'r1', usage(1, 0, 0, 1)),
  },
  'oversize-line': {
    'projects/a/one.jsonl': event('m1', 'r1', usage(1, 0, 0, 1)) + JSON.stringify({ type: 'user', pad: 'x'.repeat(4 * 1024 * 1024) }) + '\n',
  },
  'naive-timestamp': {
    'projects/a/one.jsonl': event('m1', 'r1', usage(1, 0, 0, 1), { timestamp: '2026-09-25T04:30:00' }),
  },
  'model-changed': {
    'projects/a/one.jsonl': event('m1', 'r1', usage(1, 0, 0, 1)) + event('m1', 'r1', usage(2, 0, 0, 2), { model: 'claude-opus-4-1-20250805' }),
  },
  'only-users': {
    'projects/a/one.jsonl': user() + user(),
  },
  'no-logs': {
    'projects/a/readme.txt': 'nothing here\n',
  },
  'missing-projects': {
    'settings.json': '{}\n',
  },
  'symlink-file': {
    'outside.jsonl': event('m1', 'r1', usage(1, 0, 0, 1)),
    'projects/a/real.jsonl': event('m2', 'r2', usage(1, 0, 0, 1)),
    'projects/a/linked.jsonl': { link: 'outside.jsonl' },
  },
  'symlink-folder': {
    'elsewhere/one.jsonl': event('m1', 'r1', usage(1, 0, 0, 1)),
    'projects/a/real.jsonl': event('m2', 'r2', usage(1, 0, 0, 1)),
    'projects/a/linked': { link: 'elsewhere' },
  },
  'symlink-other-name': {
    'outside.txt': 'synthetic\n',
    'projects/a/real.jsonl': event('m2', 'r2', usage(1, 0, 0, 1)),
    'projects/a/linked.txt': { link: 'outside.txt' },
  },
};

// A symlink fixture is left out where the platform refuses links.
export async function buildFixtures(folder) {
  const built = [];
  for (const [name, files] of Object.entries(FIXTURES)) {
    const root = path.join(folder, name);
    await mkdir(root, { recursive: true });
    let complete = true;
    for (const [relative, body] of Object.entries(files)) {
      const file = path.join(root, ...relative.split('/'));
      await mkdir(path.dirname(file), { recursive: true });
      if (typeof body === 'string') {
        await writeFile(file, body);
        continue;
      }
      const target = path.join(root, ...body.link.split('/'));
      try {
        await symlink(target, file, relative.endsWith('.jsonl') || relative.endsWith('.txt') ? 'file' : 'dir');
      } catch (error) {
        if (process.platform !== 'win32' || error.code !== 'EPERM') throw error;
        complete = false;
      }
    }
    if (complete) built.push(name);
  }
  return built;
}
