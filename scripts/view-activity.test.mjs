import test from 'node:test';
import assert from 'node:assert/strict';
import { nowFromHours, activityNow, activityView } from '../lib/view-activity.mjs';
import strings from '../lib/strings.json' with { type: 'json' };

const now = Date.parse('2026-10-14T12:32:00Z');
const readingAt = '2026-10-14T12:30:00Z';
const hours = value => Array(24).fill(value);
const day = (date = '2026-10-14', seconds = 2400) => ({ date, seconds, hours: hours(seconds / 24) });
const run = overrides => nowFromHours({ days: [day()], readingAt, timeZone: 'UTC', now, ...overrides });
const source = (host, seconds = 2400) => ({ host, status: 'ok', checkedAt: readingAt, days: [day('2026-10-14', seconds)] });
const snapshot = () => ({ timezone: 'UTC', collectedAt: readingAt, activity: [source('Mac'), source('Windows', 4800)], combined: source('Combined', 3600) });
const view = (data = snapshot(), options = {}) => activityView(data, { host: 'Mac', period: 'day', now, ...options });

test('Now adds two buckets at a two minute old reading', () => {
  assert.deepEqual(run(), { value: 200, reason: 'ok', readingAt, current: { date: '2026-10-14', hour: 12 }, previous: { date: '2026-10-14', hour: 11 } });
  assert.equal(activityNow(snapshot(), 'Mac', now).windowSeconds, 5400);
});
test('Now crosses midnight with calendar date arithmetic', () => {
  const args = { readingAt: '2026-01-01T00:05:00Z', now: Date.parse('2026-01-01T00:07:00Z'), days: [day('2026-01-01'), day('2025-12-31', 4800)] };
  assert.equal(run(args).value, 300);
  assert.deepEqual(run(args).previous, { date: '2025-12-31', hour: 23 });
  assert.equal(run({ ...args, days: [day('2026-01-01')] }).reason, 'noHours');
  assert.equal(run({ ...args, days: [day('2026-01-01'), { date: '2025-12-31' }] }).reason, 'noHours');
});
for (const [minutes, reason] of [[11, 'stale'], [9, 'ok'], [10, 'ok']]) test(`Now at ${minutes} minutes is ${reason}`, () => {
  assert.equal(run({ now: Date.parse(readingAt) + minutes * 60000 }).reason, reason);
});
test('Now refuses a reading from the previous clock hour', () => {
  assert.equal(run({ readingAt: '2026-10-14T12:58:00Z', now: Date.parse('2026-10-14T13:03:00Z') }).reason, 'hourAfterReading');
});
for (const [date, read, reason] of [
  ['2026-03-08', '2026-03-08T07:30:00Z', 'daylightSaving'],
  ['2026-11-01', '2026-11-01T05:30:00Z', 'daylightSaving'],
  ['2026-11-01', '2026-11-01T06:30:00Z', 'daylightSaving'],
  ['2026-10-14', readingAt, 'ok'],
]) test(`New York buckets at ${read}: ${reason}`, () => {
  assert.equal(run({ days: [day(date)], readingAt: read, now: Date.parse(read) + 120000, timeZone: 'America/New_York' }).reason, reason);
});
for (const bad of [undefined, hours(1).slice(1), [...hours(1).slice(1), -1], [...hours(1).slice(1), Infinity], [...hours(1).slice(1), null]]) test(`invalid hours ${JSON.stringify(bad)}`, () => {
  assert.equal(run({ days: [{ ...day(), hours: bad }] }).reason, 'noHours');
});
for (const read of [null, '', 'invalid']) test(`invalid reading ${read}`, () => {
  assert.equal(run({ readingAt: read }).reason, 'noReading');
});
for (const zone of [null, '', 'Invalid/Zone']) test(`invalid zone ${zone}`, () => assert.equal(run({ timeZone: zone }).reason, 'timeZone'));
test('observed zero stays zero', () => assert.equal(run({ days: [day('2026-10-14', 0)] }).value, 0));
test('Both Now needs a live reading from each computer', () => {
  const data = snapshot(); data.activity[1].status = 'unavailable';
  assert.equal(activityNow(data, 'All', now).reason, 'noSource');
});
test('device reading falls back to collection time', () => {
  const data = snapshot(); delete data.activity[0].checkedAt;
  assert.equal(activityNow(data, 'Mac', now).reason, 'ok');
});
test('retired host blocks All', () => {
  const data = snapshot(); data.activity.push(source('Ubuntu'));
  assert.equal(activityNow(data, 'All', now).reason, 'noSource');
  assert.equal(view(data, { host: 'All' }).note, strings.status.allUnverified);
});
test('Both Now adds each computer\'s Now', () => {
  const data = snapshot();
  assert.equal(activityNow(data, 'All', now).value, activityNow(data, 'Mac', now).value + activityNow(data, 'Windows', now).value);
  assert.equal(activityNow(data, 'All', now).value, 600);
});
test('Both adds the computers day by day and its total matches the rows under it', () => {
  const data = snapshot();
  data.activity[0].days.push(day('2026-10-13', 1200), day('2026-09-01', 600));
  data.activity[1].days.push(day('2026-10-13', 2400));
  const all = view(data, { host: 'All', period: 'all' });
  assert.equal(all.total, 2400 + 1200 + 600 + 4800 + 2400);
  assert.deepEqual(all.byDevice.map(row => [row.label, row.total]), [['Mac', 4200], ['PC', 7200]]);
  assert.equal(all.since, '2026-09-01');
  assert.deepEqual(all.series.slice(-2).map(row => row.value), [3600, 7200]);
  const day13 = view(data, { host: 'All', date: '2026-10-13' });
  assert.equal(day13.total, 3600);
  assert.deepEqual(day13.hourly.slice(0, 2).map(row => row.value), [150, 150]);
  assert.equal(view(data, { host: 'All', period: 'day', date: '2026-09-01' }).total, 600);
  assert.equal(view(data, { host: 'Mac', period: 'all' }).since, '2026-09-01');
  assert.equal(view(data, { host: 'Mac', period: 'week' }).since, null);
});
test('Both is Unknown when a computer\'s own total is Unknown for that day', () => {
  const data = snapshot();
  data.activity[1].days = [{ ...day(), seconds: 0, trackedSeconds: 0 }];
  const result = view(data, { host: 'All' });
  assert.equal(result.byDevice[1].total, null);
  assert.equal(result.total, null);
  assert.equal(view(data, { host: 'All', period: 'week' }).total, 2400);
  assert.equal(view(data, { host: 'All', period: 'week' }).series.at(-1).value, null);
});
for (const [period, expected] of [['day', 2400], ['week', 3600], ['month', 4200], ['all', 4500]]) test(`${period} total uses retained days for one host`, () => {
  const data = snapshot(); data.activity[0].days.push(day('2026-10-13', 1200), day('2026-09-20', 600), day('2026-08-01', 300));
  assert.equal(view(data, { period }).total, expected);
});
test('empty periods and unread sources stay Unknown with the appropriate note', () => {
  const data = snapshot(); data.activity[0].days = [day('2026-10-01')];
  assert.equal(view(data).total, null);
  assert.equal(view(data).note, strings.status.noRecords);
  assert.equal(view({}).total, null);
  assert.equal(view(null).total, null);
});
test('dates include today and accept only a recorded anchor', () => {
  const data = snapshot(); data.activity[0].days = [day('2026-10-01')];
  assert.deepEqual(view(data).dates, ['2026-10-14', '2026-10-01']);
  assert.equal(view(data, { date: '2026-10-01' }).anchor, '2026-10-01');
  assert.equal(view(data, { date: '1900-01-01' }).anchor, '2026-10-14');
});
test('series retains missing calendar dates as null', () => {
  const result = view();
  assert.equal(result.series.length, 30);
  assert.deepEqual(result.series.at(-1), { label: '10-14', date: '2026-10-14', value: 2400 });
  assert.ok(result.series.slice(0, -1).every(point => point.value === null));
  assert.equal(view(undefined, { period: 'week' }).series.length, 7);
  assert.equal(view(undefined, { period: 'month' }).series.length, 30);
});
test('hourly masks hours after reading but retains the reading hour', () => {
  const result = view();
  assert.equal(result.hourly.length, 24);
  assert.equal(result.hourly[12].value, 100);
  assert.ok(result.hourly.slice(13).every(point => point.value === undefined));
  assert.deepEqual([result.hourly[0].label, result.hourly[13].label], ['12 AM', '1 PM']);
  assert.ok(result.hourlyTitle.startsWith(strings.activity.hourlyTitle));
  const tokyo = snapshot(); tokyo.timezone = 'Asia/Tokyo';
  assert.equal(view(tokyo).hourlyTitle, 'Screen time by hour, GMT+9');
  assert.equal(view(undefined, { period: 'week' }).hourly, null);
});
test('missing hours and dates after the reading are Unknown', () => {
  const data = snapshot(); delete data.activity[0].days[0].hours;
  assert.ok(view(data).hourly.slice(0, 13).every(point => point.value === null));
  data.activity[0].days.push(day('2026-10-15'));
  assert.ok(view(data, { date: '2026-10-15' }).hourly.every(point => point.value === null));
});
test('Both masks every hour when a computer has no reading time', () => {
  const data = snapshot(); delete data.collectedAt; delete data.activity[1].checkedAt;
  data.activity[0].days.push(day('2026-10-13'), day('2026-10-15'));
  for (const date of ['2026-10-13', '2026-10-14', '2026-10-15']) assert.ok(view(data, { host: 'All', date }).hourly.every(point => point.value == null));
});
test('Both hourly chart falls back to archive times while Now stays Unknown', () => {
  const data = {
    timezone: 'UTC', collectedAt: readingAt,
    activity: [{ host: 'Mac', status: 'unavailable' }, { host: 'Windows', status: 'unavailable' }],
    activityHistory: [
      { host: 'Mac', status: 'ok', latestReadStatus: 'unavailable', asOf: '2026-10-14T11:20:00Z', days: [day()] },
      { host: 'Windows', status: 'ok', latestReadStatus: 'unavailable', asOf: '2026-10-14T10:20:00Z', days: [day()] },
    ],
  };
  const options = { host: 'All', period: 'day', date: '2026-10-14' };
  assert.deepEqual(view(data, options).hourly.map(point => point.value), [...Array(11).fill(200), null, null, ...Array(11).fill(undefined)]);
  assert.equal(activityNow(data, 'All', now).reason, 'noSource');
  assert.equal(activityNow(data, 'All', now).value, null);
  for (const asOf of [undefined, null, '', 'invalid']) {
    data.activityHistory[1].asOf = asOf;
    assert.deepEqual(view(data, options).hourly.map(point => point.value), [...Array(13).fill(null), ...Array(11).fill(undefined)]);
  }
});
test('Now hourly chart follows reading date instead of selected date', () => {
  const data = snapshot(); data.activity[0].days.push(day('2026-10-13', 4800));
  assert.equal(view(data, { period: 'now', date: '2026-10-13' }).hourly[12].value, 100);
});
test('categories and apps sum one host with overlap label and zero entries dropped', () => {
  const data = snapshot();
  data.activity[0].days = ['2026-10-14', '2026-10-13'].map(date => ({ ...day(date), categories: { Editors: 100, 'Mixed activity': 50, Browser: 0 }, apps: { Editors: { 'VS Code': 100, Safari: 0 } } }));
  assert.deepEqual(view(data, { period: 'week' }).categories, [
    { name: 'Editors', label: 'Editors', seconds: 200, apps: [{ name: 'VS Code', seconds: 200 }] },
    { name: 'Mixed activity', label: 'Device overlap', seconds: 100, apps: [] },
  ]);
  assert.equal(view().categories, null);
});
for (const status of ['recent', 'stale', 'unknown', 'unavailable']) test(`tracking ${status} uses shared wording without raw messages`, () => {
  const data = snapshot(); data.activityHistory = [{ ...source('Mac'), latestReadStatus: status === 'unavailable' ? 'error' : 'ok', trackingStatus: status, trackingThrough: readingAt, asOf: readingAt, trackingMessage: 'PRIVATE RAW MESSAGE' }];
  const result = view(data);
  assert.equal(result.tracking.status, status);
  assert.equal(result.tracking.label, strings.activity[`tracking${status[0].toUpperCase()}${status.slice(1)}`]);
  assert.equal(result.tracking.through, readingAt);
  assert.equal(result.tracking.asOf, readingAt);
  assert.ok(!JSON.stringify(result).includes('PRIVATE RAW MESSAGE'));
});
test('Both leaves the tracking warning to each computer\'s own view', () => {
  const data = snapshot(); data.activityHistory = [{ ...source('Mac'), latestReadStatus: 'error', trackingStatus: 'unknown' }];
  const result = view(data, { host: 'All' });
  assert.equal(result.tracking.status, 'recent');
  assert.equal(result.tracking.asOf, null);
  assert.equal(result.tracking.through, null);
  assert.equal(view(data).tracking.status, 'unavailable');
});
test('zero activity without coverage carries the tracking warning', () => {
  const data = snapshot(); data.activity[0].days = [{ ...day(undefined, 0), trackedSeconds: 0 }];
  assert.equal(view(data).noTracking, true);
});
test('Now notes translate each failure without exposing reason codes', () => {
  const cases = [
    [{}, strings.activity.nowNoSource],
    [{ ...snapshot(), collectedAt: undefined, activity: [source('Mac'), { ...source('Windows'), checkedAt: null }] }, strings.activity.nowNoReading],
    [{ ...snapshot(), activity: [source('Mac'), { ...source('Windows'), checkedAt: '2026-10-14T12:00:00Z' }] }, strings.activity.nowStale],
    [{ ...snapshot(), timezone: 'Invalid/Zone' }, strings.activity.nowZone],
    [{ ...snapshot(), activity: [source('Mac'), { ...source('Windows'), days: [] }] }, strings.activity.nowNoHours],
  ];
  for (const [data, note] of cases) {
    const result = view(data, { host: 'All', period: 'now' });
    assert.equal(result.total, null);
    assert.equal(result.note, note);
    assert.equal(result.windowSeconds, null);
  }
});
test('history supplies retained totals while Now uses the live source only', () => {
  const data = snapshot();
  data.activityHistory = [{ ...source('Mac', 7200), latestReadStatus: 'unavailable' }];
  assert.equal(view(data).total, 7200);
  assert.equal(view(data, { period: 'now' }).total, 200);
  data.activity[0].status = 'unavailable';
  assert.equal(view(data, { period: 'now' }).total, null);
  assert.equal(view(data).total, 7200);
  assert.equal(data.activityHistory[0].days[0].seconds, 7200);
});
test('categories hold one computer\'s own records, and Both adds them', () => {
  const data = snapshot();
  data.activity[0].days[0].categories = { Editors: 100 };
  data.activity[0].days[0].apps = { Editors: { 'VS Code': 100 } };
  data.activity[1].days[0].categories = { Editors: 900 };
  data.activity[1].days[0].apps = { Editors: { 'VS Code': 400, Xcode: 500 } };
  assert.equal(view(data).categories[0].seconds, 100);
  assert.deepEqual(view(data, { host: 'All' }).categories[0], { name: 'Editors', label: 'Editors', seconds: 1000,
    apps: [{ name: 'VS Code', seconds: 500 }, { name: 'Xcode', seconds: 500 }] });
});

