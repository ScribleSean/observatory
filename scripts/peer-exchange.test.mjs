import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createPairingConfigurations,initializePairing} from './peer-pairing.mjs';
import {createPeerPayload} from './peer-payload.mjs';
import {publishLocalPayload,createPeerRecord,readPeerState} from './peer-store.mjs';
import {exchangePeerRecord} from './peer-exchange.mjs';

const supported=['darwin','win32'].includes(process.platform);
async function fixture(t,publish=true) {
  const runtime=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-exchange-')));
  t.after(()=>rm(runtime,{recursive:true,force:true}));
  const host=process.platform==='darwin'?'Mac':'Windows',pair=createPairingConfigurations()[host];
  await initializePairing(runtime,pair);
  const at=new Date().toISOString();
  const payload=config=>createPeerPayload({collectedAt:at,activity:{status:'not-connected'},
    codex:[{host:config.host,status:'not-connected'}],
    dictation:['Wispr Flow'].map(source=>({source,status:'not-connected'}))},config);
  const local=publish?await publishLocalPayload(runtime,payload(pair.local),pair.local):null;
  const peer=createPeerRecord(payload(pair.peer),pair.peer,1);
  return {runtime,pair,local,peer};
}
test('exchange accepts the paired peer, returns only local snapshot, and tolerates retries',{skip:!supported},async t=>{
  const {runtime,pair,local,peer}=await fixture(t),request={version:1,record:peer};
  const response=await exchangePeerRecord(runtime,request);
  assert.deepEqual(response,{version:1,record:local});
  assert.deepEqual((await readPeerState(runtime,pair.peer)),peer);
  assert.deepEqual(await exchangePeerRecord(runtime,request),response);
  assert.ok(!JSON.stringify(response).includes(pair.local.comparisonSalt));
});
test('wrong peer identity and extra protocol fields do not replace state',{skip:!supported},async t=>{
  const {runtime,pair,peer}=await fixture(t);
  const bad=structuredClone(peer);bad.revision.deviceId='0'.repeat(64);
  await assert.rejects(exchangePeerRecord(runtime,{version:1,record:bad}));
  await assert.rejects(exchangePeerRecord(runtime,{version:1,record:peer,command:'unexpected'}));
  assert.equal(await readPeerState(runtime,pair.peer),null);
});
test('missing local export does not accept a one-sided transfer',{skip:!supported},async t=>{
  const {runtime,pair,peer}=await fixture(t,false);
  await assert.rejects(exchangePeerRecord(runtime,{version:1,record:peer}));
  assert.equal(await readPeerState(runtime,pair.peer),null);
});
