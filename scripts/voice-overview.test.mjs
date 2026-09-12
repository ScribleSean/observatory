import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceOverview} from './voice-overview.mjs';
const day=(date,audioSeconds=60)=>({date,transcriptions:2,words:12,audioSeconds,wordRecords:2,audioRecords:2,engines:[]});
const source=(host,days)=>({host,source:'Wispr Flow',status:'ok',checkedAt:'2026-09-12T12:00:00Z',days});
test('overall voice view exposes tools and devices without double-counting stores',()=>{
  const view=voiceOverview([source('Mac',[day('2026-09-12')]),source('Windows',[day('2026-09-12')])]);
  assert.equal(view.sources.length,4);assert.equal(view.reportingSources,2);
  assert.equal(view.voiceSeconds,null);assert.equal(view.daily.length,2);
  assert.ok(view.sources.filter(s=>s.source==='ChatGPT').every(s=>s.status==='not-supported'&&s.audioSeconds===null));
  assert.deepEqual(view.sources.filter(s=>s.source==='Wispr Flow').map(s=>s.audioSeconds),[60,60]);
});
test('all sources use the same calendar window rather than independent latest weeks',()=>{
  const rows=[source('Mac',[day('2026-09-01')]),source('Windows',[day('2026-09-12')])];
  assert.equal(voiceOverview(rows).sources.find(s=>s.host==='Mac'&&s.source==='Wispr Flow').records,null);
  assert.equal(voiceOverview(rows,{period:'all'}).reportingSources,2);
  assert.equal(voiceOverview(rows,{period:'day',date:'2026-09-01'}).daily.length,1);
});
test('missing duration stays unknown and an explicitly recorded zero remains zero',()=>{
  const missing={...day('2026-09-12',0),audioRecords:0};
  const view=voiceOverview([source('Mac',[missing,day('2026-09-11',0)])],{host:'Mac',tool:'Wispr Flow'});
  assert.equal(view.daily[0].audioSeconds,0);assert.equal(view.daily[1].audioSeconds,null);
  assert.equal(view.sources[0].audioRecords,2);assert.equal(view.sources[0].records,4);
});
test('duplicate sources, retired tools and claimed ChatGPT readings cannot fabricate coverage',()=>{
  const rows=[source('Mac',[day('2026-09-12')]),source('Mac',[day('2026-09-12')]),
    {...source('Windows',[day('2026-09-12')]),source:'Retired tool'},
    {...source('Windows',[day('2026-09-12')]),source:'ChatGPT',transcript:'PRIVATE'}];
  const view=voiceOverview(rows);assert.equal(view.reportingSources,0);assert.equal(view.daily.length,0);
  assert.equal(view.sources[0].status,'ambiguous');assert.ok(!JSON.stringify(view).includes('PRIVATE'));
});
test('projection preserves originals and strips raw content and invalid records',()=>{
  const row=source('Mac',[{...day('2026-09-12'),transcript:'PRIVATE'}]);row.path='PRIVATE';
  const before=JSON.stringify(row),view=voiceOverview([row]);
  assert.equal(JSON.stringify(row),before);assert.ok(!JSON.stringify(view).includes('PRIVATE'));
  row.days[0].words=-1;assert.equal(voiceOverview([row]).sources[0].status,'unavailable');
  assert.throws(()=>voiceOverview([],{host:'Phone'}));assert.throws(()=>voiceOverview([],{date:'2026-02-31'}));
});
