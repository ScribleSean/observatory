import test from 'node:test';
import assert from 'node:assert/strict';
import {attachTokenHours,stripTokenHours} from './token-hours.mjs';
const hours=Array.from({length:24},(_,i)=>i===8?10:0);
const row={host:'Mac',status:'ok',days:[{date:'2026-09-08',totalTokens:10},{date:'2026-09-09',totalTokens:20},{date:'2026-09-10',totalTokens:10}]};
test('hours attach only to matching totals and leave input intact',()=>{
  const before=structuredClone(row);
  const result=attachTokenHours(row,[{date:'2026-09-08',hours},{date:'2026-09-09',hours}]);
  assert.deepEqual(result.days[0].hours,hours);
  for(const day of result.days.slice(1))assert.equal(Object.hasOwn(day,'hours'),false);
  assert.deepEqual(row,before);assert.notEqual(result,row);assert.notEqual(result.days[0].hours,hours);
});
test('invalid entries and duplicate dates are ignored without losing other valid days',()=>{
  const invalid=[null,{},'bad',[],hours.slice(1),[...hours,0],hours.map((v,i)=>i===0?-1:v),
    hours.map((v,i)=>i===0?0.5:v),hours.map((v,i)=>i===0?'0':v),hours.map((v,i)=>i===0?Number.MAX_SAFE_INTEGER+1:v),Array.from({length:24})];
  for(const bad of invalid) {
    const result=attachTokenHours(row,[null,{},7,{date:'2026-09-08',hours:bad},{date:'2026-09-10',hours}]);
    assert.equal(Object.hasOwn(result.days[0],'hours'),false);assert.deepEqual(result.days[2].hours,hours);
  }
  for(const entries of [null,{},'bad',[{date:'2026-09-08',hours},{date:'2026-09-08',hours}],
    [{date:'2026-09-08',hours},{date:'2026-09-08'}]])assert.deepEqual(attachTokenHours(row,entries),row);
  const unavailable={status:'unavailable'};assert.equal(attachTokenHours(unavailable,null),unavailable);
});
test('stripping removes all token and provider day hours without changing inputs',()=>{
  for(const provider of [undefined,'claude-code']) {
    const input={...row,...(provider?{provider}:{}),days:row.days.map(day=>({...day,hours}))};
    const before=structuredClone(input),result=stripTokenHours(input);
    assert.ok(result.days.every(day=>!Object.hasOwn(day,'hours')));assert.deepEqual(input,before);
    assert.deepEqual(attachTokenHours(input,[]),result);
  }
});
