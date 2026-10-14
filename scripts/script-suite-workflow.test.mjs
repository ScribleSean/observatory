import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

test('matrix contains exactly the runner and suite part axes', () => {
  assert.match(workflow, /      matrix:\n        os: \[windows-latest, macos-14\]\n        part: \[general, tls-1, tls-2, tls-3\]\n    runs-on: \$\{\{ matrix.os \}\}/);
});

test('Node is pinned to 24.21.0', () => {
  assert.match(workflow, /^          node-version: '24\.21\.0'$/m);
});

test('Python is pinned to 3.13', () => {
  assert.match(workflow, /^          python-version: '3\.13'$/m);
});

test('Windows private-state fixtures use the account volume before Python export', () => {
  const name = 'name: Use the account volume for private-state fixtures\n';
  const matches = steps.filter((step) => step.startsWith(name));
  assert.equal(matches.length, 1);
  const step = matches[0];
  assert.match(step, /^        if: runner\.os == 'Windows'$/m);
  assert.match(step, /^        shell: pwsh$/m);
  assert.equal(steps.indexOf(step), steps.findIndex((entry) => entry.startsWith('uses: actions/checkout@')) + 1);
  assert.ok(steps.indexOf(step) < steps.findIndex((entry) => entry.startsWith('name: Export selected Python\n')));
  assert.ok(step.includes("$temporary = Join-Path $env:LOCALAPPDATA ('WorkspaceObservatoryBuild/ci-script-suite-' + [guid]::NewGuid().ToString('N'))"));
  assert.ok(step.includes('New-Item -ItemType Directory -Path $temporary | Out-Null'));
  assert.match(step, /foreach \(\$name in @\('TEMP', 'TMP', 'TMPDIR'\)\) \{\n            "\$name=\$temporary" \| Out-File -FilePath \$env:GITHUB_ENV -Encoding utf8 -Append\n          \}/);
  assert.equal([...step.matchAll(/GITHUB_ENV/g)].length, 1);
  assert.doesNotMatch(step, /RUNNER_TEMP/);
});

test('Windows installs pinned time zone data through the selected Python before npm ci', () => {
  const name = 'name: Install pinned time zone data on Windows\n';
  const matches = steps.filter((step) => step.startsWith(name));
  assert.equal(matches.length, 1);
  const step = matches[0];
  assert.match(step, /^        if: runner\.os == 'Windows'$/m);
  assert.match(step, /^        shell: pwsh$/m);
  assert.equal(steps.indexOf(step), steps.findIndex((entry) => entry.startsWith('name: Export selected Python\n')) + 1);
  assert.equal(steps.indexOf(step) + 1, steps.findIndex((entry) => entry.startsWith('run: npm ci\n')));
  assert.match(step, /^          \. \.\/native\/windows\/runtime-assets\.ps1$/m);
  assert.ok(step.includes("$cache = Join-Path $env:LOCALAPPDATA 'WorkspaceObservatoryBuild/cache'"));
  assert.match(step, /^          \$timezone = Get-ObservatoryArchive -Name tzdata -CacheRoot \$cache$/m);
  assert.match(step, /^          & \$env:OBSERVATORY_PYTHON -B -m pip install --no-index --no-deps \$timezone$/m);
  assert.match(step, /^          if \(\$LASTEXITCODE -ne 0\) \{ throw 'Pinned timezone preparation failed\.' \}$/m);
});

test('suite job timeout is 50 minutes', () => {
  assert.match(workflow, /^    timeout-minutes: 50$/m);
  assert.equal([...workflow.matchAll(/timeout-minutes:/g)].length, 1);
});

test('suite invokes Node through the source runtime preload', () => {
  assert.ok(suite.includes("['--import', './native/tests/test-source-runtime.mjs', '--test']"));
  assert.ok(suite.includes('spawnSync(process.execPath, [...args,'));
});

const shards = {
  'tls-1': ['provider-token-sync.test.mjs'],
  'tls-2': ['peer-pairing.test.mjs', 'peer-repair.test.mjs', 'peer-setup.test.mjs', 'peer-tls-service.test.mjs', 'peer-tls-trust.test.mjs'],
  'tls-3': ['peer-tls-client.test.mjs', 'peer-tls-sync.test.mjs', 'provider-token-tls.test.mjs', 'quota-sync.test.mjs', 'quota-tls.test.mjs'],
};
const tls = Object.values(shards).flat();
const parts = ['general', ...Object.keys(shards)];
const workflowShards = [...suite.matchAll(/^            '(tls-\d+)': (\[[^\n]+\]),$/gm)]
  .map((match) => [match[1], JSON.parse(match[2].replaceAll("'", '"'))]);
const general = ['z-synthetic.test.mjs', 'a-synthetic.test.mjs'];
const args = ['--import', './native/tests/test-source-runtime.mjs', '--test'];
const suiteScript = suite.split('        run: |\n')[1]
  .split('\n').map((line) => line.slice(10)).join('\n');

