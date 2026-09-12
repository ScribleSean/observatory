import test from 'node:test';
import assert from 'node:assert/strict';
import {createPeerPayload,parsePeerPayload,mergePeerPayloads} from './peer-payload.mjs';
const now=Date.parse('2026-09-09T13:00:00.000Z'),comparisonId='a'.repeat(64);
const config=host=>({host,comparisonId,codexHosts:[host]});
const counts={inputTokens:10,cacheReadTokens:0,cacheCreationTokens:0,outputTokens:2,reasoningOutputTokens:0,totalTokens:12};
function raw(host) {
  return {collectedAt:'2026-09-09T12:59:00.000Z',secret:'PRIVATE',
    activity:{status:'ok',start:'2026-09-09T12:00:00.000Z',end:'2026-09-09T13:00:00.000Z',
      intervals:[{start:host==='Mac'?'2026-09-09T12:00:00.000Z':'2026-09-09T12:00:30.000Z',
        end:host==='Mac'?'2026-09-09T12:01:00.000Z':'2026-09-09T12:01:30.000Z',category:'Editors',app:'VS Code',title:'PRIVATE'}]},
    codex:[{host,status:'ok',profiles:[{date:'2026-09-09',model:'unknown',effort:'high',speed:'standard',...counts,prompt:'PRIVATE'}],
      tools:[{date:'2026-09-09',category:'Shell',tool:'exec_command',namespace:'functions',count:1,arguments:'PRIVATE'}],
      inventory:{status:'ok',keys:[(host==='Mac'?'0':'1').repeat(64)],parents:[],rawSession:'PRIVATE'}}],
    dictation:[{source:'Wispr Flow',status:'ok',days:[{date:'2026-09-09',transcriptions:1,words:5,audioSeconds:2,
      engines:[],wordRecords:1,audioRecords:1,transcript:'PRIVATE'}]},...(host==='Mac'?[{source:'TypeWhisper',status:'not-found',privatePath:'PRIVATE'}]:[])]};
}
const packet=host=>createPeerPayload(raw(host),config(host));

test('updated peers accept Windows TypeWhisper and still accept legacy Windows packets',()=>{
  const source=raw('Windows');
  source.dictation.push({source:'TypeWhisper',status:'ok',days:[{date:'2026-09-09',
    transcriptions:2,words:12,audioSeconds:7,engines:[],transcript:'PRIVATE'}]});
  const windows=createPeerPayload(source,config('Windows'));
  assert.deepEqual(parsePeerPayload(JSON.stringify(windows),config('Windows'),now),windows);
  assert.equal(parsePeerPayload(JSON.stringify(packet('Windows')),config('Windows'),now).dictation.length,1);
  const merged=mergePeerPayloads(packet('Mac'),windows,config('Mac'),config('Windows'),[],now);
  assert.equal(merged.dictation.find(row=>row.host==='Windows' && row.source==='TypeWhisper').days[0].words,12);
  assert.ok(!JSON.stringify(merged).includes('PRIVATE'));
  const repeated=mergePeerPayloads(packet('Mac'),windows,config('Mac'),config('Windows'),merged.activityHistory,now);
  assert.deepEqual(repeated.dictation,merged.dictation);
  for(const mutate of [p=>p.dictation.push(p.dictation[1]),p=>{p.dictation[1].source='Other';},
    p=>{p.dictation[1].days[0].transcript='PRIVATE';},p=>{p.dictation[1].days[0].words=-1;}]) {
    const invalid=structuredClone(windows);mutate(invalid);
    assert.throws(()=>parsePeerPayload(JSON.stringify(invalid),config('Windows'),now));
  }
});

