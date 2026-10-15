import test from 'node:test';
import assert from 'node:assert/strict';
import {captureLocalAdditions,reapplyLocalAdditions} from './local-additions.mjs';
const hours=[12,...Array(23).fill(0)];
const fixture=()=>({tokens:[{host:'Mac',status:'ok',days:[{date:'2026-10-01',totalTokens:12,hours}]}],
  settings:[{host:'Mac',status:'unavailable',refusal:'ancestor-refused'}],
  activity:[{host:'Mac',status:'unavailable',refusal:'private-folder-refused'}],
  dictation:[{host:'Mac',source:'Wispr Flow',status:'unavailable',refusal:'private-folder-refused'}]});
test('reapplying local additions leaves an unmerged snapshot unchanged',()=>{
  const data=fixture(),before=structuredClone(data);reapplyLocalAdditions(data,'Mac',captureLocalAdditions(data,'Mac'));
  assert.deepEqual(data,before);
});
test('hours require matching totals and refusals require a non-ok own-host row',()=>{
  const captured=captureLocalAdditions(fixture(),'Mac');
  for(const totalTokens of [12,13]) {
    const peer={host:'Windows',status:'unavailable',refusal:'untouched'},data={
      tokens:[{host:'Mac',status:'ok',days:[{date:'2026-10-01',totalTokens},{date:'2026-10-02',totalTokens:12}]},peer],
      settings:[{host:'Mac',status:'unavailable'},peer],activity:[{host:'Mac',status:'ok'},peer],
      dictation:[{host:'Mac',source:'Wispr Flow',status:'unavailable'},peer]};
    reapplyLocalAdditions(data,'Mac',captured);
    assert.deepEqual(data.tokens[0].days[0].hours,totalTokens===12?hours:undefined);
    assert.equal(data.tokens[0].days[1].hours,undefined);
    assert.equal(data.settings[0].refusal,'ancestor-refused');assert.equal(data.activity[0].refusal,undefined);
    assert.equal(data.dictation[0].refusal,'private-folder-refused');
    for(const key of ['tokens','settings','activity','dictation'])assert.equal(data[key][1],peer);
    assert.deepEqual(peer,{host:'Windows',status:'unavailable',refusal:'untouched'});
  }
});

test('equal token totals on the same day give hours only to the own-host row',()=>{
  const data={tokens:['Mac','Windows'].map(host=>({host,status:'ok',days:[{date:'2026-10-01',totalTokens:12}]}))};
  reapplyLocalAdditions(data,'Mac',captureLocalAdditions(fixture(),'Mac'));
  assert.deepEqual(data.tokens[0].days[0].hours,hours);
  assert.equal(Object.hasOwn(data.tokens[1].days[0],'hours'),false);
});