function runSuite(t, part, platform = 'win32', names = [...tls, ...general], status = 0, script = suiteScript) {
  const root = mkdtempSync(join(tmpdir(), 'script-suite-workflow-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'));
  for (const name of names) writeFileSync(join(root, 'scripts', name), '');
  writeFileSync(join(root, 'scripts', 'ignored.mjs'), '');
  mkdirSync(join(root, 'scripts', 'directory.test.mjs'));
  const shim = `
    const { runInNewContext } = require('node:vm')
    runInNewContext(${JSON.stringify(script)}, {
      require: (name) => name === 'node:child_process' ? {
        spawnSync: (executable, args, options) => {
          console.log(JSON.stringify({ executable, args, options }))
          return { status: ${JSON.stringify(status)} }
        }
      } : require(name),
      process: {
        env: process.env,
        platform: ${JSON.stringify(platform)},
        execPath: 'synthetic-node',
        exit: (code) => process.exit(code)
      },
      console
    })
  `;
  const result = spawnSync(process.execPath, ['-e', shim], {
    cwd: root,
    env: { ...process.env, SUITE_PART: part },
    encoding: 'utf8',
  });
  assert.ifError(result.error);
  return {
    ...result,
    calls: result.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)),
  };
}

test('TLS shards contain exactly the specified files in order', () => {
  assert.deepEqual(workflowShards, Object.entries(shards));
});

test('no TLS file is listed in two shards in the workflow', () => {
  const files = workflowShards.flatMap(([, names]) => names);
  assert.equal(new Set(files).size, files.length);
});

test('every part refuses duplicate shard files before launching tests', (t) => {
  const script = suiteScript.replace("'tls-1': [", "'tls-1': ['peer-pairing.test.mjs', ");
  assert.notEqual(script, suiteScript);
  for (const part of parts) {
    const result = runSuite(t, part, 'win32', [...tls, ...general], 0, script);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Duplicate TLS test file across shards/);
    assert.deepEqual(result.calls, []);
  }
});

test('suite step sets only SUITE_PART from matrix.part', () => {
  assert.match(suite, /        env:\n          SUITE_PART: \$\{\{ matrix.part \}\}\n        run: \|\n/);
});

test('suite refuses an unknown part before launching tests', (t) => {
  for (const part of ['unknown', 'tls', 'toString', '__proto__', '']) {
    const result = runSuite(t, part);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /SUITE_PART must be general or one of: tls-1, tls-2, tls-3/);
    assert.deepEqual(result.calls, []);
  }
});

test('every part refuses a missing shard file before launching tests', (t) => {
  for (const part of parts) {
    for (const missing of tls) {
      const result = runSuite(t, part, 'win32', [...tls, ...general].filter((name) => name !== missing));
      assert.equal(result.status, 1);
      assert.ok(result.stderr.includes(missing));
      assert.deepEqual(result.calls, []);
    }
  }
});

for (const [part, files] of Object.entries(shards)) {
  test(`${part} runs one file per invocation in order with concurrency one on every runner`, (t) => {
    for (const platform of ['win32', 'darwin']) {
      const result = runSuite(t, part, platform);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(result.calls, files.map((name) => ({
        executable: 'synthetic-node',
        args: [...args, '--test-timeout=900000', '--test-concurrency=1', `scripts/${name}`],
        options: { stdio: 'inherit' },
      })));
    }
  });
}

test('general runs one sorted batch and keeps concurrency one only on darwin', (t) => {
  for (const platform of ['win32', 'darwin']) {
    const result = runSuite(t, 'general', platform);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.calls, [{
      executable: 'synthetic-node',
      args: [...args, '--test-timeout=300000', ...(platform === 'darwin' ? ['--test-concurrency=1'] : []),
        ...general.toSorted().map((name) => `scripts/${name}`)],
      options: { stdio: 'inherit' },
    }]);
  }
});

test('general plus the three shards covers every synthetic test file exactly once', (t) => {
  const results = parts.map((part) => runSuite(t, part));
  for (const result of results) assert.equal(result.status, 0, result.stderr);
  const files = results.flatMap((result) => result.calls.flatMap((call) =>
    call.args.filter((arg) => arg.startsWith('scripts/'))));
  assert.deepEqual(files.sort(), [...tls, ...general].map((name) => `scripts/${name}`).sort());
  assert.equal(new Set(files).size, files.length);
});

test('suite stops at the first nonzero child exit', (t) => {
  for (const part of parts) {
    const result = runSuite(t, part, 'win32', [...tls, ...general], 7);
    assert.equal(result.status, 7);
    assert.equal(result.calls.length, 1);
  }
});

for (const command of ['npx tsc --noEmit', 'npx oxlint', 'node scripts/build-design-tokens.mjs --check']) {
  test(`${command} runs only in the general part`, () => {
    const matches = steps.filter((step) => step.includes(`run: ${command}\n`));
    assert.equal(matches.length, 1);
    assert.match(matches[0], /^        if: matrix.part == 'general'$/m);
  });
}

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
    /^name: oxlint \(advisory until the earlier web dashboard is removed\)\n        if: matrix.part == 'general'\n        continue-on-error: true\n        run: npx oxlint\n$/,
  );
});

test('workflow contains no secret references', () => {
  assert.doesNotMatch(workflow, /secrets\./);
});
