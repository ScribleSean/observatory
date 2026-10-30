import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// The tray app is compiled on Windows only, so these checks read its source.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = () => readFile(path.join(repo, 'glance/windows/Glance.cs'), 'utf8');

test('the Windows tray app asks for per-monitor DPI awareness (V2) before any window exists', async () => {
  const cs = await source();
  assert.match(cs, /SetProcessDpiAwarenessContext\(/);
  assert.match(cs, /PerMonitorAwareV2 = new IntPtr\(-4\)/);
  const main = cs.slice(cs.indexOf('static int Main('));
  assert.ok(main.indexOf('UseMonitorDpi()') >= 0, 'Main sets DPI awareness');
  assert.ok(main.indexOf('UseMonitorDpi()') < main.indexOf('Application.Run('), 'before the first window');
});

test('the panel takes its scale from the monitor it opens on and rescales on WM_DPICHANGED', async () => {
  const cs = await source();
  assert.match(cs, /GetDpiForMonitor\(/);
  assert.match(cs, /WM_DPICHANGED = 0x02E0/);
  assert.match(cs, /protected override void WndProc\(ref Message m\)[\s\S]*?WM_DPICHANGED[\s\S]*?Place\(false\)/);
  assert.doesNotMatch(cs, /scale = g\.DpiX \/ 96f/, 'the system DPI is wrong on a second monitor');
});
