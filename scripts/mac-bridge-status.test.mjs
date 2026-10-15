import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const load = specifier => import(specifier);
const { createServer } = await load('vite');
const server = await createServer({ configFile: false, root: fileURLToPath(new URL('..', import.meta.url)), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
after(() => server.close());
const { validateBridgeStatus } = await server.ssrLoadModule('/app/viewer/settings/status.ts');
const fixtureText = readFileSync(new URL('../native/tests/bridge-status-shapes.json', import.meta.url), 'utf8');
const shapes = JSON.parse(fixtureText.replace(/^\/\/[^\n]*\n/, ''));
test('Mac fixture stays identical to the Swift self-test literal', () => {
  const swift = readFileSync(new URL('../native/BridgeHandler.swift', import.meta.url), 'utf8');
  const literal = swift.match(/let expectedShapes = #"""\n([\s\S]*?)\n    """#/);
  assert.ok(literal);
  assert.deepEqual(shapes, JSON.parse(literal[1]));
});
for (const shape of shapes) {
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
