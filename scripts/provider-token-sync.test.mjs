import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,readFile,writeFile,readdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createPairingConfigurations,initializePairing,readPairing} from './peer-pairing.mjs';
import {revokePairing} from './peer-revocation.mjs';
import {preparePairingRepair} from './peer-repair.mjs';
import {cleanClaudeTokenSource,unavailableClaudeTokenSource} from './provider-token-sources.mjs';
import {createProviderTokenRecord} from './provider-token-peer.mjs';
import {readProviderTokenState,updateProviderTokenSource,acceptProviderTokenReply,disableProviderTokenSharing} from './provider-token-store.mjs';
import {providerTokenSharingControl} from './provider-token-sharing-control.mjs';
import {exchangeProviderTokens,assertOutgoingProviderTokenRequest} from './provider-token-exchange.mjs';
import {syncProviderTokens,collectProviderTokenSources,attachProviderTokenSync} from './provider-token-sync.mjs';

const now=Date.now();
function source(host,at=now,total=14) {
  const counts={inputTokens:total-12,cacheReadTokens:3,cacheCreationTokens:4,outputTokens:5,totalTokens:total,requestCount:1};
  return cleanClaudeTokenSource({provider:'claude-code',status:'ok',days:[{date:'2026-09-25',...counts,
    models:[{model:'claude-sonnet-4',...counts}]}]},host,new Date(at).toISOString());
}
async function enable(runtime,at=now) {
  const status=await providerTokenSharingControl(runtime,{action:'status'},at);
  return providerTokenSharingControl(runtime,{action:'enable',token:status.token},at);
}
async function fixture(t,{enabled=true,tls=false}={}) {
  const root=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-provider-sync-')));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const pair=createPairingConfigurations(),runtime={};
  pair.Mac.transport={kind:'ssh-windows',hostAlias:'synthetic',remoteNode:'C:/App/node.exe',remoteScript:'C:/App/peer-exchange.mjs',remoteRuntime:'C:/Runtime'};
  if(tls)for(const host of ['Mac','Windows'])pair[host].transport={kind:'tls',address:host==='Mac'?'10.0.0.2':'10.0.0.1',port:43128};
  for(const host of ['Mac','Windows']) {
    runtime[host]=await realpath(await mkdtemp(path.join(root,host)));
    await initializePairing(runtime[host],pair[host]);
    await updateProviderTokenSource(runtime[host],source(host),now);
    if(enabled)await enable(runtime[host]);
  }
  const requests=[];
  const request=async(_transport,input)=>{requests.push(structuredClone(input));return exchangeProviderTokens(runtime.Windows,input,now);};
  return {root,...runtime,pair,request,requests};
}

test('sharing starts off, is enabled by a current local confirmation, and probes carry no readings',async t=>{
  const {Mac,Windows,pair,requests,request}=await fixture(t,{enabled:false});
  assert.equal((await providerTokenSharingControl(Mac)).enabled,false);
  assert.equal((await syncProviderTokens(Mac,{request,clock:()=>now})).status,'disabled');assert.equal(requests.length,0);
  const status=await providerTokenSharingControl(Mac,{action:'status'},now);
  assert.deepEqual(Object.keys(status),['version','enabled','canEnable','reason','token']);
  assert.ok(!JSON.stringify(status).includes(pair.Mac.local.pairId));
  await updateProviderTokenSource(Mac,source('Mac',now+1),now+1);
  await assert.rejects(providerTokenSharingControl(Mac,{action:'enable',token:status.token},now+1),/expired/);
  await enable(Mac,now+1);
  const disabled=await syncProviderTokens(Mac,{request,clock:()=>now+1});
  assert.equal(disabled.status,'peer-disabled');assert.equal(requests.length,1);
  assert.deepEqual(Object.keys(requests[0]).sort(),['action','deviceId','pairId','version']);
  await enable(Windows);
  const synced=await syncProviderTokens(Mac,{request,clock:()=>now+1});
  assert.equal(synced.peer.host,'Windows');assert.equal(synced.peer.days[0].totalTokens,14);
  const windows=await syncProviderTokens(Windows,{request:()=>{throw Error('Passive SSH receiver');},clock:()=>now+1});
  assert.equal(windows.peer.host,'Mac');assert.equal(windows.peer.days[0].totalTokens,14);
  for(const forbidden of ['generation','comparisonId','pairId','deviceId','salt','revision'])assert.equal(forbidden in synced.peer,false);
});

test('native sharing CLI exposes only bounded status and confirmation fields',async t=>{
  const {Mac,pair}=await fixture(t,{enabled:false});
  const run=request=>spawnSync(process.execPath,[fileURLToPath(new URL('./provider-token-sharing-control.mjs',import.meta.url)),
    '--runtime',Mac],{input:JSON.stringify(request),encoding:'utf8',timeout:30000});
  const status=run({action:'status'});assert.equal(status.status,0,status.stderr);
  const current=JSON.parse(status.stdout);assert.equal(current.enabled,false);assert.equal(current.reason,'ready');
  assert.equal(status.stdout.includes(pair.Mac.local.pairId),false);
  const enabled=run({action:'enable',token:current.token});assert.equal(enabled.status,0,enabled.stderr);assert.equal(JSON.parse(enabled.stdout).enabled,true);
  const extra=run({action:'status',private:'PRIVATE'});assert.equal(extra.status,1);assert.equal(extra.stdout,'');
  const disabled=run({action:'disable'});assert.equal(disabled.status,0,disabled.stderr);assert.equal(JSON.parse(disabled.stdout).enabled,false);
});

