import test from 'node:test';
import assert from 'node:assert/strict';
import {createPeerPayload,parsePeerPayload,mergePeerPayloads} from './peer-payload.mjs';
import {combinePeerTokens} from './peer-inventory.mjs';
import {tokensFromSettings} from './windows-snapshot.mjs';
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
function legacyPair() {
  const macConfig=config('Mac'),windowsConfig={...config('Windows'),codexHosts:['Windows','Ubuntu']};
  const local=raw('Windows');
  local.codex.push({...local.codex[0],host:'Ubuntu',inventory:{status:'ok',keys:['2'.repeat(64)],parents:[]}});
  return {mac:packet('Mac'),windows:createPeerPayload(local,windowsConfig),macConfig,windowsConfig};
}

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
  assert.equal(result.activityHistory.find(s=>s.host==='Windows').asOf,old.collectedAt);
});
test('legacy Ubuntu wire scope remains validated but never enters native totals',()=>{
  const windowsConfig={...config('Windows'),codexHosts:['Windows','Ubuntu']};
  assert.throws(()=>createPeerPayload(raw('Windows'),windowsConfig));
  const local=raw('Windows');local.codex.push({...local.codex[0],host:'Ubuntu',inventory:{status:'ok',keys:['2'.repeat(64)],parents:[]}});
  const windows=createPeerPayload(local,windowsConfig);
  const text=JSON.stringify(windows);
  assert.deepEqual(parsePeerPayload(text,windowsConfig,now),windows);
  const result=mergePeerPayloads(packet('Mac'),windows,config('Mac'),windowsConfig,[],now);
  assert.equal(result.combinedTokens.days[0].totalTokens,24);
  assert.equal(result.tokens.some(source=>source.host==='Ubuntu'),false);
  assert.equal(result.settings.some(source=>source.host==='Ubuntu'),false);
  assert.equal(JSON.stringify(windows),text);
  windows.codex[1].inventory.parents=['0'.repeat(64)];
  assert.equal(mergePeerPayloads(packet('Mac'),windows,config('Mac'),windowsConfig,[],now).combinedTokens.status,'ok');
  windows.codex[0].inventory.parents=['0'.repeat(64)];
  assert.equal(mergePeerPayloads(packet('Mac'),windows,config('Mac'),windowsConfig,[],now).combinedTokens.status,'overlap');
  windows.codex[1].profiles[0].totalTokens=999;
  assert.throws(()=>mergePeerPayloads(packet('Mac'),windows,config('Mac'),windowsConfig,[],now));
});
test('Mac to Ubuntu to Windows inherited turns withhold native combined totals',()=>{
  const macConfig=config('Mac'),windowsConfig={...config('Windows'),codexHosts:['Windows','Ubuntu']};
  const mac=packet('Mac'),local=raw('Windows');
  local.codex[0].inventory={status:'ok',keys:['2'.repeat(64)],parents:['1'.repeat(64)]};
  local.codex.push({...local.codex[0],host:'Ubuntu',inventory:{status:'ok',keys:['1'.repeat(64)],parents:['0'.repeat(64)]}});
  const windows=createPeerPayload(local,windowsConfig);
  const before=JSON.stringify({mac,windows,macConfig,windowsConfig});
  const all=[...mac.codex,...windows.codex];
  assert.equal(combinePeerTokens(all.map(row=>tokensFromSettings(row,row.host)),
    all.map(row=>({version:1,comparisonId,host:row.host,...row.inventory})),
    comparisonId,['Mac','Windows','Ubuntu']).status,'overlap');
  const result=mergePeerPayloads(mac,windows,macConfig,windowsConfig,[],now);
  assert.equal(result.combinedTokens.status,'overlap');
  assert.equal(result.combinedTokens.days,undefined);
  assert.equal(result.combinedSettings.status,'unavailable');
  assert.deepEqual(result.tokens.map(row=>[row.host,row.days[0].totalTokens]),[['Mac',12],['Windows',12]]);
  assert.deepEqual(result.settings.map(row=>row.host),['Mac','Windows']);
  assert.deepEqual(mergePeerPayloads(windows,mac,windowsConfig,macConfig,[],now),result);
  assert.deepEqual(mergePeerPayloads(mac,windows,macConfig,windowsConfig,result.activityHistory,now),result);
  assert.equal(JSON.stringify({mac,windows,macConfig,windowsConfig}),before);
  for(const secret of ['inventory','comparisonId','0'.repeat(64),'1'.repeat(64),'2'.repeat(64)])
    assert.ok(!JSON.stringify(result).includes(secret));
});

