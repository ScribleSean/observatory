import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { projectCurrentSources } from './current-sources.mjs';

const native = (host) => ({ host, status: 'ok', days: [{ totalTokens: 12 }] });
const report = () => ({
  tokens: [native('Mac'), native('Windows')],
  settings: [
    { host: 'Mac', status: 'ok' },
    { host: 'Windows', status: 'ok' },
  ],
  combinedTokens: { host: 'All', status: 'ok', days: [{ totalTokens: 24 }] },
  combinedSettings: { host: 'All', status: 'ok', profiles: [] },
});
void test('legacy Ubuntu records are never current choices or native aggregate counters', () => {
  const raw = report();
  raw.tokens.push(native('Ubuntu'));
  raw.settings.push({ host: 'Ubuntu', status: 'ok' });
  raw.combinedTokens.days[0].totalTokens = 36;
  raw.localModel = {
    host: 'Ubuntu',
    status: 'ok',
    records: [{ model: 'fixture', output: 1 }],
  };
  const before = structuredClone(raw),
    current = projectCurrentSources(raw);
  assert.deepEqual(
    current.tokens.map((source) => source.host),
    ['Mac', 'Windows'],
  );
  assert.deepEqual(
    current.settings.map((source) => source.host),
    ['Mac', 'Windows'],
  );
  assert.equal(current.combinedTokens.status, 'unavailable');
  assert.equal(current.combinedTokens.days, undefined);
  assert.equal(current.combinedSettings.status, 'unavailable');
  assert.equal(current.hasRetiredSources, true);
  assert.deepEqual(current.localModel, raw.localModel);
  assert.deepEqual(raw, before);
});
void test('native snapshots preserve verified totals without inventing verification', () => {
  const raw = report();
  raw.tokens.push({ host: 'Ubuntu', status: 'not-connected' });
  const current = projectCurrentSources(raw);
  assert.deepEqual(
    current.tokens.map((source) => source.host),
    ['Mac', 'Windows'],
  );
  assert.deepEqual(current.combinedTokens, raw.combinedTokens);
  assert.deepEqual(current.combinedSettings, raw.combinedSettings);
  raw.combinedTokens = { host: 'All', status: 'overlap' };
  assert.deepEqual(
    projectCurrentSources(raw).combinedTokens,
    raw.combinedTokens,
  );
});
void test('the web view uses current-source projection and labels saved benchmarks as historical', async () => {
  const source = await readFile(
    new URL('../app/page.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /projectCurrentSources\(v\)/);
  assert.ok(!source.includes('Mac + Ubuntu + Windows'));
  assert.doesNotMatch(source, /these three Codex log sources/);
  assert.ok(!source.includes('Ubuntu and Wispr are optional'));
  assert.ok(!source.includes("kind:'Local model receipts'"));
  assert.ok(
    !source.includes(
      "...(data.localModel?.status==='ok'?[]:['Local model receipts'])",
    ),
  );
  assert.match(source, /Historical local model runs/);
});
