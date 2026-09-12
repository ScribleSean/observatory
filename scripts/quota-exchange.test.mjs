import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createPairingConfigurations,initializePairing} from './peer-pairing.mjs';
import {readQuotaState,updateQuotaState,setQuotaSharing,revokeQuotaSharing} from './quota-store.mjs';
import {createSharedQuota} from './quota-peer.mjs';
import {exchangeQuota} from './quota-exchange.mjs';
const now=Date.now();
async function fixture(t) {
  const runtime=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-quota-exchange-')));
  t.after(()=>rm(runtime,{recursive:true,force:true}));
  const pair=createPairingConfigurations().Windows;
  await initializePairing(runtime,pair);
  const state=await readQuotaState(runtime,now);
  const observation={status:'ok',checkedAt:new Date(now).toISOString(),windows:[{bucket:'codex',window:'primary',remainingPercent:60}]};
  const collected=await updateQuotaState(runtime,{revision:state.revision,scope:'a'.repeat(64),observation},now);
  const status={version:1,action:'status',pairId:pair.peer.pairId,deviceId:pair.peer.deviceId};
  const payload=createSharedQuota({...observation,history:[observation],dailyUsageBuckets:[]},
    {enabled:true,host:'Mac',generation:'b'.repeat(32),now});
  const request={...status,action:'exchange',record:{version:1,sequence:5,payload}};
  return {runtime,pair,collected,status,request};
}
test('explicit consent gates exchange and durable peer history never adds totals',async t=>{
  const {runtime,pair,collected,status,request}=await fixture(t);
  assert.deepEqual(await exchangeQuota(runtime,status,now),{version:1,status:'disabled',record:null});
  assert.equal((await exchangeQuota(runtime,request,now)).status,'disabled');
  await setQuotaSharing(runtime,{revision:collected.revision,enabled:true,pairingId:pair.local.pairId},now);
  assert.deepEqual(await exchangeQuota(runtime,status,now),{version:1,status:'ready',record:null});
  const first=await exchangeQuota(runtime,request,now);
  assert.equal(first.record.payload.host,'Windows');
  assert.ok(!JSON.stringify(first).includes('a'.repeat(64)));
  const again=await exchangeQuota(runtime,request,now+1);
  assert.ok(again.record.sequence>first.record.sequence);
  const saved=await readQuotaState(runtime,now+1);
  assert.deepEqual(saved.remote.record,request.record);assert.equal(saved.remote.record.payload.history.length,1);
  await revokeQuotaSharing(runtime,now+1);
  assert.equal((await readQuotaState(runtime,now+1)).remote,null);
  assert.equal((await exchangeQuota(runtime,request,now+1)).status,'disabled');
});
test('wrong peer, conflicting and older revisions cannot replace accepted readings',async t=>{
  const {runtime,pair,collected,status,request}=await fixture(t);
  await setQuotaSharing(runtime,{revision:collected.revision,enabled:true,pairingId:pair.local.pairId},now);
  await assert.rejects(exchangeQuota(runtime,{...status,deviceId:'0'.repeat(64)},now));
  await exchangeQuota(runtime,request,now);
  const conflict=structuredClone(request);conflict.record.payload.history[0].windows[0].remainingPercent=20;
  await assert.rejects(exchangeQuota(runtime,conflict,now),/Conflicting/);
  conflict.record.sequence=4;
  await exchangeQuota(runtime,conflict,now);
  assert.deepEqual((await readQuotaState(runtime,now)).remote.record,request.record);
  const switched=structuredClone(request);switched.record.sequence=6;switched.record.payload.generation='c'.repeat(32);
  await exchangeQuota(runtime,switched,now);
  assert.equal((await readQuotaState(runtime,now)).remote.record.payload.generation,'c'.repeat(32));
});
