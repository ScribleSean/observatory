import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execPython } from './test-python.mjs';

const testDirectory = fileURLToPath(
  new URL('../native/tests', import.meta.url),
);

test('Mac private-path policy regressions run through the standard test command', () => {
  const output = execPython(
    [
      '-c',
      `import sys, unittest
suite = unittest.defaultTestLoader.discover(sys.argv[1], pattern='test_private_path_acl*.py')
if suite.countTestCases() == 0:
    raise RuntimeError('No private-path ACL regression cases discovered')
result = unittest.TextTestRunner(stream=sys.stdout).run(suite)
sys.exit(0 if result.wasSuccessful() else 1)
`,
      testDirectory,
    ],
    { encoding: 'utf8', stdio: 'pipe', timeout: 15000 },
  );
  assert.match(output, /Ran [1-9][0-9]* tests/);
});

test('Mac ACL policy fixtures stay outside the packaged collector scripts', () => {
  for (const name of [
    'test_private_path_acl.py',
    'test_private_path_acl_native.py',
    'test_private_path_acl_walk.py',
  ]) {
    assert.equal(existsSync(new URL(`./${name}`, import.meta.url)), false);
    assert.equal(
      existsSync(new URL(`../native/tests/${name}`, import.meta.url)),
      true,
    );
  }
  assert.equal(
    existsSync(new URL('./private-path-acl.py', import.meta.url)),
    true,
  );
});
