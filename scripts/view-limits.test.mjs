import {test} from 'node:test';
import assert from 'node:assert/strict';
import { cleanPeerQuotaForDisplay, limitRows, limitHistory, peerLimits, sessionCost } from '../lib/view-limits.mjs';
import { sampleSnapshot } from '../lib/sample-snapshot.mjs';
import { span } from '../lib/panel-data.mjs';

const legacyNow=Date.parse('2026-09-08T20:00:00.000Z');
const sample={checkedAt:'2026-09-08T19:55:00.000Z',windows:[{bucket:'codex',window:'primary',remainingPercent:43,durationMinutes:300,resetsAt:'2026-09-09T00:00:00.000Z'}]};
test('peer allowance display keeps a separate valid reading',()=>{
  const peer=cleanPeerQuotaForDisplay({host:'Windows',status:'stale',checkedAt:sample.checkedAt,receivedAt:'2026-09-08T19:56:00.000Z',windows:sample.windows,history:[sample]},legacyNow);
  assert.equal(peer.windows[0].remainingPercent,43);
  assert.equal(peer.history.length,1);
  assert.equal(peer.receivedAt,'2026-09-08T19:56:00.000Z');
});
test('peer allowance display gives absent readings an empty safe state',()=>{
  const peer=cleanPeerQuotaForDisplay({host:'Mac',status:'unavailable',history:[],windows:[]},legacyNow);
  assert.deepEqual(peer.windows,[]);
  assert.deepEqual(peer.history,[]);
  assert.equal(peer.receivedAt,null);
});
test('peer allowance display rejects unsafe shapes and drops invalid observations',()=>{
  assert.equal(cleanPeerQuotaForDisplay({host:'Windows',status:'stale',windows:{}},legacyNow),null);
  assert.equal(cleanPeerQuotaForDisplay({host:'Linux',status:'stale',windows:[]},legacyNow),null);
  const peer=cleanPeerQuotaForDisplay({host:'Windows',status:'stale',windows:[{bucket:'codex',window:'primary',remainingPercent:101}],history:[{checkedAt:'invalid',windows:sample.windows}]},legacyNow);
  assert.deepEqual(peer.windows,[]);
  assert.deepEqual(peer.history,[]);
});

const now = Date.parse('2026-10-14T12:00:00Z');
const iso = minutes => new Date(now + minutes * 60000).toISOString();
const periods = ['now', 'day', 'week', 'month', 'all'];
const reading = (bucket, window, durationMinutes = 300, remainingPercent = 40) =>
  ({ bucket, window, durationMinutes, remainingPercent, resetsAt: iso(600) });
const snapshot = () => {
  const source = (bucket, names) => {
    const windows = names.map((name, index) => reading(bucket, name, index ? 10080 : 300));
    return { status: 'ok', checkedAt: iso(-1), windows,
      history: Array.from({ length: 13 }, (_, index) => ({ checkedAt: iso(-61 + index * 5),
        windows: windows.map(row => ({ ...row, remainingPercent: row.remainingPercent + (12 - index) * 2 })) })) };
  };
  return { timezone: 'UTC', claudeLimits: source('claude', ['five_hour', 'seven_day']), quota: source('codex', ['primary', 'secondary']) };
};

test('ok readings project pace separately for both providers and windows', () => {
  const rows = limitRows(snapshot(), now);
  assert.equal(rows.length, 4);
  for (const row of rows) {
    assert.equal(row.pace.status, 'projected');
    assert.equal(Number.isFinite(row.pace.ratePerHour), true);
    assert.equal(row.pace.runsOutInMinutes > 0, true);
    assert.equal(row.pace.resetInMinutes > 0, true);
    assert.equal(row.pace.observedMinutes, 60);
    assert.equal(Number.isFinite(row.pace.coverage), true);
  }
});

test('stale readings have no projected time or rate', () => {
  const data = snapshot();
  data.claudeLimits.checkedAt = data.quota.checkedAt = iso(-30);
  for (const row of limitRows(data, now)) {
    assert.equal(row.stale, true);
    assert.equal(row.pace.status, 'stale');
    assert.equal(row.pace.runsOutInMinutes, null);
    assert.equal(row.pace.ratePerHour, null);
  }
});

