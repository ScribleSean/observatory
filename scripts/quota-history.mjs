import {visibleQuotaBucket} from './quota-buckets.mjs';
import {quotaHistoryMaxGapMs,sameQuotaReset} from './quota-timing.mjs';

// Retained account observations, not a conversion from tokens to allowance.
// The caller supplies a local, opaque account scope and never a raw account ID.
const stamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const scopeKey = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
const statuses = ['ok','unavailable','needs-auth','unsupported','rate-limited'];
const dayMs = 86400000;
export const quotaRetention = Object.freeze({days:30,maxSamples:10000,maxDailyBuckets:366,maxSampleBytes:8000000});

export function cleanQuotaObservation(raw, now) {
  const checkedAt = stamp(raw?.checkedAt);
  if (!checkedAt || Date.parse(checkedAt) > now || !Array.isArray(raw.windows) || raw.windows.length > 32) return null;
  const windows = new Map();
  for (const row of raw.windows) {
    if (!row || typeof row.bucket !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(row.bucket) || !visibleQuotaBucket(row.bucket) || !['primary','secondary'].includes(row.window) ||
        typeof row.remainingPercent !== 'number' || !Number.isFinite(row.remainingPercent) ||
        row.remainingPercent < 0 || row.remainingPercent > 100) continue;
    windows.set(`${row.bucket}:${row.window}`,{bucket:row.bucket,window:row.window,remainingPercent:row.remainingPercent,
      durationMinutes:count(row.durationMinutes) && row.durationMinutes > 0 ? row.durationMinutes : null,
      resetsAt:stamp(row.resetsAt)});
  }
  if (!windows.size) return null;
  return {checkedAt,windows:[...windows.values()].sort((a,b)=>`${a.bucket}:${a.window}`.localeCompare(`${b.bucket}:${b.window}`))};
}

function cleanDaily(raw, now) {
  if (!Array.isArray(raw) || raw.length > 36600) return [];
  const result = new Map();
  for (const row of raw) {
    const date = row?.startDate;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !count(row.tokens)) continue;
    const parsed = Date.parse(date);
    if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0,10) !== date || parsed > now) continue;
    result.set(date,{startDate:date,tokens:row.tokens});
  }
  return [...result.values()].sort((a,b)=>a.startDate.localeCompare(b.startDate)).slice(-quotaRetention.maxDailyBuckets);
}

export function retainQuotaHistory(previous, current, {scope,enabled=true,now=Date.now()}={}) {
  if (!Number.isSafeInteger(now) || now < 0) throw Error('Invalid observation time');
  if (typeof enabled !== 'boolean') throw Error('Invalid monitoring state');
  // Disabled collection must forget its displayed account readings, including
  // after restart. This does not touch the account owner's login.
  if (!enabled) return {version:1,status:'not-connected',scope:null,samples:[],dailyUsageBuckets:[],asOf:null};
  if (!scopeKey(scope)) throw Error('Verified opaque account scope required');
  const latestReadStatus = statuses.includes(current?.status) ? current.status : 'unavailable';
  const validPrevious = previous?.version === 1 && previous.scope === scope;
  const before = validPrevious ? previous : null;
  const invalidate = ['needs-auth','unsupported'].includes(latestReadStatus);
  const cutoff = now - quotaRetention.days * dayMs;
  const samples = new Map();
  if (!invalidate && Array.isArray(before?.samples) && before.samples.length <= quotaRetention.maxSamples) {
    for (const input of before.samples) {
      const row = cleanQuotaObservation(input,now);
      if (row && Date.parse(row.checkedAt) >= cutoff) samples.set(row.checkedAt,row);
    }
  }
  const observation = latestReadStatus === 'ok' ? cleanQuotaObservation(current,now) : null;
  if (observation && Date.parse(observation.checkedAt) >= cutoff) samples.set(observation.checkedAt,observation);
  let retained = [...samples.values()].sort((a,b)=>a.checkedAt.localeCompare(b.checkedAt)).slice(-quotaRetention.maxSamples);
  const sizes=retained.map(row=>Buffer.byteLength(JSON.stringify(row))+1);
  let bytes=sizes.reduce((sum,size)=>sum+size,2),first=0;
  while(bytes>quotaRetention.maxSampleBytes && first<retained.length)bytes-=sizes[first++];
  retained=retained.slice(first);
  const days = new Map(invalidate ? [] : cleanDaily(before?.dailyUsageBuckets,now).map(row=>[row.startDate,row]));
  const accountCheckedAt=stamp(current?.accountUsage?.checkedAt ?? current?.checkedAt);
  if (current?.accountUsage?.status === 'ok' && accountCheckedAt && Date.parse(accountCheckedAt)<=now && !invalidate) {
    for (const row of cleanDaily(current.accountUsage.dailyUsageBuckets,now)) days.set(row.startDate,row);
  }
  const dailyAsOf=invalidate?null:current?.accountUsage?.status==='ok' && accountCheckedAt && Date.parse(accountCheckedAt)<=now?
    accountCheckedAt:stamp(before?.dailyAsOf);
  const asOf = retained.at(-1)?.checkedAt ?? null;
  const fresh=observation && asOf===observation.checkedAt;
  return {version:1,scope,status:invalidate ? latestReadStatus : fresh ? 'ok' : retained.length ? 'stale' : 'unavailable',
    latestReadStatus,asOf,dailyAsOf,samples:retained,dailyUsageBuckets:[...days.values()].sort((a,b)=>a.startDate.localeCompare(b.startDate)).slice(-quotaRetention.maxDailyBuckets)};
}

// Explicit line segments prevent a renderer from drawing through missed polls
// or an allowance reset. A falling used percentage is not negative token use.
export function quotaChartSegments(history,bucket,window,maxGapMs=quotaHistoryMaxGapMs) {
  if (!Number.isSafeInteger(maxGapMs) || maxGapMs < 1) throw Error('Invalid chart gap');
  const result=[];
  let segment=[],previous=null;
  for (const sample of history?.samples || []) {
    const row=sample.windows.find(value=>value.bucket===bucket && value.window===window);
    if (!row) {if(segment.length)result.push(segment);segment=[];previous=null;continue;}
    const point={at:sample.checkedAt,usedPercent:100-row.remainingPercent,resetsAt:row.resetsAt};
    if (previous && (Date.parse(point.at)-Date.parse(previous.at)>maxGapMs || !sameQuotaReset(point.resetsAt,previous.resetsAt) || point.usedPercent<previous.usedPercent)) {
      result.push(segment);segment=[];
    }
    segment.push(point);previous=point;
  }
  if(segment.length)result.push(segment);
  return result;
}
