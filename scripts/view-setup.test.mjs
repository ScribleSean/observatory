import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import strings from '../lib/strings.json' with { type: 'json' };
import contract from '../lib/bridge-contract.json' with { type: 'json' };
import { SETUP_STEPS, SETUP_SOURCES, clampStep, stepLabel, setupSummary, sampleSetupStatus } from '../lib/view-setup.mjs';
const { createServer } = await import('vite');
const server = await createServer({ configFile: false, root: fileURLToPath(new URL('..', import.meta.url)), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
after(() => server.close());
const { validateBridgeStatus } = await server.ssrLoadModule('/app/viewer/settings/status.ts');
void test('source order matches the contract and step labels clamp', () => {
  assert.deepEqual(SETUP_SOURCES.map(row => row.id), contract.actions['set-source'].args.source.values);
  assert.deepEqual(SETUP_STEPS, ['sources', 'pairing', 'finish']);
  for (const [input, expected] of [[-1, 0], [0, 0], [1, 1], [2, 2], [9, 2], [NaN, 0], [1.8, 1]]) {
    assert.equal(clampStep(input), expected);
    assert.equal(stepLabel(input), `Step ${expected + 1} of 3`);
  }
});
void test('summary preserves Unknown and recognizes ActivityWatch alone', () => {
  const missing = setupSummary(null);
  assert.equal(missing.rows.length, 6);
  assert.ok(missing.rows.every(row => row.on === undefined));
  assert.equal(missing.anyOn, false);
  const status = sampleSetupStatus();
  assert.ok(setupSummary(status).rows.every(row => row.on === false));
  assert.equal(setupSummary(status).anyOn, false);
  status.sources.activity = true;
  assert.equal(setupSummary(status).anyOn, true);
});
void test('first-run sample is valid and deeply independent', () => {
  const first = sampleSetupStatus();
  assert.deepEqual(validateBridgeStatus(first), first);
  first.sources.activity = true;
  first.skin.custom.push('Other');
  first.sharing['codex-limits'].enabled = true;
  const second = sampleSetupStatus();
  assert.equal(second.sources.activity, false);
  assert.equal(second.skin.custom.includes('Other'), false);
  assert.equal(second.sharing['codex-limits'].enabled, false);
  assert.deepEqual(second.pairing, { state: 'idle', peerFingerprint: null, transport: 'none', invitationKept: false });
});
void test('setup wording meets the writing constraints', () => {
  for (const text of Object.values(strings.setup)) assert.doesNotMatch(text, /\u2014|;|ssh/i);
});

void test('summary preserves Unknown source rows when sources is null', () => {
  const status = sampleSetupStatus();
  status.sources = null;
  const summary = setupSummary(status);
  assert.equal(summary.rows.length, 6);
  assert.ok(summary.rows.slice(0, 5).every(row => row.on === undefined));
  assert.equal(summary.rows[5].on, false);
  assert.equal(summary.anyOn, false);
  assert.equal(summary.noneOn, false);
});
