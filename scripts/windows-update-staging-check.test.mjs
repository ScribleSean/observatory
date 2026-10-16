import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const script = readFileSync(new URL('../native/windows/verify-update-staging.ps1', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const line = (name) => script.split('\n').find((value) => value.trimStart().startsWith(`${name} =`));

test('expected files and count remain exact', () => {
  assert.equal(line('$expectedData').trim(), String.raw`$expectedData = @((Join-Path $data 'setup-state.json'), (Join-Path $data 'updates\installed-envelope.json'))`);
  assert.ok(script.includes('$dataFiles.Count -ne $expectedData.Count'));
  assert.ok(script.includes('$_.FullName -notin $expectedData'));
  assert.ok(script.includes(`-cne '{"version":1,"completed":true}'`));
});

test('only the documented profile descendants are excluded', () => {
  assert.equal(line('$profilePrefix').trim(), String.raw`$profilePrefix = (Join-Path $data 'WebViewCache\EBWebView') + [IO.Path]::DirectorySeparatorChar`);
  const listing = script.slice(script.indexOf('    $dataFiles ='), script.indexOf('    # The update publishes'));
  assert.equal(listing.trim(), [
    '$dataFiles = @(Get-ChildItem -LiteralPath $data -Recurse -File -Force |',
    '        Where-Object { -not $_.FullName.StartsWith($profilePrefix, [StringComparison]::OrdinalIgnoreCase) })',
  ].join('\n'));
  assert.doesNotMatch(script, /-like\b/i);
  assert.doesNotMatch(script, /(?:FullName|\$dataFiles)[^\n]*-match\b/i);
  for (const expression of [line('$expectedData'), line('$profilePrefix'), listing]) {
    assert.ok(!expression.includes('*'));
  }
});

test('writer wait is bounded and never kills processes', () => {
  const wait = script.slice(script.indexOf('function WaitForDataWriters'), script.indexOf('$node ='));
  for (const required of [
    '[Diagnostics.Stopwatch]::StartNew()', 'Get-Process WorkspaceObservatory',
    'Get-CimInstance Win32_Process', "Name = 'msedgewebview2.exe'",
    '.CommandLine.IndexOf($data, [StringComparison]::OrdinalIgnoreCase)',
    '$timer.Elapsed.TotalSeconds -ge 60', 'Start-Sleep -Milliseconds 500',
    "throw 'WebView2 or app processes still running. Retain all files for inspection.'",
  ]) assert.ok(wait.includes(required), required);
  assert.doesNotMatch(script, /Stop-Process|taskkill|\.Kill\s*\(/i);
});

test('waits precede data listing and final cleanup verification', () => {
  assert.equal(script.match(/^\s*WaitForDataWriters$/gm)?.length, 2);
  const firstWait = script.indexOf('\n    WaitForDataWriters\n');
  assert.ok(firstWait > script.indexOf("throw 'Complete update and relaunch verification failed.'"));
  assert.ok(firstWait < script.indexOf('    $dataFiles ='));
  assert.ok(script.includes("RunChecked $uninstaller ('/S _?=' + $installed)\n}\nWaitForDataWriters\nif ((Test-Path -LiteralPath $installed)"));
});

test('all data enumeration includes hidden entries and refuses directory links', () => {
  const listings = script.match(/Get-ChildItem -LiteralPath \$data[^\n]*/g);
  assert.equal(listings.length, 3);
  for (const listing of listings) assert.match(listing, /-Force\b/);
  assert.ok(script.includes(String.raw`@((Join-Path $data 'WebViewCache'), (Join-Path $data 'WebViewCache\EBWebView'))`));
  assert.ok(script.includes('(Get-Item -LiteralPath $folder -Force).Attributes -band [IO.FileAttributes]::ReparsePoint'));
  assert.ok(script.includes('Get-ChildItem -LiteralPath $data -Recurse -Force -Directory'));
  assert.ok(script.includes('$_.Attributes -band [IO.FileAttributes]::ReparsePoint'));
  for (const message of ['WebView2 profile folder is a link.', 'Update test data contains a link.']) {
    assert.ok(script.includes(`throw '${message}'`));
  }
});

test('failure diagnostics contain bounded relative file names and location labels', () => {
  for (const prefix of ['Unexpected data file: ', 'Remaining data file: ']) {
    assert.ok(script.includes(`'${prefix}' + $_.FullName.Substring($data.Length + 1)`));
  }
  assert.equal(script.match(/Select-Object -First 50/g)?.length, 2);
  for (const location of ['install folder', 'data folder', 'shortcuts folder', 'registration']) {
    assert.ok(script.includes(`'Remaining location: ${location}'`));
  }
});
