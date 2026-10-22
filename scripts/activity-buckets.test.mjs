import {test} from 'node:test';
import assert from 'node:assert/strict';
import {activityCombinations,selectActivityPairs} from './activity-buckets.mjs';
import {cleanActivity} from './snapshot-clean.mjs';

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

test('local watchers pair by activity, not by hostname', async () => {
  const { localActivityPairs } = await import('./activity-buckets.mjs');
  const since = Date.parse('2026-10-15T00:00:00Z');
  const bucket = (id, type, hostname, lastUpdated) => ({ id, type, hostname, last_updated: lastUpdated });
  const buckets = [
    bucket('aw-watcher-window_old-name', 'currentwindow', 'old-name', '2026-10-11T22:45:00Z'),
    bucket('aw-watcher-afk_old-name', 'afkstatus', 'old-name', '2026-10-21T23:58:00Z'),
    bucket('aw-watcher-window_new-name.local', 'currentwindow', 'new-name.local', '2026-10-22T00:00:00Z'),
    bucket('aw-watcher-afk_new-name.local', 'afkstatus', 'new-name.local', '2026-10-12T15:41:00Z'),
    bucket('aw-watcher-window_other-synced-from-other', 'currentwindow', 'other', '2026-10-21T00:00:00Z'),
  ];
  // The active window watcher and the active idle watcher are read together, though their hostnames differ.
  assert.deepEqual(localActivityPairs(buckets, { since }), [{ window: 'aw-watcher-window_new-name.local', afk: 'aw-watcher-afk_old-name' }]);
  // With no recent pair at all, every local watcher is read, synced ones excepted.
  const all = localActivityPairs(buckets, { since: Date.parse('2027-01-01T00:00:00Z') });
  assert.equal(all.length, 4);
  assert.ok(all.every(pair => !pair.window.includes('synced')));
  assert.throws(() => localActivityPairs([bucket('a', 'currentwindow', 'x', '2026-10-21T00:00:00Z')], { since }), /No local activity watchers/);
});
