import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {testRuntimeBase} from './test-runtime-base.mjs';
import path from 'node:path';
import {createPairingConfigurations,initializePairing} from './peer-pairing.mjs';
import {createPeerPayload} from './peer-payload.mjs';
import {createPeerRecord,acceptPeerState} from './peer-store.mjs';
import {finalizeWithLocalAdditions} from './local-additions.mjs';

const runtimeBase=await testRuntimeBase('local-additions-merge');
after(()=>rm(runtimeBase,{recursive:true,force:true}));

const date='2026-10-01',hours=[12,...Array(23).fill(0)];
const counts={inputTokens:10,cacheReadTokens:0,cacheCreationTokens:0,outputTokens:2,reasoningOutputTokens:0,totalTokens:12};
const payload=(config,at)=>createPeerPayload({collectedAt:at,activity:{status:'unavailable'},
  codex:[{host:config.host,status:'ok',profiles:[{date,model:'unknown',effort:'high',speed:'standard',...counts}],tools:[],
    inventory:{status:'ok',keys:[(config.host==='Mac'?'b':'c').repeat(64)],parents:[]}}],
  dictation:[{source:'Wispr Flow',status:'unavailable'}]},config);

for(const host of ['Mac','Windows'])test(`stored peer merge preserves only ${host} local additions`,async t=>{
  const runtime=await realpath(await mkdtemp(path.join(runtimeBase,'local-additions-merge-')));
  t.after(()=>rm(runtime,{recursive:true,force:true}));
  const pairing=createPairingConfigurations()[host],now=Date.now(),at=new Date(now).toISOString();
  await initializePairing(runtime,pairing);
  await acceptPeerState(runtime,createPeerRecord(payload(pairing.peer,at),pairing.peer,1,now),pairing.peer,now);
  const result={data:{tokens:[{host,status:'ok',days:[{date,...counts,hours}]}],
    activity:[{host,status:'unavailable',refusal:'ancestor-refused'}],
    dictation:[{host,source:'Wispr Flow',status:'unavailable',refusal:'private-folder-refused'}]},
    peer:{status:'ready',payload:payload(pairing.local,at)}};
  assert.equal(await finalizeWithLocalAdditions(runtime,result,pairing,[],host),result);
  assert.equal(result.peer.status,'merged');
  const own=result.data.tokens.find(row=>row.host===host),peer=result.data.tokens.find(row=>row.host===pairing.peer.host);
  assert.equal(own.status,'ok');assert.equal(peer.status,'ok');
  assert.equal(peer.days[0].date,date);assert.equal(peer.days[0].totalTokens,12);
  assert.deepEqual(own.days[0].hours,hours);
  assert.equal(result.data.activity.find(row=>row.host===host).refusal,'ancestor-refused');
  assert.equal(result.data.dictation.find(row=>row.host===host).refusal,'private-folder-refused');
  for(const key of ['tokens','settings','activity','dictation']) {
    const rows=result.data[key].filter(row=>row.host===pairing.peer.host);
    assert.ok(rows.length);
    for(const row of rows) {
      assert.equal(Object.hasOwn(row,'refusal'),false);
      assert.ok((row.days??[]).every(day=>!Object.hasOwn(day,'hours')));
    }
  }
});
