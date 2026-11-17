import test from 'node:test';
import assert from 'node:assert/strict';
import { hostname } from 'node:os';
import { macActivity } from '../scripts/mac-activity.mjs';

const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; });

const iso = ms => new Date(Date.now() - ms).toISOString();
const HOST = hostname();
const bucket = (id, type, host = HOST) => ({ id, type, hostname: host, last_updated: iso(60000), data: {} });
const json = (body, ok = true) => ({ ok, json: async () => body });

// Stubs ActivityWatch. `q` maps window bucket id -> {active, observed, latest}.
function stub(buckets, q = {}) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const path = new URL(url).pathname.replace('/api/0', '');
    calls.push({ path, method: opts.method });
    if (path === '/buckets/') return json(Object.fromEntries(buckets.map(b => [b.id, b])));
    if (path === '/query/') {
      const query = JSON.parse(opts.body).query[0];
      const id = JSON.parse(query.match(/query_bucket\(("[^"]*")\)/)[1]);
      return json([query.includes('filter_keyvals') ? q[id].active : q[id].observed]);
    }
    const m = path.match(/^\/buckets\/(.+)\/events$/);
    if (m) { const e = q[decodeURIComponent(m[1])].latest; return json(e ? [{ timestamp: e }] : []); }
    throw Error('unexpected ' + path);
  };
  return calls;
}

test('a non-OK reply from the buckets call rejects', async () => {
  globalThis.fetch = async () => json({}, false);
  await assert.rejects(macActivity(), /ActivityWatch unavailable/);
});

test('a non-OK reply on a later call rejects', async () => {
  const buckets = [bucket('w1', 'currentwindow'), bucket('a1', 'afkstatus')];
  stub(buckets, { w1: { active: [], observed: [] } });
  const inner = globalThis.fetch;
  globalThis.fetch = async (url, opts) => new URL(url).pathname.endsWith('/query/') ? json({}, false) : inner(url, opts);
  await assert.rejects(macActivity(), /ActivityWatch unavailable/);
});

test('no matching watchers rejects', async () => {
  stub([bucket('x', 'other')]);
  await assert.rejects(macActivity(), /No local activity watchers/);
});

for (const bad of [undefined, null, '5', -1, NaN, Infinity]) {
  test(`active event with duration ${String(bad)} rejects`, async () => {
    stub([bucket('w1', 'currentwindow'), bucket('a1', 'afkstatus')],
      { w1: { active: [{ timestamp: iso(5000), duration: bad, data: { app: 'Safari' } }], observed: [] } });
    await assert.rejects(macActivity(), /Invalid duration/);
  });
  test(`tracking event with duration ${String(bad)} rejects`, async () => {
    stub([bucket('w1', 'currentwindow'), bucket('a1', 'afkstatus')],
      { w1: { active: [], observed: [{ timestamp: iso(5000), duration: bad }] } });
    await assert.rejects(macActivity(), /Invalid tracking duration/);
  });
}

test('raw mode returns intervals, tracking intervals and latest event', async () => {
  const t = iso(3600000), latest = iso(1000);
  const calls = stub([bucket('w1', 'currentwindow'), bucket('a1', 'afkstatus')],
    { w1: { active: [{ timestamp: t, duration: 60, data: { app: 'Safari' } }],
            observed: [{ timestamp: t, duration: 120 }], latest } });
  const r = await macActivity({ raw: true });
  assert.equal(r.intervals.length, 1);
  assert.equal(r.intervals[0].start, t);
  assert.equal(r.intervals[0].end, new Date(Date.parse(t) + 60000).toISOString());
  assert.equal(r.intervals[0].app, 'Safari');
  assert.equal(typeof r.intervals[0].category, 'string');
  assert.deepEqual(r.trackingIntervals, [{ start: t, end: new Date(Date.parse(t) + 120000).toISOString() }]);
  assert.equal(r.latestEvent, latest);
  assert.equal(Date.parse(r.end) - Date.parse(r.start), 7 * 86400000);
  assert.equal(calls.filter(c => c.path === '/query/').length, 2);
  assert.ok(calls.filter(c => c.path === '/query/').every(c => c.method === 'POST'));
});

test('default mode returns the cleaned Mac report', async () => {
  const t = iso(3600000);
  stub([bucket('w1', 'currentwindow'), bucket('a1', 'afkstatus')],
    { w1: { active: [{ timestamp: t, duration: 60, data: { app: 'Safari' } }],
            observed: [{ timestamp: t, duration: 120 }], latest: t } });
  const r = await macActivity();
  assert.equal(r.host, 'Mac');
  assert.equal(r.status, 'ok');
  assert.equal(r.intervals.length, 1);
  assert.equal(r.latestEvent, t);
});

test('watchers under host aliases are read as every window against every idle bucket', async () => {
  const t1 = iso(7200000), t2 = iso(3600000), l1 = iso(50000), l2 = iso(9000);
  const alias = HOST + '.local';
  const calls = stub(
    [bucket('w1', 'currentwindow'), bucket('a1', 'afkstatus'), bucket('w2', 'currentwindow', alias), bucket('a2', 'afkstatus', alias)],
    { w1: { active: [{ timestamp: t1, duration: 10, data: { app: 'Safari' } }], observed: [{ timestamp: t1, duration: 20 }], latest: l1 },
      w2: { active: [{ timestamp: t2, duration: 30, data: { app: 'Terminal' } }], observed: [{ timestamp: t2, duration: 40 }], latest: l2 } });
  const r = await macActivity({ raw: true });
  assert.equal(calls.filter(c => c.path === '/query/').length, 8);
  // Overlapping results repeat per combination; the caller counts them once.
  assert.deepEqual(r.intervals.map(i => i.start), [t1, t1, t2, t2]);
  assert.deepEqual(r.trackingIntervals.map(i => i.start), [t1, t1, t2, t2]);
  assert.equal(r.latestEvent, l2);
});

test('missing or invalid latest events are ignored', async () => {
  const l = iso(2000), alias = HOST + '.local';
  stub([bucket('w1', 'currentwindow'), bucket('a1', 'afkstatus'), bucket('w2', 'currentwindow', alias), bucket('a2', 'afkstatus', alias)],
    { w1: { active: [], observed: [], latest: null }, w2: { active: [], observed: [], latest: l } });
  assert.equal((await macActivity({ raw: true })).latestEvent, l);
  stub([bucket('w1', 'currentwindow'), bucket('a1', 'afkstatus')], { w1: { active: [], observed: [], latest: null } });
  assert.equal((await macActivity({ raw: true })).latestEvent, undefined);
});

test('synced and read-only buckets from other computers are ignored', async () => {
  const ro = { ...bucket('wo', 'currentwindow', 'other-host-xyz'), data: { readonly: true } };
  const calls = stub([bucket('w1', 'currentwindow'), bucket('a1', 'afkstatus'), bucket('aw-watcher-window_synced-x', 'currentwindow', 'other-host-xyz'), bucket('ao', 'afkstatus', 'other-host-xyz'), ro],
    { w1: { active: [], observed: [] }, ao: { active: [], observed: [] } });
  await macActivity({ raw: true });
  // w1 is paired with both idle buckets; the synced and read-only windows are skipped.
  assert.equal(calls.filter(c => c.path === '/query/').length, 4);
});

test('a bucket not updated in the last 7 days is skipped when fresh ones exist', async () => {
  const old = { ...bucket('wold', 'currentwindow'), last_updated: iso(8 * 86400000) };
  const calls = stub([bucket('w1', 'currentwindow'), bucket('a1', 'afkstatus'), old], { w1: { active: [], observed: [] } });
  await macActivity({ raw: true });
  assert.equal(calls.filter(c => c.path === '/query/').length, 2);
});

test('more than 8 window buckets rejects', async () => {
  const ws = Array.from({ length: 9 }, (_, i) => bucket('w' + i, 'currentwindow'));
  stub([...ws, bucket('a1', 'afkstatus')]);
  await assert.rejects(macActivity(), /Too many local activity watchers/);
});
