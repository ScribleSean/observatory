import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {appNames} from '../native/app-names.mjs';
import {checkInstallTarget} from '../native/mac/install-guard.mjs';

const mac={skip:process.platform==='win32'};
function fixture(t) {
  const root=fs.mkdtempSync(path.join(tmpdir(),'mac-install-guard-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  return {root,dataParent:path.join(root,'data'),applicationsFolders:[path.join(root,'user-apps'),path.join(root,'system-apps')],runningProcesses:()=>''};
}
test('guard creates nothing on a clean install',mac,t=>{
  const f=fixture(t);
  assert.deepEqual(checkInstallTarget(f),{legacyBundles:[]});
  assert.deepEqual(fs.readdirSync(f.root),[]);
});
test('guard refuses all Observatory writers without creating folders',mac,t=>{
  const f=fixture(t);
  for(const [output,category] of [['/fixture/'+appNames.internal.macExecutable+' --flag','an Observatory app'],
    ['/Users/x/Applications/Workspace Observatory copy.app/Contents/MacOS/WorkspaceObservatory','an Observatory app'],
    ['/Users/x/Downloads/Observatory 2.app/Contents/MacOS/WorkspaceObservatory --background','an Observatory app'],
    ['/Users/x/Downloads/Observatory 2.app/Contents/Resources/Runtime/node/bin/node --synthetic','a bundled Observatory runtime (this includes a shell whose command names the bundled node)'],

    ['python /fixture/'+appNames.legacy.macBundle+'/collector.py','an Observatory app'],
    ['node /fixture/'+appNames.visible.macBundle+'/collector.mjs','an Observatory app'],
    ['node claude-statusline-bridge.mjs','the Claude Code status line bridge'],
    ['/bin/sh -c "/tmp/Observatory.app/Contents/Resources/Runtime/node/bin/node --private-fixture"','a bundled Observatory runtime (this includes a shell whose command names the bundled node)']]) {
    assert.throws(()=>checkInstallTarget({...f,runningProcesses:()=>output}),{message:'Quit the earlier Observatory app first. Still running: '+category+'.'});
    assert.deepEqual(fs.readdirSync(f.root),[]);
  }
  assert.throws(()=>checkInstallTarget({...f,runningProcesses:()=>null}),/Cannot verify/);
});
test('guard refuses unmigrated data and accepts migrated data with both legacy bundles reported',mac,t=>{
  const f=fixture(t);
  fs.mkdirSync(path.join(f.dataParent,appNames.legacy.dataFolder),{recursive:true});
  assert.throws(()=>checkInstallTarget(f),{message:'Migrate the earlier data folder first: node native/mac/migrate-data.mjs copy --confirm-app-quit'});
  assert.deepEqual(fs.readdirSync(f.dataParent),[appNames.legacy.dataFolder]);
  const target=path.join(f.dataParent,appNames.visible.dataFolder);
  fs.mkdirSync(target);
  assert.throws(()=>checkInstallTarget(f),/Migrate the earlier/);
  fs.writeFileSync(path.join(target,'observatory-migration.json'),'{}');
  const legacyBundles=f.applicationsFolders.map(folder=>path.join(folder,appNames.legacy.macBundle));
  for(const bundle of legacyBundles)fs.mkdirSync(bundle,{recursive:true});
  assert.deepEqual(checkInstallTarget(f),{legacyBundles});
  assert.deepEqual(fs.readdirSync(target),['observatory-migration.json']);
  for(const bundle of legacyBundles)assert.deepEqual(fs.readdirSync(bundle),[]);
});

test('harmless process arguments allow the operation',mac,t=>{
  const f=fixture(t);
  assert.doesNotThrow(()=>checkInstallTarget({...f,runningProcesses:()=>'/usr/bin/vim notes about WorkspaceObservatory.txt'}));
});
