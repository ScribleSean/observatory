import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = () =>
  readFileSync(
    new URL('../.github/workflows/windows-package.yml', import.meta.url),
    'utf8',
  ).replaceAll('\r\n', '\n');

void test('Windows package job allows 75 minutes', () => {
  assert.match(workflow(), /^  package:\n    runs-on: windows-latest\n    timeout-minutes: 75\n/m);
});

void test('Windows package excludes build tools from Defender immediately before the build', () => {
  const text = workflow();
  const name = '      - name: Exclude build tools from Defender scans';
  assert.equal(text.split(name).length - 1, 1);
  const start = text.indexOf(name);
  const end = text.indexOf('\n      - ', start + 1);
  assert.equal(text.slice(start, end), [
    name,
    "        if: '!inputs.verify_compiler_only'",
    '        shell: pwsh',
    '        run: |',
    '          try {',
    "            Add-MpPreference -ExclusionPath $env:RUNNER_TEMP, $env:GITHUB_WORKSPACE, (Split-Path -Parent (Get-Command node).Source) -ExclusionProcess 'node.exe', 'powershell.exe' -ErrorAction Stop",
    '          } catch {',
    "            Write-Output '::warning::Could not exclude build tools from Defender scans. Continuing with the build.'",
    '          }',
  ].join('\n'));
  assert.ok(text.slice(end).startsWith(
    '\n      - name: Build and verify complete package from a clean checkout\n',
  ));
});

