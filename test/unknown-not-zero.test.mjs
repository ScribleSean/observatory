import test from 'node:test';
import assert from 'node:assert/strict';
import {recordedDays,totals,untrackedDay} from '../lib/panel-data.mjs';
import {activityView} from '../lib/view-activity.mjs';
import {combine} from '../lib/combine.mjs';
import {ownSnapshot} from './helpers.mjs';

const now=Date.parse('2026-10-21T17:00:00Z');
const hours=()=>Array(24).fill(0);
const day=(date,seconds,trackedSeconds)=>({date,seconds,hours:hours(),trackedSeconds,trackedHours:hours(),categories:{},apps:{}});

function withDays(days) {
  return ownSnapshot('Mac',now,snapshot=>{
    const at=new Date(now).toISOString();
    const activity={host:'Mac',status:'ok',checkedAt:at,start:'2026-10-14T17:00:00Z',end:at,days};
    return {...snapshot,timezone:'America/New_York',collectedAt:at,
      activity:[activity,{host:'Windows',status:'not-connected'}],
      activityHistory:[{host:'Mac',status:'ok',latestReadStatus:'ok',asOf:at,days}]};
  });
}

test('a day with no tracking coverage has Unknown screen time',()=>{
  assert.equal(untrackedDay(day('2026-10-21',0,0)),true);
  assert.equal(untrackedDay(day('2026-10-21',0,3600)),false);
  assert.equal(untrackedDay(day('2026-10-21',120,120)),false);
  assert.equal(untrackedDay({date:'2026-10-21',seconds:0}),false);
});

test('today without tracking is Unknown, and a tracked quiet day is zero',()=>{
  const untracked=withDays([day('2026-10-20',3600,40000),day('2026-10-21',0,0)]);
  assert.equal(totals(untracked,'Mac','day',new Date(now)).seconds,null);
  const quiet=withDays([day('2026-10-20',3600,40000),day('2026-10-21',0,5000)]);
  assert.equal(totals(quiet,'Mac','day',new Date(now)).seconds,0);
});

test('a period that includes an untracked day counts the tracked days, and the untracked day stays Unknown',()=>{
  const snapshot=withDays([day('2026-10-19',3600,40000),day('2026-10-20',0,0),day('2026-10-21',1800,9000)]);
  assert.equal(totals(snapshot,'Mac','week',new Date(now)).seconds,5400);
  assert.equal(totals(withDays([day('2026-10-20',0,0)]),'Mac','week',new Date(now)).seconds,null);
  const marked=recordedDays(snapshot,'activity','Mac').find(row=>row.date==='2026-10-20');
  assert.equal(marked.seconds,null);
  assert.equal(marked.untracked,true);
});

test('the Activity page shows Unknown, not 0m, for an untracked day and its chart bar',()=>{
  const snapshot=withDays([day('2026-10-20',3600,40000),day('2026-10-21',0,0)]);
  const view=activityView(snapshot,{host:'Mac',period:'day',now});
  assert.equal(view.total,null);
  assert.equal(view.noTracking,true);
  assert.ok(view.hourly.every(point=>point.value===null || point.value===undefined),'hourly values are Unknown');
  assert.ok(view.hourly.some(point=>point.value===null));
  const week=activityView(snapshot,{host:'Mac',period:'week',now});
  const bar=week.series.find(point=>point.label==='10-21');
  assert.equal(bar.value,null);
});

test('the overview tile, the menu line and the two-computer sum say Unknown',()=>{
  const mac=withDays([day('2026-10-21',0,0)]);
  const pc=ownSnapshot('Windows',now);
  const combined=combine([{host:'Mac',snapshot:mac},{host:'Windows',snapshot:pc}],{now});
  const today=combined.glance.today.find(device=>device.host==='Mac');
  assert.equal(today.seconds,null);
  assert.equal(combined.glance.both.seconds,null);
  assert.ok(combined.glance.lines.some(line=>line.includes('Mac: Unknown screen')));
  assert.ok(!combined.glance.lines.some(line=>/Mac: 0m screen/.test(line)));
});

test('ledger history: a day that could not be read stays Unknown through cleaning and the hub, never 0',async()=>{
  const {sampleR2Combined}=await import('../lib/sample-r2.mjs');
  const {cleanLedgerHistory}=await import('../lib/r2-shape.mjs');
  const now=Date.parse('2026-11-18T15:00:00Z');
  const row=sampleR2Combined(now).view.ledgerHistory.find(entry=>entry.host==='Windows');
  const unreadable=row.days.find(day=>day.status==='unavailable');
  assert.ok(unreadable);
  // A tampered unavailable day that claims numbers is read back as Unknown.
  const tampered={...row,days:row.days.map(day=>day===unreadable?{...day,apiUsd:0,sessionCount:0,ship:{commits:0,onMain:0,merges:0}}:day)};
  const clean=cleanLedgerHistory(tampered,{titles:true}).days.find(day=>day.date===unreadable.date && day.tool===unreadable.tool);
  assert.deepEqual([clean.apiUsd,clean.sessionCount,clean.ship.commits,clean.tokens.output],[null,null,null,null]);
  const combined=combine([{host:'Windows',snapshot:ownSnapshot('Windows',now,snapshot=>({...snapshot,ledgerHistory:[tampered]}))}],{now,generatedBy:'Windows'});
  const viewed=combined.view.ledgerHistory.find(entry=>entry.host==='Windows').days.find(day=>day.date===unreadable.date && day.tool===unreadable.tool);
  assert.equal(viewed.apiUsd,null);
  // A null count elsewhere stays null, and Unknown spend in a session is not turned into 0.
  const nulls=structuredClone(row);
  const day=nulls.days.find(entry=>entry.status==='ok');
  day.sessions[0].apiUsd=null;day.apiUsd=null;
  const kept=cleanLedgerHistory(nulls,{titles:true}).days.find(entry=>entry.date===day.date && entry.tool===day.tool);
  assert.deepEqual([kept.apiUsd,kept.sessions[0].apiUsd],[null,null]);
});