test('duplicate deliveries keep source and receipt time, newer snapshots replace instead of sum',async t=>{
  const {Mac,Windows,request}=await fixture(t);
  const first=await syncProviderTokens(Mac,{request,clock:()=>now});
  const saved=await readProviderTokenState(Mac,now);
  await syncProviderTokens(Mac,{request,clock:()=>now+500000});
  assert.deepEqual((await readProviderTokenState(Mac,now+500000)).remote,saved.remote);
  const stale=await syncProviderTokens(Mac,{request,clock:()=>now+600001});
  assert.equal(stale.peer.status,'stale');assert.equal(stale.peer.checkedAt,first.peer.checkedAt);assert.equal(stale.peer.receivedAt,first.peer.receivedAt);
  await updateProviderTokenSource(Windows,source('Windows',now+1,20),now+1);
  const newer=await syncProviderTokens(Mac,{request,clock:()=>now+1});
  assert.equal(newer.peer.days[0].totalTokens,20);assert.equal(newer.peer.days.length,1);
  const offline=await syncProviderTokens(Mac,{request:async()=>{throw Error('offline');},clock:()=>now+600002});
  assert.equal(offline.status,'unavailable');assert.equal(offline.peer.status,'stale');assert.equal(offline.peer.days[0].totalTokens,20);
});

test('wrong identity, older, conflicting and regressing revisions cannot replace a peer record',async t=>{
  const {Mac,Windows,pair,request}=await fixture(t);await syncProviderTokens(Mac,{request,clock:()=>now});
  const local=await readProviderTokenState(Mac,now),remote=await readProviderTokenState(Windows,now);
  const make=(sequence,at=now,total=14)=>createProviderTokenRecord(source('Windows',at,total),pair.Windows.local,remote.generation,sequence,now+1000);
  await assert.rejects(acceptProviderTokenReply(Mac,make(remote.local.revision.sequence,now,20),local.generation,now),/Conflicting/);
  await acceptProviderTokenReply(Mac,make(1),local.generation,now);
  assert.deepEqual((await readProviderTokenState(Mac,now)).remote,local.remote);
  await assert.rejects(acceptProviderTokenReply(Mac,make(100,now-1),local.generation,now),/Regressing/);
  const bad=make(100);bad.revision.deviceId=pair.Mac.local.deviceId;
  await assert.rejects(acceptProviderTokenReply(Mac,bad,local.generation,now));
  assert.deepEqual((await readProviderTokenState(Mac,now)).remote,local.remote);
});

test('disable or disable-reenable during readiness prevents sending provider readings',async t=>{
  for(const reenable of [false,true]) {
    const {Mac}=await fixture(t);let calls=0;
    const result=await syncProviderTokens(Mac,{clock:()=>now,request:async()=>{
      calls++;await disableProviderTokenSharing(Mac,now);
      if(reenable)await enable(Mac);
      return {version:1,status:'ready',record:null};
    }});
    assert.equal(result.status,'disabled');assert.equal(result.peer,null);assert.equal(calls,1);
  }
});

test('disable during exchange rejects the reply and a disabled peer hides cached readings without dropping watermarks',async t=>{
  const {Mac,Windows,request}=await fixture(t);await syncProviderTokens(Mac,{request,clock:()=>now});
  const before=await readProviderTokenState(Mac,now);
  await disableProviderTokenSharing(Windows,now);
  assert.equal((await syncProviderTokens(Mac,{request,clock:()=>now})).status,'peer-disabled');
  const hidden=await readProviderTokenState(Mac,now);
  assert.deepEqual(hidden.remote.record,before.remote.record);assert.equal(hidden.remote.consentGeneration,null);
  await enable(Windows);
  let calls=0;
  const result=await syncProviderTokens(Mac,{clock:()=>now,request:async(...args)=>{
    calls++;const reply=await request(...args);if(calls===2)await disableProviderTokenSharing(Mac,now);return reply;
  }});
  assert.equal(result.status,'disabled');assert.equal(result.peer,null);
  assert.equal((await readProviderTokenState(Mac,now)).generation,null);
});