test('outbound peer payload strips raw fields and inbound canonical form round-trips',()=>{
  for(const host of ['Mac','Windows']) {
    const payload=packet(host),text=JSON.stringify(payload);
    assert.ok(!text.includes('PRIVATE'));
    assert.deepEqual(parsePeerPayload(text,config(host),now),payload);
  }
});
test('either app derives the same combined dashboard without leaking private evidence',()=>{
  const mac=packet('Mac'),windows=packet('Windows');
  const a=mergePeerPayloads(mac,windows,config('Mac'),config('Windows'),[],now);
  const b=mergePeerPayloads(windows,mac,config('Windows'),config('Mac'),[],now);
  assert.deepEqual(a,b);assert.equal(a.combined.days[0].seconds,90);
  assert.equal(a.combinedTokens.days[0].totalTokens,24);
  assert.equal(a.tokens.find(s=>s.host==='Ubuntu').status,'not-connected');
  for(const secret of ['PRIVATE','inventory','comparisonId','intervals','0'.repeat(64),'1'.repeat(64)])
    assert.ok(!JSON.stringify(a).includes(secret));
  assert.equal(a.dictation.length,3);
});
test('inbound extra fields, host spoofing, changed comparison ID and malformed counts fail closed',()=>{
  for(const mutate of [p=>{p.prompt='PRIVATE';},p=>{p.host='Windows';},p=>{p.comparisonId='b'.repeat(64);},
    p=>{p.codex[0].profiles[0].inputTokens=11;},p=>{p.codex[0].tools[0].arguments='PRIVATE';},
    p=>{p.activity.intervals[0].title='PRIVATE';},p=>{p.collectedAt='2026-09-09T14:00:00.000Z';}]) {
    const payload=packet('Mac');mutate(payload);
    assert.throws(()=>parsePeerPayload(JSON.stringify(payload),config('Mac'),now));
  }
  assert.throws(()=>parsePeerPayload(' '.repeat(16_000_001),config('Mac'),now));
});
test('repeated merges replace history and never accumulate tokens or activity',()=>{
  const first=mergePeerPayloads(packet('Mac'),packet('Windows'),config('Mac'),config('Windows'),[],now);
  const second=mergePeerPayloads(packet('Mac'),packet('Windows'),config('Mac'),config('Windows'),first.activityHistory,now);
  assert.deepEqual(first,second);
});
test('stale peer retains dated local views and history without current combined totals',()=>{
  const old=packet('Windows');old.collectedAt='2026-09-09T12:00:00.000Z';
  const result=mergePeerPayloads(packet('Mac'),old,config('Mac'),config('Windows'),[],now);
  assert.equal(result.combined.status,'unavailable');assert.equal(result.combinedTokens.status,'unavailable');
  assert.equal(result.tokens.find(s=>s.host==='Windows').checkedAt,old.collectedAt);
  assert.equal(result.activityHistory.find(s=>s.host==='Windows').asOf,old.collectedAt);
});
test('configured Ubuntu is required and overlapping inventory blocks totals',()=>{
  const windowsConfig={...config('Windows'),codexHosts:['Windows','Ubuntu']};
  assert.throws(()=>createPeerPayload(raw('Windows'),windowsConfig));
  const local=raw('Windows');local.codex.push({...local.codex[0],host:'Ubuntu',inventory:{status:'ok',keys:['2'.repeat(64)],parents:[]}});
  const windows=createPeerPayload(local,windowsConfig);
  const result=mergePeerPayloads(packet('Mac'),windows,config('Mac'),windowsConfig,[],now);
  assert.equal(result.combinedTokens.days[0].totalTokens,36);
  windows.codex[1].inventory.parents=['0'.repeat(64)];
  assert.equal(mergePeerPayloads(packet('Mac'),windows,config('Mac'),windowsConfig,[],now).combinedTokens.status,'overlap');
});
test('unavailable and disabled sources remain explicit, not zero',()=>{
  const local=raw('Windows');local.codex=[{host:'Windows',status:'unavailable'}];local.activity={status:'not-connected'};
  const windows=createPeerPayload(local,config('Windows'));
  const result=mergePeerPayloads(packet('Mac'),windows,config('Mac'),config('Windows'),[],now);
  assert.notEqual(result.combinedTokens.status,'ok');assert.equal(result.combined.status,'unavailable');
  assert.equal(result.tokens.find(s=>s.host==='Windows').status,'unavailable');
});
