import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execPython, pythonTestCommand } from './test-python.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { testRuntimeBase } from './test-runtime-base.mjs';

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
    'test_private_path_acl_watch.py',
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


test('Mac private-path check tolerates concurrent ancestor entry churn', {
  skip: process.platform !== 'darwin',
}, async () => {
  const runtime = await testRuntimeBase('private-path-acl');
  let running = true;
  let churn;
  let cycles = 0;
  try {
    const privateFolder = path.join(runtime, 'private');
    await fs.mkdir(privateFolder, { mode: 0o700 });
    await fs.writeFile(path.join(privateFolder, 'fixture.txt'), 'fictional fixture', { mode: 0o600 });
    const command = pythonTestCommand([
      fileURLToPath(new URL('./private-path-acl.py', import.meta.url)),
      '--private', privateFolder,
    ]);
    const run = () => promisify(execFile)(command.executable, command.args, {
      encoding: 'utf8', timeout: 15000,
    });
    const churnPaths = [
      path.join(runtime, 'churn'),
      path.join(path.dirname(runtime), `${path.basename(runtime)}-churn`),
    ];
    churn = (async () => {
      while (running) {
        for (const filename of churnPaths) {
          await fs.writeFile(filename, 'fictional churn', { mode: 0o600 });
          await fs.unlink(filename);
        }
        cycles += 1;
      }
    })();
    // Observe rejection immediately while retaining the original promise.
    churn.catch(() => { running = false; });
    for (let index = 0; index < 20; index += 1) {
      const { stdout, stderr } = await run();
      assert.equal(stdout, 'private-path-acl: ok');
      assert.equal(stderr, '');
    }
    assert.ok(cycles > 0);
    await fs.chmod(runtime, 0o777);
    try {
      await assert.rejects(run(), (error) => {
        assert.equal(error.code, 1);
        assert.equal(error.stdout, '');
        assert.equal(error.stderr, 'private-path-acl: verification failed\n');
        return true;
      });
    } finally {
      await fs.chmod(runtime, 0o700);
    }
  } finally {
    running = false;
    try {
      await churn;
    } finally {
      await fs.rm(runtime, { recursive: true, force: true });
    }
  }
});
