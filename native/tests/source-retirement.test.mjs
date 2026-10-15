import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (file) =>
  readFile(new URL(`../${file}`, import.meta.url), 'utf8');

// Cross-platform source contracts complement the native UI and model tests.
// These run on Windows without pretending to compile AppKit or SwiftUI.
for (const file of [
  'Panel.swift',
  'windows/UsagePopup.cs',
  'windows/Program.cs',
]) {
  void test(`${file} offers only native devices in active filters`, async () => {
    const text = await source(file);
    assert.ok(
      /[[{]\s*"All", "Mac", "Windows"\s*[\]}]/.test(text),
      'Native device choices are missing',
    );
    assert.ok(
      !/[[{]\s*"All", "Mac", "Windows", "Ubuntu"\s*[\]}]/.test(text),
      'Retired device choice is still offered',
    );
    assert.ok(
      !/WSL (?:activity|screen time)|Ubuntu contributes tokens only|Tokens include Mac, Windows and Ubuntu/.test(
        text,
      ),
      'Active coverage copy still advertises a retired source',
    );
  });
}

for (const [dashboard, history, devices] of [
  ['NativeDashboard.swift', 'NativeHistory.swift', 'nativeHistoryDevices'],
  [
    'windows/NativeDashboard.cs',
    'windows/NativeHistory.cs',
    'NativeHistory.Devices',
  ],
]) {
  void test(`${dashboard} offers Mac and Windows history only`, async () => {
    const [ui, model] = await Promise.all([source(dashboard), source(history)]);
    assert.ok(
      /Devices = \["All", "Mac", "Windows"\]/i.test(model),
      'History devices must be All, Mac and Windows',
    );
    assert.ok(ui.includes(devices), 'History must use the shared device list');
    for (const text of [ui, model])
      assert.ok(
        !/Ubuntu|WSL/.test(text),
        'History still names a source outside Mac and Windows',
      );
  });
}

void test('Windows source settings no longer read or describe WSL selectors', async () => {
  const [settings, collector] = await Promise.all([
    source('windows/NativeSourceSettings.cs'),
    source('windows/Collector.cs'),
  ]);
  assert.ok(!/WSL|Ubuntu/.test(settings), 'Settings still describes WSL');
  assert.ok(
    !/\["(?:quotaWslDistribution|wslDistribution)"\]\s*=/.test(collector),
    'New configuration still writes a WSL selector',
  );
  assert.ok(
    /"wslDistribution", "quotaWslDistribution" \}\) current\.Remove\(key\)/.test(
      collector,
    ),
    'Saving settings must drop selectors from older files',
  );
});

for (const file of [
  'DirectPairingWindow.swift',
  'windows/DirectPairingWindow.cs',
]) {
  void test(`${file} does not offer or request retired collection scope`, async () => {
    const text = await source(file);
    assert.ok(!text.includes('includeUbuntu'), 'Retired pairing key is still present');
    assert.ok(!text.includes('Include Ubuntu'), 'Retired pairing control is still present');
  });
}

void test('SSH setup omits retired scope from requests and controls', async () => {
  const text = await source('PairingSetupDialog.swift');
  assert.ok(
    !text.includes('checkboxWithTitle: "Include already-configured Ubuntu'),
    'Retired SSH pairing checkbox is still offered',
  );
  for (const file of ['PairingSetupDialog.swift', 'PairingSetup.swift', 'PairingDetails.swift']) {
    assert.ok(
      !(await source(file)).includes('includeUbuntu'),
      `${file} still contains the retired pairing key`,
    );
  }
});

void test('Mac Settings does not enable retired benchmark reads', async () => {
  const text = await source('NativeSettings.swift');
  assert.ok(
    !/Toggle\([^\r\n]*binding\("benchmarks"\)/.test(text),
    'Retired benchmark collection is still offered',
  );
  assert.ok(
    !text.includes('Benchmark reads may connect to Ubuntu'),
    'Settings still advertises retired benchmark reads',
  );
  assert.ok(
    text.includes('Toggle("Read configured agent receipts"'),
    'Native receipt consent must remain separate',
  );
});

void test('Mac legacy collection uses bundled scripts, not retained WSL-capable code', async () => {
  const text = await source('CollectorConfiguration.swift');
  assert.ok(
    !text.includes(
      'runtime.appendingPathComponent("scripts/run-collector.py")',
    ),
    'Legacy collection still launches retained scripts',
  );
  assert.ok(
    text.includes('local ? "collect-mac.mjs" : "collect-dashboard.mjs"'),
    'Legacy configuration needs the bundled cross-device collector',
  );
  assert.ok(
    text.includes('"--runtime", runtime.path') &&
      text.includes('"--collector", collector.path'),
    'The bundled collector must receive the unchanged data directory',
  );
  assert.ok(
    text.includes('if quotaOnly && !local'),
    'Legacy allowance-only collection must remain gated',
  );
});

void test('native CI runs the source-retirement contracts after selecting Node', async () => {
  const workflow = (
    await source('../.github/workflows/native-compile.yml')
  ).replaceAll('\r\n', '\n');
  const windows = workflow.split('  windows:\n')[1]?.split('  macos:\n')[0];
  assert.ok(windows, 'The Windows native job is required');
  const command = 'run: node --test native/tests/source-retirement.test.mjs';
  assert.ok(windows.includes(command), 'Native source contracts are not in CI');
  const selected = windows.indexOf("node-version: '24.21.0'");
  assert.ok(
    selected >= 0 && selected < windows.indexOf(command),
    'The source contracts must use the selected Node runtime',
  );
  assert.ok(
    !windows.includes('continue-on-error:'),
    'Native failures must stop CI',
  );
});
