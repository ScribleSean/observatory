import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createPairingConfigurations,initializePairing} from './peer-pairing.mjs';
import {readQuotaState,updateQuotaState,setQuotaSharing,revokeQuotaSharing} from './quota-store.mjs';
import {syncQuota,attachQuotaSync} from './quota-sync.mjs';
import {exchangeQuota} from './quota-exchange.mjs';
import {sshQuotaRequest} from './peer-transport.mjs';
const now=Date.now();
async function fixture(t,{tls=false}={}) {
  const root=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-quota-sync-')));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const pair=createPairingConfigurations();
  pair.Mac.transport={kind:'ssh-windows',hostAlias:'synthetic',remoteNode:'C:/App/node.exe',remoteScript:'C:/App/peer-exchange.mjs',remoteRuntime:'C:/Runtime'};
  if(tls) {
    pair.Mac.transport={kind:'tls',address:'10.0.0.2',port:43128};
    pair.Windows.transport={kind:'tls',address:'10.0.0.1',port:43128};
  }
  const runtimes={};
  for(const host of ['Mac','Windows']) {
    const runtime=await realpath(await mkdtemp(path.join(root,host)));runtimes[host]=runtime;
    await initializePairing(runtime,pair[host]);
    const initial=await readQuotaState(runtime,now);
    const state=await updateQuotaState(runtime,{revision:initial.revision,scope:(host==='Mac'?'a':'b').repeat(64),
      observation:{status:'ok',checkedAt:new Date(now).toISOString(),windows:[{bucket:'codex',window:'primary',remainingPercent:host==='Mac'?40:70}]}},now);
    await setQuotaSharing(runtime,{revision:state.revision,enabled:true,pairingId:pair[host].local.pairId},now);
  }
  const requests=[];
  const request=(transport,input)=>sshQuotaRequest(transport,input,async(args,text)=>{
    assert.ok(args.includes('StrictHostKeyChecking=yes'));
    const command=Buffer.from(args.at(-1).split(' ').at(-1),'base64').toString('utf16le');
    assert.ok(command.includes('quota-exchange.mjs'));assert.ok(!command.includes('remainingPercent'));
    requests.push(JSON.parse(text));
    return JSON.stringify(await exchangeQuota(runtimes.Windows,JSON.parse(text),now));
  });
  return {...runtimes,request,requests};
}
test('two device runtimes exchange through the SSH adapter with readiness before readings',async t=>{
  const {Mac,Windows,request,requests}=await fixture(t);
  const result=await syncQuota(Mac,{request,clock:()=>now});
  assert.equal(result.status,'ok');assert.equal(result.peer.host,'Windows');
  assert.equal(result.peer.history[0].windows[0].remainingPercent,70);
  assert.equal(result.peer.windows[0].remainingPercent,70);
  assert.equal(Object.hasOwn(result.peer,'generation'),false);
  assert.equal(requests[0].action,'status');assert.equal(Object.hasOwn(requests[0],'record'),false);
  assert.equal(requests[1].action,'exchange');
  const windows=await syncQuota(Windows,{request:()=>{throw Error('Windows must be passive');},clock:()=>now});
  assert.equal(windows.peer.host,'Mac');assert.equal(windows.peer.history[0].windows[0].remainingPercent,40);
  const again=await syncQuota(Mac,{request,clock:()=>now});
  assert.equal(again.status,'ok');assert.equal(again.peer.history.length,1);
  const offline=await syncQuota(Mac,{request:async()=>{throw Error('offline');},clock:()=>now+600001});
  assert.equal(offline.status,'unavailable');assert.equal(offline.peer.status,'stale');
  assert.equal(offline.peer.checkedAt,new Date(now).toISOString());
});
test('disabled peer gets no readings and local disable prevents any network request',async t=>{
  const {Mac,Windows,request,requests}=await fixture(t);
  await syncQuota(Mac,{request,clock:()=>now});requests.length=0;
  await revokeQuotaSharing(Windows,now);
  const result=await syncQuota(Mac,{request,clock:()=>now});
  assert.equal(result.status,'peer-disabled');assert.equal(result.peer,null);assert.equal(requests.length,1);
  assert.equal((await readQuotaState(Mac,now)).remote,null);
  await revokeQuotaSharing(Mac,now);
  assert.equal((await syncQuota(Mac,{request:()=>{throw Error('Unexpected network');},clock:()=>now})).status,'disabled');
});
test('revocation while readiness is pending prevents sending a record',async t=>{
  const {Mac}=await fixture(t);let calls=0;
  const result=await syncQuota(Mac,{clock:()=>now,request:async()=>{
    calls++;await revokeQuotaSharing(Mac,now);return {version:1,status:'ready',record:null};
  }});
  assert.equal(result.status,'disabled');assert.equal(calls,1);
});
test('collector hook preserves local readings on failure and skips disabled collection',async t=>{
  const {Mac}=await fixture(t);
  const quota={status:'ok',windows:[{remainingPercent:40}]};
  const result={data:{quota}};
  await attachQuotaSync(Mac,result,{enabled:true,clock:()=>now,request:async()=>{throw Error('offline');}});
  assert.equal(result.data.quota,quota);assert.equal(result.quotaSync.status,'unavailable');
  let called=false;
  await attachQuotaSync(Mac,result,{enabled:false,request:async()=>{called=true;}});
  assert.equal(called,false);assert.equal(result.data.quota,quota);assert.equal(result.data.peerQuota,null);
});

test('both TLS roles can initiate concurrently without holding each other\'s pairing lock',async t=>{
  const {Mac,Windows}=await fixture(t,{tls:true});
  const requestFor=remote=>async(_transport,input)=>exchangeQuota(remote,input,now);
  const [mac,windows]=await Promise.all([
    syncQuota(Mac,{clock:()=>now,request:requestFor(Windows)}),
    syncQuota(Windows,{clock:()=>now,request:requestFor(Mac)})]);
  assert.equal(mac.status,'ok');assert.equal(windows.status,'ok');
  assert.equal(mac.peer.windows[0].remainingPercent,70);
  assert.equal(windows.peer.windows[0].remainingPercent,40);
});

test('disable and re-enable while readiness waits cannot reuse the old sharing epoch',async t=>{
  const {Mac}=await fixture(t,{tls:true});let calls=0;
  const result=await syncQuota(Mac,{clock:()=>now,request:async()=>{
    calls++;const before=await readQuotaState(Mac,now);
    await revokeQuotaSharing(Mac,now);
    const disabled=await readQuotaState(Mac,now);
    await setQuotaSharing(Mac,{revision:disabled.revision,enabled:true,pairingId:before.sharing.pairingId},now);
    return {version:1,status:'ready',record:null};
  }});
  assert.equal(result.status,'disabled');assert.equal(calls,1);
});
