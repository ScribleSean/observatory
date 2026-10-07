import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = () =>
  readFileSync(
    new URL('../.github/workflows/windows-package.yml', import.meta.url),
    'utf8',
  ).replaceAll('\r\n', '\n');

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
