import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=file=>readFile(new URL('../'+file,import.meta.url),'utf8');

// The Mac wizard moved to the shared viewer in O1-2 and has no SSH text by design.
test('the Windows setup wizard describes the SSH prerequisite and separate TLS preview',async()=>{
  for(const file of ['native/windows/SetupWizard.cs']) {
    const source=await read(file);
    assert.match(source,/started from the Mac over an existing trusted SSH connection/);
    assert.match(source,/existing SSH alias, trusted host key and key-based sign-in/);
    assert.match(source,/Direct TLS pairing in Settings is a separate preview/);
    assert.doesNotMatch(source,/This release uses direct encrypted device pairing/);
  }
});

test('ActivityWatch recovery guidance is linked on Windows and web',async()=>{
  for(const file of ['native/windows/NativeDashboard.cs','app/page.tsx']) {
    const source=await read(file);
    assert.match(source,/ActivityWatch is a separate application/);
    assert.match(source,/https:\/\/activitywatch.net\//);
    assert.match(source,/port 5600/);
    assert.match(source,/Missing readings remain Unknown/);
  }
  assert.match(await read('native/windows/NativeSourceSettings.cs'),/ActivityWatchHelp\(\)/);
});

test('Mac gear routes to Settings',async()=>{
  const main=await read('native/main.swift');
  assert.match(main,/private func openPanelSettings\(\) \{ openDashboard\("settings"\) \}/);

});

// Structural routing guard. Native desktop interaction remains a separate check.
test('Windows native tray Configure reuses the main dashboard route',async()=>{
  const program=await read('native/windows/Program.cs');
  const configure=program.slice(program.indexOf('private void Configure()'),program.indexOf('private void RefreshStatus()'));
  const native=configure.slice(configure.indexOf('if (nativeDashboard'),configure.indexOf('using var settings'));
  assert.match(native,/Open\(\);[\s\S]*existing\.ShowSourceSettings\(\);[\s\S]*return;/);
  assert.doesNotMatch(native,/new NativeDashboard|ShowDialog/);
});
