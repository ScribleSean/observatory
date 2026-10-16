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
  'native/**/*.mjs',
  'native/tests/**',
  'package.json',
  'package-lock.json',
  '.github/workflows/script-suite.yml',
  'native/BridgeContract.swift',
  'native/windows/BridgeContract.cs',
  'native/Strings.swift',
  'native/windows/Strings.cs',
  'native/DesignTokens.swift',
  'native/windows/DesignTokens.cs',
  'native/prices.json',
  'native/design-tokens.json',
  'native/skins/**',
  'native/windows/runtime-assets.ps1',
  'native/windows/runtime-assets.json',
  '.gitattributes',
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
  test(`${event} has exactly the twenty-one script suite paths`, () => {
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

test('matrix contains exactly the ordered platform parts', () => {
  const expected = [
    ...['general', 'tls-1', 'tls-2', 'tls-3', 'tls-4', 'tls-5', 'sync-1', 'sync-2', 'sync-3'].map((part) => ['windows-latest', part]),
    ...['general', 'tls'].map((part) => ['macos-14', part]),
  ];
  assert.equal(workflow.match(/      matrix:\n([\s\S]*?)    runs-on:/)[1],
    '        include:\n' + expected.map(([os, part]) => `          - os: ${os}\n            part: ${part}\n`).join(''));
  assert.ok(workflow.includes('      fail-fast: false\n'));
  assert.ok(workflow.includes('    runs-on: ${{ matrix.os }}\n'));
});

for (const prefix of ['script-suite', 'native-compile', 'native-private-state', 'update-safety']) {
  test(`${prefix} cancels only superseded pull requests`, () => {
    const text = readFileSync(new URL(`../.github/workflows/${prefix}.yml`, import.meta.url), 'utf8');
    assert.equal(text.match(/^concurrency:\n([\s\S]*?)^jobs:/m)[1],
      "  group: " + prefix + "-${{ github.event_name == 'pull_request' && github.ref || github.run_id }}\n  cancel-in-progress: ${{ github.event_name == 'pull_request' }}\n");
  });
}

test('workflow has exactly the existing if lines in order', () => {
  assert.deepEqual(workflow.match(/^\s*if:.*$/gm), [
    "        if: runner.os == 'Windows'",
    "        if: runner.os == 'Windows'",
    "        if: runner.os == 'Windows'",
    "        if: matrix.part == 'general'",
    "        if: matrix.part == 'general'",
    "        if: matrix.part == 'general'",
  ]);
});

test('no job has a job-level if or env key', () => {
  assert.doesNotMatch(section('jobs'), /^    (?:if|env):/m);
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

test('Windows attempts Defender exclusions before warming Python and propagates warm-up failure', () => {
  const matches = steps.filter((step) => step.startsWith('name: Exclude test tools from Defender scans and warm Python\n'));
  assert.equal(matches.length, 1);
  const step = matches[0];
  assert.equal(steps.indexOf(step), steps.findIndex((entry) => entry.startsWith('run: npm ci\n')) + 1);
  assert.equal(steps.indexOf(step) + 1, steps.indexOf(suite));
  assert.equal(step, `name: Exclude test tools from Defender scans and warm Python
        if: runner.os == 'Windows'
        shell: pwsh
        run: |
          try {
            Add-MpPreference -ExclusionPath (Split-Path $env:OBSERVATORY_PYTHON), $env:RUNNER_TEMP, $env:GITHUB_WORKSPACE -ErrorAction Stop
            Add-MpPreference -ExclusionProcess $env:OBSERVATORY_PYTHON, (Get-Command node).Source -ErrorAction Stop
          } catch {
            echo "::warning::Could not configure Defender exclusions. Continuing with Python warm-up."
          }
          & $env:OBSERVATORY_PYTHON -I -S -B -c "import sys"
          if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
`);
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
  'tls-1': ['peer-tls-trust.test.mjs'],
  'tls-2': ['peer-repair.test.mjs', 'peer-pairing.test.mjs'],
  'tls-3': ['peer-tls-repair.test.mjs', 'quota-tls.test.mjs', 'peer-tls-service.test.mjs', 'peer-tls-control.test.mjs'],
  'tls-4': ['peer-setup.test.mjs', 'provider-token-tls.test.mjs'],
  'tls-5': ['quota-sync.test.mjs', 'peer-tls-client.test.mjs', 'peer-tls-sync.test.mjs'],
};
const syncNames = {
  'sync-1': [
    'local hours stay on the dashboard while stored and exchanged records remain identical',
    'pairing revoke, corruption and retirement fence transport while local disable remains available',
    'wrong identity, older, conflicting and regressing revisions cannot replace a peer record',
    'native sharing CLI exposes only bounded status and confirmation fields',
  ],
  'sync-2': [
    'duplicate deliveries keep source and receipt time, newer snapshots replace instead of sum',
    'disable or disable-reenable during readiness prevents sending provider readings',
    'collection off disables sharing and failed reads replace totals with Unknown',
    'concurrent TLS roles exchange without holding a network lock and preserve local collection on errors',
  ],
};

const syncFile = 'provider-token-sync.test.mjs';
const tls = [...Object.values(shards).flat(), syncFile];
const parts = ['general', ...Object.keys(shards), 'sync-1', 'sync-2', 'sync-3'];
const platformParts = (platform) => platform === 'win32' ? parts : ['general', 'tls'];
const providerSource = readFileSync(new URL('./provider-token-sync.test.mjs', import.meta.url), 'utf8');
const general = ['z-synthetic.test.mjs', 'a-synthetic.test.mjs'];
const args = ['--import', './native/tests/test-source-runtime.mjs', '--test'];
const suiteScript = suite.split('        run: |\n')[1]
  .split('\n').map((line) => line.slice(10)).join('\n');
const escape = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patterns = (part) => (part === 'sync-3' ? Object.values(syncNames).flat() : syncNames[part])
  .map((name) => `${part === 'sync-3' ? '--test-skip-pattern' : '--test-name-pattern'}=^${escape(name)}$`);
function runSuite(t, part, platform = 'win32', names = [...tls, ...general], status = 0, script = suiteScript, provider = providerSource) {
  const root = mkdtempSync(join(tmpdir(), 'script-suite-workflow-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'));
  for (const name of names) writeFileSync(join(root, 'scripts', name), name === syncFile ? provider : '');
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


test('workflow pins the file groups and sync names', () => {
  const extract = (key) => JSON.parse(suiteScript.match(new RegExp(`const ${key} = ([\\s\\S]*?);`))[1].replaceAll("'", '"').replace(/,\s*([\]}])/g, '$1'));
  assert.deepEqual(extract('shards'), shards);
  assert.deepEqual(extract('syncNames'), syncNames);
  const names = Object.values(syncNames).flat();
  assert.equal(new Set(names).size, names.length);
  for (const name of names) {
    assert.equal(providerSource.split("test('" + name + "'").length - 1, 1, name);
    assert.equal(providerSource.split("\ntest('" + name + "'").length - 1, 1, name);
  }
  assert.match(suite, /shell: node \{0\}/);
  assert.match(suite, /env:\n          SUITE_PART: \$\{\{ matrix.part \}\}\n        run: \|/);
  assert.doesNotMatch(suiteScript, /--test-shard/);
});

test('TLS patterns remain unchanged', () => {
  assert.deepEqual(suiteScript.match(/const tlsPatterns = \[\n([\s\S]*?)\n\];/)[1].trim().split('\n').map((line) => line.trim()), [
    String.raw`/^peer-tls-.*\.test\.mjs$/,`,
    String.raw`/^peer-(pairing|repair|setup)\.test\.mjs$/,`,
    String.raw`/^provider-token-(sync|tls)\.test\.mjs$/,`,
    String.raw`/^quota-(sync|tls)\.test\.mjs$/,`,
  ]);
  assert.ok(suiteScript.includes('const isTls = (name) => tlsPatterns.some((pattern) => pattern.test(name));'));
});

for (const platform of ['win32', 'darwin', 'linux']) {
  test(`${platform} covers all files with exact arguments and future TLS routing`, (t) => {
    const files = [...tls, ...general, 'peer-tls-new.test.mjs'];
    const owners = new Map();
    for (const part of platformParts(platform)) {
      const result = runSuite(t, part, platform, files);
      assert.equal(result.status, 0, result.stderr);
      const selected = part === 'general' ? general.toSorted() : part === 'tls' ? [...tls, 'peer-tls-new.test.mjs'].sort()
        : part.startsWith('sync-') ? [syncFile] : [...shards[part], ...(part === 'tls-3' ? ['peer-tls-new.test.mjs'] : [])];
      const batches = part === 'general' ? [selected] : selected.map((name) => [name]);
      assert.deepEqual(result.calls, batches.map((batch) => ({
        executable: 'synthetic-node', options: { stdio: 'inherit' },
        args: [...args, part === 'general' ? '--test-timeout=300000' : '--test-timeout=900000',
          ...(part !== 'general' || platform === 'darwin' ? ['--test-concurrency=1'] : []),
          ...(part.startsWith('sync-') ? patterns(part) : []), ...batch.map((name) => `scripts/${name}`)],
      })));
      for (const file of selected) owners.set(file, [...(owners.get(file) ?? []), part]);
    }
    assert.deepEqual([...owners.keys()].sort(), files.sort());
    for (const [file, assigned] of owners) {
      if (file === syncFile && platform === 'win32') assert.deepEqual(assigned, ['sync-1', 'sync-2', 'sync-3']);
      else assert.equal(assigned.length, 1, file);
    }
  });
}

test('sync skip patterns equal both inclusion lists', (t) => {
  const get = (part) => runSuite(t, part).calls[0].args.filter((arg) => arg.startsWith('--test-') && arg.includes('pattern='));
  assert.deepEqual(get('sync-3'), [...get('sync-1'), ...get('sync-2')].map((arg) => arg.replace('--test-name-pattern', '--test-skip-pattern')));
});

test('real Node runs every synthetic name exactly once and later tests in sync-3', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'sync-name-behavior-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const names = [...providerSource.matchAll(/^test\('([^']+)'/gm)].map((match) => match[1]);
  assert.equal(names.length, 13);
  names.push('a later test');
  const file = join(root, 'synthetic.test.mjs');
  const log = join(root, 'names.jsonl');
  writeFileSync(file, "import test from 'node:test';\nimport { appendFileSync } from 'node:fs';\n" +
    names.map((name) => `test(${JSON.stringify(name)}, () => appendFileSync(${JSON.stringify(log)}, JSON.stringify(${JSON.stringify(name)}) + '\\n'));`).join('\n'));
  const observed = [];
  for (const part of ['sync-1', 'sync-2', 'sync-3']) {
    writeFileSync(log, '');
    const produced = runSuite(t, part).calls[0].args;
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, [...produced.slice(2, -1), file], { encoding: 'utf8', env });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const ran = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    assert.equal(ran.includes('a later test'), part === 'sync-3', JSON.stringify({ part, ran, stdout: result.stdout }));
    observed.push(...ran);
  }
  assert.deepEqual(observed.sort(), names.sort());
});

test('invalid parts refuse before spawning with platform-specific guidance', (t) => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    for (const part of ['unknown', 'toString', '__proto__', '', ...(platform === 'win32' ? ['tls'] : ['tls-1', 'sync-1'])]) {
      const result = runSuite(t, part, platform);
      assert.equal(result.status, 1);
      assert.equal(result.stderr.trim(), 'SUITE_PART must be general or one of: ' + platformParts(platform).slice(1).join(', '));
      assert.deepEqual(result.calls, []);
    }
  }
});

