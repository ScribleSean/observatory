import test from 'node:test';
import assert from 'node:assert/strict';
import {createPairingConfigurations} from './peer-pairing.mjs';
import {cleanClaudeTokenSource,unavailableClaudeTokenSource} from './provider-token-sources.mjs';
import {createProviderTokenRecord,parseProviderTokenRecord,parseProviderTokenSource,parseProviderTokenRequest,parseProviderTokenReply} from './provider-token-peer.mjs';

const now=Date.now(),pair=createPairingConfigurations().Mac;
const counters={inputTokens:2,cacheReadTokens:3,cacheCreationTokens:4,outputTokens:5,totalTokens:14,requestCount:1};
const source=cleanClaudeTokenSource({provider:'claude-code',status:'ok',days:[{date:'2026-09-25',...counters,
  models:[{model:'claude-sonnet-4',...counters}]}]},'Mac',new Date(now).toISOString());
const record=()=>createProviderTokenRecord(source,pair.local,'a'.repeat(32),1,now);

test('provider records bind the public source to device, generation and digest',()=>{
  assert.deepEqual(parseProviderTokenRecord(record(),pair.local,now),record());
  for(const mutate of [r=>{r.payload.source.prompt='PRIVATE';},r=>{r.payload.source.days[0].models[0].requestId='PRIVATE';},
    r=>{r.payload.source.host='Windows';},r=>{r.payload.generation='bad';},r=>{r.revision.deviceId=pair.peer.deviceId;},
    r=>{r.revision.comparisonId='b'.repeat(64);},r=>{r.revision.digest='0'.repeat(64);},r=>{r.payload.source.days[0].totalTokens++;},
    r=>{r.payload.source.days[0].inputTokens=Number.MAX_SAFE_INTEGER+1;},r=>{r.payload.source.days.push(r.payload.source.days[0]);},
    r=>{r.payload.source.days[0].models[0].model='private-host-name';},r=>{r.version=2;}]) {
    const invalid=record();mutate(invalid);assert.throws(()=>parseProviderTokenRecord(invalid,pair.local,now));
  }
  assert.throws(()=>parseProviderTokenSource({...source,checkedAt:new Date(now+300001).toISOString()},'Mac',now));
  const oversized=record();oversized.payload.source.scope='x'.repeat(17_000_001);
  assert.throws(()=>parseProviderTokenRecord(oversized,pair.local,now),/Invalid provider record/);
  assert.deepEqual(parseProviderTokenSource(unavailableClaudeTokenSource('Mac',new Date(now).toISOString()),'Mac',now).days,undefined);
});

test('readiness contains identities only and disabled replies never carry data',()=>{
  const request={version:1,action:'status',pairId:pair.local.pairId,deviceId:pair.local.deviceId};
  assert.deepEqual(parseProviderTokenRequest(request,pair.local),request);
  for(const extra of [{record:record()},{provider:'claude-code'},{days:[]}])assert.throws(()=>parseProviderTokenRequest({...request,...extra},pair.local));
  assert.throws(()=>parseProviderTokenRequest({...request,action:'exchange',record:null},pair.local));
  assert.throws(()=>parseProviderTokenRequest({...request,deviceId:pair.peer.deviceId},pair.local));
  for(const status of ['ready','disabled']) {
    assert.deepEqual(parseProviderTokenReply({version:1,status,record:null},request),{version:1,status,record:null});
    assert.throws(()=>parseProviderTokenReply({version:1,status,record:record()},request));
  }
  assert.throws(()=>parseProviderTokenReply({version:1,status:'disabled',record:record()},{action:'exchange'}));
});
