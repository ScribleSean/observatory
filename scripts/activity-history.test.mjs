import {test} from 'node:test';
import assert from 'node:assert/strict';
import {retainActivityHistory,previousActivityHistory,activityTrackingHealth} from './activity-history.mjs';
import {mkdtemp,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const day=(date,seconds)=>({date,seconds,hours:Array(24).fill(seconds/24),categories:{Editors:seconds},apps:{Editors:{'VS Code':seconds}},trackedSeconds:seconds,trackedHours:Array(24).fill(seconds/24)});
const source=(host,start,end,days)=>({host,status:'ok',start,end,days});
const at='2026-09-08T16:00:00Z';
test('freshness measures tracking coverage rather than activity or read success',()=>{
  const healthy={host:'Mac',status:'ok',trackingThrough:'2026-09-08T15:50:00Z'};
  assert.equal(activityTrackingHealth(healthy,at).trackingStatus,'recent');
  assert.equal(activityTrackingHealth({...healthy,trackingThrough:'2026-09-08T15:49:59Z'},at).trackingStatus,'stale');
  for(const input of [{...healthy,status:'unavailable'},{status:'ok'},
    {...healthy,trackingThrough:'invalid'},{...healthy,trackingThrough:'2026-09-08T16:01:00Z'}]) {
    assert.equal(activityTrackingHealth(input,at).trackingStatus,'unknown');
  }
  assert.match(activityTrackingHealth({...healthy,host:'Combined'},at).trackingMessage,/does not verify every device/);
});
test('stale tracking retains measured days and cannot reuse a previous healthy status on read failure',()=>{
  const raw={...source('Mac','2026-09-01T12:00Z',at,[day('2026-09-08',300)]),trackingThrough:'2026-09-08T12:00:00Z'};
  const prior=retainActivityHistory([],[raw],at);
  assert.equal(prior.find(r=>r.host==='Mac').trackingStatus,'stale');
  assert.equal(prior.find(r=>r.host==='Mac').days[0].seconds,300);
  const failed=retainActivityHistory(prior,[{host:'Mac',status:'unavailable'}],at).find(r=>r.host==='Mac');
  assert.equal(failed.trackingStatus,'unknown');
  assert.equal(failed.trackingThrough,null);
  assert.equal(failed.days[0].seconds,300);
});
test('complete days survive truncated rolling-window boundary reads',()=>{
  const prior=retainActivityHistory([], [source('Mac','2026-09-01T12:00Z',at,[day('2026-09-02',300)])],at);
  const next=retainActivityHistory(prior,[source('Mac','2026-09-02T13:00Z',at,[day('2026-09-02',100)])],at);
  assert.equal(next.find(r=>r.host==='Mac').days[0].seconds,300);
});
test('broader reads replace partial days and repeated reads never add totals',()=>{
  let prior=retainActivityHistory([],[source('Mac','2026-09-01T12:00Z',at,[day('2026-09-01',100),day('2026-09-08',100)])],at);
  const current=[source('Mac','2026-08-31T12:00Z','2026-09-08T17:00Z',[day('2026-09-01',300),day('2026-09-08',200)])];
  const next=retainActivityHistory(prior,current,at);
  assert.deepEqual(next.find(r=>r.host==='Mac').days.map(r=>r.seconds),[300,200]);
  assert.deepEqual(retainActivityHistory(next,current,at),next);
});
test('failed sources preserve history without inventing a combined sum',()=>{
  const sources=['Mac','Windows','Combined'].map(host=>source(host,'2026-09-01T12:00Z',at,[day('2026-09-02',host==='Combined'?400:300)]));
  const prior=retainActivityHistory([],sources,at);
  const next=retainActivityHistory(prior,sources.map(r=>({host:r.host,status:'unavailable'})),at);
  assert.equal(next.find(r=>r.host==='Combined').days[0].seconds,400);
  assert.equal(next.find(r=>r.host==='Combined').latestReadStatus,'unavailable');
  assert.equal(next.find(r=>r.host==='Combined').asOf,new Date(at).toISOString());
});
test('retention is bounded, sorted and strips unexpected fields',()=>{
  const raw={...day('2026-09-02',100),title:'PRIVATE',categories:{Editors:100,PRIVATE:5},apps:{Editors:{'VS Code':100,PRIVATE:5}}};
  const result=retainActivityHistory([],[source('Mac','2026-09-01T12:00Z',at,[day('2026-09-04',100),raw,day('2026-09-03',100)])],at,2);
  assert.deepEqual(result.find(r=>r.host==='Mac').days.map(r=>r.date),['2026-09-03','2026-09-04']);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  const kept=retainActivityHistory([],[source('Mac','2026-09-01T12:00Z',at,[raw])],at);
  assert.equal(kept.find(r=>r.host==='Mac').days.length,1);
  assert.ok(!JSON.stringify(kept).includes('PRIVATE'));
});
test('previous snapshot migration and safe file boundaries',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'activity-history-'));
  try {
    const file=path.join(dir,'usage.json');
    assert.deepEqual(await previousActivityHistory(file),[]);
    await writeFile(file,JSON.stringify({collectedAt:at,activity:[source('Mac','2026-09-01T12:00Z',at,[day('2026-09-02',300)])]}));
    const migrated=await previousActivityHistory(file);
    assert.equal(migrated.find(r=>r.host==='Mac').days[0].seconds,300);
    await writeFile(file,JSON.stringify({activityHistory:migrated}));
    assert.deepEqual(await previousActivityHistory(file),migrated);
    const link=path.join(dir,'link.json');
    await symlink(file,link);
    await assert.rejects(previousActivityHistory(link));
    await assert.rejects(previousActivityHistory(dir));
    await writeFile(file,'malformed');
    await assert.rejects(previousActivityHistory(file));
  } finally {await rm(dir,{recursive:true,force:true});}
});
