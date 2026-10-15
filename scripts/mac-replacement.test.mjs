import {appNames} from '../native/app-names.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync,renameSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {inspectMacPackage} from '../native/mac/inspect-package.mjs';
import {replaceMacApp} from '../native/mac/replace-app.mjs';

function setup(t) {
  const root=realpathSync(mkdtempSync(path.join(tmpdir(),'observatory-mac-replacement-')));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const files=['Contents/MacOS/WorkspaceObservatory','Contents/Info.plist',
    'Contents/Resources/LICENSE','Contents/Resources/THIRD-PARTY-NOTICES.md',
    'Contents/Resources/Web/index.html','Contents/Resources/Web/assets/third-party-licenses.txt',
    'Contents/Resources/Runtime/node/bin/node','Contents/Resources/Runtime/node/LICENSE',
    'Contents/Resources/Runtime/python/bin/python3.13','Contents/Resources/Runtime/python/licenses/LICENSE.cpython.txt',
    'Contents/Resources/Collector/scripts/run-collector.py','Contents/Resources/Collector/scripts/collect-mac.mjs',
    'Contents/_CodeSignature/CodeResources'];
  const installed=path.join(root,appNames.visible.macBundle),staged=path.join(root,'candidate.app');
  const receipts=[];
  for(const [index,folder] of [installed,staged].entries()) {
    // Inspection of new release artifacts still requires the canonical app name.
    const temporary=path.join(root,'build-'+index,appNames.visible.macBundle);
    for(const name of files) {
      const target=path.join(temporary,name);mkdirSync(path.dirname(target),{recursive:true});
      writeFileSync(target,'fixture-'+index);
    }
    writeFileSync(path.join(temporary,'Contents/Resources/build-info.json'),JSON.stringify({
      sourceRevision:(index?'b':'a').repeat(40),sourceDirty:false,version:'0.3.'+(8+index),buildNumber:14+index}));
    receipts.push(inspectMacPackage(temporary));renameSync(temporary,folder);
  }
  const history=path.join(root,'history.sqlite');writeFileSync(history,'newer private observations');
  return {root,installed,staged,history,previousManifest:receipts[0],candidateManifest:receipts[1],
    runningProcesses:()=>'/usr/bin/other\n',verifySignature:()=>{}};
}
const mac={skip:process.platform!=='darwin'};

test('Mac replacement verifies relocated bundles, retains previous app and leaves history alone',mac,t=>{
  const f=setup(t),checked=[];
  const result=replaceMacApp({...f,verifySignature:folder=>checked.push(folder)});
  assert.equal(readFileSync(path.join(f.installed,'Contents/Resources/LICENSE'),'utf8'),'fixture-1');
  assert.equal(readFileSync(path.join(result.previous,'Contents/Resources/LICENSE'),'utf8'),'fixture-0');
  assert.equal(readFileSync(f.history,'utf8'),'newer private observations');
  assert.deepEqual(JSON.parse(readFileSync(path.join(result.recovery,'previous-manifest.json'),'utf8')),f.previousManifest);
  assert.deepEqual(JSON.parse(readFileSync(path.join(result.recovery,'candidate-manifest.json'),'utf8')),f.candidateManifest);
  assert.deepEqual(checked,[f.installed,f.staged,f.installed]);
  assert.equal(existsSync(path.join(f.root,'.observatory-install.lock')),false);
});
test('running Mac app or occupied installer lock prevents all moves',mac,t=>{
  const f=setup(t);
  assert.throws(()=>replaceMacApp({...f,runningProcesses:()=>f.installed+'/Contents/MacOS/WorkspaceObservatory\n'}),/Quit all/);
  const lock=path.join(f.root,'.observatory-install.lock');writeFileSync(lock,'other installer');
  assert.throws(()=>replaceMacApp(f),{code:'EEXIST'});
  assert.equal(readFileSync(lock,'utf8'),'other installer');
  assert.ok(existsSync(f.installed)&&existsSync(f.staged));
});
test('Mac signature failure after promotion restores verified previous app without restoring data',mac,t=>{
  const f=setup(t);let signatures=0,failure;
  try {replaceMacApp({...f,verifySignature:()=>{if(++signatures===3)throw Error('Rejected signature');}});}
  catch(error) {failure=error;}
  assert.equal(failure?.restored,true);
  assert.deepEqual(JSON.parse(readFileSync(path.join(failure.recovery,'previous-manifest.json'),'utf8')),f.previousManifest);
  assert.equal(readFileSync(path.join(f.installed,'Contents/Resources/LICENSE'),'utf8'),'fixture-0');
  assert.equal(readFileSync(path.join(failure.recovery,'rejected/Contents/Resources/LICENSE'),'utf8'),'fixture-1');
  assert.equal(readFileSync(f.history,'utf8'),'newer private observations');
  assert.equal(existsSync(path.join(f.root,'.observatory-install.lock')),false);
});
test('Mac replacement refuses altered candidate contents before any move',mac,t=>{
  const f=setup(t);writeFileSync(path.join(f.staged,'Contents/Resources/LICENSE'),'tampered');
  assert.throws(()=>replaceMacApp(f),/does not match/);
  assert.ok(existsSync(f.installed)&&existsSync(f.staged));
  assert.equal(existsSync(path.join(f.root,'.observatory-install.lock')),false);
});

test('legacy app rename retains the earlier bundle and journals promotion',mac,t=>{
  const f=setup(t),target=f.installed;
  f.installed=path.join(f.root,appNames.legacy.macBundle);renameSync(target,f.installed);
  const result=replaceMacApp(f);
  assert.equal(result.state,'renamed');assert.equal(result.installed,target);
  assert.equal(existsSync(f.installed),false);
  assert.equal(readFileSync(path.join(result.recovery,'previous/Contents/Resources/LICENSE'),'utf8'),'fixture-0');
  assert.equal(readFileSync(path.join(target,'Contents/Resources/LICENSE'),'utf8'),'fixture-1');
  assert.deepEqual(readFileSync(path.join(result.recovery,'transaction.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line).state),
    ['prepared','previous-retained','candidate-promoted']);
  for(const name of ['previous-manifest.json','candidate-manifest.json'])assert.ok(existsSync(path.join(result.recovery,name)));
});
test('rename refuses an existing destination, a running app and unrelated basenames',mac,t=>{
  const f=setup(t),target=f.installed;
  f.installed=path.join(f.root,appNames.legacy.macBundle);renameSync(target,f.installed);
  assert.throws(()=>replaceMacApp({...f,runningProcesses:()=>'/synthetic/'+appNames.internal.macExecutable}),/Quit all/);
  mkdirSync(target);
  assert.throws(()=>replaceMacApp(f),/already exists/);
  const g=setup(t),other=path.join(g.root,'Other.app');renameSync(g.installed,other);
  assert.throws(()=>replaceMacApp({...g,installed:other}),/Stage the candidate/);
});
