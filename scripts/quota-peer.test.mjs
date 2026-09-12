import test from 'node:test';
import assert from 'node:assert/strict';
import {createSharedQuota,parseSharedQuota,sharedQuotaLimits} from './quota-peer.mjs';

const now=Date.parse('2026-09-12T12:00:00.000Z');
const options={enabled:true,host:'Mac',generation:'a'.repeat(32),now};
const window={bucket:'codex',window:'primary',remainingPercent:60,durationMinutes:300,resetsAt:'2026-09-12T15:00:00.000Z'};
const fixture=()=>({status:'ok',checkedAt:new Date(now).toISOString(),history:[{checkedAt:new Date(now).toISOString(),windows:[{...window}]}],
  accountUsageCheckedAt:new Date(now).toISOString(),dailyUsageBuckets:[{startDate:'2026-09-12',tokens:100}]});

test('quota sharing is off by default and does not inspect readings',()=>{
  const raw=new Proxy({}, {get(){throw Error('Read without consent');}});
  assert.equal(createSharedQuota(raw),null);
  assert.throws(()=>parseSharedQuota('{}'));
});
test('outbound quota strips private fields and canonical inbound round-trips',()=>{
  const raw=fixture(); raw.email='private';raw.scope='secret';raw.salt='secret';raw.credentials='secret';
  raw.history[0].windows[0].accountId='private';raw.dailyUsageBuckets[0].title='private';
  const safe=createSharedQuota(raw,options),text=JSON.stringify(safe);
  assert.ok(!text.includes('private') && !text.includes('secret'));
  assert.deepEqual(parseSharedQuota(text,options),safe);
  assert.throws(()=>parseSharedQuota(JSON.stringify({...safe,email:'private'}),options));
  assert.throws(()=>parseSharedQuota(text,{...options,host:'Windows'}));
  assert.throws(()=>parseSharedQuota(text,{...options,generation:'b'.repeat(32)}));
});
test('retired and arbitrary account labels are not shared',()=>{
  const raw=fixture();raw.history[0].windows.push({...window,bucket:'spark'},{...window,bucket:'private-account'});
  assert.deepEqual(createSharedQuota(raw,options).history[0].windows,[window]);
  raw.history[0].windows=[{...window,bucket:'spark'}];
  assert.deepEqual(createSharedQuota(raw,options).history,[]);
});
test('conflicting windows and daily totals without provenance are rejected',()=>{
  let raw=fixture();raw.history[0].windows.push({...window,remainingPercent:25});
  assert.throws(()=>createSharedQuota(raw,options));
  raw=fixture();raw.history[0].windows.push({...window});
  assert.equal(createSharedQuota(raw,options).history[0].windows.length,1);
  raw=fixture();delete raw.accountUsageCheckedAt;
  assert.throws(()=>createSharedQuota(raw,options));
  raw=fixture();raw.history[0].windows[0].remainingPercent=101;
  assert.throws(()=>createSharedQuota(raw,options));
});
test('disabled and failed authentication discard old readings',()=>{
  for(const status of ['not-connected','needs-auth','unsupported']) {
    const safe=createSharedQuota({...fixture(),status},options);
    assert.equal(safe.checkedAt,null);assert.deepEqual(safe.history,[]);assert.deepEqual(safe.dailyUsageBuckets,[]);
    assert.deepEqual(parseSharedQuota(JSON.stringify(safe),options),safe);
  }
});
test('conflicting, future and malformed observations fail closed',()=>{
  let raw=fixture();raw.history.push({...raw.history[0],windows:[{...window,remainingPercent:20}]});
  assert.throws(()=>createSharedQuota(raw,options));
  raw=fixture();raw.checkedAt=new Date(now+1).toISOString();assert.throws(()=>createSharedQuota(raw,options));
  raw=fixture();raw.dailyUsageBuckets[0].tokens=-1;assert.throws(()=>createSharedQuota(raw,options));
  raw=fixture();raw.dailyUsageBuckets[0].startDate='2026-02-30';assert.throws(()=>createSharedQuota(raw,options));
  assert.throws(()=>parseSharedQuota(' '.repeat(sharedQuotaLimits.bytes+1),options));
});
test('old quota observations expire and duplicate snapshots never add totals',()=>{
  const raw=fixture();raw.history.unshift({checkedAt:new Date(now-86400001).toISOString(),windows:[window]});
  raw.history.push(raw.history[1]);raw.dailyUsageBuckets.push(raw.dailyUsageBuckets[0]);
  const safe=createSharedQuota(raw,options);
  assert.equal(safe.history.length,1);assert.equal(safe.dailyUsageBuckets.length,1);
  assert.equal(safe.dailyUsageBuckets[0].tokens,100);
});