test('retired recorded usage without session keys is incomplete evidence, not zero usage',()=>{
  for(const retained of [false,true]) {
    const {mac,windows,macConfig,windowsConfig}=legacyPair();
    windows.codex[1].inventory.keys=[];
    if(retained) {windows.codex[1].tokenProfiles=windows.codex[1].profiles;windows.codex[1].profiles=[];}
    const before=JSON.stringify({mac,windows,macConfig,windowsConfig});
    assert.deepEqual(parsePeerPayload(JSON.stringify(windows),windowsConfig,now),windows);
    const result=mergePeerPayloads(mac,windows,macConfig,windowsConfig,[],now);
    assert.equal(result.combinedTokens.status,'unverified');
    assert.equal(result.combinedTokens.days,undefined);
    assert.equal(result.combinedSettings.status,'unavailable');
    assert.deepEqual(result.tokens.map(row=>[row.host,row.days[0].totalTokens]),[['Mac',12],['Windows',12]]);
    assert.equal(JSON.stringify({mac,windows,macConfig,windowsConfig}),before);
  }
});

for(const retained of ['empty','zero'])test(`retired positive recent usage with ${retained} retained profiles requires session keys`,()=>{
  const {mac,windows,macConfig,windowsConfig}=legacyPair(),retired=windows.codex[1];
  retired.inventory.keys=[];
  retired.tokenProfiles=retained==='empty'?[]:[{...retired.profiles[0],
    ...Object.fromEntries(Object.keys(counts).map(key=>[key,0]))}];
  const before=JSON.stringify({mac,windows,macConfig,windowsConfig});
  assert.deepEqual(parsePeerPayload(JSON.stringify(windows),windowsConfig,now),windows);
  const result=mergePeerPayloads(mac,windows,macConfig,windowsConfig,[],now);
  assert.equal(result.combinedTokens.status,'unverified');
  assert.equal(result.combinedTokens.days,undefined);
  assert.equal(result.combinedSettings.status,'unavailable');
  assert.deepEqual(result.tokens.map(row=>[row.host,row.days[0].totalTokens]),[['Mac',12],['Windows',12]]);
  assert.deepEqual(result.settings.map(row=>row.host),['Mac','Windows']);
  assert.deepEqual(mergePeerPayloads(windows,mac,windowsConfig,macConfig,[],now),result);
  assert.deepEqual(mergePeerPayloads(mac,windows,macConfig,windowsConfig,result.activityHistory,now),result);
  assert.equal(JSON.stringify({mac,windows,macConfig,windowsConfig}),before);
  for(const secret of ['PRIVATE','inventory','comparisonId','keys','parents',comparisonId,
    '0'.repeat(64),'1'.repeat(64),'2'.repeat(64)])
    assert.ok(!JSON.stringify(result).includes(secret));
});

test('unavailable or incomplete retired evidence preserves dated native readings, not combined totals',()=>{
  for(const status of ['unavailable','not-connected','incomplete']) {
    const {mac,windows,macConfig,windowsConfig}=legacyPair();
    windows.collectedAt='2026-09-09T12:58:00.000Z';
    if(status==='incomplete')windows.codex[1].inventory.status=status;
    else windows.codex[1]={host:'Ubuntu',status};
    const before=JSON.stringify({mac,windows,macConfig,windowsConfig});
    assert.deepEqual(parsePeerPayload(JSON.stringify(windows),windowsConfig,now),windows);
    const result=mergePeerPayloads(mac,windows,macConfig,windowsConfig,[],now);
    assert.equal(result.combinedTokens.status,'unverified',status);
    assert.equal(result.combinedTokens.days,undefined);
    assert.equal(result.combinedSettings.status,'unavailable');
    assert.deepEqual(result.tokens.map(row=>[row.host,row.days[0].totalTokens,row.checkedAt]),
      [['Mac',12,mac.collectedAt],['Windows',12,windows.collectedAt]]);
    assert.deepEqual(result.settings.map(row=>[row.host,row.checkedAt]),
      [['Mac',mac.collectedAt],['Windows',windows.collectedAt]]);
    assert.deepEqual(mergePeerPayloads(windows,mac,windowsConfig,macConfig,[],now),result);
    assert.deepEqual(mergePeerPayloads(mac,windows,macConfig,windowsConfig,result.activityHistory,now),result);
    assert.equal(JSON.stringify({mac,windows,macConfig,windowsConfig}),before);
  }
});

