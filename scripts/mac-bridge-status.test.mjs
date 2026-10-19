import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const load = specifier => import(specifier);
const { createServer } = await load('vite');
const server = await createServer({ configFile: false, root: fileURLToPath(new URL('..', import.meta.url)), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
after(() => server.close());
const { validateBridgeStatus } = await server.ssrLoadModule('/app/viewer/settings/status.ts');
// The fixture must stay identical to the JSON literal in runBridgeSelfTests (native/BridgeHandler.swift).
const fixtureText = readFileSync(new URL('../native/tests/bridge-status-shapes.json', import.meta.url), 'utf8');
const shapes = JSON.parse(fixtureText.replace(/^\/\/[^\n]*\n/, ''));
test('Mac fixture stays identical to the Swift self-test literal', () => {
  const swift = readFileSync(new URL('../native/BridgeHandler.swift', import.meta.url), 'utf8');
  const literal = swift.match(/let expectedShapes = #"""\n([\s\S]*?)\n    """#/);
  assert.ok(literal);
  assert.equal(fixtureText.replace(/^\/\/[^\n]*\n/, '').trimEnd(), literal[1].trimStart());
  assert.deepEqual(shapes, JSON.parse(literal[1]));
});
const partialShapes = [
  ['unknown sources', shapes.find(shape => shape.sources === null)],
  ['unknown limits consent', shapes.find(shape => shape.limitsConsent === null)],
  ['unknown Claude token sharing', shapes.find(shape => shape.sharing['claude-code-tokens'] === null)],
];
for (const [name, shape] of partialShapes) {
  test(`Mac partial status reaches the page validator unchanged: ${name}`, () => {
    assert.ok(shape);
    assert.notEqual(shape.sharing['codex-limits'], null);
    assert.deepEqual(Object.keys(shape.sharing).sort(), ['claude-code-tokens', 'codex-limits']);
    assert.deepEqual(validateBridgeStatus(shape), shape);
  });
}
for (const shape of shapes.filter(shape => !partialShapes.some(([, partial]) => partial === shape))) {
  test(`Mac status reaches the page validator: ${shape.pairing.state}`, () => {
    assert.deepEqual(validateBridgeStatus(shape), shape);
  });
}
test('host confirming requires its fingerprint', () => {
  const shape = structuredClone(shapes[0]);
  shape.pairing.peerFingerprint = null;
  assert.equal(validateBridgeStatus(shape), null);
  delete shape.pairing.peerFingerprint;
  assert.equal(validateBridgeStatus(shape), null);
});
test('joiner awaiting confirmation refuses a fingerprint', () => {
  const shape = structuredClone(shapes[1]);
  shape.pairing.peerFingerprint = 'a'.repeat(64);
  assert.equal(validateBridgeStatus(shape), null);
});

test('active sync carries the sharing choice and channel progress', () => {
  const shape = shapes.find(shape => shape.pairing.state === 'active-sync');
  assert.ok(shape);
  assert.deepEqual(shape.sharingChoice, { chosen: true, channels: {
    'codex-limits': 'on', 'claude-code-tokens': 'waiting-for-reading',
  } });
  for (const invalid of [null, { chosen: 1, channels: shape.sharingChoice.channels },
    { chosen: true, channels: { 'codex-limits': 'on' } },
    { chosen: true, channels: { ...shape.sharingChoice.channels, 'codex-limits': 'bad' } }]) {
    assert.equal(validateBridgeStatus({ ...shape, sharingChoice: invalid }), null);
  }
});
