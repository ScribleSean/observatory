import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,realpath,writeFile,readFile,rm,symlink,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {refreshAllowances} from './refresh-allowances.mjs';

async function fixture(action) {
  const root=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-allowance-refresh-')));
  try {await mkdir(path.join(root,'public/local'),{recursive:true});await action(root,path.join(root,'public/local/usage.json'));}
  finally {await rm(root,{recursive:true,force:true});}
}
const saved=()=>({schema:2,collectedAt:'2026-09-13T12:00:00Z',activity:[{seconds:12}],tokens:[{totalTokens:34}],dictation:[{words:56}],
  peer:{status:'stale'},quota:{status:'stale'},peerQuota:{status:'stale'},futureField:{preserved:true}});
test('allowance-only refresh preserves all unrelated data and its collection time',()=>fixture(async(root,file)=>{
  const before=saved();await writeFile(file,JSON.stringify(before));
  await writeFile(path.join(root,'public/local/collector.json'),'heavy status unchanged');
  const quota={status:'ok',checkedAt:'2026-09-13T12:05:00Z',windows:[]};
  await refreshAllowances(root,{enabled:true,readQuota:async()=>quota,sync:async(runtime,result,{enabled})=>{
    assert.equal(runtime,root);assert.equal(enabled,true);result.data.peerQuota=null;
  }});
  const after=JSON.parse(await readFile(file,'utf8'));
  assert.deepEqual(after,{...before,quota,peerQuota:null});
  assert.equal(await readFile(path.join(root,'public/local/collector.json'),'utf8'),'heavy status unchanged');
  assert.deepEqual((await readdir(path.dirname(file))).sort(),['collector.json','usage.json']);
}));
test('missing snapshot asks for full collection without reading a provider',()=>fixture(async(root)=>{
  assert.deepEqual(await refreshAllowances(root,{enabled:true,readQuota:()=>{throw Error('Must not read');}}),{needsFullCollection:true});
}));
test('read failure preserves original snapshot and creates no partial output',()=>fixture(async(root,file)=>{
  const before=JSON.stringify(saved());await writeFile(file,before);
  await assert.rejects(refreshAllowances(root,{enabled:true,readQuota:async()=>{throw Error('Read failed');}}),/Read failed/);
  assert.equal(await readFile(file,'utf8'),before);
  assert.deepEqual(await readdir(path.dirname(file)),['usage.json']);
}));
test('an external snapshot change is never overwritten by a slow allowance read',()=>fixture(async(root,file)=>{
  await writeFile(file,JSON.stringify(saved()));
  const other=JSON.stringify({...saved(),collectedAt:'2026-09-13T12:06:00Z'});
  await assert.rejects(refreshAllowances(root,{enabled:false,readQuota:async()=>{await writeFile(file,other);return {status:'not-connected'};},
    sync:async()=>{}}),/Snapshot changed/);
  assert.equal(await readFile(file,'utf8'),other);
}));
test('malformed snapshots fail before provider access',()=>fixture(async(root,file)=>{
  for(const value of ['not json','null',JSON.stringify({schema:2,collectedAt:'invalid'})]) {
    await writeFile(file,value);
    await assert.rejects(refreshAllowances(root,{enabled:true,readQuota:()=>{assert.fail('Must not read');}}));
    assert.equal(await readFile(file,'utf8'),value);
  }
}));
test('linked snapshot is refused without touching its target',{skip:process.platform==='win32'},()=>fixture(async(root,file)=>{
  const target=path.join(root,'other.json');await writeFile(target,JSON.stringify(saved()));await symlink(target,file);
  await assert.rejects(refreshAllowances(root,{enabled:true,readQuota:()=>{assert.fail('Must not read');}}),/Unsafe/);
  assert.deepEqual(JSON.parse(await readFile(target,'utf8')),saved());
}));
test('platform collector quota-only entry preserves unrelated saved records',{skip:!['darwin','win32'].includes(process.platform)},()=>fixture(async(root,file)=>{
  const before=saved();await writeFile(file,JSON.stringify(before));
  await writeFile(path.join(root,'collector.config.json'),JSON.stringify({activity:false,codex:false,wispr:false,quota:false}));
  if(process.platform==='darwin') {
    const {collectMac}=await import('./collect-mac.mjs');
    await collectMac(root,'/synthetic-python-never-used',null,{quotaOnly:true});
  } else {
    const {collectWindows}=await import('./collect-windows.mjs');
    await collectWindows(root,null,{quotaOnly:true});
  }
  const after=JSON.parse(await readFile(file,'utf8'));
  assert.equal(after.quota.status,'not-connected');assert.equal(after.peerQuota,null);
  delete after.quota;delete after.peerQuota;delete before.quota;delete before.peerQuota;
  assert.deepEqual(after,before);
  assert.deepEqual(await readdir(path.dirname(file)),['usage.json']);
}));
