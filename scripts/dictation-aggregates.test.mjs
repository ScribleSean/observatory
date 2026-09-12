import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanDictation,summarizeDictation} from './dictation-aggregates.mjs';
const row={date:'2026-09-08',transcriptions:2,words:12,audioSeconds:7,engines:[]};
test('aggregate validation strips private fields and keeps unknown distinct from zero',()=>{
  const safe=cleanDictation({status:'ok',secret:'PRIVATE',days:[{...row,transcript:'PRIVATE'}]},'Mac');
  assert.ok(!JSON.stringify(safe).includes('PRIVATE'));
  assert.equal(summarizeDictation({status:'unavailable'}),null);
  assert.equal(summarizeDictation(safe,'2026-09-09'),null);
  assert.equal(summarizeDictation(safe).words,12);
  assert.deepEqual(cleanDictation({status:'ambiguous',days:[row]},'Windows'),{host:'Windows',status:'ambiguous'});
});
test('aggregate validation rejects malformed counts, dates, duplicate dates and private model names',()=>{
  for(const change of [{transcriptions:-1},{words:null},{audioSeconds:Infinity},{date:'2026-02-31'},
    {engines:[{engine:'PRIVATE',transcriptions:2}]}])
    assert.throws(()=>cleanDictation({status:'ok',days:[{...row,...change}]},'Mac'));
  assert.throws(()=>cleanDictation({status:'ok',days:[row,row]},'Mac'));
});
