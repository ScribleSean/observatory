import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../native/windows/'+name,import.meta.url),'utf8');
test('native startup uses the installer mutex until the singleton exists',()=>{
  const program=read('Program.cs'),gate=read('InstallationGate.cs');
  assert.match(gate,/Name = "Local\\\\WorkspaceObservatorySetup"/);
  assert.match(read('generate-installer.mjs'),/'WorkspaceObservatorySetup'/);
  assert.match(read('installer.nsi'),/CreateMutexW\(p 0, i 0, w "Local\\\$\{SETUP_ID\}"\)/);
  const acquire=program.indexOf('using var installationGate = TryEnterInstallation();');
  const singleton=program.indexOf('using var singleton = new Mutex');
  const release=program.indexOf('installationGate.Dispose();');
  const run=program.indexOf('Application.Run(new ObservatoryContext');
  assert.ok(acquire>=0 && acquire<singleton && singleton<release && release<run);
  assert.match(program,/InstallationGate.SelfTest\(\)/);
  assert.match(program,/using var installation = TryEnterInstallation\(\);[\s\S]*?using var collector = new Collector/);
});
