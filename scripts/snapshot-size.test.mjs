import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {snapshotMaximumBytes,snapshotHistoryBudget,serializeSnapshot,writeSnapshot} from './snapshot-size.mjs';
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
  const models=Array.from({length:modelCount},(_,index)=>({model:`claude-sonnet-99-99-${String(index).padStart(8,'0')}-latest`,
    inputTokens:count,cacheReadTokens:count,cacheCreationTokens:count,outputTokens:count,totalTokens:count*4,requestCount:count}));
  const day={inputTokens:part,cacheReadTokens:part,cacheCreationTokens:part,outputTokens:part,totalTokens:part*4,requestCount:part,models};
  const hour=Math.floor(day.totalTokens/24);
  return cleanClaudeTokenSource({provider:'claude-code',status:'ok',days:Array.from({length:dayCount},(_,index)=>({date:date(index),...day,
    hours:Array.from({length:24},(_,hourIndex)=>hour+(hourIndex<day.totalTokens-hour*24?1:0))}))},host,at,{hours:host==='Mac'});
}
test('shared limit matches both readers',async()=>{
  for(const [file,pattern] of [['mac-snapshot-archive.mjs',/maximumBytes=([\d_]+)/],
    ['../native/windows/Snapshot.cs',/MaxBytes = ([\d_]+)/]]) {
    const source=await readFile(new URL(file,import.meta.url),'utf8');
    assert.equal(snapshotMaximumBytes,Number(source.match(pattern)[1].replaceAll('_','')));
  }
});
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
test('missing history fields stay missing when dates are trimmed',()=>{
  const data={activityHistory:maximalHistory()};
  delete data.activityHistory[0].days.at(-1).trackedHours;
  data.activityHistory[0].days.at(-1).windowStart=null;
  serializeSnapshot(data);
  assert.equal(Object.hasOwn(data.activityHistory[0].days.at(-1),'trackedHours'),false);
  assert.equal(data.activityHistory[0].days.at(-1).windowStart,null);
});
test('refusal leaves previous bytes untouched and never preserves the replacement',async()=>{
  const folder=await mkdtemp(path.join(tmpdir(),'snapshot-size-'));
  try {
    const previous=Buffer.from('{"synthetic":"previous 🪴"}');
    await writeFile(path.join(folder,'usage.json'),previous);
    let preserved=false;
    const atomic=async(name,value,beforeReplace,serialized=false)=>{
      const temporary=path.join(folder,'temporary');
      await writeFile(temporary,serialized?value:JSON.stringify(value));
      await beforeReplace?.();await rename(temporary,path.join(folder,name));
    };
    const data={activityHistory:[{host:'Mac',days:[{date:date(0),seconds:null}]}],synthetic:'🪴'.repeat(4_000_001)};
    await assert.rejects(writeSnapshot(data,{atomic,startedAt:at,beforeReplace:()=>{preserved=true;}}),
      {message:'Snapshot size limit of 16000000 bytes exceeded'});
    assert.equal(preserved,false);assert.deepEqual(await readFile(path.join(folder,'usage.json')),previous);
    const status=JSON.parse(await readFile(path.join(folder,'collector.json'),'utf8'));
    assert.equal(status.state,'failed');assert.equal(status.reason,'snapshot-too-large');assert.equal(status.startedAt,at);
    assert.ok(Number.isFinite(Date.parse(status.finishedAt)));assert.equal(status.bytes,Buffer.byteLength(JSON.stringify(data)));
    assert.equal(data.activityHistory[0].days.length,0);
  } finally {await rm(folder,{recursive:true,force:true});}
});
test('accepted writes use the exact measured serialization and preserve before replacing',async()=>{
  let calls=0,preserved=false;
  const data={activityHistory:[],unknown:null,label:'🪴'};
  const bytes=await writeSnapshot(data,{startedAt:at,beforeReplace:()=>{preserved=true;},
    atomic:async(name,text,beforeReplace,serialized)=>{
      calls++;assert.equal(name,'usage.json');assert.equal(serialized,true);
      assert.equal(text,JSON.stringify(data));await beforeReplace();
    }});
  assert.equal(bytes,Buffer.byteLength(JSON.stringify(data)));assert.equal(calls,1);assert.equal(preserved,true);
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
  // All dates have equal encoded length. Measure one validated maximal day
  // without allocating two multi-gigabyte JSON strings for 3660 copies each.
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
