import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {macSnapshot} from './mac-snapshot.mjs';
import {windowsSnapshot} from './windows-dashboard.mjs';
import {attachDeviceName} from './device-name.mjs';
import {captureLocalAdditions,reapplyLocalAdditions} from './local-additions.mjs';
import {parsePeerPayload,mergePeerPayloads} from './peer-payload.mjs';
import {createPairingConfigurations,initializePairing} from './peer-pairing.mjs';
import {collectProviderTokenSources} from './provider-token-sync.mjs';
import {providerTokenSharingControl} from './provider-token-sharing-control.mjs';
import {readProviderTokenState} from './provider-token-store.mjs';
import {cleanClaudeTokenSource} from './provider-token-sources.mjs';

const at='2026-10-01T13:00:00.000Z',now=Date.parse(at),date='2026-10-01';
const config=host=>({host,comparisonId:'a'.repeat(64),codexHosts:[host]});
const hours=[12,...Array(23).fill(0)];
const counts={inputTokens:10,cacheReadTokens:0,cacheCreationTokens:0,outputTokens:2,reasoningOutputTokens:0,totalTokens:12};
const report=host=>({status:'ok',profiles:[{date,model:'unknown',effort:'high',speed:'standard',...counts}],tools:[],
  inventory:{status:'ok',keys:[(host==='Mac'?'b':'c').repeat(64)],parents:[]}});
async function snapshot(host,additions,failedHost) {
  const settings={...report(host),...(additions?{hourTotals:[{date,hours}]}:{})};
  const refusal=additions?'ancestor-refused':undefined;
  const result=host==='Mac'?await macSnapshot({activity:false},{codex:async()=>{
    if(host===failedHost)throw Object.assign(Error('PRIVATE'),{refusal});return settings;
  }},[],at,config(host)):windowsSnapshot({windows:{status:'not-connected'},wispr:{status:'not-connected'},
    localSettings:host===failedHost?{status:'unavailable',...(refusal?{refusal}:{})}:settings},[],at,config(host));
  if(additions)attachDeviceName(result.data,host,'Fixture desk');
  return result;
}
test('an older peer still accepts what this device sends with local additions',async t=>{
  for(const failedHost of ['Mac','Windows']) {
    const results={};
    for(const host of ['Mac','Windows']) {
      const local=await snapshot(host,true,failedHost),plain=await snapshot(host,false,failedHost);
      assert.equal(local.peer.status,'ready');assert.deepEqual(local.peer.payload,plain.peer.payload);
      assert.doesNotMatch(JSON.stringify(local.peer.payload),/"(?:deviceNames|refusal|hours|hourTotals)":/);
      results[host]=local;
    }
    for(const host of ['Mac','Windows']) {
      const peer=host==='Mac'?'Windows':'Mac',local=results[host],remote=results[peer];
      const received=parsePeerPayload(JSON.stringify(remote.peer.payload),config(peer),now);
      assert.deepEqual(received,remote.peer.payload);
      const merged=mergePeerPayloads(local.peer.payload,received,config(host),config(peer),[],now);
      reapplyLocalAdditions(merged,host,captureLocalAdditions(local.data,host));
      const own=merged.tokens.find(row=>row.host===host),other=merged.tokens.find(row=>row.host===peer);
      if(host===failedHost)assert.equal(own.refusal,'ancestor-refused');
      else assert.deepEqual(own.days[0].hours,hours);
      assert.equal(other.refusal,undefined);assert.ok((other.days??[]).every(day=>!Object.hasOwn(day,'hours')));
      for(const key of ['settings','activity','dictation'])assert.ok(merged[key].filter(row=>row.host===peer).every(row=>!Object.hasOwn(row,'refusal')));
      assert.equal(merged.settings.find(row=>row.host===host).refusal,host===failedHost?'ancestor-refused':undefined);
    }
  }
  const runtime=await realpath(await mkdtemp(path.join(tmpdir(),'local-first-provider-')));
  t.after(()=>rm(runtime,{recursive:true,force:true}));
  await initializePairing(runtime,createPairingConfigurations().Mac);
  const providerNow=Date.now(),providerAt=new Date(providerNow).toISOString();
  const providerCounts={inputTokens:10,cacheReadTokens:0,cacheCreationTokens:0,outputTokens:2,totalTokens:12,requestCount:1};
  const plain=cleanClaudeTokenSource({provider:'claude-code',status:'ok',days:[{date,...providerCounts,
    models:[{model:'claude-sonnet-4',...providerCounts}]}]},'Mac',providerAt);
  assert.equal((await collectProviderTokenSources(runtime,plain,{clock:()=>providerNow})).status,'disabled');
  const control=await providerTokenSharingControl(runtime,{action:'status'},providerNow);
  await providerTokenSharingControl(runtime,{action:'enable',token:control.token},providerNow);
  const stored=(await readProviderTokenState(runtime,providerNow)).local;
  assert.ok(stored);
  const laterNow=providerNow+1000,laterAt=new Date(laterNow).toISOString();
  const withHours=structuredClone(plain);withHours.days[0].hours=hours;withHours.checkedAt=laterAt;
  const result=await collectProviderTokenSources(runtime,withHours,{clock:()=>laterNow});
  assert.equal(result.status,'passive');
  assert.deepEqual(result.sources[0].days[0].hours,hours);
  const updated=(await readProviderTokenState(runtime,laterNow)).local;
  assert.equal(updated.payload.source.checkedAt,laterAt);
  assert.notDeepEqual(updated,stored);
  assert.doesNotMatch(JSON.stringify(updated),/"(?:deviceNames|refusal|hours)":/);
});
