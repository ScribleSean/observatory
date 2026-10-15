import assert from 'node:assert/strict';
import test from 'node:test';
import { compact, demoSnapshot, devices, duration, limits, periodDays, recordedDays, sourceCounts, totals } from '../lib/panel-data.mjs';
import { spawnSync } from 'node:child_process';
import { SAMPLE_UNKNOWN } from '../lib/sample-snapshot.mjs';
import strings from '../lib/strings.json' with { type: 'json' };

const now = Date.parse('2026-03-10T15:00:00Z');
const day = (date, totalTokens) => ({ date, totalTokens });
const snapshot = () => ({
  timezone: 'UTC',
  tokens: [{ host: 'Mac', status: 'ok', days: [day('2026-03-10', 100), day('2026-03-09', 50)] },
    { host: 'Windows', status: 'ok', days: [day('2026-03-10', 40)] }],
  settings: [],
  combinedTokens: { status: 'ok', verification: { status: 'verified' }, days: [day('2026-03-10', 120)] },
  activity: [{ host: 'Mac', status: 'ok', days: [{ date: '2026-03-10', seconds: 3600 }] }],
});

const readingAt = '2026-10-14T12:30:00Z';
const nowTime = Date.parse('2026-10-14T12:32:00Z');
const hourlyDay = (date, scale = 1) => {
  const hours = Array.from({ length: 24 }, (_, hour) => (hour + 1) * scale);
  return { date, hours, totalTokens: hours.reduce((a, b) => a + b, 0) };
};
const hourlySnapshot = (read = readingAt) => {
  const source = (host, scale) => ({ host, status: 'ok', checkedAt: read, days: [hourlyDay(read.slice(0, 10), scale)] });
  return { timezone: 'America/New_York', collectedAt: read,
    tokens: [source('Mac', 1), source('Windows', 4)],
    providerTokenSources: ['Mac', 'Windows'].map(host => ({ ...source(host, 2), provider: 'claude-code' })),
    activity: [source('Mac', 3), source('Windows', 5)],
    combinedTokens: { ...source('Combined', 6), verification: { status: 'verified' } },
    combined: source('Combined', 7) };
};
const nowValues = result => [result.codexTokens, result.claudeTokens, result.seconds];