test('low remaining allowance is marked low', () => {
  const data = snapshot(); data.quota.windows[0].remainingPercent = 12;
  assert.equal(limitRows(data, now).find(row => row.provider === 'codex').low, true);
});

test('unknown sources have null rows and empty history for every period', () => {
  const data = { timezone: 'UTC', quota: { status: 'unavailable' } };
  assert.deepEqual(limitRows(data, now).map(row => [row.provider, row.remaining, row.pace]), [['claude', null, null], ['codex', null, null]]);
  for (const provider of ['claude', 'codex']) for (const period of periods)
    assert.deepEqual(limitHistory(data, provider, period, now).windows, []);
});

test('unknown history slots stay null rather than zero', () => {
  const data = snapshot(); delete data.quota.history;
  for (const period of periods) {
    const history = limitHistory(data, 'codex', period, now);
    for (const row of history.windows) {
      assert.equal(row.points.filter(point => point.value !== null).length, 1);
      assert.equal(row.points.every(point => point.value === null || point.value === 40), true);
    }
    assert.equal(JSON.stringify(history).includes('"value":0'), false);
  }
});

test('exhausted fresh readings alone report zero minutes remaining', () => {
  const data = snapshot(); data.quota.windows[0].remainingPercent = 0;
  const row = limitRows(data, now).find(row => row.provider === 'codex');
  assert.equal(row.pace.status, 'exhausted');
  assert.equal(row.pace.runsOutInMinutes, 0);
  assert.equal(JSON.stringify(limitHistory(data, 'codex', 'now', now)).includes('"value":0'), true);
});

test('history slots use the latest valid reading and ignore hidden or invalid records', () => {
  const data = { timezone: 'UTC', quota: { checkedAt: iso(-3), windows: [reading('codex', 'primary', 300, 43)], history: [
    { checkedAt: iso(-4), windows: [reading('codex', 'primary', 300, 44)] },
    { checkedAt: iso(1), windows: [reading('future', 'primary')] },
    { checkedAt: iso(-2), windows: ['CODEX_BENGALFOX', 'codex_spark', 'spark'].map(bucket => reading(bucket, 'primary')) },
    { checkedAt: iso(-2), windows: [reading('invalid', 'primary', 300, 101), null, []] },
  ] } };
  for (const [period, count] of [['now', 12], ['day', 24], ['week', 7], ['month', 30]]) {
    const result = limitHistory(data, 'codex', period, now);
    assert.equal(result.windows.length, 1);
    assert.equal(result.windows[0].points.length, count);
  }
  assert.deepEqual(limitHistory(data, 'codex', 'now', now).windows[0].points.at(-1), { label: '11:55', value: 43 });
  const day = limitHistory(data, 'codex', 'day', now).windows[0].points;
  assert.deepEqual(day[11], { label: '11', value: 43 });
  assert.equal(day.slice(12).every(point => point.value === null), true);
});

test('peer present uses named devices and preserves observation freshness', () => {
  const data = { peerQuota: { host: 'Windows', status: 'ok', checkedAt: iso(-5), receivedAt: iso(-2), windows: [reading('codex', 'primary', 300, 43)] }, deviceNames: { Windows: 'Desk' } };
  const peer = peerLimits(data, now);
  assert.equal(peer.device, 'Desk (Windows)');
  assert.equal(peer.rows[0].remaining, 43);
  assert.equal(peer.stale, false);
  assert.equal(peer.observedAt, iso(-5));
  assert.equal(peer.receivedAt, iso(-2));
  delete data.deviceNames;
  assert.equal(peerLimits(data, now).device, 'Windows');
  data.peerQuota.checkedAt = iso(-30);
  assert.equal(peerLimits(data, now).stale, true);
});

test('peer absent or invalid is null and empty peer windows are Unknown', () => {
  assert.equal(peerLimits({}, now), null);
  assert.equal(peerLimits({ peerQuota: { host: 'Linux', status: 'ok', windows: [] } }, now), null);
  const peer = peerLimits({ peerQuota: { host: 'Mac', status: 'ok', windows: [] } }, now);
  assert.equal(peer.rows.length, 1);
  assert.equal(peer.rows[0].remaining, null);
  assert.equal(peer.stale, true);
});

