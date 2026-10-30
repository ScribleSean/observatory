import test from 'node:test';
import assert from 'node:assert/strict';
import {windowColumns,paceGuide} from '../lib/view-limit-history.mjs';

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
  const drifting=[0,1,2,3].map(step=>({t:reset+step*HOUR,r:100-step*5,x:reset+5*HOUR+step*HOUR}));
  const columns=windowColumns(drifting,'5h');
  assert.equal(columns.length,1);
  assert.equal(columns[0].low,85);
  const weekly=[0,1,2].map(step=>({t:reset+step*DAY,r:90,x:reset+6*DAY+step*HOUR}));
  assert.equal(paceGuide(weekly,'week',reset,reset+3*DAY).length,1);
});
