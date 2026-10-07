import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,writeFile,readFile,mkdir,lstat,symlink,readdir,rm,chmod,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import childProcess from 'node:child_process';
import fsPromises from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {archiveMacSnapshot,retirementSnapshotGuard} from './mac-snapshot-archive.mjs';
import {privateCollectorDirectory} from './peer-directory.mjs';
import {windowsPowerShellEnvironment} from './windows-powershell.mjs';
const options={skip:process.platform!=='darwin'};
async function fixture(t) {
  const root=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-snapshot-archive-')));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const archive=path.join(root,'archives'),file=path.join(root,'usage.json');
  await mkdir(archive,{mode:0o700});
  const bytes=JSON.stringify({schema:2,collectedAt:'2026-09-01T12:00:00.000Z',tokens:[{host:'Mac',totalTokens:42}]});
  await writeFile(file,bytes);
  return {root,archive,file,bytes};
}
const retiredBytes=Buffer.from(JSON.stringify({schema:2,collectedAt:'2026-09-09T12:00:00.000Z',
  timezone:'America/New_York',activity:[],activityHistory:[],agents:[],
  tokens:[{host:'Ubuntu',status:'ok',days:[{date:'2026-09-09',totalTokens:42}]}],
  settings:[{host:'Ubuntu',status:'ok',profiles:[{model:'fixture',totalTokens:42}],tools:[]}],
  localModel:{host:'Ubuntu',status:'ok',records:[{model:'fixture',recordedAt:'2026-09-09T11:00:00.000Z',seconds:1,input:10,output:2}]}},null,2)+'\r\n');
async function retirementFixture(t) {
  const runtime=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-retirement-snapshot-')));
  t.after(()=>rm(runtime,{recursive:true,force:true}));
  const file=path.join(runtime,'public/local/usage.json');
  await mkdir(path.dirname(file),{recursive:true,mode:0o700});
  await writeFile(file,retiredBytes,{mode:0o600});
  const config=JSON.stringify({activity:false,codex:false,wispr:false,quota:false,claude:false,
    antigravity:false,receipts:false,benchmarks:false,...(process.platform==='win32'?{wslDistribution:'Ubuntu'}:{})});
  await writeFile(path.join(runtime,'collector.config.json'),config);
  await writeFile(path.join(runtime,'original-record.json'),'fictional-original-record-bytes');
  return {runtime,file,config,archive:path.join(runtime,'.runtime/private-repair','retirement-snapshot.json'),
    receipt:path.join(runtime,'.runtime/private-repair','retirement-receipt.json')};
}
async function nativeCollect(f,options) {
  return process.platform==='win32'
    ? (await import('./collect-windows.mjs')).collectWindows(f.runtime,null,options)
    : (await import('./collect-mac.mjs')).collectMac(f.runtime,'/unused-python',null,options);
}
const nativeOptions={skip:!['win32','darwin'].includes(process.platform)};
test('native retirement saves exact old evidence privately before replacing the snapshot',
  nativeOptions,async t=>{
    const f=await retirementFixture(t);
    await nativeCollect(f);
    assert.deepEqual(await readFile(f.archive),retiredBytes);
    const receipt=JSON.parse(await readFile(f.receipt,'utf8'));
    assert.equal(receipt.collectedAt,'2026-09-09T12:00:00.000Z');
    assert.equal(receipt.bytes,retiredBytes.length);
    assert.equal(receipt.reason,'source-retirement');
    assert.equal(receipt.source,'public/local/usage.json');
    const data=JSON.parse(await readFile(f.file,'utf8'));
    assert.equal(data.tokens.some(source=>source.host==='Ubuntu'),false);
    assert.equal(data.settings.some(source=>source.host==='Ubuntu'),false);
    assert.equal(data.localModel?.records,undefined);
    assert.equal(data.combinedTokens.status,'unavailable');
    assert.equal(JSON.stringify(data).includes(f.runtime),false);
    assert.equal(JSON.stringify(data).includes('retirement-snapshot'),false);
    assert.equal(await readFile(path.join(f.runtime,'collector.config.json'),'utf8'),f.config);
    assert.equal(await readFile(path.join(f.runtime,'original-record.json'),'utf8'),'fictional-original-record-bytes');
    const receiptBytes=await readFile(f.receipt);
    await nativeCollect(f);
    assert.deepEqual(await readFile(f.receipt),receiptBytes);
    assert.deepEqual((await readdir(path.dirname(f.archive))).sort(),['retirement-receipt.json','retirement-snapshot.json']);
    if(process.platform!=='win32')for(const file of [f.archive,f.receipt,path.dirname(f.archive)])
      assert.equal((await lstat(file)).mode&0o077,0);
  });

