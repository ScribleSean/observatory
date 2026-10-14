import { test } from 'node:test'; // Synthetic fixtures only; no personal records.
import assert from 'node:assert/strict';
import { cleanReceipts } from './collect-dashboard.mjs';
test('continued conversation keeps latest snapshot, never sums counters', () => {
  const v = {
    conversationId: 'same',
    requestedModel: 'gemini',
    status: 'SUCCESS',
    usage: { total_tokens: 100 },
  };
  const rows = cleanReceipts([
    { value: v, modified: 1 },
    { value: { ...v, usage: { total_tokens: 150 } }, modified: 2 },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].total, 150);
  assert.ok(!JSON.stringify(rows).includes('same'));
});
test('failed provider zero counters stay unknown', () => {
  const [x] = cleanReceipts([
    {
      value: {
        conversationId: 'error',
        requestedModel: 'gemini',
        status: 'ERROR',
        error: 'private',
        usage: { total_tokens: 0 },
      },
      modified: 1,
    },
  ]);
  assert.equal(x.total, null);
  assert.equal(x.status, 'failed');
  assert.ok(!JSON.stringify(x).includes('private'));
});
