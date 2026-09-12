import test from 'node:test';
import assert from 'node:assert/strict';
import {windowsSnapshot} from './windows-dashboard.mjs';
const at='2026-09-09T13:00:00.000Z';
const peerConfig={host:'Windows',comparisonId:'a'.repeat(64),codexHosts:['Windows']};
const counts={inputTokens:10,cacheReadTokens:0,cacheCreationTokens:0,outputTokens:2,reasoningOutputTokens:0,totalTokens:12};
const settings=()=>({status:'ok',checkedAt:'2026-09-09T12:59:59.000Z',profiles:[{date:'2026-09-09',model:'unknown',effort:'high',speed:'standard',...counts,prompt:'PRIVATE'}],
  tools:[],inventory:{status:'ok',keys:['b'.repeat(64)],parents:[]}});
const raw=()=>({localSettings:settings(),ubuntuSettings:{status:'not-connected'},
  windows:{status:'ok',start:'2026-09-09T12:00:00.000Z',end:at,
    intervals:[{start:'2026-09-09T12:00:00.000Z',end:'2026-09-09T12:01:00.000Z',category:'Editors',app:'VS Code',title:'PRIVATE'}]},
  wispr:{status:'not-found',privatePath:'PRIVATE'}});

test('Windows projection preserves local source shape and optional Ubuntu absence',()=>{
  const {data,status,peer}=windowsSnapshot(raw(),[],at);
  assert.equal(peer,undefined);assert.equal(data.schema,2);assert.equal(data.tokens[0].host,'Mac');
  assert.equal(data.tokens[1].days[0].totalTokens,12);assert.equal(data.tokens[2].status,'not-connected');
  assert.equal(data.tokens[1].checkedAt,'2026-09-09T12:59:59.000Z');
  assert.equal(data.dictation[0].status,'not-found');assert.equal(status.state,'partial');
  assert.equal(data.activity[1].days[0].seconds,60);assert.equal(data.activity[1].intervals,undefined);
  assert.ok(!JSON.stringify(data).includes('PRIVATE'));assert.ok(!JSON.stringify(data).includes('b'.repeat(64)));
});
test('peer output shares input counters and intervals without duplicating them in public data',()=>{
  const result=windowsSnapshot(raw(),[],at,peerConfig);
  assert.equal(result.peer.status,'ready');assert.equal(result.peer.payload.codex[0].profiles[0].totalTokens,12);
  assert.equal(result.peer.payload.activity.intervals.length,1);assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  assert.equal(result.data.activity[1].intervals,undefined);
});
test('optional Ubuntu peer source uses its own identity and evidence',()=>{
  const input=raw();input.ubuntuSettings=settings();input.ubuntuSettings.inventory.keys=['c'.repeat(64)];
  const result=windowsSnapshot(input,[],at,{...peerConfig,codexHosts:['Windows','Ubuntu']});
  assert.equal(result.peer.status,'ready');assert.equal(result.peer.payload.codex[1].host,'Ubuntu');
  assert.deepEqual(result.peer.payload.codex[1].inventory.keys,['c'.repeat(64)]);
  assert.equal(result.data.tokens[2].days[0].totalTokens,12);
});
test('bad inventory disables only export and malformed counters do not become successful zeroes',()=>{
  const missing=raw();delete missing.localSettings.inventory;
  const result=windowsSnapshot(missing,[],at,peerConfig);
  assert.equal(result.peer.status,'unavailable');assert.equal(result.data.tokens[1].status,'ok');
  const invalid=raw();invalid.localSettings.profiles[0].totalTokens=999;
  assert.equal(windowsSnapshot(invalid,[],at).data.tokens[1].status,'unavailable');
});
test('disabled sources and invalid timestamps cannot leak private metadata',()=>{
  const result=windowsSnapshot({localSettings:{status:'not-connected',checkedAt:'PRIVATE'},ubuntuSettings:{status:'not-connected'},
    windows:{status:'not-connected'},wispr:{status:'not-connected'}},[],at);
  assert.equal(result.status.sourcesConfigured,0);assert.equal(result.status.state,'partial');
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});

test('retired source input is omitted from local and peer projections',()=>{
  const input=raw();
  input.typewhisper={status:'ok',days:[{transcript:'PRIVATE'}]};
  const result=windowsSnapshot(input,[],at,peerConfig);
  assert.equal(result.peer.status,'ready');
  assert.equal(result.data.dictation.length,1);
  assert.equal(result.peer.payload.dictation.length,1);
  assert.equal(result.data.dictation[0].source,'Wispr Flow');
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});
