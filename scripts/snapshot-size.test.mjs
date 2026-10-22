import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotMaximumBytes,snapshotHistoryBudget,serializeSnapshot} from './snapshot-size.mjs';
import {retainActivityHistory} from './activity-history.mjs';
import {categories,appLabels} from './activity-timeline.mjs';
import {quotaRetention,retainQuotaHistory} from './quota-history.mjs';
import {cleanClaudeTokenSource,attachProviderTokenEstimates} from './provider-token-sources.mjs';
const at='2026-10-18T12:00:00.000Z',now=Date.parse(at),maximum=Number.MAX_SAFE_INTEGER;
const date=index=>new Date(now-index*86400000).toISOString().slice(0,10);
function maximalHistory() {
  const value=89999.999,keys=[...categories,'Mixed activity'];
  const days=Array.from({length:3650},(_,index)=>({date:date(index),seconds:value,hours:Array(24).fill(value),
    trackedSeconds:value,trackedHours:Array(24).fill(value),categories:Object.fromEntries(keys.map(key=>[key,value])),
    apps:Object.fromEntries(keys.map(key=>[key,Object.fromEntries([...appLabels,'Overlapping categories','Multiple apps'].map(app=>[app,value]))])),
    windowStart:'+010000-01-01T00:00:00.000Z',windowEnd:'+010000-01-02T00:00:00.000Z'}));
  return retainActivityHistory(['Combined','Mac','Windows'].map(host=>({host,days,asOf:at})),[],at);
}
function quota() {
  const windows=Array.from({length:32},(_,index)=>({bucket:'x'.repeat(78)+String(index).padStart(2,'0'),window:'secondary',
    remainingPercent:99.99999999999999,durationMinutes:maximum,resetsAt:'+010000-01-01T00:00:00.000Z'}));
  const samples=Array.from({length:quotaRetention.maxSamples},(_,index)=>({checkedAt:new Date(now-index).toISOString(),windows}));
  const history=retainQuotaHistory({version:1,scope:'a'.repeat(64),samples},{status:'ok',checkedAt:at,windows,
    accountUsage:{status:'ok',dailyUsageBuckets:Array.from({length:quotaRetention.maxDailyBuckets},(_,index)=>({startDate:date(index),tokens:maximum}))}},
    {scope:'a'.repeat(64),now});
  assert.ok(Buffer.byteLength(JSON.stringify(history.samples))<=quotaRetention.maxSampleBytes);
  return {history:history.samples,windows,dailyUsageBuckets:history.dailyUsageBuckets};
}
function provider(host,modelCount=1,dayCount=3660) {
  const count=Math.floor(maximum/modelCount/4),part=count*modelCount;
  const models=Array.from({length:modelCount},(_,index)=>({model:`claude-sonnet-5-5-${String(index).padStart(8,'0')}-latest`,
    inputTokens:count,cacheReadTokens:count,cacheCreationTokens:count,outputTokens:count,totalTokens:count*4,requestCount:count}));
  const day={inputTokens:part,cacheReadTokens:part,cacheCreationTokens:part,outputTokens:part,totalTokens:part*4,requestCount:part,models};
  const hour=Math.floor(day.totalTokens/24);
  return cleanClaudeTokenSource({provider:'claude-code',status:'ok',days:Array.from({length:dayCount},(_,index)=>({date:date(index),...day,
    hours:Array.from({length:24},(_,hourIndex)=>hour+(hourIndex<day.totalTokens-hour*24?1:0))}))},host,at,{hours:host==='Mac'});
}
test('under budget is byte-for-byte unchanged, including Unknown and Unicode',()=>{
  const data={collectedAt:at,missing:null,label:'Unknown 🪴',activityHistory:[{host:'Mac',days:[{date:date(0),seconds:null}]}]};
  const before=JSON.stringify(data),result=serializeSnapshot(data);
  assert.equal(result.text,before);assert.equal(JSON.stringify(data),before);
  assert.equal(result.bytes,Buffer.byteLength(before));
});
test('history drops whole oldest dates across hosts and keeps newest rows intact',()=>{
  const data={activityHistory:maximalHistory(),current:{seconds:null,hours:null}};
  const before=structuredClone(data),result=serializeSnapshot(data);
  assert.ok(Buffer.byteLength(JSON.stringify(before))>snapshotMaximumBytes);
  assert.ok(result.bytes<=snapshotHistoryBudget);
  assert.equal(result.text,JSON.stringify(data));
  for(const host of data.activityHistory) {
    const original=before.activityHistory.find(row=>row.host===host.host);
    assert.ok(host.days.length>0 && host.days.length<3650);
    assert.deepEqual(host.days,original.days.slice(-host.days.length));
    assert.deepEqual(host.days.map(row=>row.date),data.activityHistory[0].days.map(row=>row.date));
  }
  assert.deepEqual(data.current,before.current);
});
test('non-history above budget preserves all dates below the hard limit',()=>{
  const data={synthetic:'x'.repeat(snapshotHistoryBudget+1),activityHistory:maximalHistory().map(host=>({...host,days:host.days.slice(-2)}))};
  const before=JSON.stringify(data),result=serializeSnapshot(data);
  assert.ok(result.bytes<snapshotMaximumBytes);
  assert.equal(result.text,before);assert.equal(JSON.stringify(data),before);
});
test('non-history above budget drops only the oldest dates needed for the hard limit',()=>{
  const days=[3,2,1,0].map(index=>({date:date(index),synthetic:'x'.repeat(1_000_000),seconds:null}));
  const data={synthetic:'x'.repeat(13_000_000),activityHistory:[{host:'Mac',status:'ok',days}]};
  const result=serializeSnapshot(data);
  assert.ok(result.bytes<=snapshotMaximumBytes);assert.ok(result.bytes>snapshotHistoryBudget);
  assert.deepEqual(data.activityHistory[0].days,days.slice(2));
  assert.ok(Buffer.byteLength(JSON.stringify({...data,activityHistory:[{host:'Mac',status:'ok',days:days.slice(1)}]}))>snapshotMaximumBytes);
});
test('exact budget boundary stops trimming and empty hosts use retained history status',()=>{
  const days=[{date:date(1),seconds:null},{date:date(0),seconds:null}];
  const data={synthetic:'',activityHistory:[{host:'Mac',status:'ok',days:days.slice(0,1)},
    {host:'Windows',status:'ok',days}]};
  const emptyStatus=retainActivityHistory([],[],at).find(host=>host.host==='Mac').status;
  const expected={...data,activityHistory:[{host:'Mac',status:emptyStatus,days:[]},
    {host:'Windows',status:'ok',days:days.slice(1)}]};
  data.synthetic='x'.repeat(snapshotHistoryBudget-Buffer.byteLength(JSON.stringify(expected)));
  expected.synthetic=data.synthetic;
  const result=serializeSnapshot(data);
  assert.equal(result.bytes,snapshotHistoryBudget);assert.deepEqual(data,expected);
  assert.equal(result.text,JSON.stringify(expected));
});
test('missing history fields stay missing when dates are trimmed',()=>{
  const data={activityHistory:maximalHistory()};
  delete data.activityHistory[0].days.at(-1).trackedHours;
  data.activityHistory[0].days.at(-1).windowStart=null;
  serializeSnapshot(data);
  assert.equal(Object.hasOwn(data.activityHistory[0].days.at(-1),'trackedHours'),false);
  assert.equal(data.activityHistory[0].days.at(-1).windowStart,null);
});
test('maximal activity and quota with full provider day retention fit after trimming',t=>{
  const result={data:{activityHistory:maximalHistory(),quota:quota(),providerTokenSources:[provider('Mac'),provider('Windows')]},status:{}};
  attachProviderTokenEstimates(result);
  const before=Buffer.byteLength(JSON.stringify(result.data)),sized=serializeSnapshot(result.data);
  t.diagnostic(`Synthetic full-day-retention fixture: ${before} bytes before trimming, ${sized.bytes} bytes after trimming`);
  assert.ok(sized.bytes<snapshotMaximumBytes);
  assert.equal(sized.text,JSON.stringify(result.data));
});
test('maximal provider model cardinality alone cannot fit the snapshot limit',t=>{
  const sources=['Mac','Windows'].map(host=>provider(host,1000,1));
  const result={data:{providerTokenSources:sources},status:{}};
  attachProviderTokenEstimates(result);
  const size=Buffer.byteLength(JSON.stringify(result.data))+sources.reduce((sum,source)=>{
    const day=result.data.providerTokenSources.find(row=>row.host===source.host).days[0];
    return sum+3659*(Buffer.byteLength(JSON.stringify(day))+1);
  },0);
  t.diagnostic(`Synthetic maximal provider cardinality: ${size} bytes for two 3660-day sources, before activity or quota`);
  assert.ok(size>snapshotMaximumBytes);
});