test('retired wire records still reject missing, malformed and extra private evidence',()=>{
  for(const mutate of [p=>{p.codex.pop();},p=>{delete p.codex[1].inventory;},
    p=>{p.codex[1].inventory.keys=['raw-session-id'];},p=>{p.codex[1].inventory.parents=null;},
    p=>{p.codex[1].inventory.status='unavailable';},p=>{p.codex[1].inventory.salt='PRIVATE';},
    p=>{p.codex[1].inventory.comparisonId='b'.repeat(64);},p=>{p.comparisonId='b'.repeat(64);}]) {
    const {mac,windows,macConfig,windowsConfig}=legacyPair();mutate(windows);
    const before=JSON.stringify({mac,windows,macConfig,windowsConfig});
    assert.throws(()=>mergePeerPayloads(mac,windows,macConfig,windowsConfig,[],now));
    assert.equal(JSON.stringify({mac,windows,macConfig,windowsConfig}),before);
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

test('a complete empty retired inventory permits native disjoint totals without invented usage',()=>{
  const {mac,windows,macConfig,windowsConfig}=legacyPair();
  windows.codex[1].profiles=[];windows.codex[1].tools=[];windows.codex[1].inventory.keys=[];
  for(const payload of [mac,windows])payload.codex[0].profiles[0].model='test-model';
  const before=JSON.stringify({mac,windows,macConfig,windowsConfig});
  const result=mergePeerPayloads(mac,windows,macConfig,windowsConfig,[],now);
  assert.equal(result.combinedTokens.status,'ok');assert.equal(result.combinedTokens.days[0].totalTokens,24);
  assert.equal(result.combinedSettings.profiles[0].totalTokens,24);
  assert.deepEqual(result.tokens.map(row=>row.host),['Mac','Windows']);
  assert.equal(JSON.stringify({mac,windows,macConfig,windowsConfig}),before);
});

test('legacy evidence obeys freshness boundaries and never restamps native observations',()=>{
  for(const [age,status] of [[600000,'ok'],[600001,'unavailable']]) {
    const {mac,windows,macConfig,windowsConfig}=legacyPair();
    windows.collectedAt=new Date(now-age).toISOString();
    windows.codex[1].inventory.parents=mac.codex[0].inventory.keys;
    const before=JSON.stringify({mac,windows,macConfig,windowsConfig});
    const result=mergePeerPayloads(mac,windows,macConfig,windowsConfig,[],now);
    assert.equal(result.combinedTokens.status,status);
    if(status==='ok')assert.equal(result.combinedTokens.days[0].totalTokens,24);
    else {assert.equal(result.combinedTokens.days,undefined);assert.equal(result.combinedSettings.status,'unavailable');}
    assert.equal(result.tokens.find(row=>row.host==='Windows').checkedAt,windows.collectedAt);
    assert.equal(result.settings.find(row=>row.host==='Windows').checkedAt,windows.collectedAt);
    assert.equal(result.activityHistory.find(row=>row.host==='Windows').asOf,windows.collectedAt);
    assert.equal(JSON.stringify({mac,windows,macConfig,windowsConfig}),before);
  }
  const {mac,windows,macConfig,windowsConfig}=legacyPair();
  for(const stamp of [new Date(now+300001).toISOString(),'bad','2026-09-09T12:59:00Z']) {
    windows.collectedAt=stamp;
    assert.throws(()=>mergePeerPayloads(mac,windows,macConfig,windowsConfig,[],now));
  }
});

test('unavailable and disabled sources remain explicit, not zero',()=>{
  const local=raw('Windows');local.codex=[{host:'Windows',status:'unavailable'}];local.activity={status:'not-connected'};
  const windows=createPeerPayload(local,config('Windows'));
  const result=mergePeerPayloads(packet('Mac'),windows,config('Mac'),config('Windows'),[],now);
  assert.notEqual(result.combinedTokens.status,'ok');assert.equal(result.combined.status,'unavailable');
  assert.equal(result.tokens.find(s=>s.host==='Windows').status,'unavailable');
});
