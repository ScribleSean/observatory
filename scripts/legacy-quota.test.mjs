import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {collectLegacyQuota,collectConfiguredMacQuota} from './legacy-quota.mjs';

async function fixture(run) {
  const runtime=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-legacy-quota-')));
  const config=path.join(runtime,'local.config.json');
  try {await run(runtime,async value=>writeFile(config,JSON.stringify(value)),config);}
  finally {await rm(runtime,{recursive:true,force:true});}
}
const start=Date.parse('2026-09-12T12:00:00Z');
test('legacy selection retains successive actual readings and respects restart deadlines',()=>fixture(async(runtime,save,file)=>{
  await save({codexExecutable:'/explicit/client',unrelated:'preserve'});
  const before=await readFile(file,'utf8');
  let at=start,calls=0;
  const options={clock:()=>at,readSnapshot:async executable=>{
    assert.equal(executable,'/explicit/client');calls++;
    return {status:'ok',scope:'a'.repeat(64),checkedAt:new Date(at).toISOString(),
      windows:[{bucket:'codex',window:'primary',remainingPercent:90-calls}]};
  }};
  await collectLegacyQuota(runtime,options);
  assert.equal((await collectLegacyQuota(runtime,options)).history.length,1);
  assert.equal(calls,1);
  at+=300001;
  const result=await collectLegacyQuota(runtime,options);
  assert.equal(result.history.length,2);assert.equal(calls,2);
  assert.deepEqual(result.history.map(row=>row.windows[0].remainingPercent),[89,88]);
  assert.equal(await readFile(file,'utf8'),before);
  assert.equal(JSON.stringify(result).includes('aaaaaa'),false);
}));
test('legacy quota disabled does not create a store or read a client',()=>fixture(async(runtime,save)=>{
  await save({});
  assert.equal((await collectLegacyQuota(runtime,{readSnapshot:()=>{throw Error('Unexpected read');}})).status,'not-connected');
  assert.deepEqual(await readdir(runtime),['local.config.json']);
}));
test('changing the configured client during a read discards the result',()=>fixture(async(runtime,save)=>{
  await save({codexExecutable:'/first/client'});
  const result=await collectLegacyQuota(runtime,{clock:()=>start,readSnapshot:async()=>{
    await save({codexExecutable:'/second/client'});
    return {status:'ok',scope:'a'.repeat(64),checkedAt:new Date(start).toISOString(),
      windows:[{bucket:'codex',window:'primary',remainingPercent:90}]};
  }});
  assert.equal(result.status,'not-connected');assert.deepEqual(result.history,[]);
}));
test('invalid legacy configuration fails without silently finding another account',()=>fixture(async(runtime,save)=>{
  await save({codexExecutable:'relative/client'});
  await assert.rejects(collectLegacyQuota(runtime,{readSnapshot:()=>{throw Error('Unexpected read');}}),/Invalid configured/);
  assert.deepEqual(await readdir(runtime),['local.config.json']);
}));
test('native migration retains explicit client and does not discover a replacement',()=>fixture(async(runtime,save,file)=>{
  await save({codexExecutable:'/selected/client'});
  const before=await readFile(file,'utf8');
  const result=await collectConfiguredMacQuota(runtime,{enabled:true,clock:()=>start,
    resolveExecutable:()=>{throw Error('Must not discover');},readSnapshot:async executable=>{
      assert.equal(executable,'/selected/client');return {status:'ok',scope:'a'.repeat(64),checkedAt:new Date(start).toISOString(),windows:[{bucket:'codex',window:'primary',remainingPercent:80}]};
    }});
  assert.equal(result.status,'ok');assert.equal(await readFile(file,'utf8'),before);
}));
test('native workflow source settings do not implicitly enable an unselected legacy account',()=>fixture(async(runtime,save)=>{
  await save({receiptDirectory:'/receipts'});
  const fail=()=>{throw Error('Unexpected client access');};
  const result=await collectConfiguredMacQuota(runtime,{enabled:true,resolveExecutable:fail,readSnapshot:fail});
  assert.equal(result.status,'not-connected');assert.deepEqual(await readdir(runtime),['local.config.json']);
}));
test('native quota opt-out bypasses malformed legacy config without starting a client',()=>fixture(async(runtime,save)=>{
  await save({codexExecutable:42});
  const result=await collectConfiguredMacQuota(runtime,{enabled:false,readSnapshot:()=>{throw Error('Unexpected client access');}});
  assert.equal(result.status,'not-connected');
  await assert.rejects(collectConfiguredMacQuota(runtime,{enabled:true}),/Invalid configured/);
}));
test('native opt-out during legacy read discards the response',()=>fixture(async(runtime,save)=>{
  await save({codexExecutable:'/selected/client'});
  const result=await collectConfiguredMacQuota(runtime,{enabled:true,clock:()=>start,isEnabled:async()=>false,
    readSnapshot:async()=>({status:'ok',scope:'a'.repeat(64),checkedAt:new Date(start).toISOString(),windows:[{bucket:'codex',window:'primary',remainingPercent:80}]})});
  assert.equal(result.status,'not-connected');assert.deepEqual(result.history,[]);
}));
test('fresh native installation may use installed-client discovery when explicitly enabled',()=>fixture(async runtime=>{
  let calls=0;
  const result=await collectConfiguredMacQuota(runtime,{enabled:true,clock:()=>start,resolveExecutable:async()=>{calls++;return '/installed/client';},
    readSnapshot:async executable=>{
      assert.equal(executable,'/installed/client');return {status:'ok',scope:'a'.repeat(64),checkedAt:new Date(start).toISOString(),windows:[{bucket:'codex',window:'primary',remainingPercent:80}]};
    }});
  assert.equal(calls,1);assert.equal(result.status,'ok');
}));
