import {test} from 'node:test';
import assert from 'node:assert/strict';
import {activityCombinations,selectActivityPairs} from './activity-buckets.mjs';
import {cleanActivity} from './collect-dashboard.mjs';

const pair = hostname => [
  {id:`window_${hostname}`,hostname,type:'currentwindow'},
  {id:`afk_${hostname}`,hostname,type:'afkstatus'},
];
test('reads both verified local aliases while excluding another computer', () => {
  const selected=selectActivityPairs([...pair('old'),...pair('new.local'),...pair('remote')],['old','NEW']);
  assert.deepEqual(selected,[{window:'window_old',afk:'afk_old'},{window:'window_new.local',afk:'afk_new.local'}]);
});
test('does not guess the newest or mix different hosts into a watcher pair', () => {
  assert.throws(()=>selectActivityPairs(pair('remote'),['local']));
  assert.throws(()=>selectActivityPairs([pair('local')[0],pair('other')[1]],['local','other']));
  assert.throws(()=>selectActivityPairs([...pair('local'),pair('local')[0]],['local']));
  assert.throws(()=>selectActivityPairs(pair('local'),[]));
});
test('reads window and idle watchers that registered under different local aliases', () => {
  const selected=selectActivityPairs([...pair('old'),...pair('new.local'),...pair('remote')],['old','NEW']);
  assert.deepEqual(activityCombinations(selected),[
    {window:'window_old',afk:'afk_old'},{window:'window_old',afk:'afk_new.local'},
    {window:'window_new.local',afk:'afk_old'},{window:'window_new.local',afk:'afk_new.local'}]);
  assert.deepEqual(activityCombinations([{window:'w',afk:'a'}]),[{window:'w',afk:'a'}]);
  assert.throws(()=>activityCombinations([]));
  assert.throws(()=>activityCombinations(Array.from({length:9},(_,i)=>({window:`w${i}`,afk:`a${i}`}))));
});
test('rejects malformed IDs and excessive alias sets', () => {
  assert.throws(()=>selectActivityPairs([{...pair('local')[0],id:null},pair('local')[1]],['local']));
  const names=Array.from({length:9},(_,i)=>String(i));
  assert.throws(()=>selectActivityPairs(names.flatMap(pair),names));
});
test('overlapping local alias history counts once and keeps earlier records', () => {
  const start='2026-09-07T12:00:00Z', end='2026-09-07T13:00:00Z';
  const interval={start,end,category:'Editors',app:'VS Code'};
  const result=cleanActivity({start,end,intervals:[interval,interval],trackingIntervals:[interval,interval]},'Mac');
  assert.equal(result.days.reduce((n,d)=>n+d.seconds,0),3600);
  assert.equal(result.days.reduce((n,d)=>n+d.trackedSeconds,0),3600);
});
