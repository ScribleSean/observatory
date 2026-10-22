import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cleanActivity} from './snapshot-clean.mjs';

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
