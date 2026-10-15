import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=file=>readFile(new URL('../'+file,import.meta.url),'utf8');

test('shared setup avoids release transport claims and Mac menu retains SSH pairing',async()=>{
  const strings=JSON.parse(await read('lib/strings.json'));
  for(const source of [await read('app/viewer/setup/SetupView.tsx'),JSON.stringify(strings.setup)]) {
    assert.doesNotMatch(source,/This release uses direct encrypted device pairing/);
    assert.doesNotMatch(source,/SSH/);
  }
  const main=await read('native/main.swift');
  const menu=main.slice(main.indexOf('private func showMenu()'),main.indexOf('@objc private func toggleLogin'));
  assert.match(menu,/menu\.addItem\(withTitle: "Pair with Windows…", action: #selector\(setupPairing\)/);
});

test('ActivityWatch recovery guidance is retained in web and native shared strings',async()=>{
  for(const file of ['app/page.tsx']) {
    const source=await read(file);
    assert.match(source,/ActivityWatch is a separate application/);
    assert.match(source,/https:\/\/activitywatch.net\//);
    assert.match(source,/port 5600/);
    assert.match(source,/Missing readings remain Unknown/);
  }
  const shared=await read('native/windows/Strings.cs');
  assert.match(shared,/ActivityWatch is a separate application/);
  assert.match(shared,/activitywatch.net/);
  assert.match(shared,/port 5600/);
  assert.match(shared,/Missing readings remain Unknown/);
  assert.match(await read('app/viewer/activity/ActivityView.tsx'),/STRINGS\.activity\.help, STRINGS\.activity\.helpAddress/);
  const mac=await read('native/Strings.swift');
  assert.match(mac,/ActivityWatch is a separate application/);
  assert.match(mac,/activitywatch.net/);
  assert.match(mac,/port 5600/);
  assert.match(mac,/Missing readings remain Unknown/);
});

test('Mac bridge pause reaches shared views and Settings recovery stays reachable',async()=>{
  assert.match(await read('native/BridgeActions.swift'),/collectionPaused: store\.collectionPausedForPairing \|\| store\.pairingMaintenance/);
  const dashboard=await read('app/viewer/dashboard.tsx');
  assert.match(dashboard,/setCollectionPaused\(status\?\.collectionPaused === true\)/);
  assert.match(dashboard,/collectionPaused && <span[^>]*>\{STRINGS\.settings\.collectionPaused\}/);
  assert.match(await read('app/viewer/settings/settings.tsx'),/status\?\.collectionPaused === true && <p[^>]*>\{S\.collectionPaused\}/);
  assert.equal(JSON.parse(await read('lib/strings.json')).settings.collectionPaused,'Collection paused');
  const main=await read('native/main.swift');
  assert.match(main,/private func openPanelSettings\(\) \{ openDashboard\("settings"\) \}/);
  assert.match(main,/case \.openSettings: self\.openPanelSettings\(\)/);
  // Recovery actions stay available while the failed operation's pause remains.
  const validation=main.slice(main.indexOf('func validateMenuItem('),main.indexOf('private func openDashboard('));
  for(const action of ['setupPairing','disconnectPairing','preparePairingRepair'])
    assert.ok(validation.includes('#selector('+action+')'));
  assert.doesNotMatch(validation,/collectionPausedForPairing/);
});

// Structural routing guard. Native desktop interaction remains a separate check.
test('Windows tray Configure opens Settings in the shared viewer',async()=>{
  const program=await read('native/windows/Program.cs');
  const configure=program.slice(program.indexOf('private void Configure()'),program.indexOf('private void RefreshStatus()'));
  assert.equal(configure.trim(),'private void Configure() => Open("settings");');
  assert.match(program,/menu\.Items\.Add\("Configure local collection", null, \(_, _\) => Configure\(\)\);/);
  assert.doesNotMatch(program,/new\s+NativeDashboard\b|\bShowSourceSettings\b/);
  assert.doesNotMatch(configure,/\bShowDialog\s*\(/);
});
