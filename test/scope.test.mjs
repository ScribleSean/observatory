// The round 2 scope: calendar periods in the snapshot's zone, stepping, the comparison cut, chips and the URL form.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  periodOf, stepRange, comparisonOf, patchScope, deviceChips, visibleSources, defaultScope, scopeToSearch, scopeFromSearch,
  dateIn, datesBetween, addDays, validDate,
} from '../lib/scope.mjs';
import { sampleR2Combined, SAMPLE_R2_TIME_ZONE } from '../lib/sample-r2.mjs';

const NOW = Date.parse('2026-11-18T15:00:00Z'); // Wednesday 10 AM in New York
const NY = { timeZone: 'America/New_York', now: NOW, firstDate: '2026-01-05' };

test('each unit covers its calendar span, cut at today', () => {
  const day = periodOf({ unit: 'day', anchor: '2026-11-18' }, NY);
  assert.deepEqual([day.first, day.last, day.dates, day.current, day.partial, day.label], ['2026-11-18', '2026-11-18', ['2026-11-18'], true, false, 'Nov 18']);
  const week = periodOf({ unit: 'week', anchor: '2026-11-18' }, NY);
  assert.deepEqual([week.first, week.last, week.dates.length, week.current, week.partial, week.label], ['2026-11-16', '2026-11-18', 3, true, true, 'Nov 16 to 22']);
  const month = periodOf({ unit: 'month', anchor: '2026-11-03' }, NY);
  assert.deepEqual([month.first, month.last, month.dates.length, month.label], ['2026-11-01', '2026-11-18', 18, 'November 2026']);
  const year = periodOf({ unit: 'year', anchor: '2026-02-10' }, NY);
  assert.deepEqual([year.first, year.last, year.label], ['2026-01-01', '2026-11-18', '2026']);
  const all = periodOf({ unit: 'all', anchor: '2020-01-01' }, NY);
  assert.deepEqual([all.first, all.last, all.label, all.current], ['2026-01-05', '2026-11-18', 'All time', true]);
  const past = periodOf({ unit: 'week', anchor: '2026-11-04' }, NY);
  assert.deepEqual([past.first, past.last, past.dates.length, past.current, past.partial, past.label], ['2026-11-02', '2026-11-08', 7, false, false, 'Nov 2 to 8']);
  assert.equal(periodOf({ unit: 'week', anchor: '2026-10-28' }, NY).label, 'Oct 26 to Nov 1');
});

test('an anchor after today or not a date reads as today, and weeks start on Monday', () => {
  assert.equal(periodOf({ unit: 'day', anchor: '2027-01-01' }, NY).first, '2026-11-18');
  assert.equal(periodOf({ unit: 'day', anchor: '2026-02-30' }, NY).first, '2026-11-18');
  for (const anchor of ['2026-11-16', '2026-11-19', '2026-11-22']) assert.equal(periodOf({ unit: 'week', anchor }, { ...NY, now: Date.parse('2026-11-25T15:00:00Z') }).first, '2026-11-16');
});

test('stepping crosses month and year ends as dates', () => {
  const later = { ...NY, now: Date.parse('2027-03-01T15:00:00Z'), firstDate: '2025-01-01' };
  assert.deepEqual(stepRange({ unit: 'day', anchor: '2026-12-31' }, 1, later), { unit: 'day', anchor: '2027-01-01' });
  assert.deepEqual(stepRange({ unit: 'day', anchor: '2026-03-01' }, -1, later), { unit: 'day', anchor: '2026-02-28' });
  assert.deepEqual(stepRange({ unit: 'month', anchor: '2027-01-31' }, -1, later), { unit: 'month', anchor: '2026-12-01' });
  assert.deepEqual(stepRange({ unit: 'month', anchor: '2026-12-15' }, 1, later), { unit: 'month', anchor: '2027-01-01' });
  assert.deepEqual(stepRange({ unit: 'year', anchor: '2026-07-04' }, -1, later), { unit: 'year', anchor: '2025-01-01' });
  assert.deepEqual(stepRange({ unit: 'week', anchor: '2026-12-31' }, 1, later), { unit: 'week', anchor: '2027-01-04' });
  const spanning = periodOf({ unit: 'week', anchor: '2026-12-31' }, later);
  assert.deepEqual([spanning.first, spanning.last, spanning.label], ['2026-12-28', '2027-01-03', 'Dec 28 to Jan 3, 2027']);
});