test('sample fixture supplies both providers and the named peer', () => {
  const data = sampleSnapshot(now);
  const rows = limitRows(data, now);
  for (const provider of ['claude', 'codex']) assert.equal(rows.filter(row => row.provider === provider && row.remaining !== null).length, 2);
  assert.equal(peerLimits(data, now).device, 'Desk (Windows)');
});

test('pace defensively filters malformed shapes without mutating the snapshot', () => {
  const data = snapshot();
  data.quota.windows.push(null, [], { bucket: 1, window: 'primary' });
  data.quota.history.push(null, [], { windows: null }, { windows: [null, [], { bucket: 1 }] });
  const before = structuredClone(data);
  assert.doesNotThrow(() => limitRows(data, now));
  assert.deepEqual(data, before);
  assert.equal(limitRows(snapshot(), -1).every(row => row.pace === null), true);
});

test('history uses local calendar dates with UTC fallback and caps all at 400 days', () => {
  const data = { timezone: 'America/New_York', quota: { checkedAt: iso(-3), windows: [reading('codex', 'primary')],
    history: [{ checkedAt: iso(-500 * 1440), windows: [reading('codex', 'primary')] }] } };
  assert.equal(limitHistory(data, 'codex', 'day', now).windows[0].points[7].value, 40);
  assert.equal(limitHistory(data, 'codex', 'all', now).windows[0].points.length, 400);
  data.timezone = 'invalid';
  assert.equal(limitHistory(data, 'codex', 'day', now).windows[0].points[11].value, 40);
});

test('peer and session cost freshness ends exactly at ten minutes', () => {
  for (const [age, stale] of [[600000, true], [599000, false]]) {
    const observedAt = new Date(now - age).toISOString();
    const peer = peerLimits({ peerQuota: { host: 'Mac', status: 'ok', checkedAt: observedAt,
      windows: [reading('codex', 'primary')] } }, now);
    assert.equal(peer.stale, stale);
    const cost = sessionCost({ claudeLimits: { sessionCost: { usd: 3, observedAt } } }, now);
    assert.deepEqual(cost, stale ? null : { usd: 3, observedAt });
  }
});

test('peer without windows preserves a valid observation time and an Unknown row', () => {
  const peerQuota = { host: 'Mac', status: 'ok', checkedAt: '2026-10-14T11:55:00+00:00', windows: [] };
  const peer = peerLimits({ peerQuota }, now);
  assert.equal(peer.observedAt, iso(-5));
  assert.equal(peer.rows.length, 1);
  assert.equal(peer.rows[0].remaining, null);
  for (const checkedAt of ['invalid', iso(1)]) {
    const invalid = peerLimits({ peerQuota: { ...peerQuota, checkedAt } }, now);
    assert.equal(invalid.observedAt, null);
    assert.equal(invalid.stale, true);
  }
});

test('computed pace alone supplies every projected window note', () => {
  const data = snapshot();
  data.quota.pace = [{ bucket: 'codex', window: 'primary', status: 'projected',
    asOf: data.quota.checkedAt, estimatedExhaustionAt: iso(170) }];
  for (const fixture of [data, sampleSnapshot(now)]) {
    for (const row of limitRows(fixture, now)) {
      assert.doesNotMatch(row.note, /runs out in about 2h 50m/);
      assert.equal(row.note.includes('runs out in about'), row.pace?.status === 'projected');
      if (row.pace?.status === 'projected') {
        assert.equal(row.note.split(' · ')[1], 'runs out in about ' + span(row.pace.runsOutInMinutes * 60000));
      }
    }
  }
  const rows = limitRows(data, now);
  assert.equal(rows.find(row => row.provider === 'codex' && row.windowId === 'secondary').pace.status, 'projected');
  assert.equal(rows.find(row => row.provider === 'claude').pace.status, 'projected');
});

