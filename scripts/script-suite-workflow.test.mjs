import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(
  new URL('../.github/workflows/script-suite.yml', import.meta.url),
  'utf8',
).replaceAll('\r\n', '\n');
const section = (name) =>
  workflow.match(new RegExp(`^${name}:\\n([\\s\\S]*?)(?=^\\S|$(?![\\s\\S]))`, 'm'))?.[1];
const triggers = section('on');
const steps = workflow.split(/^      - /m).slice(1);
const suite = steps.find((step) => step.startsWith('name: Run full script suite\n'));
const paths = [
  'scripts/**',
  'lib/**',
  'app/**',
  'native/web/**',
  'native/tests/**',
  'package.json',
  'package-lock.json',
  '.github/workflows/script-suite.yml',
];

test('script suite triggers are exactly pull requests, pushes and manual dispatch', () => {
  assert.deepEqual(
    [...triggers.matchAll(/^  ([\w-]+):/gm)].map((match) => match[1]),
    ['pull_request', 'push', 'workflow_dispatch'],
  );
});

test('pushes target only main', () => {
  assert.match(triggers, /^  push:\n    branches: \[main\]\n/m);
});

test('manual dispatch has no inputs', () => {
  assert.match(triggers, /  workflow_dispatch:\n$/);
});

for (const event of ['pull_request', 'push']) {
  test(`${event} has exactly the eight script suite paths`, () => {
    const block = triggers.match(new RegExp(`^  ${event}:\\n([\\s\\S]*?)(?=^  \\w|$(?![\\s\\S]))`, 'm'))?.[1];
    assert.deepEqual(
      [...block.matchAll(/^      - '([^']+)'$/gm)].map((match) => match[1]),
      paths,
    );
  });
}

test('permissions grant only contents read access', () => {
  assert.equal(section('permissions'), '  contents: read\n');
});

test('workflow contains no write permission text', () => {
  assert.doesNotMatch(workflow, /write/i);
});

test('matrix contains exactly Windows and macOS runners', () => {
  assert.match(workflow, /      matrix:\n        os: \[windows-latest, macos-14\]\n    runs-on: \$\{\{ matrix.os \}\}/);
});

test('Node is pinned to 24.21.0', () => {
  assert.match(workflow, /^          node-version: '24\.21\.0'$/m);
});

test('Python is pinned to 3.13', () => {
  assert.match(workflow, /^          python-version: '3\.13'$/m);
});

test('suite job timeout is 50 minutes', () => {
  assert.match(workflow, /^    timeout-minutes: 50$/m);
});

test('suite invokes Node through the source runtime preload', () => {
  assert.ok(suite.includes("['--import', './native/tests/test-source-runtime.mjs', '--test', '--test-timeout=300000']"));
  assert.ok(suite.includes('spawnSync(process.execPath, [...args,'));
});

for (const name of ['peer-pairing.test.mjs', 'peer-tls-client.test.mjs', 'quota-tls.test.mjs']) {
  test(`${name} appears in the isolated suite list`, () => {
    assert.ok(suite.split('\n').find((line) => line.includes('const isolated =')).includes(`'${name}'`));
  });
}

test('macOS runs each invocation with concurrency one', () => {
  assert.ok(suite.includes("if (process.platform === 'darwin') args.push('--test-concurrency=1')"));
});

test('workflow runs the TypeScript check', () => {
  assert.ok(workflow.includes('npx tsc --noEmit'));
});

test('workflow runs oxlint', () => {
  assert.ok(workflow.includes('npx oxlint'));
});

test('workflow checks generated design tokens', () => {
  assert.ok(workflow.includes('node scripts/build-design-tokens.mjs --check'));
});

test('only the advisory oxlint step may continue on error', () => {
  assert.equal([...workflow.matchAll(/continue-on-error/g)].length, 1);
  assert.match(
    steps.find((step) => step.includes('continue-on-error')),
    /^name: oxlint \(advisory until the earlier web dashboard is removed\)\n        continue-on-error: true\n        run: npx oxlint\n$/,
  );
});

test('workflow contains no secret references', () => {
  assert.doesNotMatch(workflow, /secrets\./);
});