void test('Windows package fixtures use the account volume before native build and installer checks', () => {
  const text = workflow();
  const start = text.indexOf(
    '      - name: Use the account volume for private-state fixtures',
  );
  assert.notEqual(
    start,
    -1,
    'The package workflow must select an account-volume temporary root',
  );
  const end = text.indexOf('\n      - ', start + 1);
  const step = text.slice(start, end);
  assert.ok(
    start < text.indexOf('      - name: Build and verify complete package'),
  );
  assert.match(step, /if: '!inputs\.verify_compiler_only'/);
  assert.match(
    step,
    /\$temporary = Join-Path \$env:LOCALAPPDATA \('WorkspaceObservatoryBuild\/ci-package-'/,
  );
  assert.match(
    step,
    /New-Item -ItemType Directory -Path \$temporary \| Out-Null/,
  );
  assert.match(step, /foreach \(\$name in @\('TEMP', 'TMP', 'TMPDIR'\)\)/);
  assert.match(
    step,
    /"\$name=\$temporary" \| Out-File -FilePath \$env:GITHUB_ENV -Encoding utf8 -Append/,
  );
  assert.doesNotMatch(
    step,
    /RUNNER_TEMP|\$env:(?:LOCALAPPDATA|APPDATA|USERPROFILE)\s*=/,
  );
});

void test('failure diagnostics use the same account-volume fixture root without changing publication guards', () => {
  const text = workflow();
  const diagnostic = text.slice(
    text.indexOf('      - name: Diagnose private-directory failure'),
  );
  assert.match(diagnostic, /if: failure\(\) && !inputs\.verify_compiler_only/);
  assert.match(
    diagnostic,
    /\$fixture = Join-Path \$env:TEMP \('observatory-acl-diagnostic-'/,
  );
  assert.doesNotMatch(diagnostic, /RUNNER_TEMP/);
  assert.match(text, /on:\n  workflow_dispatch:/);
  assert.doesNotMatch(text, /^  (?:push|pull_request):/m);
  const uploads = [
    ...text.matchAll(
      /if: success\(\) && inputs\.verify_installer && !inputs\.verify_compiler_only/g,
    ),
  ];
  assert.equal(uploads.length, 2);
});

const packageSteps = workflow().split(/^      - /m).slice(1);
const gate = packageSteps.find((step) => step.startsWith('name: Require a passing script suite on this commit\n'));
const gateScript = gate.split('        run: |\n')[1].split('\n').map((line) => line.slice(10)).join('\n');

test('package gate has read-only permissions and runs after Python before Defender', () => {
  assert.equal(workflow().match(/^permissions:\n([\s\S]*?)^concurrency:/m)[1], '  contents: read\n  actions: read\n');
  const index = packageSteps.indexOf(gate);
  assert.ok(packageSteps[index - 1].startsWith('uses: actions/setup-python@v5\n'));
  assert.ok(packageSteps[index + 1].startsWith('name: Exclude build tools from Defender scans\n'));
  assert.match(gate, /^        if: '!inputs.verify_compiler_only'$/m);
  assert.match(gate, /^        shell: node \{0\}$/m);
  assert.match(gate, /        env:\n          GITHUB_TOKEN: \$\{\{ github.token \}\}\n        run: \|/);
  assert.match(workflow(), /^          \.\/native\/windows\/package.ps1 -BuildPython \$builder -SkipScriptSuite$/m);
});

const syntheticEnv = {
  GITHUB_API_URL: 'https://api.example.invalid', GITHUB_REPOSITORY: 'fictional/project',
  GITHUB_SHA: 'fictional-sha', GITHUB_TOKEN: 'synthetic-secret-token',
};
const passingRun = {
  id: 123, html_url: 'https://example.invalid/run/123', head_sha: syntheticEnv.GITHUB_SHA,
  status: 'completed', conclusion: 'success', event: 'push',
  head_repository: { full_name: syntheticEnv.GITHUB_REPOSITORY },
};

async function runGate({ runs = [passingRun], status = 200, malformed = false, data, env = syntheticEnv, networkError = false } = {}) {
  const { runInNewContext } = await import('node:vm');
  const output = [];
  const calls = [];
  let exit = 0;
  const stopped = new Error('synthetic exit');
  try {
    await runInNewContext(gateScript, {
      process: { env, exit: (code) => { exit = code; throw stopped; } },
      console: { log: (...args) => output.push(args.join(' ')), error: (...args) => output.push(args.join(' ')) },
      fetch: async (url, options) => {
        calls.push(JSON.parse(JSON.stringify({ url, options })));
        if (networkError) throw new Error(syntheticEnv.GITHUB_TOKEN);
        return { ok: status === 200, status, json: async () => {
          if (malformed) throw new Error(syntheticEnv.GITHUB_TOKEN);
          return data ?? { workflow_runs: runs };
        } };
      },
    });
  } catch (error) { assert.equal(error, stopped); }
  assert.ok(!output.join('\n').includes(syntheticEnv.GITHUB_TOKEN));
  return { exit, output, calls };
}

for (const event of ['push', 'workflow_dispatch']) {
  test(`package gate accepts a completed ${event} on this commit`, async () => {
    const result = await runGate({ runs: [{ ...passingRun, event }] });
    assert.equal(result.exit, 0);
    assert.deepEqual(result.output, ['Accepted Script suite run 123: https://example.invalid/run/123']);
    assert.deepEqual(result.calls, [{
      url: 'https://api.example.invalid/repos/fictional/project/actions/workflows/script-suite.yml/runs?head_sha=fictional-sha&status=success&per_page=100',
      options: { headers: {
        Authorization: 'Bearer synthetic-secret-token', Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      } },
    }]);
  });
}

for (const [label, options, reason] of [
  ['empty list', { runs: [] }],
  ['pull request', { runs: [{ ...passingRun, event: 'pull_request' }] }],
  ['different commit', { runs: [{ ...passingRun, head_sha: 'other-sha' }] }],
  ['failed run', { runs: [{ ...passingRun, conclusion: 'failure' }] }],
  ['incomplete run', { runs: [{ ...passingRun, status: 'in_progress' }] }],
  ['different repository', { runs: [{ ...passingRun, head_repository: { full_name: 'fictional/other' } }] }],
  ['missing repository', { runs: [{ ...passingRun, head_repository: null }] }],
  ['HTTP refusal', { status: 403 }, 'Script suite lookup returned HTTP 403.'],
  ['malformed JSON', { malformed: true }, 'Script suite lookup returned malformed JSON.'],
  ['malformed response shape', { data: {} }, 'Script suite lookup returned malformed JSON.'],
  ['network failure', { networkError: true }, 'Script suite lookup failed.'],
]) {
  test(`package gate refuses ${label}`, async () => {
    const result = await runGate(options);
    assert.equal(result.exit, 1);
    assert.deepEqual(result.output, [reason ?? 'No successful Script suite run (push or manual dispatch) exists for fictional-sha. Dispatch Script suite on this commit, wait for it to pass, then run this workflow again.']);
  });
}

test('package gate refuses each missing environment variable without fetching', async () => {
  for (const key of Object.keys(syntheticEnv)) {
    const env = { ...syntheticEnv };
    delete env[key];
    const result = await runGate({ env });
    assert.equal(result.exit, 1);
    assert.deepEqual(result.calls, []);
    assert.deepEqual(result.output, [`No successful Script suite run (push or manual dispatch) exists for ${env.GITHUB_SHA}. Dispatch Script suite on this commit, wait for it to pass, then run this workflow again.`]);
  }
});

test('SkipScriptSuite wraps only the script suite and isolated loop and is forwarded by packaging', () => {
  const build = readFileSync(new URL('../native/windows/build.ps1', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  const pack = readFileSync(new URL('../native/windows/package.ps1', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  assert.match(build, /param\([\s\S]*?\[switch\]\$SkipScriptSuite\n\)/);
  assert.match(pack, /param\([\s\S]*?\[switch\]\$SkipScriptSuite\n\)/);
  assert.match(pack, /& \(Join-Path \$PSScriptRoot 'build.ps1'\) -Dotnet \$Dotnet -CacheRoot \$CacheRoot -SkipScriptSuite:\$SkipScriptSuite/);
  const block = build.match(/    if \(-not \$SkipScriptSuite\) \{\n([\s\S]*?)\n    \} else \{\n        Write-Output 'Script suite skipped by -SkipScriptSuite\. A passing Script suite run on this commit is required before using it\.'\n    \}/);
  assert.ok(block);
  assert.equal(build.split('if (-not $SkipScriptSuite)').length - 1, 1);
  assert.match(block[1], /Write-BuildPhase 'script suite'\n        & \$node --test @contractTests/);
  assert.match(block[1], /foreach \(\$isolatedTest in \$isolatedTests\) \{\n            Write-BuildPhase \('isolated ' \+ \$isolatedTest\)\n            & \$node --test \(Join-Path 'scripts' \$isolatedTest\)/);
  assert.doesNotMatch(block[1], /--self-test|Dotnet|npm|web bundle/);
  assert.ok(build.indexOf('& $Dotnet native/windows/bin/Release/net10.0-windows/WorkspaceObservatory.dll --self-test') < block.index);
  assert.ok(build.indexOf("    Write-Output 'Windows development build passed.") > block.index + block[0].length);
});
