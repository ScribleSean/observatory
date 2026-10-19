import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {appNames} from '../native/app-names.mjs';
import {migrateDataFolder,inspectDataMigration,runningProcessArgs,assertObservatoryStopped} from '../native/mac/migrate-data.mjs';
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
test('pending and damaged identity folders preserve bytes and private modes',mac,t=>{
  const f=fixture(t);
  const files=[
    ['private-device-identity-pending-'+'a'.repeat(32),'key.json'],
    ['private-device-identity-damaged-'+'b'.repeat(32),'partial.json']
  ];
  for(const [folder,name] of files) {
    fs.mkdirSync(path.join(f.legacy,folder),{mode:0o700});
    fs.writeFileSync(path.join(f.legacy,folder,name),'{"synthetic":true}',{mode:0o600});
  }
  const before=snapshot(f.legacy);
  assert.equal(migrateDataFolder(f).state,'migrated');
  const after=snapshot(f.target);
  for(const [folder,name] of files) {
    const relative=folder+'/'+name;
    assert.deepEqual(after[folder],before[folder]);
    assert.deepEqual(after[relative],before[relative]);
    assert.equal(after[folder].mode&0o777,0o700);
    assert.equal(after[relative].mode&0o777,0o600);
  }
  assert.deepEqual(snapshot(f.legacy),before);
});
test('retirement checkpoint preserves bytes, private mode and the legacy folder',mac,t=>{
  const f=fixture(t),relative='.runtime/private-repair';
  fs.mkdirSync(path.join(f.legacy,relative),{recursive:true,mode:0o700});
  const files={'retirement-receipt.json':'{"synthetic":"receipt"}\n',
    'retirement-snapshot.json':'{"synthetic":"snapshot"}\n'};
  for(const [name,bytes] of Object.entries(files))fs.writeFileSync(path.join(f.legacy,relative,name),bytes,{mode:0o600});
  const before=snapshot(f.legacy);
  assert.equal(migrateDataFolder(f).state,'migrated');
  for(const [name,bytes] of Object.entries(files))
    assert.deepEqual(fs.readFileSync(path.join(f.target,relative,name)),Buffer.from(bytes));
  assert.equal(fs.statSync(path.join(f.target,relative)).mode&0o777,0o700);
  assert.deepEqual(snapshot(f.legacy),before);
});
test('retirement checkpoint hardlinks refuse with bounded entry names',mac,t=>{
  const f=fixture(t),relative='.runtime/private-repair',source=path.join(f.root,'synthetic-receipt.json');
  fs.mkdirSync(path.join(f.legacy,relative),{recursive:true,mode:0o700});
  fs.writeFileSync(source,'{"synthetic":"receipt"}\n',{mode:0o600});
  fs.linkSync(source,path.join(f.legacy,relative,'retirement-receipt.json'));
  assert.throws(()=>migrateDataFolder(f),error=>{
    assert.match(error.message,/Private file has multiple links/);
    assert.doesNotMatch(error.message,/retirement-receipt\.json/);
    return true;
  });
  assert.equal(fs.existsSync(f.target),false);
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
    assert.throws(()=>migrateDataFolder({...f,runningProcesses}),/Quit every|Cannot verify/);
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
test('interrupted staging is retained aside on the next run',mac,t=>{
  const f=fixture(t);let copied=0;
  assert.throws(()=>migrateDataFolder({...f,hooks:{afterFile(){if(++copied===2)throw Error('interrupted');}}}),/interrupted/);
  assert.equal(fs.existsSync(f.stage),false);
  assert.equal(migrateDataFolder(f).state,'migrated');
  assert.equal(fs.existsSync(path.join(f.target,'stale.observatory-partial')),false);
});
test('changed legacy refuses the switch',mac,t=>{
  const f=fixture(t);
  assert.throws(()=>migrateDataFolder({...f,hooks:{afterFile(){fs.writeFileSync(path.join(f.legacy,'new'),'changed');}}}),/earlier data folder changed/);
  assert.equal(fs.existsSync(f.target),false);
});
test('extra staging files are retained aside before a fresh copy',mac,t=>{
  const f=fixture(t);fs.mkdirSync(f.stage);fs.writeFileSync(path.join(f.stage,'extra'),'fixture');
  assert.equal(migrateDataFolder(f).state,'migrated');
  assert.ok(fs.readdirSync(f.root).some(name=>name.includes('-migration-stale-')));
});
test('FIFO is skipped and reported',{skip:process.platform==='win32'},t=>{
  const f=fixture(t);execFileSync('mkfifo',[path.join(f.legacy,'pipe')]);
  assert.deepEqual(inspectDataMigration(f).skipped,['pipe']);
  assert.deepEqual(migrateDataFolder(f).skipped,['pipe']);assert.equal(fs.existsSync(path.join(f.target,'pipe')),false);
});
test('pairing, quota, peer and settings survive migration',mac,async t=>{
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
  assert.deepEqual(snapshot(f.legacy),before);
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

const staleFolders=f=>fs.readdirSync(f.root).filter(name=>name.startsWith('.'+appNames.visible.dataFolder+'-migration-stale-')).map(name=>path.join(f.root,name));
test('receipt survives interruption and resumes directly at the switch',mac,t=>{
  const f=fixture(t);
  assert.throws(()=>migrateDataFolder({...f,hooks:{afterReceipt(){throw Error('crash');}}}),/crash/);
  const before=fs.statSync(path.join(f.stage,'settings.json')).ino;
  assert.equal(migrateDataFolder({...f,hooks:{afterFile(){assert.fail('must not recopy');}}}).state,'migrated');
  assert.equal(fs.statSync(path.join(f.target,'settings.json')).ino,before);
  assert.equal(staleFolders(f).length,0);
});
test('a disappearing copied source refuses once and a stable retry succeeds',mac,t=>{
  const f=fixture(t);
  assert.throws(()=>migrateDataFolder({...f,hooks:{afterFile(name){
    if(name==='settings.json')fs.renameSync(path.join(f.legacy,name),path.join(f.root,'retained'));
  }}}),/earlier data folder changed/);
  assert.equal(staleFolders(f).length,1);
  assert.equal(fs.existsSync(f.stage),false);
  assert.equal(migrateDataFolder(f).state,'migrated');
});
test('source symlink swap never copies outside bytes',mac,t=>{
  const f=fixture(t),outside='outside bytes that must never be copied';
  fs.writeFileSync(path.join(f.root,'outside'),outside);
  assert.throws(()=>migrateDataFolder({...f,hooks:{afterFile(name){
    if(name==='settings.json') {
      fs.renameSync(path.join(f.legacy,'viewer.json'),path.join(f.root,'saved'));
      fs.symlinkSync(path.join(f.root,'outside'),path.join(f.legacy,'viewer.json'));
    }
  }}}),/earlier data folder changed/);
  assert.equal(staleFolders(f).length,1);
  for(const folder of staleFolders(f))for(const entry of Object.values(snapshot(folder)))
    assert.notEqual(entry.bytes,Buffer.from(outside).toString('hex'));
});
test('read-only directories survive a refused run and stable retry',mac,t=>{
  const f=fixture(t),folder=path.join(f.legacy,'private-sync/nested');
  fs.chmodSync(folder,0o500);
  assert.throws(()=>migrateDataFolder({...f,hooks:{afterFile(name){
    if(name==='viewer.json')fs.writeFileSync(path.join(f.stage,'extra'),'mismatch');
  }}}),/staging copy does not match/);
  assert.equal(staleFolders(f).length,1);
  assert.equal(migrateDataFolder(f).state,'migrated');
  assert.equal(fs.statSync(path.join(f.target,'private-sync/nested')).mode&0o777,0o500);
  // Allow the fixture cleanup to remove these synthetic directories.
  for(const root of [f.legacy,f.target,...staleFolders(f)])fs.chmodSync(path.join(root,'private-sync/nested'),0o700);
});
test('free space refusal happens before staging',mac,t=>{
  const f=fixture(t),before=snapshot(f.root);
  assert.throws(()=>migrateDataFolder({...f,statfs:parent=>{
    assert.equal(parent,f.root);return {bavail:0,bsize:4096};
  }}),{message:'Not enough free space for the copy.'});
  assert.deepEqual(snapshot(f.root),before);
});
test('ps arguments cover executables, bundled helpers and the status line bridge',mac,t=>{
  const f=fixture(t),before=snapshot(f.root);
  for(const [output,category] of [['/fixture/'+appNames.internal.macExecutable+' --runtime fixture','an Observatory app'],
    ['/Users/x/Applications/Workspace Observatory copy.app/Contents/MacOS/WorkspaceObservatory','an Observatory app'],
    ['/Users/x/Downloads/Observatory 2.app/Contents/MacOS/WorkspaceObservatory --background','an Observatory app'],
    ['/Users/x/Downloads/Observatory 2.app/Contents/Resources/Runtime/node/bin/node --synthetic','a bundled Observatory runtime (this includes a shell whose command names the bundled node)'],

    ['/usr/bin/python /fixture/'+appNames.legacy.macBundle+'/Contents/collector.py','an Observatory app'],
    ['/usr/bin/node /fixture/'+appNames.visible.macBundle+'/Contents/collector.mjs','an Observatory app'],
    ['/usr/bin/node /fixture/claude-statusline-bridge.mjs','the Claude Code status line bridge'],
    ['/bin/sh -c "/tmp/Observatory.app/Contents/Resources/Runtime/node/bin/node --private-fixture"','a bundled Observatory runtime (this includes a shell whose command names the bundled node)']]) {
    assert.throws(()=>migrateDataFolder({...f,runningProcesses:()=>output}),
      {message:'Quit every Observatory app and close Claude Code sessions that show the Observatory status line, then run again. Still running: '+category+'.'});
  }
  assert.deepEqual(snapshot(f.root),before);
});
test('shutdown is rechecked before comparison and switch',mac,t=>{
  for(const at of [2,3]) {
    const f=fixture(t);let calls=0;
    assert.throws(()=>migrateDataFolder({...f,runningProcesses:()=>++calls===at?'node claude-statusline-bridge.mjs':''}),/Quit every/);
    assert.equal(calls,at);assert.equal(fs.existsSync(f.target),false);
    assert.equal(migrateDataFolder(f).state,'migrated');
  }
});
test('a valid receipt distinguishes later changes to the earlier folder',mac,t=>{
  const f=fixture(t);migrateDataFolder(f);
  fs.writeFileSync(path.join(f.legacy,'settings.json'),'changed');
  assert.equal(inspectDataMigration(f).target,'migrated-earlier-folder-changed');
});
test('private hardlinks and foreign owners refuse with bounded entry names',mac,t=>{
  const f=fixture(t);
  fs.linkSync(path.join(f.legacy,'private-sync/nested/one'),path.join(f.root,'hardlink'));
  assert.throws(()=>migrateDataFolder(f),{message:'Private file has multiple links: private-sync'});
  const g=fixture(t),uid=process.getuid();let calls=0;
  t.mock.method(process,'getuid',()=>++calls===1?uid:uid+1);
  assert.throws(()=>migrateDataFolder(g),{message:'Entry is not owned by the current user: private-sync'});
});

test('status line inspection only reads an explicitly supplied settings fixture',mac,t=>{
  const f=fixture(t),settingsPath=path.join(f.root,'settings-fixture.json');
  assert.equal(inspectDataMigration(f).statusLineTargetsEarlierFolder,'Unknown');
  fs.writeFileSync(settingsPath,JSON.stringify({statusLine:{command:'node "'+f.legacy+'/scripts/claude-statusline-bridge.mjs"'}}));
  assert.equal(inspectDataMigration({...f,settingsPath}).statusLineTargetsEarlierFolder,true);
  fs.writeFileSync(settingsPath,JSON.stringify({statusLine:{command:'node "'+f.target+'/scripts/claude-statusline-bridge.mjs"'}}));
  assert.equal(inspectDataMigration({...f,settingsPath}).statusLineTargetsEarlierFolder,false);
});
test('a copied file hash mismatch retains no partial file',mac,t=>{
  const f=fixture(t),source=path.join(f.legacy,'viewer.json');
  const info=fs.statSync(source);
  assert.throws(()=>migrateDataFolder({...f,hooks:{afterFile(name){
    if(name==='settings.json') {
      fs.writeFileSync(source,'X'.repeat(info.size));
      fs.utimesSync(source,info.atimeMs/1000,info.mtimeMs/1000);
    }
  }}}),/copied file does not match/);
  assert.equal(staleFolders(f).length,1);
  assert.ok(Object.keys(snapshot(staleFolders(f)[0])).every(name=>!name.endsWith('.observatory-partial')));
});
test('a receipted but damaged stage is retained before recopying',mac,t=>{
  const f=fixture(t);
  assert.throws(()=>migrateDataFolder({...f,hooks:{afterReceipt(){throw Error('crash');}}}),/crash/);
  fs.writeFileSync(path.join(f.stage,'settings.json'),'damaged stage');
  assert.equal(migrateDataFolder(f).state,'migrated');
  assert.equal(staleFolders(f).length,1);
  assert.equal(fs.readFileSync(path.join(staleFolders(f)[0],'settings.json'),'utf8'),'damaged stage');
  assert.equal(fs.readFileSync(path.join(f.target,'settings.json'),'utf8'),'{"synthetic":true}');
});

test('process reader removes only its own PID and preserves complete arguments',()=>{
  const own='/fixture/Observatory copy.app/Contents/Resources/Runtime/node/bin/node native/mac/migrate-data.mjs';
  const other='/fixture/Observatory 2.app/Contents/MacOS/WorkspaceObservatory --background';
  const harmless='/usr/bin/vim notes about WorkspaceObservatory.txt';
  const output=runningProcessArgs((command,args,options)=>{
    assert.equal(command,'/bin/ps');
    assert.deepEqual(args,['-axo','pid=,args=']);
    assert.equal(options.encoding,'utf8');
    return `  ${process.pid} ${own}\n  ${process.pid+1} ${other}\n  ${process.pid+2} ${harmless}\n`;
  });
  assert.equal(output,`${other}\n${harmless}\n`);
  assert.throws(()=>assertObservatoryStopped(()=>output,'running'),/running/);
  assert.doesNotThrow(()=>assertObservatoryStopped(()=>runningProcessArgs(()=>` ${process.pid} ${own}\n ${process.pid+1} ${harmless}`),'running'));
});
test('harmless process arguments allow migration',mac,t=>{
  const f=fixture(t);
  assert.doesNotThrow(()=>migrateDataFolder({...f,runningProcesses:()=>'/usr/bin/vim notes about WorkspaceObservatory.txt'}));
});