test('a reading ahead of the clock has its own Now reason and note', () => {
  const ahead = '2026-10-14T12:35:00Z';
  assert.equal(run({ readingAt: ahead }).reason, 'ahead');
  const data = snapshot();
  data.activity[0].checkedAt = ahead;
  const result = view(data, { period: 'now' });
  assert.equal(result.total, null);
  assert.equal(result.note, "The last reading is ahead of this device's clock");
  assert.equal(run({ readingAt: undefined }).reason, 'noReading');
});
test('Both masks hours after the earlier computer\'s reading despite a later collection', () => {
  const data = snapshot();
  data.activity[0].days.push(day('2026-10-13'));
  data.activity[1] = { host: 'Windows', status: 'unavailable' };
  data.activityHistory = [{
    host: 'Windows', status: 'ok', latestReadStatus: 'unavailable', asOf: '2026-10-13T14:10:00Z',
    days: [{ date: '2026-10-13', seconds: 1500, hours: hours(100).map((value, hour) => hour <= 14 ? value : 0) }],
  }];
  const result = view(data, { host: 'All', date: '2026-10-13' });
  assert.deepEqual(result.hourly.map(point => point.value), [...Array(15).fill(200), ...Array(9).fill(null)]);
  assert.equal(view(data, { host: 'All', period: 'now' }).total, null);
  for (const asOf of [undefined, null, '', 'invalid']) {
    data.activityHistory[0].asOf = asOf;
    assert.ok(view(data, { host: 'All', date: '2026-10-13' }).hourly.every(point => point.value === null));
  }
});
test('unavailable device displays archived hours only through the archive reading', () => {
  const data = snapshot();
  data.activity[0].status = 'unavailable';
  data.activityHistory = [{
    host: 'Mac', status: 'ok', latestReadStatus: 'unavailable', asOf: readingAt,
    days: [day('2026-10-13'), day(), day('2026-10-15')],
  }];
  assert.deepEqual(view(data, { date: '2026-10-13' }).hourly.map(point => point.value), hours(100));
  assert.deepEqual(view(data).hourly.map(point => point.value), hours(100).map((value, hour) => hour <= 12 ? value : undefined));
  assert.deepEqual(data.activityHistory[0].days[0].hours, hours(100));
  assert.ok(view(data, { date: '2026-10-15' }).hourly.every(point => point.value === null));
  assert.equal(view(data, { period: 'now' }).total, null);
  assert.ok(view(data, { period: 'now' }).hourly.every(point => point.value == null));
  data.activityHistory[0].days[0].hours = hours(null);
  assert.ok(view(data, { date: '2026-10-13' }).hourly.every(point => point.value === null));
});

