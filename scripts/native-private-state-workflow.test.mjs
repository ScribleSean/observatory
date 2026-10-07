import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// Source contracts only. Never launch a workflow, native helper or child process.
const source = (name) =>
  readFileSync(new URL(`../${name}`, import.meta.url), 'utf8').replaceAll(
    '\r\n',
    '\n',
  );
const entryPoints = [
  'peer-directory',
  'private-directory-policy',
  'private-path-acl',
  'mac-snapshot-archive',
  'archive-retirement-recovery',
  'refresh-allowances-retirement',
  'run-collector',
  'source-python-runner',
  'source-python-test-entry',
  'source-test-packaging',
  'source-python-workflow',
  'demo-workflow',
  'native-private-state-workflow',
].map((name) => `scripts/${name}.test.mjs`);

function verifyGate(workflow) {
  // Keep the deliberately small workflow closed to extra jobs, permissions,
  // conditional skips, shell commands, publication and dependency installs.
  const [header, ...steps] = workflow
    .split('\n')
    .filter((line) => !/^\s*#/.test(line) && line.trim())
    .join('\n')
    .concat('\n')
    .split(/^      - (?=[a-z-]+:)/m);
  assert.equal(
    header,
    `name: Native private-state contracts
on:
  pull_request:
    paths:
      - 'scripts/**'
      - 'native/**'
      - 'package.json'
      - '.github/workflows/**'
  push:
    branches: [main]
    paths:
      - 'scripts/**'
      - 'native/**'
      - 'package.json'
      - '.github/workflows/**'
permissions:
  contents: read
concurrency:
  group: native-private-state-\${{ github.ref }}
  cancel-in-progress: true
jobs:
  contracts:
    strategy:
      fail-fast: false
      matrix:
        os: [windows-latest, macos-14]
    runs-on: \${{ matrix.os }}
    timeout-minutes: 15
    steps:
`,
  );
  assert.equal(steps.length, 5, 'Only runtime setup, isolation and tests');
  assert.equal(
    steps[0],
    `uses: actions/checkout@v4
        with:
          persist-credentials: false
`,
  );
  assert.equal(
    steps[1],
    `uses: actions/setup-node@v4
        with:
          node-version: '24.21.0'
`,
  );
  assert.equal(
    steps[2],
    `uses: actions/setup-python@v5
        id: python
        with:
          python-version: '3.13'
`,
  );
  const preparation = steps[3].match(
    /^name: Isolate fictional state\n        shell: node \{0\}\n        run: \|\n((?:          .+\n)+)$/,
  );
  assert.ok(preparation, 'Prepare owned state without a platform shell');
  // Model this inspected Node snippet, not a runner or security sandbox.
  // All filesystem calls are inert and restricted to fresh fictional paths.
  for (const paths of [path.posix, path.win32]) {
    const windows = paths === path.win32;
    const runnerTemp = paths.resolve(
      windows ? 'D:/runner-temp' : '/runner-temp',
    );
    const localAppData = paths.resolve(
      windows ? 'C:/runner-localappdata' : '/unused-localappdata',
    );
    const base = windows ? localAppData : runnerTemp;
    const root = paths.join(base, 'native-private-state-owned');
    const envFile = paths.join(runnerTemp, 'environment');
    const calls = [];
    const writes = [];
    vm.runInNewContext(
      preparation[1].replace(/^          /gm, ''),
      {
        require(name) {
          if (name === 'node:path') return paths;
          assert.equal(name, 'node:fs');
          return {
            realpathSync(value) {
              assert.equal(value, base);
              return base;
            },
            mkdtempSync(prefix) {
              assert.equal(prefix, paths.join(base, 'native-private-state-'));
              calls.push('root');
              return root;
            },
            mkdirSync(directory, options) {
              assert.equal(paths.dirname(directory), root);
              assert.equal(
                JSON.stringify(options),
                '{"recursive":true,"mode":448}',
              );
              calls.push(paths.basename(directory));
            },
            appendFileSync(file, value) {
              assert.equal(file, envFile);
              writes.push(value);
            },
          };
        },
        process: {
          platform: windows ? 'win32' : 'darwin',
          env: Object.freeze({
            RUNNER_TEMP: runnerTemp,
            LOCALAPPDATA: localAppData,
            GITHUB_ENV: envFile,
          }),
        },
      },
      { timeout: 1000 },
    );
    const directories = {
      HOME: 'home',
      USERPROFILE: 'home',
      APPDATA: 'appdata',
      LOCALAPPDATA: 'localappdata',
      XDG_CONFIG_HOME: 'config',
      XDG_CACHE_HOME: 'cache',
      TMPDIR: 'tmp',
      TEMP: 'tmp',
      TMP: 'tmp',
    };
    assert.deepEqual(calls, ['root', ...Object.values(directories)]);
    assert.deepEqual(
      writes,
      Object.entries(directories).map(
        ([key, name]) => `${key}=${paths.join(root, name)}\n`,
      ),
    );
  }
  assert.equal(
    steps[4],
    `name: Verify fictional native private-state contracts
        timeout-minutes: 12
        shell: bash
        env:
          OBSERVATORY_PYTHON: \${{ steps.python.outputs.python-path }}
          OBSERVATORY_TEST_PYTHON: \${{ steps.python.outputs.python-path }}
        run: >-
          node --import ./native/tests/test-source-runtime.mjs
          --test --test-concurrency=1 --test-timeout=120000
${entryPoints.map((name) => `          ${name}\n`).join('')}`,
  );
}

const gatePath = '.github/workflows/native-private-state.yml';
const gate = () => {
  assert.ok(
    existsSync(new URL(`../${gatePath}`, import.meta.url)),
    'Missing automatic Windows/Mac native private-state gate',
  );
  return source(gatePath);
};

test('automatic native gate is read-only, isolated, bounded and serialized', () => {
  verifyGate(gate());
  for (const name of entryPoints)
    assert.ok(existsSync(new URL(`../${name}`, import.meta.url)), name);
});

test('native gate contract rejects unsafe or incomplete workflow edits', () => {
  const original = gate();
  verifyGate(original);
  for (const [before, after] of [
    ['  pull_request:', '  workflow_dispatch:'],
    ["      - 'scripts/**'", "      - 'unrelated/**'"],
    ['branches: [main]', 'branches: [unrelated]'],
    ['contents: read', 'contents: write'],
    ['windows-latest, macos-14', 'ubuntu-latest'],
    ['persist-credentials: false', 'persist-credentials: true'],
    ["node-version: '24.21.0'", "node-version: 'latest'"],
    ['steps.python.outputs.python-path', 'env.UNSELECTED_PYTHON'],
    ['--test-concurrency=1', '--test-concurrency=4'],
    ['--test-timeout=120000', '--test-timeout=0'],
    ['timeout-minutes: 15', 'timeout-minutes: 360'],
    ['HOME:', 'UNUSED_HOME:'],
    [
      'process.env.LOCALAPPDATA : process.env.RUNNER_TEMP',
      'process.env.RUNNER_TEMP : process.env.RUNNER_TEMP',
    ],
    ['scripts/archive-retirement-recovery.test.mjs', 'scripts/unused.test.mjs'],
    [
      'scripts/refresh-allowances-retirement.test.mjs',
      'scripts/unused.test.mjs',
    ],
    [
      '        shell: bash',
      '        continue-on-error: true\n        shell: bash',
    ],
    [
      '      - name: Isolate fictional state',
      '      - run: npm install\n      - name: Isolate fictional state',
    ],
    [
      '      - name: Isolate fictional state',
      '      - uses: actions/upload-artifact@v4\n      - name: Isolate fictional state',
    ],
  ]) {
    assert.ok(original.includes(before), before);
    assert.throws(() => verifyGate(original.replace(before, after)), before);
  }
});

test('native PR coverage leaves demo publication manual-only', () => {
  const demo = source('.github/workflows/demo.yml');
  assert.equal(
    demo.match(/^on:\n([\s\S]*?)^permissions:/m)?.[1],
    '  workflow_dispatch:\n',
  );
});
