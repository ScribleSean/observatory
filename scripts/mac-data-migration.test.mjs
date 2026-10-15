import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {appNames} from '../native/app-names.mjs';
import {migrateDataFolder,inspectDataMigration,updateWindowsPeerPaths} from '../native/mac/migrate-data.mjs';
import {privateSyncDirectory} from './peer-directory.mjs';
import {readPairing,createPairingConfigurations} from './peer-pairing.mjs';
import {readQuotaState,updateQuotaState} from './quota-store.mjs';
import {createPeerPayload} from './peer-payload.mjs';
import {createPeerRecord,acceptPeerState,readPeerState} from './peer-store.mjs';

function fixture(t,{pairing=false}={}) {
  const root=fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(),'observatory-data-migration-')));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const f={root,legacy:path.join(root,appNames.legacy.dataFolder),target:path.join(root,appNames.visible.dataFolder),
    stage:path.join(root,'.migration'),runningProcesses:()=>'/usr/bin/other\n'};
  fs.mkdirSync(f.legacy,{mode:0o700});
  fs.mkdirSync(path.join(f.legacy,'private-sync'),{mode:0o700});
  const privateFolder=pairing?'private-fixture':'private-sync';
  if(pairing)fs.mkdirSync(path.join(f.legacy,privateFolder),{mode:0o700});
  fs.mkdirSync(path.join(f.legacy,privateFolder,'nested'),{mode:0o700});
  for(const [name,mode] of [[privateFolder+'/nested/one',0o600],['settings.json',0o600],['viewer.json',0o644]]) {
    const file=path.join(f.legacy,name);fs.writeFileSync(file,'{"synthetic":true}',{mode});
    fs.utimesSync(file,1700000000,1700000001);
  }
  fs.utimesSync(path.join(f.legacy,privateFolder,'nested'),1700000000,1700000002);
  fs.utimesSync(path.join(f.legacy,'private-sync'),1700000000,1700000003);
  return f;
}
function snapshot(root) {
  const out={};
  function visit(rel) {
    const file=path.join(root,rel),s=fs.lstatSync(file);
    out[rel]={mode:s.mode,mtime:s.mtimeMs,bytes:s.isFile()?fs.readFileSync(file).toString('hex'):null,
      linkText:s.isSymbolicLink()?fs.readlinkSync(file):null};
    if(s.isDirectory())for(const name of fs.readdirSync(file).sort())visit(rel?rel+'/'+name:name);
  }
  visit('');return out;
}
// The Mac migration uses POSIX modes, owners and ps, so it runs only off Windows.
const mac={skip:process.platform==='win32'};
test('full migration preserves nested permissions, timestamps and every legacy byte',mac,t=>{
  const f=fixture(t),before=snapshot(f.legacy);
  const result=migrateDataFolder(f);
  assert.equal(result.state,'migrated');assert.equal(result.files,3);assert.equal(result.directories,2);
  assert.deepEqual(snapshot(f.legacy),before);
  const after=snapshot(f.target);
  for(const [name,entry] of Object.entries(before))if(name)assert.deepEqual(after[name],entry);
  const receipt=JSON.parse(fs.readFileSync(path.join(f.target,'observatory-migration.json')));
  assert.equal(receipt.manifestSha256,result.manifestSha256);
  assert.equal(fs.statSync(path.join(f.target,'observatory-migration.json')).mode&0o777,0o600);
});
test('backup bundle links retain their text and report destinations outside Backups',mac,t=>{
  const f=fixture(t),bundle='Backups/Old.app.backup',versions=bundle+'/Sparkle.framework/Versions';
  fs.mkdirSync(path.join(f.legacy,versions,'A'),{recursive:true});
  fs.writeFileSync(path.join(f.legacy,versions,'A/Sparkle'),'synthetic framework');
  const links={
    [versions+'/Current']:'A',
    [bundle+'/absolute']:path.join(f.root,'missing-absolute-target'),
    [bundle+'/escaping']:'../../outside',
    [bundle+'/internal']:'../Old.app.backup/Sparkle.framework/Versions/A'
  };
  for(const [name,text] of Object.entries(links)) {
    fs.symlinkSync(text,path.join(f.legacy,name));
    fs.lutimesSync(path.join(f.legacy,name),1700000000,1700000001);
  }
  const before=snapshot(f.legacy),outside=[bundle+'/absolute',bundle+'/escaping'];
  assert.deepEqual(inspectDataMigration(f).linksOutsideBackups,outside);
  const result=migrateDataFolder(f);
  assert.deepEqual(result.linksOutsideBackups,outside);
  for(const [name,text] of Object.entries(links)) {
    const copied=path.join(f.target,name);
    assert.equal(fs.lstatSync(copied).isSymbolicLink(),true);
    assert.equal(fs.readlinkSync(copied),text);
    assert.equal(fs.lstatSync(copied).mtimeMs,before[name].mtime);
  }
  assert.deepEqual(snapshot(f.legacy),before);
  assert.equal(migrateDataFolder(f).state,'already-migrated');
});
test('verification refuses changed staged link text',mac,t=>{
  const f=fixture(t),name='Backups/link';
  fs.mkdirSync(path.join(f.legacy,'Backups'));
  fs.symlinkSync('original',path.join(f.legacy,name));
  assert.throws(()=>migrateDataFolder({...f,hooks:{afterFile(copied){
    if(copied!==name)return;
    fs.unlinkSync(path.join(f.stage,name));
    fs.symlinkSync('modified',path.join(f.stage,name));
    const source=fs.lstatSync(path.join(f.legacy,name));
    fs.lutimesSync(path.join(f.stage,name),source.atimeMs/1000,source.mtimeMs/1000);
  }}}),/staging copy does not match/);
  assert.equal(fs.existsSync(f.target),false);
});
test('a file larger than three MiB copies and verifies every byte',mac,t=>{
  const f=fixture(t),bytes=Buffer.alloc(3*1024*1024+137);
  for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
  fs.writeFileSync(path.join(f.legacy,'large.bin'),bytes,{mode:0o640});
  const result=migrateDataFolder(f);
  assert.equal(result.state,'migrated');
  assert.equal(result.files,4);
  assert.deepEqual(fs.readFileSync(path.join(f.target,'large.bin')),bytes);
  assert.equal(inspectDataMigration(f).target,'migrated');
});
test('the root mode and timestamps survive the marker write and switch',mac,t=>{
  const f=fixture(t);
  fs.chmodSync(f.legacy,0o755);
  fs.utimesSync(f.legacy,1700000000,1700000001);
  const before=fs.lstatSync(f.legacy);
  migrateDataFolder(f);
  const after=fs.lstatSync(f.target);
  assert.equal(after.mode&0o7777,0o755);
  assert.equal(after.atimeMs,before.atimeMs);
  assert.equal(after.mtimeMs,before.mtimeMs);
  assert.equal(fs.existsSync(path.join(f.target,'observatory-migration.json')),true);
});
test('Swift uses the canonical legacy data folder literal',()=>{
  const swift=fs.readFileSync(new URL('../native/main.swift',import.meta.url),'utf8');
  const match=swift.match(/^let legacyDataFolder = .*\.appendingPathComponent\("([^"\n]+)"\)$/m);
  assert.ok(match,'The legacyDataFolder declaration must contain its folder literal.');
  assert.equal(match[1],appNames.legacy.dataFolder);
});
test('running or unverifiable processes refuse without writes',mac,t=>{
  const f=fixture(t),before=snapshot(f.root);
  for(const runningProcesses of [()=>'/fixture/'+appNames.internal.macExecutable,()=>null,()=>{throw Error('ps failed');}])
    assert.throws(()=>migrateDataFolder({...f,runningProcesses}),/Quit all|Cannot verify/);
  assert.deepEqual(snapshot(f.root),before);
});
test('occupied target and linked legacy entries refuse without staging',mac,t=>{
  const f=fixture(t);fs.mkdirSync(f.target);fs.writeFileSync(path.join(f.target,'occupied'),'fixture');
  assert.throws(()=>migrateDataFolder(f),/already holds data/);
  assert.equal(fs.existsSync(f.stage),false);
  const g=fixture(t);fs.symlinkSync('settings.json',path.join(g.legacy,'link'));
  assert.throws(()=>migrateDataFolder(g),/Unsupported entries: "link"/);
  assert.equal(fs.existsSync(g.target),false);assert.equal(fs.existsSync(g.stage),false);
});
test('already migrated and inspection perform no writes',mac,t=>{
  const f=fixture(t),before=snapshot(f.root);
  assert.equal(inspectDataMigration(f).target,'missing');assert.deepEqual(snapshot(f.root),before);
  migrateDataFolder(f);const copied=snapshot(f.root);
  assert.equal(migrateDataFolder(f).state,'already-migrated');
  assert.equal(inspectDataMigration(f).target,'migrated');
  assert.deepEqual(snapshot(f.root),copied);
});
test('interrupted staging resumes and removes only owned partial files',mac,t=>{
  const f=fixture(t);let copied=0;
  assert.throws(()=>migrateDataFolder({...f,hooks:{afterFile(){if(++copied===2)throw Error('interrupted');}}}),/interrupted/);
  fs.writeFileSync(path.join(f.stage,'stale.observatory-partial'),'partial');
  assert.equal(migrateDataFolder(f).state,'migrated');
  assert.equal(fs.existsSync(path.join(f.target,'stale.observatory-partial')),false);
});
test('changed legacy refuses the switch',mac,t=>{
  const f=fixture(t);
  assert.throws(()=>migrateDataFolder({...f,hooks:{afterFile(){fs.writeFileSync(path.join(f.legacy,'new'),'changed');}}}),/earlier data folder changed/);
  assert.equal(fs.existsSync(f.target),false);
});
test('extra staging files refuse the switch',mac,t=>{
  const f=fixture(t);fs.mkdirSync(f.stage);fs.writeFileSync(path.join(f.stage,'extra'),'fixture');
  assert.throws(()=>migrateDataFolder(f),/staging copy does not match/);assert.equal(fs.existsSync(f.target),false);
});
test('FIFO is skipped and reported',{skip:process.platform==='win32'},t=>{
  const f=fixture(t);execFileSync('mkfifo',[path.join(f.legacy,'pipe')]);
  assert.deepEqual(inspectDataMigration(f).skipped,['pipe']);
  assert.deepEqual(migrateDataFolder(f).skipped,['pipe']);assert.equal(fs.existsSync(path.join(f.target,'pipe')),false);
});
test('pairing, quota, peer and settings survive migration and Windows paths update once',mac,async t=>{
  const f=fixture(t,{pairing:true}),now=1700000000000;
  await privateSyncDirectory(f.legacy,true);
  const pairing=createPairingConfigurations().Mac;
  pairing.transport={kind:'ssh-windows',hostAlias:'synthetic-host',
    remoteNode:'C:/Users/Example/AppData/Local/Programs/Workspace Observatory/Runtime/node.exe',
    remoteScript:'C:/Users/Example/AppData/Local/Programs/Workspace Observatory/Collector/scripts/peer-exchange.mjs',
    remoteRuntime:'C:/Users/Example/AppData/Local/Workspace Observatory'};
  const pairingFile=path.join(f.legacy,'private-sync/pairing.json');
  fs.writeFileSync(pairingFile,JSON.stringify(pairing),{mode:0o600});
  const initial=await readQuotaState(f.legacy,now);
  await updateQuotaState(f.legacy,{revision:initial.revision,scope:'f'.repeat(64),
    observation:{status:'ok',checkedAt:new Date(now).toISOString(),windows:[{bucket:'codex',window:'primary',remainingPercent:60}]}},now);
  const payload=createPeerPayload({collectedAt:new Date(now).toISOString(),activity:{status:'not-connected'},
    codex:[{host:'Windows',status:'not-connected'}],dictation:[{source:'Wispr Flow',status:'not-connected'}]},pairing.peer);
  const record=createPeerRecord(payload,pairing.peer,7,now);
  await acceptPeerState(f.legacy,record,pairing.peer,now);
  const quota=await readQuotaState(f.legacy,now),before=snapshot(f.legacy);
  migrateDataFolder(f);
  assert.deepEqual(await readPairing(f.target),pairing);
  assert.deepEqual(await readQuotaState(f.target,now),quota);
  assert.deepEqual(await readPeerState(f.target,pairing.peer,now),record);
  await privateSyncDirectory(f.target,false);
  for(const name of ['viewer.json','settings.json'])assert.deepEqual(fs.readFileSync(path.join(f.target,name)),fs.readFileSync(path.join(f.legacy,name)));
  assert.deepEqual(await updateWindowsPeerPaths({runtime:f.target}),{state:'updated',fields:['remoteNode','remoteScript','remoteRuntime']});
  const expected=structuredClone(pairing);
  for(const field of ['remoteNode','remoteScript','remoteRuntime'])expected.transport[field]=expected.transport[field].replace('Workspace Observatory','Observatory');
  assert.deepEqual(await readPairing(f.target),expected);
  assert.deepEqual(await updateWindowsPeerPaths({runtime:f.target}),{state:'unchanged'});
  assert.deepEqual(snapshot(f.legacy),before);
  await assert.rejects(updateWindowsPeerPaths({runtime:f.legacy}),/new data folder/);
  const tls={...pairing,transport:{kind:'tls',address:'10.0.0.3',port:43128}};
  fs.writeFileSync(path.join(f.target,'private-sync/pairing.json'),JSON.stringify(tls));
  assert.deepEqual(await updateWindowsPeerPaths({runtime:f.target}),{state:'unchanged'});
});