test('a daylight saving change neither skips nor repeats a date', () => {
  // US clocks fall back on Nov 1 2026 and spring forward on Mar 8 2026.
  assert.equal(dateIn('America/New_York', Date.parse('2026-11-01T05:30:00Z')), '2026-11-01');
  assert.equal(dateIn('America/New_York', Date.parse('2026-11-02T04:30:00Z')), '2026-11-01');
  assert.equal(dateIn('America/New_York', Date.parse('2026-03-09T03:30:00Z')), '2026-03-08');
  const fall = periodOf({ unit: 'week', anchor: '2026-11-01' }, NY);
  assert.deepEqual(fall.dates, ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
  const spring = periodOf({ unit: 'month', anchor: '2026-03-08' }, NY);
  assert.equal(spring.dates.length, 31);
  assert.equal(new Set(spring.dates).size, 31);
  assert.deepEqual(stepRange({ unit: 'day', anchor: '2026-11-01' }, 1, NY), { unit: 'day', anchor: '2026-11-02' });
  assert.deepEqual(stepRange({ unit: 'day', anchor: '2026-03-09' }, -1, NY), { unit: 'day', anchor: '2026-03-08' });
});

test('the arrows stop at today, at the first recorded date, and never move All', () => {
  assert.equal(stepRange({ unit: 'week', anchor: '2026-11-18' }, 1, NY), null);
  assert.equal(stepRange({ unit: 'day', anchor: '2026-11-18' }, 1, NY), null);
  assert.deepEqual(stepRange({ unit: 'day', anchor: '2026-11-17' }, 1, NY), { unit: 'day', anchor: '2026-11-18' });
  assert.equal(stepRange({ unit: 'all', anchor: '2026-11-18' }, -1, NY), null);
  assert.equal(stepRange({ unit: 'day', anchor: '2026-01-05' }, -1, NY), null);
  // The week holding the first date is still reachable.
  assert.deepEqual(stepRange({ unit: 'week', anchor: '2026-01-12' }, -1, NY), { unit: 'week', anchor: '2026-01-05' });
  assert.equal(stepRange({ unit: 'week', anchor: '2026-01-05' }, -1, NY), null);
  assert.equal(stepRange({ unit: 'week', anchor: '2026-11-18' }, -1, { ...NY, firstDate: null }), null);
});

test('the comparison is the previous period cut to as many dates as this one has', () => {
  const week = comparisonOf({ unit: 'week', anchor: '2026-11-18' }, NY);
  assert.deepEqual(week.period.dates, ['2026-11-09', '2026-11-10', '2026-11-11']);
  assert.equal(week.toDate, true);
  assert.equal(week.label, 'vs same days last week');
  const month = comparisonOf({ unit: 'month', anchor: '2026-11-18' }, NY);
  assert.deepEqual([month.period.first, month.period.last, month.period.dates.length], ['2026-10-01', '2026-10-18', 18]);
  assert.equal(comparisonOf({ unit: 'day', anchor: '2026-11-18' }, NY).label, 'vs yesterday');
  assert.equal(comparisonOf({ unit: 'day', anchor: '2026-11-10' }, NY).label, 'vs the day before');
  // A whole past month against a shorter one keeps every date of the shorter one.
  const march = comparisonOf({ unit: 'month', anchor: '2026-03-15' }, NY);
  assert.deepEqual([march.period.first, march.period.last, march.toDate, march.label], ['2026-02-01', '2026-02-28', false, 'vs the month before']);
  const year = comparisonOf({ unit: 'year', anchor: '2027-02-01' }, { ...NY, now: Date.parse('2027-02-01T15:00:00Z') });
  assert.deepEqual([year.period.first, year.period.last], ['2026-01-01', '2026-02-01']);
});

test('no comparison for All, or when nothing was recorded before this period', () => {
  assert.equal(comparisonOf({ unit: 'all', anchor: '2026-11-18' }, NY), null);
  assert.equal(comparisonOf({ unit: 'week', anchor: '2026-11-18' }, { ...NY, firstDate: '2026-11-16' }), null);
  assert.notEqual(comparisonOf({ unit: 'week', anchor: '2026-11-18' }, { ...NY, firstDate: '2026-11-15' }), null);
  assert.equal(comparisonOf({ unit: 'week', anchor: '2026-11-18' }, { ...NY, firstDate: null }), null);
});

test('a patch replaces devices, keeps the anchor for a unit alone, and only narrows sources', () => {
  const scope = { devices: ['Mac', 'Windows'], range: { unit: 'week', anchor: '2026-11-18' }, sources: ['claude', 'grok'] };
  assert.deepEqual(patchScope(scope, { range: { unit: 'day' } }).range, { unit: 'day', anchor: '2026-11-18' });
  assert.deepEqual(patchScope(scope, { devices: ['Linux'] }).devices, ['Linux']);
  assert.deepEqual(patchScope(scope, { sources: ['codex', 'grok'] }).sources, ['grok']);
  assert.deepEqual(patchScope(scope, { devices: ['Nope'] }).devices, ['Mac', 'Windows']);
  assert.equal(patchScope(scope, undefined), scope);
});

test('the scope round trips through the URL and bad values fall back', () => {
  const scope = { devices: ['Mac', 'Linux'], range: { unit: 'month', anchor: '2026-10-02' }, sources: ['claude'] };
  const search = scopeToSearch(scope);
  assert.equal(search, '?devices=Mac,Linux&unit=month&anchor=2026-10-02&sources=claude');
  assert.deepEqual(scopeFromSearch(search, null), scope);
  const fallback = { devices: ['Mac'], range: { unit: 'week', anchor: '2026-11-18' }, sources: ['claude', 'grok'] };
  assert.deepEqual(scopeFromSearch('?devices=Toaster&unit=decade&anchor=2026-13-01&sources=', fallback), fallback);
  assert.deepEqual(scopeFromSearch('?devices=Linux,Mac,Mac', fallback).devices, ['Mac', 'Linux']);
  assert.deepEqual(scopeFromSearch('', fallback), fallback);
});

test('chips name each computer and say whether it is live, stale or not set up', () => {
  const snapshot = sampleR2Combined(NOW);
  const scope = defaultScope(snapshot, { now: NOW });
  assert.deepEqual(scope.devices, ['Mac', 'Windows', 'Linux']);
  assert.deepEqual(scope.range, { unit: 'week', anchor: '2026-11-18' });
  const chips = deviceChips(snapshot, scope, { now: NOW });
  assert.deepEqual(chips.map(chip => [chip.host, chip.name, chip.state, chip.selected]),
    [['Mac', 'Studio', 'live', true], ['Windows', 'Tower', 'stale', true], ['Linux', 'Lab', 'live', true]]);
  assert.equal(chips[1].since, '2026-11-18T12:00:00.000Z');
  const two = { ...snapshot, devices: snapshot.devices.slice(0, 2), view: { ...snapshot.view, config: snapshot.view.config.slice(0, 2) } };
  assert.equal(deviceChips(two, scope, { now: NOW })[2].state, 'not-set-up');
});

test('a source shows only when it is on and has data in the period on a selected computer', () => {
  const snapshot = sampleR2Combined(NOW);
  const week = { devices: ['Mac', 'Windows', 'Linux'], range: { unit: 'week', anchor: '2026-11-18' }, sources: [] };
  assert.deepEqual(visibleSources(snapshot, week, { now: NOW }), ['claude', 'codex', 'grok']);
  // Codex runs on Windows only and Grok is read on the Mac.
  assert.deepEqual(visibleSources(snapshot, { ...week, devices: ['Linux'] }, { now: NOW }), ['claude']);
  const off = { ...snapshot, view: { ...snapshot.view, config: snapshot.view.config.map(row => ({ ...row, sources: { ...row.sources, codex: false, codexLimits: false } })) } };
  assert.deepEqual(visibleSources(off, week, { now: NOW }), ['claude', 'grok']);
  // A year ago, nothing had been recorded.
  assert.deepEqual(visibleSources(snapshot, { ...week, range: { unit: 'day', anchor: '2025-11-18' } }, { now: NOW }), []);
});

test('date helpers', () => {
  assert.deepEqual(datesBetween('2026-02-27', '2026-03-02'), ['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(validDate('2026-02-29'), false);
  assert.equal(dateIn(SAMPLE_R2_TIME_ZONE, NOW), '2026-11-18');
});