test('every part refuses missing files and duplicate files or names before spawning', (t) => {
  const mutations = [
    [suiteScript.replace("'tls-2': [", "'tls-2': ['peer-pairing.test.mjs', "), /Duplicate TLS/],
    [suiteScript.replace("'sync-2': [", "'sync-2': ['" + syncNames['sync-1'][0] + "', "), /Duplicate sync/],
    [suiteScript.replace("'sync-1': [", "'sync-1': ['" + syncNames['sync-1'][0] + "', "), /Duplicate sync/],
  ];
  for (const platform of ['win32', 'darwin']) for (const part of platformParts(platform)) {
    for (const missing of tls) {
      const result = runSuite(t, part, platform, [...tls, ...general].filter((name) => name !== missing));
      assert.equal(result.status, 1);
      assert.ok(result.stderr.includes(missing));
      assert.deepEqual(result.calls, []);
    }
    for (const [script, message] of mutations) {
      assert.notEqual(script, suiteScript);
      const result = runSuite(t, part, platform, [...tls, ...general], 0, script);
      assert.equal(result.status, 1);
      assert.match(result.stderr, message);
      assert.deepEqual(result.calls, []);
    }
  }
});

test('sync parts refuse missing or repeated provider names before spawning', (t) => {
  for (const part of ['sync-1', 'sync-2', 'sync-3']) for (const provider of ['', providerSource + providerSource]) {
    const result = runSuite(t, part, 'win32', [...tls, ...general], 0, suiteScript, provider);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Expected exactly one top-level sync test/);
    assert.deepEqual(result.calls, []);
  }
});

