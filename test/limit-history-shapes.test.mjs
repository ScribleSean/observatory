import test from 'node:test';
import assert from 'node:assert/strict';
import {windowColumns,paceGuide,dailyColumns} from '../lib/view-limit-history.mjs';

const HOUR=3600000, DAY=24*HOUR;
const reset=Date.parse('2026-10-30T15:00:00Z');

test('each 5-hour window becomes one column at its lowest reading',()=>{
  const points=[
    {t:reset-4*HOUR,r:90,x:reset},{t:reset-2*HOUR,r:12,x:reset+60000},{t:reset-HOUR,r:30,x:reset},
    {t:reset+HOUR,r:100,x:reset+5*HOUR},
  ];
  const columns=windowColumns(points,'5h');
  assert.equal(columns.length,2,'a reset reported a minute apart is the same window');
  assert.deepEqual(columns.map(column=>[column.low,column.readings]),[[12,3],[100,1]]);
  assert.equal(columns[0].start,reset-5*HOUR);
});

test('a reading with no reset time makes no column, so a missing window is never drawn as zero',()=>{
  assert.deepEqual(windowColumns([{t:reset,r:40,x:NaN}],'5h'),[]);
  assert.equal(windowColumns([{t:reset,r:0,x:reset}],'5h')[0].low,0,'a real empty reading stays zero');
});

test('the pace guide runs from 100% at the window start to 0% at its reset, clipped to the view',()=>{
  const end=reset+3*DAY;
  const [guide]=paceGuide([{t:reset,r:70,x:end}],'week',reset,reset+DAY);
  assert.equal(guide.t1,reset);
  assert.equal(guide.t2,reset+DAY);
  // The window started four days before the view, so four of its seven days are already spent.
  assert.ok(Math.abs(guide.r1-100*3/7)<1e-9);
  assert.ok(Math.abs(guide.r2-100*2/7)<1e-9);
  assert.ok(guide.r1>guide.r2,'it falls over time');
  assert.equal(paceGuide([],'week',reset,reset+DAY).length,0);
});

test('a reset time that drifts on every reading is still one window, and one pace line',()=>{
  // While idle at 100%, Codex reports a reset five hours from each reading, so it moves every time.
  const idle=[0,1,2,3].map(step=>({t:reset+step*2*HOUR,r:100,x:reset+5*HOUR+step*2*HOUR}));
  const used=[{t:reset+7*HOUR,r:80,x:reset+12*HOUR},{t:reset+8*HOUR,r:60,x:reset+12*HOUR}];
  const columns=windowColumns([...idle,...used],'5h');
  assert.deepEqual(columns.map(column=>column.low),[100,60],'one unused window, then the window that was used');
  const weekly=[
    ...[0,1,2].map(step=>({t:reset+step*DAY,r:100,x:reset+7*DAY+step*DAY})),
    {t:reset+3*DAY,r:90,x:reset+10*DAY},{t:reset+4*DAY,r:70,x:reset+10*DAY},
  ];
  const guides=paceGuide(weekly,'week',reset,reset+5*DAY);
  assert.equal(guides.length,1,'the idle run draws no guide');
  assert.equal(guides[0].end,reset+10*DAY);
});

test('an early reset starts a new window instead of inheriting the old low',()=>{
  const columns=windowColumns([
    {t:reset,r:10,x:reset+5*HOUR},
    {t:reset+2*HOUR,r:100,x:reset+7*HOUR},
    {t:reset+4*HOUR,r:60,x:reset+7*HOUR},
  ],'5h');
  assert.deepEqual(columns.map(column=>column.low),[10,60]);
  const boundary=windowColumns([{t:reset-HOUR,r:5,x:reset+60000},{t:reset,r:100,x:reset+5*HOUR}],'5h');
  assert.deepEqual(boundary.map(column=>column.low),[5,100],'a new reset time at the boundary is a new window');
});

test('two computers with different weekly resets get their own pace guides',()=>{
  const mac=[{t:reset,r:80,x:reset+2*DAY}], pc=[{t:reset,r:80,x:reset+5*DAY}];
  const ends=[...paceGuide(mac,'week',reset,reset+DAY),...paceGuide(pc,'week',reset,reset+DAY)].map(guide=>guide.end);
  assert.deepEqual(ends,[reset+2*DAY,reset+5*DAY]);
});

test('over long ranges windows group by day at the lowest reading',()=>{
  const day=new Date(reset); day.setHours(12,0,0,0);
  const columns=[{start:0,end:day.getTime(),low:40,readings:1,lastAt:0,latest:40},{start:0,end:day.getTime()+HOUR,low:15,readings:2,lastAt:0,latest:15}];
  const [only]=dailyColumns(columns);
  assert.equal(only.low,15);
  assert.equal(only.readings,3);
});
