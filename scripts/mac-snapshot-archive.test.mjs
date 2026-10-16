import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,writeFile,readFile,mkdir,lstat,symlink,readdir,rm,chmod,unlink} from 'node:fs/promises';
import fsPromises from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {testRuntimeBase} from './test-runtime-base.mjs';
import path from 'node:path';
import {archiveMacSnapshot,retirementSnapshotGuard} from './mac-snapshot-archive.mjs';

const runtimeBase=await testRuntimeBase('mac-snapshot-archive');
after(()=>rm(runtimeBase,{recursive:true,force:true}));
const options={skip:process.platform!=='darwin'};
async function fixture(t) {
  const root=await realpath(await mkdtemp(path.join(runtimeBase,'observatory-snapshot-archive-')));
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
  const runtime=await realpath(await mkdtemp(path.join(runtimeBase,'observatory-retirement-snapshot-')));
  t.after(()=>rm(runtime,{recursive:true,force:true}));
  const file=path.join(runtime,'public/local/usage.json');
  await mkdir(path.dirname(file),{recursive:true,mode:0o700});
  await writeFile(file,retiredBytes,{mode:0o600});
  const config=JSON.stringify({activity:false,codex:false,wispr:false,quota:false,claude:false,
    receipts:false,benchmarks:false,...(process.platform==='win32'?{wslDistribution:'Ubuntu'}:{})});
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
test('a zero-filled or empty snapshot counts as a first collection while other damage still fails closed',async t=>{
  for(const bytes of [Buffer.alloc(0),Buffer.alloc(4096)]) {
    const f=await retirementFixture(t);
    await writeFile(f.file,bytes);
    const guard=await retirementSnapshotGuard(f.runtime);
    assert.deepEqual(guard.history,[]);
    await guard.preserve();
    assert.deepEqual(await readFile(f.file),bytes);
    await assert.rejects(readFile(f.archive),{code:'ENOENT'});
    // A snapshot that appears while collecting must still stop the replacement.
    const racing=await retirementSnapshotGuard(f.runtime);
    await writeFile(f.file,retiredBytes);
    await assert.rejects(racing.preserve(),/Snapshot changed during collection/);
  }
  for(const bytes of ['{',' ',Buffer.concat([Buffer.alloc(16),Buffer.from('{}')])]) {
    const f=await retirementFixture(t);
    await writeFile(f.file,bytes);
    await assert.rejects(retirementSnapshotGuard(f.runtime));
  }
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

test('a source changed during the final unchanged check refuses replacement',async t=>{
  const f=await retirementFixture(t),guard=await retirementSnapshotGuard(f.runtime),originalOpen=fsPromises.open;
  const changed=Buffer.from(retiredBytes.toString().replace('42','43'));
  let reads=0;
  fsPromises.open=async(file,...args)=>{
    if(file===f.file && ++reads===2)await writeFile(f.file,changed);
    return originalOpen(file,...args);
  };
  syncBuiltinESMExports();
  try {await assert.rejects(guard.preserve(),/Changing snapshot/);}
  finally {fsPromises.open=originalOpen;syncBuiltinESMExports();}
  assert.deepEqual(await readFile(f.file),changed);
});

test('a stale temporary-file alias cannot overwrite evidence before the archive guard',nativeOptions,async t=>{
  const f=await retirementFixture(t);
  // The limits reader is the last step before the snapshot is written, so it stands in for anything that runs then.
  await assert.rejects(nativeCollect(f,{readLimits:async()=>{
    await fsPromises.link(f.file,f.file+'.tmp');
    return {provider:'Claude Code',scope:'account',status:'not-connected',windows:[]};
  }}));
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

test('saved localModel loads for history and full collection leaves leftover checkpoints unchanged',nativeOptions,async t=>{
  const f=await retirementFixture(t),saved=JSON.parse(retiredBytes);
  const day={date:'2026-09-09',seconds:12,hours:[12,...Array(23).fill(0)],categories:{},apps:{},windowStart:null,windowEnd:null};
  saved.activityHistory=[{host:'Mac',status:'ok',asOf:saved.collectedAt,days:[day]}];
  await writeFile(f.file,JSON.stringify(saved));
  await mkdir(path.dirname(f.archive),{recursive:true,mode:0o700});
  const checkpoints=[Buffer.from('{fictional incomplete snapshot'),Buffer.from('{"fictional":"conflicting receipt"}\r\n')];
  await writeFile(f.archive,checkpoints[0]);await writeFile(f.receipt,checkpoints[1]);
  const guard=await retirementSnapshotGuard(f.runtime);
  assert.deepEqual(guard.history,saved.activityHistory);
  await guard.preserve();
  await nativeCollect(f);
  const next=JSON.parse(await readFile(f.file,'utf8'));
  assert.equal(Object.hasOwn(next,'localModel'),false);
  assert.deepEqual(next.activityHistory.find(row=>row.host==='Mac').days,[day]);
  assert.deepEqual(await readFile(f.archive),checkpoints[0]);
  assert.deepEqual(await readFile(f.receipt),checkpoints[1]);
});

test('a failed final rename preserves the snapshot and a retry publishes a new snapshot',nativeOptions,async t=>{
  const f=await retirementFixture(t),before=await lstat(f.file,{bigint:true}),originalRename=fsPromises.rename;
  let failed=false;
  fsPromises.rename=async(from,to)=>{
    if(to===f.file && !failed) {
      failed=true;
      throw Object.assign(Error('Synthetic final rename failure'),{code:'EIO'});
    }
    return originalRename(from,to);
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(nativeCollect(f),{code:'EIO',message:'Synthetic final rename failure'});
    assert.equal(failed,true);
    assert.deepEqual(await readFile(f.file),retiredBytes);
    const after=await lstat(f.file,{bigint:true});
    for(const key of ['dev','ino','size','mtimeNs'])assert.equal(after[key],before[key]);
    assert.deepEqual((await readdir(path.dirname(f.file))).sort(),['collector.json','usage.json']);
    await nativeCollect(f);
    const next=await readFile(f.file);
    assert.notDeepEqual(next,retiredBytes);
    assert.equal(JSON.parse(next).schema,2);
    assert.notEqual(JSON.parse(next).collectedAt,JSON.parse(retiredBytes).collectedAt);
    assert.deepEqual((await readdir(path.dirname(f.file))).sort(),['collector.json','usage.json']);
  } finally {fsPromises.rename=originalRename;syncBuiltinESMExports();}
});

for(const damage of ['snapshot broad permissions','snapshot hardlink'])
  test(`archive preparation refuses ${damage} after snapshot publication`,options,async t=>{
    const f=await fixture(t),originalOpen=fsPromises.open;
    let injected=false;
    fsPromises.open=async(file,...args)=>{
      const handle=await originalOpen(file,...args);
      if(path.basename(file)==='snapshot.json' && args[0]==='wx') {
        const close=handle.close.bind(handle);
        handle.close=async()=>{
          await close();
          if(damage==='snapshot broad permissions')await chmod(file,0o640);
          if(damage==='snapshot hardlink')await fsPromises.link(file,path.join(f.root,'archive-alias.json'));
          injected=true;
        };
      }
      return handle;
    };
    syncBuiltinESMExports();
    try {
      await assert.rejects(archiveMacSnapshot(f.file,f.archive),/Invalid snapshot file/);
      assert.equal(injected,true);
    } finally {fsPromises.open=originalOpen;syncBuiltinESMExports();}
    assert.equal(await readFile(f.file,'utf8'),f.bytes);
  });

for(const damage of ['snapshot overwrite','receipt EIO','snapshot hardlink','receipt mismatch','snapshot broad permissions'])
  test(`archive preparation refuses ${damage} during receipt publication`,options,async t=>{
    const f=await fixture(t),originalOpen=fsPromises.open;
    let injected=false;
    fsPromises.open=async(file,...args)=>{
      if(path.basename(file)==='receipt.json' && args[0]==='wx') {
        injected=true;
        const snapshot=path.join(path.dirname(file),'snapshot.json');
        if(damage==='snapshot overwrite')await writeFile(snapshot,f.bytes.replace('42','43'));
        if(damage==='receipt EIO')throw Object.assign(Error('Synthetic receipt failure'),{code:'EIO'});
        if(damage==='snapshot hardlink')await fsPromises.link(snapshot,path.join(f.root,'archive-alias.json'));
        if(damage==='snapshot broad permissions')await chmod(snapshot,0o640);
        if(damage==='receipt mismatch') {
          const handle=await originalOpen(file,...args),write=handle.writeFile.bind(handle);
          handle.writeFile=async bytes=>write(JSON.stringify({...JSON.parse(bytes),bytes:0})+'\n');
          return handle;
        }
      }
      return originalOpen(file,...args);
    };
    syncBuiltinESMExports();
    try {
      const error=damage==='receipt EIO'?{code:'EIO',message:'Synthetic receipt failure'}:
        damage==='receipt mismatch'?/Archive receipt verification failed/:
        damage==='snapshot overwrite'?/Archive changed during verification/:
        // The private-file ACL check runs first and refuses a linked or broad file before the byte read.
        /Private path access-control verification failed|Invalid snapshot file/;
      await assert.rejects(archiveMacSnapshot(f.file,f.archive),error);
      assert.equal(injected,true);
    } finally {fsPromises.open=originalOpen;syncBuiltinESMExports();}
    assert.equal(await readFile(f.file,'utf8'),f.bytes);
  });
