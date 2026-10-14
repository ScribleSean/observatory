import test from 'node:test';
import assert from 'node:assert/strict';
import { NOW_MAX_AGE_MS, nowFromHours, activityNow, activityView } from '../lib/view-activity.mjs';
import { sampleSnapshot } from '../lib/sample-snapshot.mjs';
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
  assert.equal(NOW_MAX_AGE_MS, 600000);
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
test('All needs a Combined live row', () => {
  const data = snapshot(); delete data.combined;
  assert.equal(activityNow(data, 'All', now).reason, 'noSource');
});
test('Combined never falls back to collection time', () => {
  const data = snapshot(); delete data.combined.checkedAt;
  assert.equal(activityNow(data, 'All', now).reason, 'noReading');
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
test('All uses Combined rather than adding device values', () => {
  const data = snapshot();
  assert.equal(activityNow(data, 'All', now).value, 300);
  assert.notEqual(activityNow(data, 'All', now).value, activityNow(data, 'Mac', now).value + activityNow(data, 'Windows', now).value);
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
  assert.deepEqual(result.series.at(-1), { label: '10-14', value: 2400 });
  assert.ok(result.series.slice(0, -1).every(point => point.value === null));
  assert.equal(view(undefined, { period: 'week' }).series.length, 7);
  assert.equal(view(undefined, { period: 'month' }).series.length, 30);
});
test('hourly masks hours after reading but retains the reading hour', () => {
  const result = view();
  assert.equal(result.hourly.length, 24);
  assert.equal(result.hourly[12].value, 100);
  assert.ok(result.hourly.slice(13).every(point => point.value === null));
  assert.ok(result.zoneLabel.includes('UTC'));
  assert.equal(view(undefined, { period: 'week' }).hourly, null);
});
test('missing hours and dates after the reading are Unknown', () => {
  const data = snapshot(); delete data.activity[0].days[0].hours;
  assert.ok(view(data).hourly.every(point => point.value === null));
  data.activity[0].days.push(day('2026-10-15'));
  assert.ok(view(data, { date: '2026-10-15' }).hourly.every(point => point.value === null));
});
test('Combined live source without reading masks every date', () => {
  const data = snapshot(); delete data.combined.checkedAt;
  data.combined.days.push(day('2026-10-13'), day('2026-10-15'));
  for (const date of ['2026-10-13', '2026-10-14', '2026-10-15']) assert.ok(view(data, { host: 'All', date }).hourly.every(point => point.value === null));
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
test('Combined tracking has a distinct detail and invalid times stay null', () => {
  const data = snapshot(); data.activityHistory = [{ ...source('Combined'), latestReadStatus: 'ok', trackingStatus: 'recent', asOf: 'invalid' }];
  const result = view(data, { host: 'All' });
  assert.equal(result.tracking.detail, strings.activity.trackingRecentCombinedDetail);
  assert.equal(result.tracking.asOf, null);
  assert.equal(result.tracking.through, null);
});
test('one caveat and additional information match the period', () => {
  assert.equal(view().caveat, strings.activity.zoneCaveat.replace('{zone}', 'UTC'));
  const result = view(undefined, { period: 'now' });
  assert.equal(result.caveat, strings.activity.nowCaveat);
  assert.ok(result.info.includes(view().caveat));
  assert.ok(view().info.includes(strings.activity.missingDates));
});
test('zero activity without coverage carries the tracking warning', () => {
  const data = snapshot(); data.activity[0].days = [{ ...day(undefined, 0), trackedSeconds: 0 }];
  assert.equal(view(data).noTracking, true);
});
test('sample Mac Now is ok at a fixed time', () => assert.equal(activityNow(sampleSnapshot(now), 'Mac', now).reason, 'ok'));

test('Now notes translate each failure without exposing reason codes', () => {
  const cases = [
    [{}, strings.activity.nowNoSource],
    [{ ...snapshot(), combined: { ...source('Combined'), checkedAt: null } }, strings.activity.nowNoReading],
    [{ ...snapshot(), combined: { ...source('Combined'), checkedAt: '2026-10-14T12:00:00Z' } }, strings.activity.nowStale],
    [{ ...snapshot(), timezone: 'Invalid/Zone' }, strings.activity.nowZone],
    [{ ...snapshot(), combined: { ...source('Combined'), days: [] } }, strings.activity.nowNoHours],
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
});
test('categories do not include peer device or Combined records', () => {
  const data = snapshot();
  data.activity[0].days[0].categories = { Editors: 100 };
  data.activity[1].days[0].categories = { Editors: 900 };
  data.combined.days[0].categories = { Editors: 700 };
  assert.equal(view(data).categories[0].seconds, 100);
  assert.equal(view(data, { host: 'All' }).categories[0].seconds, 700);
});

test('a reading ahead of the clock has its own Now reason and note', () => {
  const ahead = '2026-10-14T12:32:30Z';
  assert.equal(run({ readingAt: ahead }).reason, 'ahead');
  const data = snapshot();
  data.activity[0].checkedAt = ahead;
  const result = view(data, { period: 'now' });
  assert.equal(result.total, null);
  assert.equal(result.note, "The last reading is ahead of this device's clock");
  assert.equal(run({ readingAt: undefined }).reason, 'noReading');
});
test('Combined archive masks hours after its reading despite a later collection', () => {
  const data = {
    timezone: 'UTC', collectedAt: readingAt,
    combined: { host: 'Combined', status: 'unavailable' },
    activityHistory: [{
      host: 'Combined', status: 'ok', latestReadStatus: 'unavailable', asOf: '2026-10-13T14:10:00Z',
      days: [{ date: '2026-10-13', seconds: 1500, hours: hours(100).map((value, hour) => hour <= 14 ? value : 0) }],
    }],
  };
  const result = view(data, { host: 'All', date: '2026-10-13' });
  assert.deepEqual(result.hourly.map(point => point.value), [...Array(15).fill(100), ...Array(9).fill(null)]);
  assert.equal(view(data, { host: 'All', period: 'now' }).total, null);
  delete data.combined;
  for (const asOf of [undefined, null, '', 'invalid']) {
    data.activityHistory[0].asOf = asOf;
    assert.ok(view(data, { host: 'All', date: '2026-10-13' }).hourly.every(point => point.value === null));
  }
});
test('unavailable device retains earlier hours and masks at the archive reading', () => {
  const data = snapshot();
  data.activity[0].status = 'unavailable';
  data.activityHistory = [{
    host: 'Mac', status: 'ok', latestReadStatus: 'unavailable', asOf: readingAt,
    days: [day('2026-10-13'), day(), day('2026-10-15')],
  }];
  assert.deepEqual(view(data, { date: '2026-10-13' }).hourly.map(point => point.value), hours(100));
  assert.deepEqual(view(data).hourly.map(point => point.value), [...Array(13).fill(100), ...Array(11).fill(null)]);
  assert.ok(view(data, { date: '2026-10-15' }).hourly.every(point => point.value === null));
  assert.equal(view(data, { period: 'now' }).total, null);
  assert.ok(view(data, { period: 'now' }).hourly.every(point => point.value === null));
  data.activityHistory[0].days[0].hours = hours(null);
  assert.ok(view(data, { date: '2026-10-13' }).hourly.every(point => point.value === null));
});
