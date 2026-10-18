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
      engines:[],wordRecords:1,audioRecords:1,transcript:'PRIVATE'}]}]};
}
const packet=host=>createPeerPayload(raw(host),config(host));
test('peer protocol only accepts the supported Wispr source',()=>{
  for(const host of ['Mac','Windows']) {
    const value=packet(host);
    assert.equal(value.dictation.length,1);
    assert.equal(value.dictation[0].source,'Wispr Flow');
    for(const mutate of [p=>p.dictation.push({...p.dictation[0],source:'Retired source'}),
      p=>{p.dictation[0].source='Other';},p=>{p.dictation[0].days[0].transcript='PRIVATE';}]) {
      const invalid=structuredClone(value);mutate(invalid);
      assert.throws(()=>parsePeerPayload(JSON.stringify(invalid),config(host),now));
    }
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
  assert.equal(Object.hasOwn(a,'localModel'),false);
  assert.deepEqual(a,b);assert.equal(a.combined.days[0].seconds,90);
  assert.equal(a.combinedTokens.days[0].totalTokens,24);
  assert.equal(a.tokens.some(s=>s.host==='Ubuntu'),false);
  for(const secret of ['PRIVATE','inventory','comparisonId','intervals','0'.repeat(64),'1'.repeat(64)])
    assert.ok(!JSON.stringify(a).includes(secret));
  assert.equal(a.dictation.length,2);
});
test('peer token history round-trips and combines retained dates outside the recent scan',()=>{
  const mac=raw('Mac'),windows=raw('Windows');
  for(const value of [mac,windows]) value.codex[0].tokenProfiles=[{...value.codex[0].profiles[0],date:'2026-08-01',totalTokens:24,inputTokens:20,outputTokens:4,prompt:'PRIVATE'}];
  const result=mergePeerPayloads(createPeerPayload(mac,config('Mac')),createPeerPayload(windows,config('Windows')),config('Mac'),config('Windows'),[],now);
  assert.equal(result.tokens.find(source=>source.host==='Mac').scope,'All retained saved Codex logs only');
  assert.equal(result.combinedTokens.days[0].date,'2026-08-01');
  assert.equal(result.combinedTokens.days[0].totalTokens,48);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});
test('inbound extra fields, host spoofing, changed comparison ID and malformed counts fail closed',()=>{
  for(const mutate of [p=>{p.prompt='PRIVATE';},p=>{p.host='Windows';},p=>{p.comparisonId='b'.repeat(64);},
    p=>{p.codex[0].profiles[0].inputTokens=11;},p=>{p.codex[0].tools[0].arguments='PRIVATE';},
    p=>{p.codex[0].tokenProfiles=[{...p.codex[0].profiles[0],date:'bad'}];},
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
  assert.equal(result.activityHistory.find(s=>s.host==='Windows').asOf,null);
  assert.equal(result.activityHistory.find(s=>s.host==='Windows').latestReadStatus,'stale');
});
test('two-slot configurations and payloads are refused',()=>{
  const value=raw('Windows'),legacy={...config('Windows'),codexHosts:['Windows','Ubuntu']};
  assert.throws(()=>createPeerPayload(value,legacy));
  value.codex.push({host:'Ubuntu',status:'not-connected'});
  assert.throws(()=>createPeerPayload(value,legacy));
  assert.throws(()=>createPeerPayload(value,config('Windows')));
});
test('native recorded usage without keys withholds combined totals',()=>{
  for(const retained of [false,true]) {
    const windows=packet('Windows');windows.codex[0].inventory.keys=[];
    if(retained) {windows.codex[0].tokenProfiles=windows.codex[0].profiles;windows.codex[0].profiles=[];}
    const result=mergePeerPayloads(packet('Mac'),windows,config('Mac'),config('Windows'),[],now);
    assert.equal(result.combinedTokens.status,'unverified');
    assert.equal(result.combinedTokens.days,undefined);
  }
});

test('unresolved parents in native-only pairing withhold totals without requiring retired collection',()=>{
  const mac=packet('Mac'),windows=packet('Windows');
  windows.codex[0].inventory.parents=['2'.repeat(64)];
  const result=mergePeerPayloads(mac,windows,config('Mac'),config('Windows'),[],now);
  assert.equal(result.combinedTokens.status,'unverified');assert.equal(result.combinedTokens.days,undefined);
  assert.equal(result.combinedSettings.status,'unavailable');
  assert.deepEqual(result.tokens.map(row=>[row.host,row.days[0].totalTokens]),[['Mac',12],['Windows',12]]);
});

test('unavailable and disabled sources remain explicit, not zero',()=>{
  const local=raw('Windows');local.codex=[{host:'Windows',status:'unavailable'}];local.activity={status:'not-connected'};
  const windows=createPeerPayload(local,config('Windows'));
  const result=mergePeerPayloads(packet('Mac'),windows,config('Mac'),config('Windows'),[],now);
  assert.notEqual(result.combinedTokens.status,'ok');assert.equal(result.combined.status,'unavailable');
  assert.equal(result.tokens.find(s=>s.host==='Windows').status,'unavailable');
});

test('single-host legacy and current configurations produce the same wire payload',()=>{
  for(const host of ['Mac','Windows']) {
    const current={host,comparisonId};
    assert.deepEqual(createPeerPayload(raw(host),current),packet(host));
    for(const scope of [null,undefined,[],[host,host],['Ubuntu'],{0:host,length:1}])
      assert.throws(()=>createPeerPayload(raw(host),{...current,codexHosts:scope}));
  }
});

test('native evidence freshness boundaries preserve original observations',()=>{
  for(const [age,status] of [[600000,'ok'],[600001,'unavailable']]) {
    const windows=packet('Windows');windows.collectedAt=new Date(now-age).toISOString();
    const before=JSON.stringify(windows);
    const result=mergePeerPayloads(packet('Mac'),windows,config('Mac'),config('Windows'),[],now);
    assert.equal(result.combinedTokens.status,status);
    assert.equal(result.tokens.find(row=>row.host==='Windows').checkedAt,windows.collectedAt);
    assert.equal(result.activityHistory.find(row=>row.host==='Windows').asOf,status==='ok'?windows.collectedAt:null);
    assert.equal(JSON.stringify(windows),before);
  }
});

test('native wire evidence rejects malformed and extra private fields',()=>{
  for(const mutate of [p=>{delete p.codex[0].inventory;},
    p=>{p.codex[0].inventory.keys=['raw-session-id'];},p=>{p.codex[0].inventory.parents=null;},
    p=>{p.codex[0].inventory.status='unavailable';},p=>{p.codex[0].inventory.salt='PRIVATE';},
    p=>{p.codex[0].inventory.comparisonId='b'.repeat(64);}]) {
    const windows=packet('Windows');mutate(windows);
    assert.throws(()=>mergePeerPayloads(packet('Mac'),windows,config('Mac'),config('Windows'),[],now));
  }
});

test('Combined activity reading time is the earlier payload collection time',()=>{
  for(const host of ['Mac','Windows']) {
    const mac=packet('Mac'),windows=packet('Windows');
    (host==='Mac'?mac:windows).collectedAt='2026-09-09T12:58:00.000Z';
    const result=mergePeerPayloads(mac,windows,config('Mac'),config('Windows'),[],now);
    assert.equal(result.combined.checkedAt,'2026-09-09T12:58:00.000Z');
  }
});

for (const age of [9, 11]) test(`peer sources at ${age} minutes preserve reading times and freshness`, () => {
  const local = packet('Mac'), peer = packet('Windows');
  const baseline = mergePeerPayloads(local, peer, config('Mac'), config('Windows'), [], now);
  peer.collectedAt = new Date(now - age * 60000).toISOString();
  const result = mergePeerPayloads(local, peer, config('Mac'), config('Windows'), baseline.activityHistory, now);
  for (const key of ['activity', 'tokens', 'settings', 'dictation']) {
    assert.deepEqual(result[key].find(row => row.host === 'Mac'), baseline[key].find(row => row.host === 'Mac'));
    const row = result[key].find(row => row.host === 'Windows');
    assert.equal(row.status, age > 10 ? 'stale' : 'ok');
    assert.equal(row.checkedAt, peer.collectedAt);
  }
  if (age > 10) {
    for (const key of ['combined', 'combinedTokens', 'combinedSettings']) assert.notEqual(result[key].status, 'ok');
    const history = result.activityHistory.find(row => row.host === 'Windows');
    assert.equal(history.latestReadStatus, 'stale');
    assert.deepEqual(history.days, baseline.activityHistory.find(row => row.host === 'Windows').days);
  }
});

test('a late peer source that was not read keeps its status instead of becoming stale', () => {
  const local = packet('Mac'), peer = packet('Windows');
  peer.activity = { host: 'Windows', status: 'unavailable' };
  peer.collectedAt = new Date(now - 11 * 60000).toISOString();
  const result = mergePeerPayloads(local, peer, config('Mac'), config('Windows'), [], now);
  const row = result.activity.find(row => row.host === 'Windows');
  assert.equal(row.status, 'unavailable');
  assert.equal(row.checkedAt, peer.collectedAt);
  assert.equal(result.tokens.find(row => row.host === 'Windows').status, 'stale');
});
