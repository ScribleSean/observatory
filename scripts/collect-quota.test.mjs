import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {collectQuota} from './collect-quota.mjs';
const now=Date.parse('2026-09-09T12:00:00Z');
test('collected pace uses retained observations and cannot survive an account switch',async()=>fixture(async runtime=>{
  let result;
  for(let i=0;i<=12;i++) {
    const at=now+i*300000;
    result=await collectQuota(runtime,{enabled:true,clock:()=>at,resolveExecutable:async()=>'/fake/codex',
      readSnapshot:async()=>({scope:'a'.repeat(64),status:'ok',checkedAt:new Date(at).toISOString(),
        windows:[{bucket:'codex',window:'primary',remainingPercent:74-i*2,durationMinutes:300,
          resetsAt:new Date(now+5*3600000).toISOString()}]})});
  }
  assert.equal(result.pace[0].percentagePointsPerHour,24);
  assert.equal(result.pace[0].remainingMinutes,125);
  const switched=await collectQuota(runtime,{enabled:true,clock:()=>now+3900000,resolveExecutable:async()=>'/fake/codex',
    readSnapshot:async()=>({scope:'b'.repeat(64),status:'ok',checkedAt:new Date(now+3900000).toISOString(),
      windows:[{bucket:'codex',window:'primary',remainingPercent:50,durationMinutes:300,
        resetsAt:new Date(now+5*3600000).toISOString()}]})});
  assert.equal(switched.pace[0].status,'insufficient-history');
  assert.equal(switched.history.length,1);
}));
async function fixture(action) {const runtime=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-quota-collection-')));try{await action(runtime);}finally{await rm(runtime,{recursive:true,force:true});}}
test('disabled quota never discovers clients or creates a private store',async()=>fixture(async runtime=>{
  const result=await collectQuota(runtime,{resolveExecutable:()=>{throw Error('Should not run');}});
  assert.equal(result.status,'not-connected');assert.deepEqual(await readdir(runtime),[]);
}));
test('quota collection survives restart, respects cooldown, and excludes account keys',async()=>fixture(async runtime=>{
  let calls=0;
  const options={enabled:true,clock:()=>now,resolveExecutable:async()=>'/fake/codex',readSnapshot:async()=>{
    calls++;return {scope:'a'.repeat(64),status:'ok',checkedAt:new Date(now).toISOString(),
      windows:[{bucket:'codex',window:'primary',remainingPercent:75}],email:'PRIVATE'};
  }};
  const first=await collectQuota(runtime,options);
  const cached=await collectQuota(runtime,options);
  assert.equal(calls,1);assert.equal(first.status,'ok');assert.equal(cached.status,'ok');
  assert.equal(first.pace[0].status,'insufficient-history');
  assert.equal(cached.checkedAt,first.checkedAt);
  assert.deepEqual(cached.history,first.history);
  assert.equal(cached.history.length,1);assert.equal(cached.scope,'account');
  assert.equal(JSON.stringify(cached).includes('aaaaaa'),false);assert.equal(JSON.stringify(cached).includes('PRIVATE'),false);
  await collectQuota(runtime,{enabled:false,clock:()=>now});
  const reenabled=await collectQuota(runtime,{...options,readSnapshot:async()=>{throw Error('Offline');}});
  assert.equal(reenabled.status,'unavailable');assert.deepEqual(reenabled.history,[]);
  assert.equal(reenabled.latestReadStatus,'waiting');assert.equal(calls,1);
  assert.equal(reenabled.nextAttemptAt,first.nextAttemptAt);
}));
test('successful cached samples age out and failed polls remain stale even with recent history',async()=>fixture(async runtime=>{
  const options={enabled:true,clock:()=>now,resolveExecutable:async()=>'/fake/codex',readSnapshot:async()=>({
    scope:'a'.repeat(64),status:'ok',checkedAt:new Date(now-600000).toISOString(),
    windows:[{bucket:'codex',window:'primary',remainingPercent:75}]})};
  const old=await collectQuota(runtime,options);
  assert.equal(old.status,'stale');assert.equal(old.latestReadStatus,'ok');
  assert.equal(old.pace[0].status,'stale');
  assert.equal(old.checkedAt,new Date(now-600000).toISOString());
  const fresh=await collectQuota(runtime,{...options,clock:()=>now+300001,readSnapshot:async()=>({
    scope:'a'.repeat(64),status:'ok',checkedAt:new Date(now+300001).toISOString(),
    windows:[{bucket:'codex',window:'primary',remainingPercent:70}]})});
  assert.equal(fresh.status,'ok');
  const failed=await collectQuota(runtime,{...options,clock:()=>now+600002,readSnapshot:async()=>{throw Error('Offline');}});
  assert.equal(failed.status,'stale');assert.equal(failed.latestReadStatus,'unavailable');
  assert.equal(failed.checkedAt,fresh.checkedAt);
  assert.deepEqual(failed.history,fresh.history);
}));
test('failed reads persist retry deadlines without inventing usage',async()=>fixture(async runtime=>{
  let calls=0;
  const options={enabled:true,clock:()=>now,resolveExecutable:async()=>'/fake/codex',readSnapshot:async()=>{calls++;throw Object.assign(Error('PRIVATE'),{status:'rate-limited'});}};
  const result=await collectQuota(runtime,options);
  await collectQuota(runtime,options);
  assert.equal(calls,1);assert.equal(result.latestReadStatus,'rate-limited');assert.deepEqual(result.windows,[]);
  assert.ok(Date.parse(result.nextAttemptAt)>now);assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
}));
test('disabling while a read is in flight discards the returned account data',async()=>fixture(async runtime=>{
  const result=await collectQuota(runtime,{enabled:true,isEnabled:async()=>false,clock:()=>now,resolveExecutable:async()=>'/fake/codex',
    readSnapshot:async()=>({scope:'a'.repeat(64),status:'ok',checkedAt:new Date(now).toISOString(),windows:[{bucket:'codex',window:'primary',remainingPercent:75}]})});
  assert.equal(result.status,'not-connected');assert.deepEqual(result.history,[]);
}));
test('a newly observed account clears the prior account history even if its quota request fails',async()=>fixture(async runtime=>{
  await collectQuota(runtime,{enabled:true,clock:()=>now,resolveExecutable:async()=>'/fake/codex',
    readSnapshot:async()=>({scope:'a'.repeat(64),status:'ok',checkedAt:new Date(now).toISOString(),
      windows:[{bucket:'codex',window:'primary',remainingPercent:75}],
      accountUsage:{status:'ok',checkedAt:new Date(now).toISOString(),dailyUsageBuckets:[{startDate:'2026-09-09',tokens:12}]}})});
  const result=await collectQuota(runtime,{enabled:true,clock:()=>now+300001,resolveExecutable:async()=>'/fake/codex',
    readSnapshot:async()=>{throw Object.assign(Error('PRIVATE'),{scope:'b'.repeat(64),status:'rate-limited'});}});
  assert.deepEqual(result.windows,[]);
  assert.deepEqual(result.history,[]);
  assert.deepEqual(result.dailyUsageBuckets,[]);
  assert.equal(result.latestReadStatus,'rate-limited');
  assert.equal(result.scope,'account');
  assert.equal(JSON.stringify(result).includes('bbbbbb'),false);
}));
