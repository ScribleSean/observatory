import test from 'node:test';
import assert from 'node:assert/strict';
import {createSharedQuota} from './quota-peer.mjs';
import {parseQuotaRecord,quotaClockSkewMs} from './quota-record.mjs';
import {projectPeerQuota} from './quota-sync.mjs';
const now=Date.parse('2026-09-12T12:00:00.000Z');
function fixture(offset=0) {
  const at=now+offset,checkedAt=new Date(at).toISOString();
  const window={bucket:'codex',window:'primary',remainingPercent:70,durationMinutes:300,resetsAt:null};
  const payload=createSharedQuota({status:'stale',checkedAt,history:[
    {checkedAt:new Date(at-86400000).toISOString(),windows:[window]},
    {checkedAt,windows:[window]}],dailyUsageBuckets:[]},
    {enabled:true,host:'Windows',generation:'a'.repeat(32),now:at});
  return {version:1,sequence:1,payload};
}
test('bounded source clock skew preserves original times and complete retained history',()=>{
  const record=fixture(9000);
  assert.deepEqual(parseQuotaRecord(record,'Windows',now),record);
  assert.deepEqual(parseQuotaRecord(fixture(quotaClockSkewMs),'Windows',now),fixture(quotaClockSkewMs));
  assert.throws(()=>parseQuotaRecord(fixture(quotaClockSkewMs+1),'Windows',now),/clock too far/);
});
test('reopening a dated record does not silently prune its canonical history',()=>{
  const record=fixture();
  assert.deepEqual(parseQuotaRecord(record,'Windows',now+86400000),record);
  assert.equal(record.payload.history.length,2);
  assert.throws(()=>parseQuotaRecord(record,'Mac',now));
  assert.throws(()=>parseQuotaRecord(record,'Windows',NaN));
});
test('an accepted future-dated reading is displayed as stale, not current',()=>{
  const record=fixture(9000);record.payload.status='ok';
  const pair={local:{pairId:'fixture'},peer:{host:'Windows'}};
  const projected=projectPeerQuota({sharing:{enabled:true,pairingId:'fixture'},remote:{host:'Windows',pairingId:'fixture',receivedAt:now,record}},pair,now);
  assert.equal(projected.status,'stale');
  assert.equal(projected.checkedAt,record.payload.checkedAt);
  assert.equal(projected.windows[0].remainingPercent,70);
});