test('empty destination can be replaced and linked folders are refused',mac,t=>{
  const f=fixture(t);fs.mkdirSync(f.target);
  assert.equal(migrateDataFolder(f).state,'migrated');
  for(const field of ['legacy','target','stage']) {
    const g=fixture(t),destination=path.join(g.root,'linked');
    fs.symlinkSync(g.legacy,destination);
    assert.throws(()=>migrateDataFolder({...g,[field]:destination}),/Unsafe data folder/);
  }
  const g=fixture(t),alias=path.join(g.root,'ancestor');fs.symlinkSync(g.root,alias);
  assert.throws(()=>migrateDataFolder({...g,legacy:path.join(alias,appNames.legacy.dataFolder),
    target:path.join(alias,appNames.visible.dataFolder),stage:path.join(alias,'.migration')}),/ancestor refused/);
});
test('Windows peer path updates preserve separators and require the exact parent segment',mac,async t=>{
  const f=fixture(t,{pairing:true});migrateDataFolder(f);
  const pairing=createPairingConfigurations().Mac;
  pairing.transport={kind:'ssh-windows',hostAlias:'synthetic-host',
    remoteNode:'C:\\Users\\Example\\AppData\\Local\\pRoGrAmS\\Workspace Observatory\\Runtime\\node.exe',
    remoteScript:'C:/Other/Workspace Observatory/Collector/scripts/peer-exchange.mjs',
    remoteRuntime:'C:\\Users\\Example\\AppData\\LOCAL\\Workspace Observatory'};
  fs.writeFileSync(path.join(f.target,'private-sync/pairing.json'),JSON.stringify(pairing),{mode:0o600});
  assert.deepEqual(await updateWindowsPeerPaths({runtime:f.target}),{state:'updated',fields:['remoteNode','remoteRuntime']});
  const expected=structuredClone(pairing);
  expected.transport.remoteNode=expected.transport.remoteNode.replace('Workspace Observatory','Observatory');
  expected.transport.remoteRuntime=expected.transport.remoteRuntime.replace('Workspace Observatory','Observatory');
  assert.deepEqual(await readPairing(f.target),expected);
});