test('panel-data imports first in a fresh process despite the activity cycle', () => {
  const module = new URL('../lib/panel-data.mjs', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `const panel = await import(${JSON.stringify(module)}); if (panel.totals({}, 'All', 'now', 0).seconds !== null) process.exit(1);`], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('device Now adds the previous and current local hours with Date or milliseconds', () => {
  for (const time of [nowTime, new Date(nowTime)]) {
    for (const [host, expected] of [['Mac', [17, 34, 51]], ['Windows', [68, 34, 85]]]) {
      const result = totals(hourlySnapshot(), host, 'now', time);
      assert.deepEqual(nowValues(result), expected);
      assert.deepEqual([result.usd, result.codexNote, result.timeNote, result.claudeNote], [null, '', '', '']);
      assert.equal(result.note, strings.activity.nowCaveat);
    }
  }
});

test('device Now falls back to collection time only when checkedAt is absent', () => {
  const data = hourlySnapshot();
  for (const key of ['tokens', 'providerTokenSources', 'activity']) delete data[key][0].checkedAt;
  assert.deepEqual(nowValues(totals(data, 'Mac', 'now', nowTime)), [17, 34, 51]);
  for (const key of ['tokens', 'providerTokenSources', 'activity']) data[key][0].checkedAt = '2026-10-14T12:20:00Z';
  assert.deepEqual(nowValues(totals(data, 'Mac', 'now', nowTime)), [null, null, null]);
});

for (const [label, read, time] of [
  ['stale', readingAt, Date.parse(readingAt) + 600001],
  ['new hour', '2026-10-14T12:58:00Z', Date.parse('2026-10-14T13:03:00Z')],
  ['skipped hour', '2026-03-08T07:30:00Z', Date.parse('2026-03-08T07:32:00Z')],
  ['first repeated hour', '2026-11-01T05:30:00Z', Date.parse('2026-11-01T05:32:00Z')],
  ['second repeated hour', '2026-11-01T06:30:00Z', Date.parse('2026-11-01T06:32:00Z')],
]) test(`device Now is Unknown for ${label}`, () => {
  const result = totals(hourlySnapshot(read), 'Mac', 'now', time);
  assert.deepEqual(nowValues(result), [null, null, null]);
  assert.equal(result.note, strings.status.hourlyUnavailable);
});

test('device Now accepts a reading exactly ten minutes old', () => {
  assert.deepEqual(nowValues(totals(hourlySnapshot(), 'Mac', 'now', Date.parse(readingAt) + 600000)), [17, 34, 51]);
});

test('device Now requires hours and an ok status for each source', () => {
  for (const key of ['tokens', 'providerTokenSources', 'activity']) {
    for (const missing of ['hours', 'status']) {
      const data = hourlySnapshot();
      if (missing === 'hours') delete data[key][0].days[0].hours;
      else data[key][0].status = 'stale';
      const expected = [17, 34, 51];
      expected[['tokens', 'providerTokenSources', 'activity'].indexOf(key)] = null;
      const result = totals(data, 'Mac', 'now', nowTime);
      assert.deepEqual(nowValues(result), expected);
      assert.equal(result.note, strings.activity.nowCaveat);
    }
  }
});

test('Now crosses midnight using hour 23 of the previous local day', () => {
  const data = hourlySnapshot('2026-10-15T04:05:00Z');
  const time = Date.parse('2026-10-15T04:07:00Z');
  for (const key of ['tokens', 'providerTokenSources', 'activity']) data[key][0].days.push(hourlyDay('2026-10-14', 10));
  assert.deepEqual(nowValues(totals(data, 'Mac', 'now', time)), [241, 242, 243]);
  for (const date of ['2026-10-14', '2026-10-15']) {
    const missing = structuredClone(data);
    for (const key of ['tokens', 'providerTokenSources', 'activity']) delete missing[key][0].days.find(day => day.date === date).hours;
    assert.deepEqual(nowValues(totals(missing, 'Mac', 'now', time)), [null, null, null]);
  }
});

test('All Now uses only verified aggregate hours and their own reading times', () => {
  const data = hourlySnapshot();
  const result = totals(data, 'All', 'now', nowTime);
  assert.deepEqual(nowValues(result), [102, null, 119]);
  assert.equal(result.claudeNote, strings.status.byDevice);
  assert.equal(result.note, strings.activity.nowCaveat);
  for (const change of [
    data => { delete data.combinedTokens.days[0].hours; },
    data => { data.combinedTokens.verification.status = 'unverified'; },
    data => { data.combinedTokens.status = 'stale'; },
    data => { delete data.combinedTokens.checkedAt; },
    data => { data.tokens[1].status = 'unavailable'; },
    data => { data.tokens.push({ host: 'Ubuntu', status: 'ok', days: [] }); },
  ]) {
    const invalid = hourlySnapshot(); change(invalid);
    assert.equal(totals(invalid, 'All', 'now', nowTime).codexTokens, null);
  }
  delete data.combined.checkedAt;
  assert.equal(totals(data, 'All', 'now', nowTime).seconds, null);
  data.combined.checkedAt = '2026-10-14T12:20:00Z';
  assert.equal(totals(data, 'All', 'now', nowTime).seconds, null);
});

test('Now caveat appears when only one value is known, including an observed zero', () => {
  for (const key of ['tokens', 'providerTokenSources', 'activity']) {
    const data = hourlySnapshot();
    for (const other of ['tokens', 'providerTokenSources', 'activity']) if (other !== key) delete data[other];
    data[key][0].days[0].hours[7] = 0;
    data[key][0].days[0].hours[8] = 0;
    const result = totals(data, 'Mac', 'now', nowTime);
    assert.equal(nowValues(result).filter(value => value === 0).length, 1);
    assert.equal(result.note, strings.activity.nowCaveat);
  }
  assert.equal(totals({}, 'Mac', 'now', nowTime).note, strings.status.hourlyUnavailable);
});

test('source counts include consented Claude limits and only count ok as read', () => {
  for (const [status, read, total] of [['ok', 2, 2], ['stale', 1, 2], ['not-connected', 1, 1]])
    assert.deepEqual(sourceCounts({ quota: { status: 'ok' }, claudeLimits: { status } }), { read, total });
  for (const claudeLimits of [undefined, null, [], 'ok']) assert.deepEqual(sourceCounts({ claudeLimits }), { read: 0, total: 0 });
});

test('sample All Codex Now stays Unknown as declared by SAMPLE_UNKNOWN', () => {
  assert.ok(SAMPLE_UNKNOWN.some(row => row.path === 'combinedTokens.days.0.hours'));
  assert.equal(totals(demoSnapshot(nowTime), 'All', 'now', nowTime).codexTokens, null);
});

test('All uses the verified aggregate and never adds device records', () => {
  assert.equal(totals(snapshot(), 'All', 'day', new Date(now)).codexTokens, 120);
});

test('All is withheld without verification or with a missing device', () => {
  const unverified = snapshot(); unverified.combinedTokens.verification.status = 'unverified';
  assert.equal(totals(unverified, 'All', 'day', new Date(now)).codexTokens, null);
  const missing = snapshot(); missing.tokens[1].status = 'unavailable';
  assert.deepEqual(recordedDays(missing, 'tokens', 'All'), []);
  assert.match(totals(missing, 'All', 'day', new Date(now)).note, /verified records/);
});

test('a retired host blocks the combined total', () => {
  const retired = snapshot(); retired.tokens.push({ host: 'Ubuntu', status: 'ok', days: [day('2026-03-10', 5)] });
  assert.deepEqual(recordedDays(retired, 'tokens', 'All'), []);
});

test('month covers 30 calendar days and week covers 7', () => {
  const days = Array.from({ length: 45 }, (_, index) => day(new Date(now - index * 86400000).toISOString().slice(0, 10), 1));
  assert.equal(periodDays(days, 'month', '2026-03-10').length, 30);
  assert.equal(periodDays(days, 'week', '2026-03-10').length, 7);
  assert.equal(periodDays(days, 'day', '2026-03-10').length, 1);
  assert.equal(periodDays(days, 'all', '2026-03-10').length, 45);
});

test('missing values stay Unknown and are never zero', () => {
  const broken = snapshot(); broken.tokens[0].days[0].totalTokens = null;
  assert.equal(totals(broken, 'Mac', 'week', new Date(now)).codexTokens, null);
  assert.equal(totals(snapshot(), 'Windows', 'day', new Date(now)).seconds, null);
  assert.equal(compact(null), 'Unknown');
  assert.equal(duration(undefined), 'Unknown');
  assert.equal(totals(snapshot(), 'Mac', 'now', new Date(now)).codexTokens, null);
  const quiet = totals(snapshot(), 'Windows', 'day', new Date(now + 86400000));
  assert.deepEqual([quiet.codexTokens, quiet.codexNote], [null, 'No records']);
  const unread = snapshot(); unread.tokens[1].status = 'unavailable';
  assert.equal(totals(unread, 'Windows', 'day', new Date(now)).codexNote, '');
});

test('Claude Code tokens are per device and have no combined total', () => {
  const data = snapshot();
  data.providerTokenSources = [{ provider: 'claude-code', host: 'Mac', status: 'ok', days: [day('2026-03-10', 70)] }];
  assert.equal(totals(data, 'Mac', 'day', new Date(now)).claudeTokens, 70);
  assert.equal(totals(data, 'All', 'day', new Date(now)).claudeTokens, null);
  assert.equal(totals(data, 'All', 'day', new Date(now)).claudeNote, 'By device');
  assert.equal(totals(data, 'Windows', 'day', new Date(now)).claudeTokens, null);
});

test('a provider without a reading gets one Unknown row', () => {
  const rows = limits({}, now);
  assert.deepEqual(rows.map(row => [row.provider, row.remaining]), [['claude', null], ['codex', null]]);
});

test('limit rows mark old readings and low limits, and reject impossible values', () => {
  const quota = { status: 'ok', checkedAt: new Date(now - 60000).toISOString(), windows: [
    { bucket: 'codex', window: 'primary', durationMinutes: 300, remainingPercent: 81, resetsAt: new Date(now + 3600000).toISOString() },
    { bucket: 'codex', window: 'secondary', durationMinutes: 10080, remainingPercent: 12, resetsAt: new Date(now + 86400000).toISOString() },
    { bucket: 'codex', window: 'other', durationMinutes: 60, remainingPercent: 140, resetsAt: 'bad' },
    { bucket: 'codex_spark', window: 'primary', durationMinutes: 300, remainingPercent: 50 }] };
  const rows = limits({ quota }, now).filter(row => row.provider === 'codex');
  assert.equal(rows.length, 3);
  assert.deepEqual([rows[0].bucket, rows[0].windowId, ...limits({}, now).map(row => [row.bucket, row.windowId])], ['codex', 'primary', ['', ''], ['', '']]);
  assert.deepEqual([rows[0].window, rows[0].low, rows[0].stale, rows[0].remaining], ['5-hour', false, false, 81]);
  assert.deepEqual([rows[1].window, rows[1].low], ['weekly', true]);
  assert.equal(rows[2].remaining, null);
  assert.match(rows[2].note, /Reset time unknown/);
  const old = limits({ quota: { ...quota, checkedAt: new Date(now - 3600000).toISOString() } }, now).filter(row => row.provider === 'codex');
  assert.deepEqual([old[0].low, old[0].stale], [false, true]);
  assert.match(old[0].note, /as of/);
});

test('device labels use a custom name or the platform name', () => {
  assert.deepEqual(devices(snapshot()).map(device => device.label), ['macOS', 'Windows']);
  assert.deepEqual(devices({ ...snapshot(), deviceNames: { Mac: ' Studio ' } }).map(device => device.label), ['Studio', 'Windows']);
});

test('the sample snapshot renders every row with a value', () => {
  const demo = demoSnapshot(now);
  assert.equal(limits(demo, now).every(row => row.remaining !== null), true);
  const sums = totals(demo, 'All', 'month', new Date(now));
  assert.equal(sums.codexTokens > 0 && sums.seconds > 0 && sums.usd > 0, true);
});

test('limits readings become stale exactly at ten minutes', () => {
  for (const [age, stale] of [[600000, true], [599000, false]]) {
    const source = { status: 'ok', checkedAt: new Date(now - age).toISOString(),
      windows: [{ bucket: 'codex', window: 'primary', remainingPercent: 40, durationMinutes: 300 }] };
    for (const row of limits({ quota: source, claudeLimits: source }, now)) assert.equal(row.stale, stale);
  }
});

test('stored pace remains the default and can be omitted without changing other row fields', () => {
  const checkedAt = new Date(now - 60000).toISOString();
  const quota = { status: 'ok', checkedAt,
    windows: [{ bucket: 'codex', window: 'primary', remainingPercent: 40, durationMinutes: 300,
      resetsAt: new Date(now + 3600000).toISOString() }],
    pace: [{ bucket: 'codex', window: 'primary', status: 'projected', asOf: checkedAt,
      estimatedExhaustionAt: new Date(now + 30 * 60000).toISOString() }] };
  const data = { quota, claudeLimits: quota };
  assert.deepEqual(limits(data, now), limits(data, now, { storedPace: true }));
  const without = limits(data, now, { storedPace: false });
  limits(data, now).forEach((row, index) => {
    assert.equal(row.note, 'Resets in 1h 0m · runs out in about 30m');
    assert.deepEqual(without[index], { ...row, note: 'Resets in 1h 0m' });
  });
});