test('a stale device reading leaves today Unknown and charts only the hours up to that reading', () => {
  const data = snapshot();
  data.activity[0].checkedAt = new Date(Date.parse(data.collectedAt) - 660000).toISOString();
  data.activityHistory = [{ host: 'Mac', status: 'ok', latestReadStatus: 'ok', trackingStatus: 'recent', days: [day()] }];
  const result = view(data);
  assert.equal(result.total, null);
  assert.match(result.note, /as of/);
  assert.deepEqual(result.hourly.map(row => row.value), [...Array(13).fill(100), ...Array(11).fill(undefined)]);
  assert.equal(result.tracking.status, 'unavailable');
  assert.ok(view(data, { period: 'now' }).hourly.every(row => row.value == null));
  assert.equal(view(data, { host: 'All' }).total, null);
  assert.match(view(data, { host: 'All' }).byDevice[0].note, /as of/);
});

test('activity retains complete history while frozen readings age at draw time', () => {
  for (const lag of [0, 9, 11]) {
    const data = snapshot();
    data.collectedAt = new Date(now - 1800000).toISOString();
    data.activity[0].checkedAt = new Date(Date.parse(data.collectedAt) - lag * 60000).toISOString();
    data.activityHistory = [{ ...data.activity[0], days: [day('2026-10-13', 42), day()] }];
    const result = view(data, { date: '2026-10-13' });
    assert.equal(result.total, 42);
    assert.equal(result.note, '');
    assert.equal(result.hourly.some(row => row.value !== null), true);
    const empty = view(data, { now: now + 86400000 });
    assert.match(empty.note, /as of/);
  }
});

