import test from 'node:test';
import assert from 'node:assert/strict';
import {retainQuotaHistory,quotaRetention} from './quota-history.mjs';
const scope='a'.repeat(64),now=Date.parse('2026-09-09T12:00:00Z');
const options={scope,now};
const reading=(offset=0,remainingPercent=75,resetsAt='2026-09-09T16:00:00Z')=>({status:'ok',checkedAt:new Date(now+offset).toISOString(),
  windows:[{bucket:'codex',window:'primary',remainingPercent,durationMinutes:300,resetsAt}],
  accountUsage:{status:'ok',dailyUsageBuckets:[{startDate:'2026-09-09',tokens:123}]}});
test('history persists safe observations, replaces duplicate readings and omits private fields',()=>{
  const raw={...reading(),email:'PRIVATE',windows:[{...reading().windows[0],secret:'PRIVATE'}]};
  let history=retainQuotaHistory(null,raw,options);
  history=retainQuotaHistory(JSON.parse(JSON.stringify(history)),reading(),options);
  assert.equal(history.samples.length,1);
  assert.equal(history.dailyUsageBuckets[0].tokens,123);
  assert.equal(JSON.stringify(history).includes('PRIVATE'),false);
});
test('offline readings remain stale with original timestamp and no fabricated samples',()=>{
  const history=retainQuotaHistory(null,reading(),options);
  const next=retainQuotaHistory(history,{status:'rate-limited'},{scope,now:now+300000});
  assert.equal(next.status,'stale');assert.equal(next.asOf,history.asOf);
  assert.deepEqual(next.samples,history.samples);
});
test('retired allowance windows are removed when saved history is reopened',()=>{
  const old={...reading(),windows:[...reading().windows,
    {bucket:'codex_bengalfox',window:'primary',remainingPercent:100},
    {bucket:'spark',window:'primary',remainingPercent:50}]};
  const previous={version:1,scope,samples:[old]};
  const restored=retainQuotaHistory(previous,{status:'unavailable'},options);
  assert.deepEqual(restored.samples[0].windows.map(row=>row.bucket),['codex']);
});
test('account switches, sign-out and disabling cannot reveal previous readings',()=>{
  const history=retainQuotaHistory(null,reading(),options);
  for(const status of ['needs-auth','unsupported']) {
    const next=retainQuotaHistory(history,{status},options);
    assert.equal(next.status,status);assert.deepEqual(next.samples,[]);assert.deepEqual(next.dailyUsageBuckets,[]);
  }
  assert.deepEqual(retainQuotaHistory(history,{}, {...options,scope:'b'.repeat(64)}).samples,[]);
  const disabled=retainQuotaHistory(history,reading(),{enabled:false,now});
  assert.equal(disabled.status,'not-connected');assert.equal(disabled.scope,null);
  assert.deepEqual(disabled.samples,[]);assert.deepEqual(disabled.dailyUsageBuckets,[]);
});
test('retention drops old and future samples, while a missing daily bucket is not zero',()=>{
  let history=retainQuotaHistory(null,reading(-31*86400000),options);
  assert.deepEqual(history.samples,[]);
  history=retainQuotaHistory(null,reading(1),options);
  assert.deepEqual(history.samples,[]);
  assert.deepEqual(history.dailyUsageBuckets,[]);
  assert.throws(()=>retainQuotaHistory(null,reading(),{scope:'email@example.com',now}));
});
test('dense multi-bucket history remains below its byte budget',()=>{
  const windows=Array.from({length:32},(_,index)=>({bucket:'x'.repeat(78)+String(index).padStart(2,'0'),window:'primary',remainingPercent:75,
    durationMinutes:300,resetsAt:'2026-09-09T16:00:00Z'}));
  const samples=Array.from({length:2000},(_,index)=>({checkedAt:new Date(now-2000+index).toISOString(),windows}));
  const history=retainQuotaHistory({version:1,scope,samples},{status:'unavailable'},options);
  assert.ok(history.samples.length<samples.length);assert.ok(history.samples.length>0);
  assert.ok(Buffer.byteLength(JSON.stringify(history.samples))<=quotaRetention.maxSampleBytes);
});
