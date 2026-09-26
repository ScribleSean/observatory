import test from 'node:test';
import assert from 'node:assert/strict';
import {antigravityAllowanceDisplay,antigravityPoolLabel} from './provider-allowance-display.mjs';

const now=Date.parse('2026-09-25T12:00:00Z');
const source=()=>({provider:'antigravity',host:'Mac',status:'ok',checkedAt:new Date(now).toISOString(),windows:[
  {bucket:'privateCamelCaseBucket',window:'5h',remainingPercent:75,resetsAt:'2026-09-25T17:00:00Z',secret:'PRIVATE'},
  {bucket:'otherBucket',window:'weekly',remainingPercent:50,resetsAt:'2026-10-02T12:00:00Z'}]});

test('provider display uses human window labels and ordinal allowances without guessing model identities',()=>{
  const result=antigravityAllowanceDisplay(source(),now);
  assert.equal(result.status,'Latest reading');assert.equal(result.checkedAt,'2026-09-25T12:00:00.000Z');
  assert.deepEqual(result.windows.map(row=>[row.pool,row.label]),[['Allowance 1','5-hour window'],['Allowance 2','Weekly window']]);
  assert.equal(antigravityPoolLabel('internalGeminiCapacityBucket',0),'Allowance 1');
  assert.equal(result.windows[0].secret,undefined);
});

test('old or future observations cannot appear current and keep the original check time',()=>{
  for(const checkedAt of [new Date(now-600000).toISOString(),new Date(now+1).toISOString()]) {
    const result=antigravityAllowanceDisplay({...source(),checkedAt},now);
    assert.equal(result.status,'Saved reading');assert.equal(result.checkedAt,checkedAt);
    assert.equal(result.windows[0].stale,true);
  }
});

test('unavailable and unsupported sources show Unknown without retained percentages',()=>{
  for(const status of ['unavailable','unsupported']) {
    const result=antigravityAllowanceDisplay({...source(),status},now);
    assert.equal(result.status,'Unknown');assert.deepEqual(result.windows,[]);
  }
  assert.match(antigravityAllowanceDisplay({...source(),host:'Windows',status:'unsupported'},now).guidance,/supported on Mac/);
  assert.equal(antigravityAllowanceDisplay(undefined,now).status,'Collection off');
});

test('elapsed reset times are disclosed and invalid display counters remain absent',()=>{
  const old=source();old.windows[0].resetsAt='2026-09-25T11:59:59Z';
  assert.equal(antigravityAllowanceDisplay(old,now).windows[0].resetReached,true);
  for(const remainingPercent of [null,'75',NaN,Infinity,-1,101]) {
    const raw=source();raw.windows[0].remainingPercent=remainingPercent;
    assert.equal(antigravityAllowanceDisplay(raw,now).windows.length,1);
  }
});