test('failed Mac reads still list and total the activity archive', () => {
  const data = snapshot();
  data.activity[0].status = 'unavailable';
  data.activityHistory = [{ host: 'Mac', status: 'ok', days: [day('2026-10-12', 20), day('2026-10-13', 40)] }];
  const result = view(data, { period: 'week' });
  assert.equal(result.total, 60);
  assert.deepEqual(result.dates, ['2026-10-14', '2026-10-13', '2026-10-12']);
});

test('late Windows history remains visible, All keeps every day, and periods reaching the reading stay Unknown', () => {
  for (const status of ['ok', 'stale']) {
    const data = snapshot();
    Object.assign(data.activity[1], { status, checkedAt: new Date(now - 15 * 60000).toISOString() });
    data.activityHistory = [{ host: 'Windows', status: 'ok', days: [day('2026-10-12', 20), day('2026-10-13', 40), day()] }];
    const all = view(data, { host: 'Windows', period: 'all' });
    assert.deepEqual([all.total, all.note, all.since], [2460, '', '2026-10-12']);
    for (const period of ['day', 'week', 'month']) {
      const result = view(data, { host: 'Windows', period });
      assert.equal(result.total, null);
      assert.match(result.note, /as of/);
      assert.ok(result.dates.includes('2026-10-13'));
      if (period === 'week') assert.deepEqual(result.series.slice(-3).map(row => row.value), [20, 40, 2400]);
    }
    const earlier = view(data, { host: 'Windows', period: 'week', date: '2026-10-13' });
    assert.equal(earlier.total, 60);
    assert.equal(earlier.note, '');
    const current = view(data, { host: 'Windows', period: 'now' });
    assert.equal(current.total, null);
    assert.equal(current.note, strings.activity.nowStale);
  }
});
