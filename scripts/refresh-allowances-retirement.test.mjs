import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  realpath,
  writeFile,
  readFile,
  lstat,
  readdir,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { refreshAllowances } from './refresh-allowances.mjs';

// Fictional saved files model a failed final publication. No permission helper,
// provider or peer is called. archive-retirement-recovery.test.mjs creates the
// checkpoint through the real archive writer and injects the final rename fault.
const saved = {
  schema: 2,
  collectedAt: '2026-09-09T12:00:00.000Z',
  tokens: [
    {
      host: 'Ubuntu',
      status: 'ok',
      checkedAt: '2026-09-09T11:59:00.000Z',
      days: [],
    },
  ],
  quota: { status: 'stale', checkedAt: '2026-09-09T11:58:00.000Z' },
};
const bytes = Buffer.from(JSON.stringify(saved, null, 2) + '\r\n');
async function fixture(t) {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), 'observatory-retirement-refresh-')),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const folder = path.join(root, 'public/local'),
    checkpoint = path.join(root, '.runtime/private-repair');
  await mkdir(folder, { recursive: true });
  const file = path.join(folder, 'usage.json');
  await writeFile(file, bytes);
  return { root, folder, file, checkpoint };
}
test('quota refresh refuses a pending retirement before provider access without changing evidence', async (t) => {
  const f = await fixture(t);
  await mkdir(f.checkpoint, { recursive: true });
  const snapshot = path.join(f.checkpoint, 'retirement-snapshot.json');
  const receipt = path.join(f.checkpoint, 'retirement-receipt.json');
  await writeFile(snapshot, bytes);
  const receiptBytes = Buffer.from(
    '{"fictional":"unchanged receipt sentinel"}\n',
  );
  await writeFile(receipt, receiptBytes);
  const before = await lstat(f.file, { bigint: true });
  let reads = 0,
    syncs = 0;
  await assert.rejects(
    refreshAllowances(f.root, {
      enabled: true,
      readQuota: async () => {
        reads++;
        return { status: 'ok', checkedAt: '2026-09-09T12:05:00.000Z' };
      },
      sync: async () => {
        syncs++;
      },
    }),
    /Allowance refresh deferred.*retirement/,
  );
  assert.equal(reads, 0);
  assert.equal(syncs, 0);
  assert.deepEqual(await readFile(f.file), bytes);
  assert.deepEqual(await readFile(snapshot), bytes);
  assert.deepEqual(await readFile(receipt), receiptBytes);
  const after = await lstat(f.file, { bigint: true });
  for (const key of ['ino', 'dev', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs'])
    assert.equal(after[key], before[key]);
  assert.deepEqual(await readdir(f.folder), ['usage.json']);
});

for (const name of ['retirement-snapshot.json', 'retirement-receipt.json']) {
  test(`quota refresh refuses even an incomplete ${name} without repairing it`, async (t) => {
    const f = await fixture(t);
    await mkdir(f.checkpoint, { recursive: true });
    const entry = path.join(f.checkpoint, name);
    await writeFile(entry, '{');
    await assert.rejects(
      refreshAllowances(f.root, {
        enabled: false,
        readQuota: () => assert.fail('Must not read a provider'),
        sync: () => assert.fail('Must not sync'),
      }),
      /Allowance refresh deferred/,
    );
    assert.equal(await readFile(entry, 'utf8'), '{');
    assert.deepEqual(await readFile(f.file), bytes);
    assert.deepEqual(await readdir(f.checkpoint), [name]);
  });
}
for (const key of [
  'tokens',
  'settings',
  'activity',
  'activityHistory',
  'providerTokenSources',
  'localModel',
]) {
  test(`quota guard uses the retirement evidence policy for ${key}`, async (t) => {
    const f = await fixture(t);
    await mkdir(f.checkpoint, { recursive: true });
    const source = {
      host: 'Ubuntu',
      status: 'unavailable',
      checkedAt: '2026-09-09T11:59:00.000Z',
    };
    const original = JSON.stringify({
      schema: 2,
      collectedAt: saved.collectedAt,
      [key]: key === 'localModel' ? source : [source],
    });
    await writeFile(f.file, original);
    await writeFile(
      path.join(f.checkpoint, 'retirement-snapshot.json'),
      'conflicting saved evidence',
    );
    await assert.rejects(
      refreshAllowances(f.root, {
        enabled: true,
        readQuota: () => assert.fail('Must not read a provider'),
      }),
      /Allowance refresh deferred/,
    );
    assert.equal(await readFile(f.file, 'utf8'), original);
    assert.equal(
      await readFile(
        path.join(f.checkpoint, 'retirement-snapshot.json'),
        'utf8',
      ),
      'conflicting saved evidence',
    );
  });
}
for (const layout of [
  'absent-control',
  'absent-private-folder',
  'empty-private-folder',
]) {
  test(`quota refresh retains its normal behavior with ${layout}`, async (t) => {
    const f = await fixture(t);
    if (layout === 'absent-private-folder')
      await mkdir(path.dirname(f.checkpoint));
    if (layout === 'empty-private-folder')
      await mkdir(f.checkpoint, { recursive: true });
    const quota = { status: 'ok', checkedAt: '2026-09-09T12:05:00.000Z' };
    const result = await refreshAllowances(f.root, {
      enabled: true,
      readQuota: async () => quota,
      sync: async () => {},
    });
    assert.equal(result.status.state, 'ok');
    assert.equal(result.status.mode, 'allowances-only');
    assert.deepEqual(JSON.parse(await readFile(f.file)), { ...saved, quota });
    assert.deepEqual(await readdir(f.folder), ['usage.json']);
    if (layout === 'empty-private-folder')
      assert.deepEqual(await readdir(f.checkpoint), []);
  });
}
test('completed retirement does not block quota refresh because historical checkpoint files remain', async (t) => {
  const f = await fixture(t);
  await mkdir(f.checkpoint, { recursive: true });
  await writeFile(path.join(f.checkpoint, 'retirement-snapshot.json'), bytes);
  const current = {
    ...saved,
    tokens: [
      { host: 'Windows', status: 'ok', checkedAt: saved.collectedAt, days: [] },
    ],
    localModel: { host: 'Ubuntu', status: 'not-connected' },
  };
  await writeFile(f.file, JSON.stringify(current));
  const quota = { status: 'not-connected' };
  await refreshAllowances(f.root, {
    enabled: false,
    readQuota: async () => quota,
    sync: async () => {},
  });
  assert.deepEqual(JSON.parse(await readFile(f.file)), { ...current, quota });
  assert.deepEqual(
    await readFile(path.join(f.checkpoint, 'retirement-snapshot.json')),
    bytes,
  );
});
for (const level of ['control', 'private-folder']) {
  test(`uninspectable ${level} fails closed without a quota write`, async (t) => {
    const f = await fixture(t);
    if (level === 'private-folder') await mkdir(path.dirname(f.checkpoint));
    const target =
      level === 'control' ? path.dirname(f.checkpoint) : f.checkpoint;
    await writeFile(target, 'not a directory');
    await assert.rejects(
      refreshAllowances(f.root, {
        enabled: true,
        readQuota: () => assert.fail('Must not read a provider'),
      }),
      /Unsafe retirement checkpoint directory/,
    );
    assert.deepEqual(await readFile(f.file), bytes);
    assert.equal(await readFile(target, 'utf8'), 'not a directory');
  });
}