test('retirement retry reuses one exact checkpoint without refreshing its provenance',async t=>{
  const f=await retirementFixture(t),before=await lstat(f.file,{bigint:true});
  const guard=await retirementSnapshotGuard(f.runtime);
  await guard.preserve();
  const receiptBytes=await readFile(f.receipt),receipt=JSON.parse(receiptBytes);
  assert.equal(receipt.sha256,createHash('sha256').update(retiredBytes).digest('hex'));
  assert.equal(receipt.sourceMtimeNs,String(before.mtimeNs));
  assert.equal(receipt.sourceCtimeNs,String(before.ctimeNs));
  assert.equal(receipt.sourceBirthtimeNs,String(before.birthtimeNs));
  assert.ok(Number.isFinite(Date.parse(receipt.archivedAt)));
  for(let attempt=0;attempt<3;attempt++)await (await retirementSnapshotGuard(f.runtime)).preserve();
  assert.deepEqual(await readFile(f.receipt),receiptBytes);
  assert.deepEqual(await readFile(f.archive),retiredBytes);
  assert.deepEqual(await readFile(f.file),retiredBytes);
  assert.deepEqual((await readdir(path.dirname(f.archive))).sort(),['retirement-receipt.json','retirement-snapshot.json']);
});

test('retirement resumes a complete copy interrupted before its receipt',async t=>{
  const f=await retirementFixture(t);
  await (await retirementSnapshotGuard(f.runtime)).preserve();
  await unlink(f.receipt);
  await (await retirementSnapshotGuard(f.runtime)).preserve();
  assert.deepEqual(await readFile(f.archive),retiredBytes);
  assert.equal(JSON.parse(await readFile(f.receipt)).bytes,retiredBytes.length);
  assert.deepEqual(await readFile(f.file),retiredBytes);
});

async function legacyCollector(t,f,action) {
  const bundle=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-retirement-bundle-')));
  t.after(()=>rm(bundle,{recursive:true,force:true}));
  await fsPromises.cp(new URL('./',import.meta.url),path.join(bundle,'scripts'),{recursive:true});
  const receiptDirectory=path.join(f.runtime,'receipts');await mkdir(receiptDirectory);
  const config=JSON.stringify({macCcusage:'/fictional/ccusage',windowsHost:'fixture-host',
    receiptDirectory,ubuntuHost:'retired-fixture-host',ubuntuCodexHome:'/fictional/retired',
    dictation:{mac:false,windows:false}});
  await writeFile(path.join(f.runtime,'local.config.json'),config);
  const original={execFile:childProcess.execFile,spawn:childProcess.spawn,fetch:globalThis.fetch,
    runtime:process.env.OBSERVATORY_RUNTIME};
  const realExecute=promisify(original.execFile),calls=[];
  childProcess.execFile=()=>{throw Error('Unexpected callback command');};
  childProcess.execFile[promisify.custom]=async(file,args,options)=>{
    if(args.some(arg=>/private-sync-acl\.ps1|private-path-acl\.py/.test(String(arg))))return realExecute(file,args,options);
    calls.push({file,args});
    if(file==='/fictional/ccusage')return {stdout:JSON.stringify({daily:[]})};
    if(file==='ssh' && args.includes('fixture-host'))return {stdout:JSON.stringify({categories:{Coding:0,Terminal:0,Browser:0,Other:0}})};
    throw Error('Unexpected fixture command');
  };
  childProcess.spawn=()=>{throw Error('Synthetic local reader unavailable');};
  globalThis.fetch=async()=>{throw Error('Synthetic activity unavailable');};
  process.env.OBSERVATORY_RUNTIME=f.runtime;
  syncBuiltinESMExports();
  try {
    const {collect}=await import(pathToFileURL(path.join(bundle,'scripts/collect-dashboard.mjs')));
    await action(collect);
    assert.equal(calls.some(call=>call.args.includes('retired-fixture-host')),false);
    assert.equal(await readFile(path.join(f.runtime,'local.config.json'),'utf8'),config);
    assert.deepEqual(await fsPromises.readdir(bundle),['scripts']);
  } finally {
    childProcess.execFile=original.execFile;childProcess.spawn=original.spawn;globalThis.fetch=original.fetch;
    if(original.runtime===undefined)delete process.env.OBSERVATORY_RUNTIME;else process.env.OBSERVATORY_RUNTIME=original.runtime;
    syncBuiltinESMExports();
  }
}

