import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createPairingConfigurations,initializePairing} from './peer-pairing.mjs';
import {createPeerPayload} from './peer-payload.mjs';
import {finalizePeerCollection} from './peer-finalize.mjs';

test('configured peer transport failure counts unavailable peer sources without enabling excluded hosts',async t=>{
  const runtime=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-peer-finalize-')));
  t.after(()=>rm(runtime,{recursive:true,force:true}));
  const base=createPairingConfigurations(false).Mac;
  const pairing={...base,transport:{kind:'tls',address:'10.0.0.2',port:3210}};
  await initializePairing(runtime,pairing);
  const payload=createPeerPayload({collectedAt:new Date().toISOString(),activity:{status:'not-connected'},
    codex:[{host:'Mac',status:'not-connected'}],dictation:[{source:'Wispr Flow',status:'not-connected'}]},pairing.local);
  const data={activity:[{host:'Mac',status:'ok'},{host:'Windows',status:'not-connected'}],
    tokens:[{host:'Mac',status:'ok'},{host:'Windows',status:'not-connected'},{host:'Ubuntu',status:'not-connected'}],
    settings:[{host:'Mac',status:'ok'}],dictation:[{host:'Mac',source:'Wispr Flow',status:'not-connected'}]};
  const result=await finalizePeerCollection(runtime,{data,peer:{status:'ready',payload},status:{state:'ok',sourcesRead:3,sourcesConfigured:3}},pairing,[],Date.now(),{exchangeTLS:async()=>{throw Error('offline');}});
  assert.equal(result.peer.status,'waiting');assert.equal(result.peer.transport,'unavailable');
  assert.equal(result.data.activity[1].status,'unavailable');
  assert.equal(result.data.tokens[1].status,'unavailable');assert.equal(result.data.tokens[2].status,'not-connected');
  assert.equal(result.status.state,'partial');assert.equal(result.status.sourcesRead,3);assert.equal(result.status.sourcesConfigured,5);
});
