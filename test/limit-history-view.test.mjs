import test from 'node:test';
import assert from 'node:assert/strict';
import {limitHistorySeries,windowOf} from '../lib/view-limit-history.mjs';

const now=Date.parse('2026-10-21T17:00:00Z');
const minutes=m=>new Date(now-m*60000).toISOString();
const point=(o,m,r,extra={})=>({p:'claude',w:'five_hour',o,t:minutes(m),r,d:300,...extra});
const snapshot=points=>({deviceNames:{Mac:'Studio Mac',Windows:'Desk PC'},
  limitHistory:['Mac','Windows'].map(host=>({host,status:'ok',points:points.filter(row=>row.o===host)}))});

test('one line per computer, never added together',()=>{
  const data=limitHistorySeries(snapshot([point('Mac',60,70),point('Mac',30,60),point('Windows',45,65),point('Windows',10,55)]),{provider:'claude',window:'5h',range:'today',now});
  assert.deepEqual(data.series.map(row=>[row.host,row.name,row.points.map(p=>p.r)]),[['Mac','Studio Mac',[70,60]],['Windows','Desk PC',[65,55]]]);
  assert.ok(data.series.flatMap(row=>row.points).every(p=>p.r<=100),'no summed values');
});

test('the freshest reading names the computer and time it came from',()=>{
  const data=limitHistorySeries(snapshot([point('Mac',30,60),point('Windows',10,55)]),{provider:'claude',window:'5h',range:'week',now});
  assert.deepEqual(data.latest,{remaining:55,at:minutes(10),host:'Windows',name:'Desk PC'});
});

test('readings far apart break the line, so gaps stay gaps',()=>{
  const data=limitHistorySeries(snapshot([point('Mac',300,80),point('Mac',295,79),point('Mac',100,60),point('Mac',95,59)]),{provider:'claude',window:'5h',range:'today',now});
  assert.equal(data.series[0].segments.length,2);
});

test('reset markers come from the provider reset time, inside the range only',()=>{
  const data=limitHistorySeries(snapshot([point('Mac',120,20,{x:minutes(60)}),point('Mac',30,95,{x:minutes(-240)})]),{provider:'claude',window:'5h',range:'today',now});
  assert.deepEqual(data.resets,[now-60*60000]);
});

test('windows are told apart by duration or by their known names',()=>{
  assert.equal(windowOf({w:'primary',d:300}),'5h');
  assert.equal(windowOf({w:'seven_day'}),'week');
  assert.equal(windowOf({w:'secondary',d:10080}),'week');
  assert.equal(windowOf({w:'mystery'}),null);
});

test('no readings in range is empty, not zero, and ranges filter by time',()=>{
  const empty=limitHistorySeries(snapshot([]),{provider:'codex',window:'week',range:'month',now});
  assert.equal(empty.empty,true);
  assert.equal(empty.latest,null);
  const old=snapshot([point('Mac',10*24*60,50),point('Mac',60,40)]);
  assert.equal(limitHistorySeries(old,{provider:'claude',window:'5h',range:'week',now}).total,1);
  assert.equal(limitHistorySeries(old,{provider:'claude',window:'5h',range:'all',now}).total,2);
  // The freshest reading is shown even when it is outside the chosen range.
  assert.equal(limitHistorySeries(snapshot([point('Mac',3*24*60,45)]),{provider:'claude',window:'5h',range:'today',now}).latest.remaining,45);
});

test('the line breaks at a reset, so two windows are never joined',()=>{
  const data=limitHistorySeries(snapshot([point('Mac',90,20,{x:minutes(60)}),point('Mac',75,15,{x:minutes(60)}),point('Mac',45,100,{x:minutes(-240)})]),{provider:'claude',window:'5h',range:'today',now});
  assert.deepEqual(data.series[0].segments.map(segment=>segment.length),[2,1]);
});

test('a reset reported a minute apart is the same window, and readings that start inside the range are marked',()=>{
  const now=Date.parse('2026-10-21T22:00:00Z');
  const at=minutes=>new Date(now-minutes*60000).toISOString();
  const points=[[60,'2026-10-21T23:00:00Z',90],[45,'2026-10-21T22:59:00Z',89],[30,'2026-10-21T23:00:00Z',88]]
    .map(([ago,x,r])=>({p:'claude',w:'five_hour',o:'Mac',t:at(ago),r,x,d:300}));
  const data=limitHistorySeries({limitHistory:[{host:'Mac',points}]},{provider:'claude',window:'5h',range:'week',now});
  assert.equal(data.series[0].segments.length,1);
  assert.equal(data.resets.length,0);
  assert.equal(data.firstAt,Date.parse(at(60)));
  assert.equal(data.startsHere,true);
});
