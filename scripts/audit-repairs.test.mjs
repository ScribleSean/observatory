import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=file=>readFile(new URL('../'+file,import.meta.url),'utf8');

test('both setup wizards describe the SSH prerequisite and separate TLS preview',async()=>{
  for(const file of ['native/SetupWizard.swift','native/windows/SetupWizard.cs']) {
    const source=await read(file);
    assert.match(source,/started from the Mac over an existing trusted SSH connection/);
    assert.match(source,/existing SSH alias, trusted host key and key-based sign-in/);
    assert.match(source,/Direct TLS pairing in Settings is a separate preview/);
    assert.doesNotMatch(source,/This release uses direct encrypted device pairing/);
  }
});

test('ActivityWatch recovery guidance is linked on all three surfaces',async()=>{
  for(const file of ['native/ActivityWatchHelp.swift','native/windows/NativeDashboard.cs','app/page.tsx']) {
    const source=await read(file);
    assert.match(source,/ActivityWatch is a separate application/);
    assert.match(source,/https:\/\/activitywatch.net\//);
    assert.match(source,/port 5600/);
    assert.match(source,/Missing readings remain Unknown/);
  }
  assert.match(await read('native/NativeSettings.swift'),/ActivityWatchHelp\(\)/);
  assert.match(await read('native/windows/NativeSourceSettings.cs'),/ActivityWatchHelp\(\)/);
});

test('Mac pause is visible in both surfaces and gear routes to Settings',async()=>{
  for(const file of ['native/Panel.swift','native/NativeDashboard.swift'])
    assert.match(await read(file),/store.pairingPauseMessage/);
  const main=await read('native/main.swift');
  assert.match(main,/settings: \{ \[weak self\] in self\?\.openPanelSettings\(\)/);
  assert.match(main,/private func openPanelSettings\(\) \{ openDashboard\("settings"\) \}/);
  // Recovery actions stay available while the failed operation's pause remains.
  const settings=await read('native/NativeSettings.swift');
  const recovery=settings.slice(settings.indexOf('Button("Pair with Windows'),settings.indexOf('if actions.preview { Text("Device changes'));
  assert.doesNotMatch(recovery,/collectionPausedForPairing|\.disabled\(busy/);
});

// Structural routing guard. Native desktop interaction remains a separate check.
test('Windows native tray Configure reuses the main dashboard route',async()=>{
  const program=await read('native/windows/Program.cs');
  const configure=program.slice(program.indexOf('private void Configure()'),program.indexOf('private void RefreshStatus()'));
  const native=configure.slice(configure.indexOf('if (nativeDashboard)'),configure.indexOf('using var settings'));
  assert.match(native,/Open\(\);[\s\S]*existing\.ShowSourceSettings\(\);[\s\S]*return;/);
  assert.doesNotMatch(native,/new NativeDashboard|ShowDialog/);
});
