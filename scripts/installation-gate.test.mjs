import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../native/windows/'+name,import.meta.url),'utf8');
test('Mac default menu and compact-panel entries open Allowances',()=>{
  const main=readFileSync(new URL('../native/main.swift',import.meta.url),'utf8');
  const panel=readFileSync(new URL('../native/Panel.swift',import.meta.url),'utf8');
  assert.match(main,/private func openDefault\(\) \{ openDashboard\("allowances"\) \}/);
  assert.match(panel,/Button\(action: \{ open\("allowances"\) \}\) \{\s+HStack \{ Text\("Open Observatory"\)/);
});
test('Mac update gate runs before the collection store is created',()=>{
  const main=readFileSync(new URL('../native/main.swift',import.meta.url),'utf8');
  const launch=main.slice(main.indexOf('func applicationDidFinishLaunching'));
  const gate=launch.indexOf('MacUpdateGate.isBlocked(bundle: Bundle.main.bundleURL)');
  assert.ok(gate>=0 && gate<launch.indexOf('store = ObservatoryStore('));
  assert.match(launch.slice(gate,launch.indexOf('ObservatoryTheme.registerFont()')),/NSApp.terminate\(nil\)\s+return/);
});
test('native startup uses the installer mutex until the singleton exists',()=>{
  const program=read('Program.cs'),gate=read('InstallationGate.cs');
  assert.match(gate,/Name = "Local\\\\WorkspaceObservatorySetup"/);
  assert.match(read('generate-installer.mjs'),/'WorkspaceObservatorySetup'/);
  assert.match(read('installer.nsi'),/CreateMutexW\(p 0, i 0, w "Local\\\$\{SETUP_ID\}"\)/);
  const acquire=program.indexOf('using var installationGate = TryEnterInstallation();');
  const singleton=program.indexOf('using var singleton = new Mutex');
  const release=program.indexOf('installationGate.Dispose();');
  const context=program.indexOf('var context = new ObservatoryContext');
  const readiness=program.indexOf('Application.Idle += readyHandler;');
  const run=program.indexOf('Application.Run(context)');
  assert.ok(acquire>=0 && acquire<singleton && singleton<release && release<context && context<readiness && readiness<run);
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
  const guardedOperations = [
    ['internal Action<bool> BeginDirectPairing()', 'internal async Task<QuotaSharingStatus> Sharing('],
    ['internal async Task<QuotaSharingStatus> Sharing(', 'private async Task MaintainPairing('],
    ['private async Task MaintainPairing(', 'internal void Configure('],
    ['private async Task Refresh(bool quotaOnly)', 'internal static void ShutdownSelfTest()'],
  ];
  for (const [start,end] of guardedOperations) {
    const from = collector.indexOf(start), to = collector.indexOf(end,from+start.length);
    assert.ok(from >= 0 && to > from, `Missing lifecycle boundary: ${start}`);
    const operation = collector.slice(from,to);
    assert.equal((operation.match(/operations.TryBegin\(\)/g)||[]).length,1, start);
    assert.equal((operation.match(/operations.Complete\(\)/g)||[]).length,1, start);
    if (start.includes('BeginDirectPairing')) assert.match(operation,/Interlocked.Exchange\(ref released, 1\)/);
    else assert.match(operation,/finally\s*\{\s*operations.Complete\(\)/);
  }
  assert.equal((production.match(/operations.TryBegin\(\)/g)||[]).length,guardedOperations.length);
  assert.equal((production.match(/operations.Complete\(\)/g)||[]).length,guardedOperations.length);
  assert.match(program,/OperationDrain.SelfTest\(\)/);
});