for (const prefix of ['  await t.', '// ']) {
  test(`sync parts refuse a provider name appearing only after ${JSON.stringify(prefix)}`, (t) => {
    const name = syncNames['sync-1'][0];
    const provider = providerSource.replace("test('" + name + "'", prefix + "test('" + name + "'");
    assert.notEqual(provider, providerSource);
    for (const part of ['sync-1', 'sync-2', 'sync-3']) {
      const result = runSuite(t, part, 'win32', [...tls, ...general], 0, suiteScript, provider);
      assert.equal(result.status, 1);
      assert.equal(result.stderr.trim(), `Expected exactly one top-level sync test: ${name}`);
      assert.deepEqual(result.calls, []);
    }
  });
}

test('sync parts accept provider source with CRLF line endings', (t) => {
  const provider = providerSource.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n');
  for (const part of ['sync-1', 'sync-2', 'sync-3']) {
    const result = runSuite(t, part, 'win32', [...tls, ...general], 0, suiteScript, provider);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.calls.length, 1);
  }
});

test('suite stops at the first nonzero child exit', (t) => {
  for (const platform of ['win32', 'darwin']) for (const part of platformParts(platform)) {
    const result = runSuite(t, part, platform, [...tls, ...general], 7);
    assert.equal(result.status, 7);
    assert.equal(result.calls.length, 1);
  }
});

test('general runs Windows test isolation checks after the full suite on both runners', (t) => {
  const matches = steps.filter((step) => step.startsWith('name: Run Windows test isolation checks\n'));
  assert.equal(matches.length, 1);
  const step = matches[0];
  assert.equal(steps.indexOf(step), steps.indexOf(suite) + 1);
  assert.match(step, /^        shell: node \{0\}$/m);
  assert.match(step, /        env:\n          SUITE_PART: \$\{\{ matrix.part \}\}\n        run: \|\n/);
  const script = step.split('        run: |\n')[1]
    .split('\n').map((line) => line.slice(10)).join('\n');
  for (const platform of ['win32', 'darwin']) {
    for (const status of [0, 7, null]) {
      const result = runSuite(t, 'general', platform, [], status, script);
      assert.equal(result.status, status ?? 1);
      assert.deepEqual(result.calls, [{
        executable: 'synthetic-node',
        args: ['--test', 'native/tests/windows-test-isolation.test.mjs'],
        options: { stdio: 'inherit' },
      }]);
    }
    for (const part of platformParts(platform).slice(1)) {
      const result = runSuite(t, part, platform, [], 7, script);
      assert.equal(result.status, 0);
      assert.deepEqual(result.calls, []);
    }
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
