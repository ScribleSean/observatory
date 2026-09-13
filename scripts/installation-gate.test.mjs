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
test('normal quit drains collection before releasing application resources',()=>{
  const program=read('Program.cs'),collector=read('Collector.cs');
  assert.match(program,/Quit Observatory", null, async .*await RequestQuit\(\)/);
  const quit=program.slice(program.indexOf('private async Task RequestQuit()'),program.indexOf('protected override void ExitThreadCore()'));
  assert.ok(quit.indexOf('await collector.StopGracefully')<quit.indexOf('ExitThread();'));
  assert.match(collector,/await operations.Stop\(\).WaitAsync\(timeout\)/);
  assert.match(collector,/catch \(TimeoutException\)[\s\S]*operations.Resume\(\)/);
  const production=collector.slice(0,collector.indexOf('internal static void ShutdownSelfTest()'));
  assert.equal((production.match(/operations.TryBegin\(\)/g)||[]).length,3);
  assert.equal((production.match(/operations.Complete\(\)/g)||[]).length,3);
  assert.match(program,/OperationDrain.SelfTest\(\)/);
});