test('bundled legacy retirement archives before replacement and never feeds history into current totals',async t=>{
  const f=await retirementFixture(t);
  await legacyCollector(t,f,async collect=>{
    const originalRename=fsPromises.rename;
    let replacements=0;
    fsPromises.rename=async(from,to)=>{
      if(to===f.file) {
        assert.deepEqual(await readFile(f.archive),retiredBytes);
        assert.ok(JSON.parse(await readFile(f.receipt)).sha256);
        if(replacements===0)assert.deepEqual(await readFile(f.file),retiredBytes);
        replacements++;
      }
      return originalRename(from,to);
    };
    syncBuiltinESMExports();
    try {await collect();await collect();}
    finally {fsPromises.rename=originalRename;syncBuiltinESMExports();}
    assert.equal(replacements,2);
    const data=JSON.parse(await readFile(f.file));
    assert.equal(data.tokens.some(source=>source.host==='Ubuntu'),false);
    assert.equal(data.localModel.records,undefined);
    assert.equal(data.combinedTokens.status,'unavailable');
    assert.equal(JSON.stringify(data).includes(f.runtime),false);
    assert.deepEqual((await readdir(path.dirname(f.archive))).sort(),['retirement-receipt.json','retirement-snapshot.json']);
    assert.equal(await readFile(path.join(f.runtime,'original-record.json'),'utf8'),'fictional-original-record-bytes');
  });
});

