import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, lstat, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { retirementFixture } from '../native/tests/archive-retirement-fixture.mjs';

const saved = {
  schema: 2,
  collectedAt: '2026-09-09T12:00:00.000Z',
  activityHistory: [],
  tokens: [
    {
      host: 'Ubuntu',
      status: 'ok',
      checkedAt: '2026-09-09T11:59:00.000Z',
      days: [{ date: '2026-09-09', totalTokens: 42 }],
    },
  ],
  settings: [{ host: 'Ubuntu', status: 'ok', profiles: [], tools: [] }],
  localModel: { host: 'Ubuntu', status: 'ok', records: [] },
  quota: { status: 'stale' },
};
const bytes = Buffer.from(JSON.stringify(saved, null, 2) + '\r\n');
const metadata = async (file) => {
  const info = await lstat(file, { bigint: true });
  return Object.fromEntries(
    ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs'].map((key) => [
      key,
      info[key],
    ]),
  );
};
async function failedPublication(f) {
  f.failRename(true);
  await assert.rejects(f.collect(), /Fictional final rename EIO/);
  assert.equal(
    f.counts().renameAttempts,
    1,
    'The fault must reach the final publication',
  );
  f.failRename(false);
  assert.deepEqual(await readFile(f.file), bytes);
  assert.deepEqual(
    await readFile(f.snapshot),
    bytes,
    'The real archive writer must have completed',
  );
  return readFile(f.receipt);
}

test('final rename failure, quota refusal and full collection recover without rewriting retirement evidence', async (t) => {
  const f = await retirementFixture(t, bytes),
    before = await metadata(f.file);
  const receiptBytes = await failedPublication(f);
  const evidenceBefore = {
    snapshot: await metadata(f.snapshot),
    receipt: await metadata(f.receipt),
  };
  const counts = f.counts();
  await assert.rejects(
    f.collect({ quotaOnly: true }),
    /Allowance refresh deferred.*retirement/,
  );
  assert.deepEqual(
    f.counts(),
    counts,
    'Quota refusal precedes provider, peer and publication work',
  );
  assert.deepEqual(await readFile(f.file), bytes);
  assert.deepEqual(
    await metadata(f.file),
    before,
    'Exact retry preimage identity and observation times survive',
  );
  assert.deepEqual(await readFile(f.snapshot), bytes);
  assert.deepEqual(await readFile(f.receipt), receiptBytes);
  assert.deepEqual((await readdir(path.dirname(f.file))).sort(), [
    'collector.json',
    'usage.json',
  ]);

  // No deletion, repair or other intervention between refusal and full retry.
  await f.collect();
  const current = JSON.parse(await readFile(f.file));
  for (const key of ['tokens', 'settings'])
    assert.equal(
      current[key].some((row) => row.host === 'Ubuntu'),
      false,
    );
  assert.deepEqual(current.localModel, {
    host: 'Ubuntu',
    status: 'not-connected',
  });
  assert.equal(current.combinedTokens.status, 'unavailable');
  await f.collect();
  const refreshed = await f.collect({ quotaOnly: true });
  assert.equal(
    refreshed.status.mode,
    'allowances-only',
    'A completed retirement permits quota publication',
  );
  assert.equal(f.counts().renameAttempts, 4);
  assert.deepEqual(await readFile(f.snapshot), bytes);
  assert.deepEqual(await readFile(f.receipt), receiptBytes);
  assert.deepEqual(await metadata(f.snapshot), evidenceBefore.snapshot);
  assert.deepEqual(await metadata(f.receipt), evidenceBefore.receipt);
  assert.deepEqual((await readdir(path.dirname(f.snapshot))).sort(), [
    'retirement-receipt.json',
    'retirement-snapshot.json',
  ]);
  const receipt = JSON.parse(receiptBytes);
  assert.equal(receipt.collectedAt, saved.collectedAt);
  assert.equal(receipt.bytes, bytes.length);
  assert.equal(
    receipt.sha256,
    createHash('sha256').update(bytes).digest('hex'),
  );
  assert.equal(receipt.source, 'public/local/usage.json');
  assert.equal(receipt.reason, 'source-retirement');
  for (const [key, field] of [
    ['sourceMtimeNs', 'mtimeNs'],
    ['sourceCtimeNs', 'ctimeNs'],
    ['sourceBirthtimeNs', 'birthtimeNs'],
  ])
    assert.equal(receipt[key], String(before[field]));
  assert.equal(
    await readFile(path.join(f.runtime, 'collector.config.json'), 'utf8'),
    f.config,
  );
});

for (const damage of ['corrupt snapshot', 'conflicting receipt'])
  test(`${damage} remains fail-closed after quota refusal`, async (t) => {
    const f = await retirementFixture(t, bytes);
    const originalReceipt = await failedPublication(f);
    if (damage === 'corrupt snapshot') await writeFile(f.snapshot, '{');
    else
      await writeFile(
        f.receipt,
        JSON.stringify({ ...JSON.parse(originalReceipt), sourceMtimeNs: '0' }),
      );
    const checkpoint = [await readFile(f.snapshot), await readFile(f.receipt)];
    const current = await metadata(f.file),
      counts = f.counts();
    await assert.rejects(
      f.collect({ quotaOnly: true }),
      /Allowance refresh deferred.*retirement/,
    );
    assert.deepEqual(f.counts(), counts);
    for (let retry = 0; retry < 2; retry++)
      await assert.rejects(
        f.collect(),
        damage === 'corrupt snapshot'
          ? /JSON|property name/
          : /Archive receipt verification failed/,
      );
    assert.equal(f.counts().renameAttempts, 1);
    assert.deepEqual(await readFile(f.file), bytes);
    assert.deepEqual(await metadata(f.file), current);
    assert.deepEqual(
      [await readFile(f.snapshot), await readFile(f.receipt)],
      checkpoint,
    );
    assert.deepEqual((await readdir(path.dirname(f.snapshot))).sort(), [
      'retirement-receipt.json',
      'retirement-snapshot.json',
    ]);
  });