test('concurrent TLS roles exchange without holding a network lock and preserve local collection on errors',async t=>{
  const {Mac,Windows}=await fixture(t,{tls:true});
  const [mac,windows]=await Promise.all([
    syncProviderTokens(Mac,{clock:()=>now,request:(_transport,input)=>exchangeProviderTokens(Windows,input,now)}),
    syncProviderTokens(Windows,{clock:()=>now,request:(_transport,input)=>exchangeProviderTokens(Mac,input,now)})]);
  assert.equal(mac.peer.host,'Windows');assert.equal(windows.peer.host,'Mac');
  const local=source('Mac');
  const result={data:{combinedTokens:{status:'unverified'}},status:{sourcesRead:2,sourcesConfigured:2,state:'ok'}};
  await attachProviderTokenSync(Mac,result,local,{clock:()=>now,request:()=>{throw Error('offline');}});
  assert.equal(result.providerTokenSync.status,'unavailable');assert.deepEqual(result.data.providerTokenSources[0],local);
  assert.equal(result.data.providerTokenSources.length,2);assert.equal(result.status.sourcesConfigured,4);assert.equal(result.status.sourcesRead,4);
  assert.deepEqual(result.data.combinedTokens,{status:'unverified'});
  const invalid={data:{coreMarker:true},status:{sourcesRead:1,sourcesConfigured:1,state:'ok'}};
  await attachProviderTokenSync(Mac,invalid,{...local,private:'PRIVATE'},{clock:()=>now});
  assert.equal(invalid.data.coreMarker,true);assert.equal(invalid.providerTokenSync.status,'unavailable');
  assert.equal(invalid.data.providerTokenSources[0].status,'unavailable');assert.equal(JSON.stringify(invalid).includes('PRIVATE'),false);
  const unpaired=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-provider-unpaired-')));
  t.after(()=>rm(unpaired,{recursive:true,force:true}));
  assert.deepEqual(await collectProviderTokenSources(unpaired,local,{clock:()=>now}),{status:'disabled',sources:[local]});
  assert.deepEqual(await readdir(unpaired),[]);
});

test('collection off disables sharing and failed reads replace totals with Unknown',async t=>{
  const {Mac,Windows,request}=await fixture(t);
  await updateProviderTokenSource(Windows,unavailableClaudeTokenSource('Windows',new Date(now+1).toISOString()),now+1);
  assert.equal((await readProviderTokenState(Windows,now+1)).local.payload.source.status,'unavailable');
  const unknown=await syncProviderTokens(Mac,{request,clock:()=>now+1});
  assert.equal(unknown.peer.status,'unavailable');assert.equal(unknown.peer.days,undefined);
  await updateProviderTokenSource(Windows,unavailableClaudeTokenSource('Windows',new Date(now+2).toISOString(),'not-connected'),now+2);
  assert.equal((await syncProviderTokens(Mac,{request,clock:()=>now+2})).status,'peer-disabled');
  assert.equal((await providerTokenSharingControl(Windows,{action:'status'},now+2)).canEnable,false);
});

test('pairing revoke, corruption and retirement fence transport while local disable remains available',async t=>{
  const {Mac,Windows,pair,request}=await fixture(t);await syncProviderTokens(Mac,{request,clock:()=>now});
  const outgoing={version:1,action:'exchange',pairId:pair.Mac.local.pairId,deviceId:pair.Mac.local.deviceId,
    record:(await readProviderTokenState(Mac,now)).local};
  await revokePairing(Mac);
  await assert.rejects(assertOutgoingProviderTokenRequest(Mac,outgoing));
  await assert.rejects(exchangeProviderTokens(Mac,{version:1,action:'status',pairId:pair.Mac.peer.pairId,deviceId:pair.Mac.peer.deviceId},now));
  assert.equal((await providerTokenSharingControl(Mac,{action:'disable'},now)).enabled,false);
  await writeFile(path.join(Windows,'private-sync','pairing.json'),'bad',{mode:0o600});
  assert.equal((await providerTokenSharingControl(Windows,{action:'disable'},now)).enabled,false);
  const {Mac:repair}=await fixture(t);
  assert.equal((await preparePairingRepair(repair)).status,'prepared');
  const retired=(await readdir(repair)).find(name=>name.startsWith('private-sync-retired-'));
  assert.ok((await readdir(path.join(repair,retired))).includes('provider-tokens.sqlite'));
  assert.equal(await readPairing(repair),null);
  assert.deepEqual((await collectProviderTokenSources(repair,source('Mac'),{clock:()=>now})).sources,[source('Mac')]);
});

test('private provider database rejects links, extra schema and mismatched saved bindings',async t=>{
  const {Mac,pair}=await fixture(t);
  const file=path.join(Mac,'private-sync','provider-tokens.sqlite');
  const db=new DatabaseSync(file);
  const saved=db.prepare('SELECT record FROM provider_token_state WHERE slot=1').get().record;
  const changed=JSON.parse(saved);changed.binding.local.deviceId='a'.repeat(64);
  db.prepare('UPDATE provider_token_state SET record=?').run(JSON.stringify(changed));db.close();
  await assert.rejects(readProviderTokenState(Mac,now));
  const restored=new DatabaseSync(file);restored.prepare('UPDATE provider_token_state SET record=?').run(saved);restored.exec('CREATE TABLE extra(value TEXT)');restored.close();
  await assert.rejects(readProviderTokenState(Mac,now),/schema/);
  const outside=path.join(Mac,'outside.sqlite');await writeFile(outside,await readFile(file),{mode:0o600});await rm(file);await symlink(outside,file);
  await assert.rejects(readProviderTokenState(Mac,now));
  assert.ok(pair.Mac.local.deviceId);
});
