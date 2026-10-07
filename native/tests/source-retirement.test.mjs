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

for (const [dashboard, history, devices, label] of [
  [
    'NativeDashboard.swift',
    'NativeHistory.swift',
    'nativeHistoryDevices',
    'nativeHistoryDeviceLabel',
  ],
  [
    'windows/NativeDashboard.cs',
    'windows/NativeHistory.cs',
    'NativeHistory.Devices',
    'NativeHistory.DeviceLabel',
  ],
]) {
  void test(`${dashboard} keeps active filters native-only and retained Ubuntu history explicitly archived`, async () => {
    const [ui, model] = await Promise.all([source(dashboard), source(history)]);
    assert.ok(
      /native = \["All", "Mac", "Windows"\]/.test(model),
      'Active devices must stay Mac and Windows',
    );
    assert.ok(
      ui.includes(devices) && ui.includes(label),
      'History must use conditional devices and separate display labels',
    );
    assert.ok(
      !/[[{]\s*"All", "Mac", "Windows", "Ubuntu"\s*[\]}]/.test(ui),
      'Unqualified retired active filter is still offered',
    );
    assert.ok(
      model.includes('"Archived Ubuntu"') &&
        model.includes('Read-only') &&
        model.includes('not collecting'),
      'Archive must not imply active collection',
    );
    assert.ok(
      /recordedDays\(key, host: "Ubuntu"\)\.isEmpty|Days\(snapshot, kind, "Ubuntu"\)\.Length > 0/.test(
        model,
      ),
      'Archive choice requires retained valid records',
    );
    assert.ok(
      !/WSL (?:activity|screen time)|Ubuntu contributes tokens only|Tokens include Mac, Windows and Ubuntu/.test(
        ui,
      ),
      'Active coverage still advertises retired tracking',
    );
  });
}

for (const file of [
  'DirectPairingWindow.swift',
  'windows/DirectPairingWindow.cs',
]) {
  void test(`${file} does not offer or request retired collection scope`, async () => {
    const text = await source(file);
    assert.ok(
      !/(?:Toggle|Text\s*=)\s*\(?\s*"Include Ubuntu/.test(text),
      'Retired pairing checkbox is still offered',
    );
    const scopes = [
      ...text.matchAll(/"includeUbuntu"\]?\s*[:=]\s*([^,}\]\r\n]+)/g),
    ].map((match) => match[1].trim());
    assert.deepEqual(
      scopes,
      ['false', 'false'],
      'Both host and join must explicitly request native-only scope',
    );
  });
}

void test('SSH setup retains legacy retry scope without offering it for new pairing', async () => {
  const text = await source('PairingSetupDialog.swift');
  assert.ok(
    !text.includes('checkboxWithTitle: "Include already-configured Ubuntu'),
    'Retired SSH pairing checkbox is still offered',
  );
  assert.ok(
    text.includes('includeUbuntu: saved.request?.includeUbuntu ?? false'),
    'Saved pairing scope must remain immutable for retries',
  );
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