async function privateArchive(f) {
  const control=path.join(f.runtime,'.runtime');
  await mkdir(control,{mode:0o700});
  return privateCollectorDirectory(control,'private-repair',true);
}
function windowsAcl(file,grant=false) {
  const executable=path.join(process.env.SystemRoot || 'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  const literal="'"+file.replaceAll("'","''")+"'";
  if(grant)childProcess.execFileSync(path.join(process.env.SystemRoot || 'C:/Windows','System32/icacls.exe'),
    [file,'/grant','*S-1-1-0:(R)'],{encoding:'utf8',timeout:15000});
  const input=`$ErrorActionPreference='Stop'; (Get-Acl -LiteralPath ${literal}).Sddl`;
  return childProcess.execFileSync(executable,['-NoProfile','-NonInteractive','-Command','-'],
    {input,encoding:'utf8',timeout:15000,env:windowsPowerShellEnvironment()}).trim();
}

test('unsafe archive directory stops both collectors without changing the current snapshot',async t=>{
  for(const collector of ['legacy',...(['win32','darwin'].includes(process.platform)?['native']:[])]) {
    await t.test(collector,async t=>{
      const f=await retirementFixture(t),outside=path.join(f.runtime,'outside');
      await mkdir(outside,{mode:0o700});await mkdir(path.join(f.runtime,'.runtime'),{mode:0o700});
      await symlink(outside,path.dirname(f.archive),process.platform==='win32'?'junction':'dir');
      const check=async collect=>{
        await assert.rejects(collect());await assert.rejects(collect());
        assert.deepEqual(await readFile(f.file),retiredBytes);
        assert.deepEqual(await readdir(outside),[]);
      };
      if(collector==='legacy')await legacyCollector(t,f,check);else await check(()=>nativeCollect(f));
    });
  }
});

test('broad archive permissions are refused without silently repairing directory or file access',async t=>{
  for(const target of ['directory','snapshot','receipt'])await t.test(target,async t=>{
    const f=await retirementFixture(t);
    if(target==='directory')await privateArchive(f);else await (await retirementSnapshotGuard(f.runtime)).preserve();
    const file=target==='directory'?path.dirname(f.archive):target==='snapshot'?f.archive:f.receipt;
    let before;
    if(process.platform==='win32')before=windowsAcl(file,true);
    else {await chmod(file,target==='directory'?0o755:0o644);before=(await lstat(file)).mode;}
    await assert.rejects((await retirementSnapshotGuard(f.runtime)).preserve());
    assert.equal(process.platform==='win32'?windowsAcl(file):(await lstat(file)).mode,before);
    assert.deepEqual(await readFile(f.file),retiredBytes);
  });
});

test('a failed receipt write keeps the current snapshot and retries reuse the completed copy',nativeOptions,async t=>{
  const f=await retirementFixture(t),originalOpen=fsPromises.open;
  fsPromises.open=async(file,...args)=>{
    if(file===f.receipt)throw Object.assign(Error('Synthetic disk failure'),{code:'EIO'});
    return originalOpen(file,...args);
  };
  syncBuiltinESMExports();
  try {
    for(let attempt=0;attempt<2;attempt++) {
      await assert.rejects(nativeCollect(f),/Synthetic disk failure/);
      assert.deepEqual(await readFile(f.file),retiredBytes);
      assert.deepEqual(await readFile(f.archive),retiredBytes);
      assert.deepEqual(await readdir(path.dirname(f.archive)),['retirement-snapshot.json']);
    }
  } finally {fsPromises.open=originalOpen;syncBuiltinESMExports();}
  await nativeCollect(f);
  assert.notDeepEqual(await readFile(f.file),retiredBytes);
  assert.deepEqual(await readFile(f.archive),retiredBytes);
});

test('different or corrupt checkpoints fail closed instead of growing or overwriting retained evidence',async t=>{
  for(const damage of ['different-source','partial-copy','corrupt-receipt','hardlink'])await t.test(damage,async t=>{
    const f=await retirementFixture(t);
    await (await retirementSnapshotGuard(f.runtime)).preserve();
    if(damage==='different-source')await writeFile(f.file,retiredBytes.toString().replace('42','43'));
    if(damage==='partial-copy')await writeFile(f.archive,'{');
    if(damage==='corrupt-receipt')await writeFile(f.receipt,'{}');
    if(damage==='hardlink')await fsPromises.link(f.archive,path.join(f.runtime,'aliased-evidence.json'));
    const current=await readFile(f.file),saved=await readFile(f.archive),receipt=await readFile(f.receipt);
    for(let attempt=0;attempt<2;attempt++)await assert.rejects((await retirementSnapshotGuard(f.runtime)).preserve());
    assert.deepEqual(await readFile(f.file),current);
    assert.deepEqual(await readFile(f.archive),saved);
    assert.deepEqual(await readFile(f.receipt),receipt);
    assert.deepEqual((await readdir(path.dirname(f.archive))).sort(),['retirement-receipt.json','retirement-snapshot.json']);
  });
});

test('source removal during the actual read is a race, not an absent first snapshot',async t=>{
  const f=await retirementFixture(t),originalOpen=fsPromises.open;
  fsPromises.open=async(file,...args)=>{
    if(file===f.file)await unlink(f.file);
    return originalOpen(file,...args);
  };
  syncBuiltinESMExports();
  try {await assert.rejects(retirementSnapshotGuard(f.runtime));}
  finally {fsPromises.open=originalOpen;syncBuiltinESMExports();}
  await assert.rejects(lstat(f.archive),{code:'ENOENT'});
});

test('a source replaced after history was read is never archived as the original snapshot',async t=>{
  const f=await retirementFixture(t),guard=await retirementSnapshotGuard(f.runtime);
  const changed=Buffer.from(retiredBytes.toString().replace('42','43'));
  await writeFile(f.file+'.replacement',changed,{mode:0o600});await fsPromises.rename(f.file+'.replacement',f.file);
  await assert.rejects(guard.preserve(),/Snapshot changed/);
  assert.deepEqual(await readFile(f.file),changed);
  await assert.rejects(lstat(f.archive),{code:'ENOENT'});
});

test('a source changed during archiving is not replaced after saving earlier evidence',nativeOptions,async t=>{
  const f=await retirementFixture(t),originalOpen=fsPromises.open;
  const changed=Buffer.from(retiredBytes.toString().replace('42','43'));
  fsPromises.open=async(file,...args)=>{
    if(file===f.receipt && args[0]==='wx')await writeFile(f.file,changed);
    return originalOpen(file,...args);
  };
  syncBuiltinESMExports();
  try {await assert.rejects(nativeCollect(f),/Snapshot changed/);}
  finally {fsPromises.open=originalOpen;syncBuiltinESMExports();}
  assert.deepEqual(await readFile(f.file),changed);
  assert.deepEqual(await readFile(f.archive),retiredBytes);
});

test('a stale temporary-file alias cannot overwrite evidence before the archive guard',nativeOptions,async t=>{
  const f=await retirementFixture(t);
  await assert.rejects(nativeCollect(f,{readAntigravity:async()=>{
    await fsPromises.link(f.file,f.file+'.tmp');
    return {provider:'Antigravity',host:process.platform==='win32'?'Windows':'Mac',status:'not-connected'};
  }}));
  assert.deepEqual(await readFile(f.file),retiredBytes);
});

test('retry flushes a completed copy whose first durability sync failed',nativeOptions,async t=>{
  const f=await retirementFixture(t),originalOpen=fsPromises.open;
  let fail=true,syncs=0;
  fsPromises.open=async(file,...args)=>{
    const handle=await originalOpen(file,...args);
    if(file===f.archive) {
      const sync=handle.sync.bind(handle);
      handle.sync=async()=>{syncs++;if(fail)throw Error('Synthetic flush failure');return sync();};
    }
    return handle;
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(nativeCollect(f),/Synthetic flush failure/);
    assert.deepEqual(await readFile(f.file),retiredBytes);
    fail=false;
    await nativeCollect(f);
    assert.ok(syncs>1,'the existing recovery copy must be flushed on retry');
  } finally {fsPromises.open=originalOpen;syncBuiltinESMExports();}
});

test('archive corruption during receipt publication prevents snapshot replacement',nativeOptions,async t=>{
  const f=await retirementFixture(t),originalOpen=fsPromises.open;
  fsPromises.open=async(file,...args)=>{
    if(file===f.receipt && args[0]==='wx')await writeFile(f.archive,'{}');
    return originalOpen(file,...args);
  };
  syncBuiltinESMExports();
  try {await assert.rejects(nativeCollect(f));}
  finally {fsPromises.open=originalOpen;syncBuiltinESMExports();}
  assert.deepEqual(await readFile(f.file),retiredBytes);
});

test('missing snapshots and disconnected retired placeholders create no archives',async t=>{
  const f=await retirementFixture(t);await unlink(f.file);
  await (await retirementSnapshotGuard(f.runtime)).preserve();
  const clean={schema:2,collectedAt:'2026-09-09T12:00:00.000Z',tokens:[{host:'Mac',status:'ok',days:[]}],
    settings:[{host:'Ubuntu',status:'not-connected'}],localModel:{host:'Ubuntu',status:'not-connected'}};
  await writeFile(f.file,JSON.stringify(clean));
  await (await retirementSnapshotGuard(f.runtime)).preserve();
  await assert.rejects(lstat(path.dirname(f.archive)),{code:'ENOENT'});
});

test('empty local-model observations retain one exact retirement checkpoint',async t=>{
  for(const localModel of [
    {host:'Ubuntu',status:'ok',records:[],checkedAt:'2026-09-09T11:59:00.000Z'},
    {host:'Ubuntu',status:'unavailable',checkedAt:'2026-09-09T11:58:00.000Z'},
    {host:'Ubuntu',status:'not-connected',checkedAt:'2026-09-09T11:57:00.000Z'}
  ])await t.test(localModel.status,async t=>{
    const f=await retirementFixture(t);
    const bytes=Buffer.from(JSON.stringify({schema:2,collectedAt:'2026-09-09T12:00:00.000Z',
      activityHistory:[],localModel},null,2)+'\r\n');
    await writeFile(f.file,bytes);
    const guard=await retirementSnapshotGuard(f.runtime);
    await guard.preserve();
    const retained=await readFile(f.archive).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    assert.notEqual(retained,null,'An empty observation is evidence, not a bare disconnected placeholder');
    assert.deepEqual(retained,bytes);
    assert.deepEqual(await readFile(f.file),bytes);
    assert.deepEqual(guard.history,[]);
    const receiptBytes=await readFile(f.receipt),receipt=JSON.parse(receiptBytes);
    assert.equal(receipt.collectedAt,'2026-09-09T12:00:00.000Z');
    assert.equal(receipt.bytes,bytes.length);
    assert.equal(receipt.sha256,createHash('sha256').update(bytes).digest('hex'));
    await (await retirementSnapshotGuard(f.runtime)).preserve();
    assert.deepEqual(await readFile(f.archive),bytes);
    assert.deepEqual(await readFile(f.receipt),receiptBytes);
    assert.deepEqual((await readdir(path.dirname(f.archive))).sort(),['retirement-receipt.json','retirement-snapshot.json']);
  });
});

test('each retired evidence channel alone triggers an exact checkpoint',async t=>{
  const original=JSON.parse(retiredBytes);
  for(const channel of ['tokens','settings','localModel'])await t.test(channel,async t=>{
    const f=await retirementFixture(t);
    const bytes=Buffer.from(JSON.stringify({schema:2,collectedAt:original.collectedAt,[channel]:original[channel]},null,4)+'\n');
    await writeFile(f.file,bytes);
    const guard=await retirementSnapshotGuard(f.runtime);
    await guard.preserve();
    assert.deepEqual(await readFile(f.archive),bytes);
    assert.equal(JSON.stringify(guard.history).includes('Ubuntu'),false);
  });
});

test('unsafe or invalid source snapshots never authorize replacement',async t=>{
  for(const kind of ['invalid','oversized','hardlink','linked-parent'])await t.test(kind,async t=>{
    const f=await retirementFixture(t);
    if(kind==='invalid')await writeFile(f.file,'{}');
    if(kind==='oversized')await writeFile(f.file,Buffer.alloc(16_000_001));
    if(kind==='hardlink')await fsPromises.link(f.file,path.join(f.runtime,'source-alias.json'));
    if(kind==='linked-parent') {
      const original=path.join(f.runtime,'original-local');
      await fsPromises.rename(path.dirname(f.file),original);
      await symlink(original,path.dirname(f.file),process.platform==='win32'?'junction':'dir');
    }
    const bytes=await readFile(f.file);
    await assert.rejects(retirementSnapshotGuard(f.runtime));
    assert.deepEqual(await readFile(f.file),bytes);
    await assert.rejects(lstat(f.archive),{code:'ENOENT'});
  });
});

test('archive preserves exact bytes, original timestamp and owner-only permissions',options,async t=>{
  const f=await fixture(t),result=await archiveMacSnapshot(f.file,f.archive);
  assert.equal(await readFile(result.file,'utf8'),f.bytes);
  assert.equal(await readFile(f.file,'utf8'),f.bytes);
  assert.equal(result.collectedAt,'2026-09-01T12:00:00.000Z');
  assert.equal((await lstat(result.file)).mode&0o777,0o600);
  assert.equal((await lstat(path.dirname(result.file))).mode&0o777,0o700);
  const receipt=JSON.parse(await readFile(path.join(path.dirname(result.file),'receipt.json')));
  assert.equal(receipt.sha256,result.sha256);
  assert.equal(receipt.bytes,Buffer.byteLength(f.bytes));
  assert.equal(JSON.parse(await readFile(result.file)).tokens[0].totalTokens,42);
});
test('repeated preparation creates distinct archives without overwriting earlier data',options,async t=>{
  const f=await fixture(t),first=await archiveMacSnapshot(f.file,f.archive);
  const next=await archiveMacSnapshot(f.file,f.archive);
  assert.notEqual(first.file,next.file);assert.equal(first.sha256,next.sha256);
  assert.equal((await readdir(f.archive)).length,2);
});
test('linked snapshot and linked archive root are refused',options,async t=>{
  const f=await fixture(t),link=path.join(f.root,'linked.json'),linkedRoot=path.join(f.root,'linked-root');
  await symlink(f.file,link);await symlink(f.archive,linkedRoot);
  await assert.rejects(archiveMacSnapshot(link,f.archive));
  await assert.rejects(archiveMacSnapshot(f.file,linkedRoot));
  assert.deepEqual(await readdir(f.archive),[]);
});
test('broad archive permissions are refused without rewriting them',options,async t=>{
  const f=await fixture(t);await chmod(f.archive,0o755);
  await assert.rejects(archiveMacSnapshot(f.file,f.archive));
  assert.equal((await lstat(f.archive)).mode&0o777,0o755);
});
test('invalid, oversized and non-file inputs leave no archive',options,async t=>{
  const f=await fixture(t);
  for(const value of ['{}','{"schema":2,"collectedAt":"invalid"}',Buffer.alloc(16_000_001)]) {
    await writeFile(f.file,value);await assert.rejects(archiveMacSnapshot(f.file,f.archive));
  }
  await assert.rejects(archiveMacSnapshot(f.root,f.archive));
  assert.deepEqual(await readdir(f.archive),[]);
});
