import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanIntervals, summarize, summarizeTracked, trackingState, threeHourBands } from './activity-timeline.mjs';
test('app detail is allowlisted and overlap is counted once', () => {
  const start='2026-09-06T04:00:00Z', end='2026-09-06T06:00:00Z';
  const a={start,end:'2026-09-06T05:00:00Z',category:'AI apps',app:'Codex'};
  const r=summarize(cleanIntervals([a,{...a,app:'private-secret'}],start,end),start,end);
  assert.equal(r.days[0].apps['AI apps']['Multiple apps'],3600);
  assert.equal(r.days[0].seconds,3600);
  assert.ok(!JSON.stringify(r).includes('private-secret'));
});
const start = '2026-09-06T04:00:00Z', end = '2026-09-07T04:00:00Z';
test('idle coverage advances freshness without inventing active time',()=>{
  const tracking=cleanIntervals([{start,end,category:'Other'}],start,end);
  const report=summarizeTracked([],tracking,start,end);
  assert.equal(report.trackingThrough,new Date(end).toISOString());
  assert.equal(report.days.reduce((sum,day)=>sum+day.seconds,0),0);
  assert.equal(summarizeTracked([],[],start,end).trackingThrough,null);
  assert.equal(summarizeTracked([],undefined,start,end).trackingThrough,undefined);
});
const row = (a, b, category = 'AI apps') => ({ start: `2026-09-06T${a}:00Z`, end: `2026-09-06T${b}:00Z`, category, title: 'private' });
test('overlap counts once with explicit mixed categories', () => {
  const rows = cleanIntervals([row('12:00','13:00'), row('12:30','13:30','Editors')], start, end);
  assert.ok(!JSON.stringify(rows).includes('private'));
  const r = summarize(rows, start, end);
  assert.equal(r.days[0].seconds, 5400);
  assert.equal(r.categories['Mixed activity'], 1800);
  assert.equal(r.days[0].hours.reduce((a,b) => a+b), 5400);
});
test('duplicate intervals do not inflate time', () => {
  const r = summarize(cleanIntervals([row('12:00','13:00'),row('12:00','13:00')], start, end), start, end);
  assert.equal(r.days[0].seconds, 3600);
});
test('clipping, invalid categories and empty recorded days', () => {
  assert.throws(() => cleanIntervals([row('12:00','13:00','private-app')], start, end));
  assert.throws(() => cleanIntervals([row('13:00','12:00')], start, end));
  assert.equal(summarize([], start, end).days[0].seconds, 0);
  assert.equal(cleanIntervals([row('03:00','05:00')], start, end)[0].start, Date.parse(start));
});
test('midnight splits across local dates', () => {
  const r = summarize(cleanIntervals([row('03:30','04:30')], '2026-09-05T04:00:00Z', end), '2026-09-05T04:00:00Z', end);
  assert.equal(r.days.find(d => d.date === '2026-09-05').seconds, 1800);
  assert.equal(r.days.find(d => d.date === '2026-09-06').seconds, 1800);
});
test('fall DST repeated hour preserves exact duration', () => {
  const lo = '2026-11-01T04:00:00Z', hi = '2026-11-02T05:00:00Z';
  const r = summarize(cleanIntervals([{start:'2026-11-01T05:00:00Z',end:'2026-11-01T07:00:00Z',category:'Editors'}],lo,hi),lo,hi);
  assert.equal(r.days[0].seconds,7200);
  assert.equal(r.days[0].hours[1],7200);
});
test('coverage distinguishes missing history from tracked idle time', () => {
  const tracked=cleanIntervals([row('12:00','13:00')],start,end);
  const idle=summarizeTracked([],tracked,start,end).days[0];
  assert.equal(idle.seconds,0);
  assert.equal(idle.trackedSeconds,3600);
  assert.equal(trackingState(idle),'tracked');
  assert.equal(trackingState(summarizeTracked([],[],start,end).days[0]),'untracked');
  assert.equal(trackingState(summarize([],start,end).days[0]),'unknown');
  assert.equal(trackingState(undefined),'untracked');
});
test('coverage unions duplicates and three-hour bands preserve active totals', () => {
  const active=cleanIntervals([row('12:00','13:00')],start,end);
  const day=summarizeTracked(active,[...active,...active],start,end).days[0];
  assert.equal(day.trackedSeconds,3600);
  assert.equal(day.seconds,3600);
  const bands=threeHourBands(day);
  assert.equal(bands.length,8);
  assert.equal(bands.reduce((n,b)=>n+b.seconds,0),day.seconds);
  assert.equal(bands.reduce((n,b)=>n+b.trackedSeconds,0),day.trackedSeconds);
});