test('expired local and peer windows are Unknown with no low warning or pace', () => {
  const data = snapshot();
  for (const source of [data.claudeLimits, data.quota]) {
    source.windows[0].resetsAt = iso(-1);
    source.windows[0].remainingPercent = 12;
  }
  for (const row of limitRows(data, now).filter(row => row.window === '5-hour')) {
    assert.equal(row.remaining, null);
    assert.equal(row.low, false);
    assert.equal(row.pace, null);
    assert.equal(row.note, 'Waiting for the reset to be observed.');
  }
  const peer = peerLimits({ peerQuota: { ...data.quota, host: 'Mac' } }, now);
  assert.equal(peer.rows[0].remaining, null);
  assert.equal(peer.rows[0].low, false);
  assert.equal(peer.rows[0].note, 'Waiting for the reset to be observed.');
});

test('a carried window cannot project pace from the fresh source timestamp', () => {
  const data = snapshot();
  data.claudeLimits.windows[1].checkedAt = iso(-30);
  const rows = limitRows(data, now).filter(row => row.provider === 'claude');
  assert.equal(rows[0].pace.status, 'projected');
  assert.equal(rows[1].stale, true);
  assert.equal(rows[1].pace.status, 'stale');
  assert.equal(rows[1].pace.ratePerHour, null);
  assert.doesNotMatch(rows[1].note, /runs out in about/);
});

test('limits view renders reset windows as Unknown in every limit style', async t => {
  const { createServer } = await import('vite');
  const { default: react } = await import('@vitejs/plugin-react');
  const { fileURLToPath } = await import('node:url');
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const server = await createServer({ configFile: false, root: fileURLToPath(new URL('..', import.meta.url)),
    server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', plugins: [react()] });
  t.after(() => server.close());
  const { LimitsView } = await server.ssrLoadModule('/app/viewer/limits/LimitsView.tsx');
  const { LimitRows } = await server.ssrLoadModule('/app/viewer/components/LimitRows.tsx');
  const data = { claudeLimits: { status: 'ok', checkedAt: iso(-2),
    windows: [{ ...reading('claude', 'five_hour', 300, 12), resetsAt: iso(-1) }] } };
  for (const style of ['meter', 'numeral', 'text']) {
    const html = renderToStaticMarkup(createElement(LimitRows, { rows: limitRows(data, now), style }));
    assert.match(html, />Unknown</);
    assert.match(html, /Waiting for the reset to be observed\./);
    assert.doesNotMatch(html, />0%<|>12%<|width:0%|width:12%/);
    if (style === 'meter') assert.match(html, /class="ob-bar" aria-hidden="true"><\/div>/);
    if (style === 'text') assert.match(html, /class="ob-blocks" aria-hidden="true"/);
    const view = renderToStaticMarkup(createElement(LimitsView, { snapshot: data, now, limitStyle: style }));
    assert.match(view, /class="ob-num big">Unknown<\/span>[\s\S]*?<div class="ob-meta">Waiting for the reset to be observed\./);
  }
});

test('Claude Code pace comes from the limit history when the reading keeps no samples, across a minute-rounded reset', () => {
  const now = Date.parse('2026-10-21T22:00:30Z');
  const at = minutes => new Date(now - 30000 - minutes * 60000).toISOString();
  const window = { bucket: 'claude', window: 'seven_day', durationMinutes: 10080, remainingPercent: 50, resetsAt: '2026-10-25T00:00:00.000Z', checkedAt: at(0) };
  const points = [[20, 53, '2026-10-24T23:59:00.000Z'], [10, 52, '2026-10-25T00:00:00.000Z'], [0, 50, '2026-10-25T00:00:00.000Z']]
    .map(([minutes, r, x]) => ({ p: 'claude', w: 'seven_day', o: 'Mac', t: at(minutes), r, x, d: 10080 }));
  const snapshot = { claudeLimits: { status: 'ok', checkedAt: at(0), observedOn: 'Mac', windows: [window] },
    limitHistory: [{ host: 'Mac', points }, { host: 'Windows', points: points.map(point => ({ ...point, o: 'Windows', r: 99 })) }] };
  const row = limitRows(snapshot, now).find(item => item.provider === 'claude');
  assert.equal(row.pace.status, 'projected');
  assert.equal(row.pace.ratePerHour, 9);
});
