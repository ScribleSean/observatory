import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runSyntheticQuotaAction} from './peer-live-fixture.test.mjs';
import {createPairingConfigurations,initializePairing} from './peer-pairing.mjs';
import {exchangeQuota} from './quota-exchange.mjs';

test('live quota fixture uses only synthetic data and verifies consent, retention and disable',async t=>{
  const root=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-live-quota-test-')));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const Mac=await mkdtemp(path.join(root,'Mac-')),Windows=await mkdtemp(path.join(root,'Windows-'));
  const run=runSyntheticQuotaAction;
  const empty={sharing:false,localRemaining:null,peerRemaining:null,peerSamples:0};
  assert.deepEqual(await run(Mac,'quota-status'),empty);
  assert.deepEqual(await run(Mac,'quota-disable'),empty);
  await assert.rejects(run(Mac,'quota-enable'));
  await assert.rejects(lstat(path.join(Mac,'private-quota')),{code:'ENOENT'});
  const pairs=createPairingConfigurations();
  pairs.Mac.transport={kind:'tls',address:'10.0.0.2',port:43128};
  pairs.Windows.transport={kind:'tls',address:'10.0.0.1',port:43128};
  await initializePairing(Mac,pairs.Mac);await initializePairing(Windows,pairs.Windows);
  await run(Mac,'quota-enable');await run(Windows,'quota-enable');
  const outbound=remote=>({request:async(_transport,input)=>exchangeQuota(remote,input)});
  const [mac,windows]=await Promise.all([
    run(Mac,'quota-exchange',outbound(Windows)),run(Windows,'quota-exchange',outbound(Mac))]);
  assert.deepEqual(mac,{status:'ok',sharing:true,localRemaining:40,peerRemaining:70,peerSamples:1});
  assert.deepEqual(windows,{status:'ok',sharing:true,localRemaining:70,peerRemaining:40,peerSamples:1});
  assert.deepEqual(await run(Mac,'quota-exchange',outbound(Windows)),mac);
  const disabled=await run(Windows,'quota-disable');
  assert.deepEqual(disabled,{sharing:false,localRemaining:70,peerRemaining:null,peerSamples:0});
  assert.deepEqual(await run(Mac,'quota-exchange',outbound(Windows)),
    {status:'peer-disabled',sharing:true,localRemaining:40,peerRemaining:null,peerSamples:0});
  let sent=false;
  assert.equal((await run(Windows,'quota-exchange',{request:()=>{sent=true;throw Error('Unexpected send');}})).status,'disabled');
  assert.equal(sent,false);
  await assert.rejects(run(Mac,'unknown'));
});
