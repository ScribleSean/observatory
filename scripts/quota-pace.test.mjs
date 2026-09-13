import test from 'node:test';
import assert from 'node:assert/strict';
import {quotaPace} from './quota-pace.mjs';
import {quotaChartSegments} from './quota-history.mjs';

const now = Date.parse('2026-09-13T12:00:00Z');
const iso = value => new Date(value).toISOString();
function fixture() {
  const windows = [{bucket:'codex',window:'primary',remainingPercent:50,durationMinutes:300,resetsAt:iso(now+4*3600000)}];
  return {status:'ok',checkedAt:iso(now),windows,history:Array.from({length:13},(_,i)=>({
    checkedAt:iso(now-(12-i)*300000),windows:[{...windows[0],remainingPercent:70-i*20/12}]
  }))};
}
const pace = quota => quotaPace(quota,now)[0];
test('reset timestamp rounding is bounded and does not join real resets',()=>{
  for(const delta of [-2000,-1000,1000,2000,2001,300000]) {
    const q=fixture();
    for(const s of q.history.slice(0,-1))s.windows[0].resetsAt=iso(Date.parse(q.windows[0].resetsAt)+delta);
    assert.equal(pace(q).status,Math.abs(delta)<=2000?'projected':'insufficient-history');
    assert.equal(quotaChartSegments({samples:q.history},'codex','primary').length,Math.abs(delta)<=2000?1:2);
  }
});
test('timer jitter preserves history but longer gaps and stale readings do not',()=>{
  for(const gap of [600022,600111,600972,630000]) {
    const q=fixture();
    q.history=Array.from({length:4},(_,i)=>({checkedAt:iso(now-(3-i)*gap),windows:[{...q.windows[0],remainingPercent:56-2*i}]}));
    assert.equal(pace(q).status,'resets-first');
    assert.ok(pace(q).percentagePointsPerHour>0);
    assert.equal(quotaChartSegments({samples:q.history},'codex','primary').length,1);
    assert.equal(quotaPace(q,now+600000)[0].status,'stale');
  }
  const q=fixture();q.history=Array.from({length:4},(_,i)=>({checkedAt:iso(now-(3-i)*630001),windows:[{...q.windows[0],remainingPercent:56-2*i}]}));
  assert.equal(pace(q).status,'insufficient-history');
  assert.equal(quotaChartSegments({samples:q.history},'codex','primary').length,4);
});
test('observed hourly pace projects hours and minutes without changing readings',()=>{
  const quota=fixture(), before=structuredClone(quota), result=pace(quota);
  assert.equal(result.status,'projected');
  assert.equal(result.percentagePointsPerHour,20);
  assert.equal(result.observedMinutes,60);
  assert.equal(result.remainingMinutes,150);
  assert.equal(result.summary,'20.0% of allowance/hour over 60 min. Approximately 2h 30m left at this pace (at last check). Reset in 4h 0m. Estimated allowance covers 63% of the time until reset (at last check).');
  assert.equal(result.timeUntilResetMinutes,240);
  assert.equal(result.coverageFraction,0.625);
  assert.equal(result.estimatedExhaustionAt,iso(now+150*60000));
  assert.deepEqual(quota,before);
  assert.equal(quotaPace(quota,now+60000)[0].remainingMinutes,149);
});
test('reset comparison remains bounded and unavailable estimates have no timeline',()=>{
  const q=fixture();q.windows[0].resetsAt=iso(now+60*60000);
  for(const s of q.history)s.windows[0].resetsAt=q.windows[0].resetsAt;
  assert.equal(pace(q).coverageFraction,1);
  assert.equal(pace(q).timeUntilResetMinutes,60);
  assert.match(pace(q).summary,/Expected to reset before running out/);
  for(const result of [quotaPace(q,now+600000)[0],pace({...q,history:[]}),quotaPace(q,now+3600000)[0]]) {
    assert.equal(result.coverageFraction,null);
    assert.equal(result.comparisonSummary,null);
  }
  const later=quotaPace(fixture(),now+60000)[0];
  assert.equal(later.timeUntilResetMinutes,239);
  assert.equal(later.coverageFraction,149/239);
});
test('requires sufficient fresh observations',()=>{
  for(const mutate of [q=>q.history=q.history.slice(-2),q=>q.history=q.history.slice(-3),
    q=>q.history.pop(),q=>q.history.at(-1).windows[0].remainingPercent=49]) {
    const q=fixture();mutate(q);assert.equal(pace(q).status,'insufficient-history');
  }
  for(const status of ['stale','needs-auth','not-connected']) {
    const q=fixture();q.status=status;assert.equal(pace(q).status,'stale');
  }
  assert.equal(quotaPace(fixture(),now+600000)[0].status,'stale');
  assert.equal(quotaPace(fixture(),now-1)[0].status,'stale');
});
test('does not join resets, gaps, corrections or conflicting observations',()=>{
  for(const mutate of [
    q=>q.history.at(-3).windows[0].resetsAt=iso(now+600000),
    q=>q.history.at(-3).windows[0].durationMinutes=60,
    q=>q.history.at(-3).windows=[],
    q=>q.history.at(-3).windows.push({...q.history.at(-3).windows[0]}),
    q=>q.history.at(-3).windows[0].remainingPercent=-1,
    q=>q.history.at(-3).windows[0].remainingPercent=1,
    q=>q.history.at(-2).checkedAt=q.history.at(-3).checkedAt,
    q=>q.history.splice(-5,3),
    q=>q.history.push({checkedAt:iso(now+1),windows:q.windows})
  ]) {
    const q=fixture();mutate(q);assert.equal(pace(q).status,'insufficient-history');
  }
});
test('idle, exhausted and resets-first do not invent a countdown',()=>{
  const idle=fixture();for(const s of idle.history)s.windows[0].remainingPercent=50;
  assert.equal(pace(idle).status,'no-recent-consumption');
  assert.equal(pace(idle).remainingMinutes,null);
  const exhausted=fixture();exhausted.windows[0].remainingPercent=0;
  assert.equal(pace(exhausted).status,'exhausted');
  const q=fixture();q.windows[0].resetsAt=iso(now+60000);
  for(const s of q.history)s.windows[0].resetsAt=q.windows[0].resetsAt;
  assert.equal(pace(q).status,'resets-first');assert.equal(pace(q).remainingMinutes,null);
  assert.equal(quotaPace(q,now+60000)[0].status,'reset-pending');
  q.windows[0].resetsAt=null;for(const s of q.history)s.windows[0].resetsAt=null;
  assert.equal(pace(q).status,'reset-unknown');
});
test('independent windows and empty inputs',()=>{
  const q=fixture();q.windows.push({...q.windows[0],bucket:'other'});
  assert.equal(quotaPace(q,now)[1].status,'insufficient-history');
  assert.deepEqual(quotaPace(null,now),[]);
  assert.throws(()=>quotaPace(q,NaN));
});
test('expired extrapolation waits for evidence instead of reporting a measured exhaustion',()=>{
  const q=fixture();q.windows[0].remainingPercent=0.1;
  for(const [i,s] of q.history.entries())s.windows[0].remainingPercent=12.1-i;
  // Keep the latest reading exactly equal despite floating point arithmetic.
  q.history.at(-1).windows[0].remainingPercent=0.1;
  assert.equal(quotaPace(q,now+60000)[0].status,'awaiting-observation');
  assert.equal(quotaPace(q,now+60000)[0].remainingMinutes,null);
});
