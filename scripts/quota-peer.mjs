import {isDeepStrictEqual} from 'node:util';
import {cleanQuotaObservation} from './quota-history.mjs';

// This contract is not connected to the transport yet. The owner must opt in
// before calling it with live readings. Generation is random, not an account ID.
export const sharedQuotaLimits=Object.freeze({bytes:1_000_000,samples:10000,days:366,historyMs:86400000});
const stamp=value=>typeof value==='string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString()===value;
const statuses=['ok','stale','unavailable','needs-auth','unsupported','rate-limited','not-connected'];
const generationPattern=/^[a-f0-9]{32}$/;

export function createSharedQuota(raw,{enabled=false,host,generation,now=Date.now()}={}) {
  if(typeof enabled!=='boolean')throw Error('Invalid quota sharing consent');
  if(!enabled)return null;
  if(!['Mac','Windows'].includes(host) || typeof generation!=='string' || !generationPattern.test(generation) ||
      !Number.isSafeInteger(now) || now<0)throw Error('Invalid quota sharing identity');
  if(!raw || !statuses.includes(raw.status))throw Error('Invalid quota sharing status');
  const result={version:1,host,provider:'Codex',generation,status:raw.status,checkedAt:null,history:[],dailyCheckedAt:null,dailyUsageBuckets:[]};
  // Failed authentication and disabled sources must not continue publishing an
  // old account's readings. No scope hash, email, salt or credentials are copied.
  if(!['ok','stale'].includes(raw.status))return result;
  if(!stamp(raw.checkedAt) || Date.parse(raw.checkedAt)>now || !Array.isArray(raw.history) ||
      raw.history.length>sharedQuotaLimits.samples || !Array.isArray(raw.dailyUsageBuckets) || raw.dailyUsageBuckets.length>sharedQuotaLimits.days)
    throw Error('Invalid shared quota history');
  result.checkedAt=raw.checkedAt;
  const samples=new Map();
  for(const sample of raw.history) {
    if(!Array.isArray(sample?.windows) || sample.windows.length>32)throw Error('Invalid shared quota windows');
    const supported=sample.windows.filter(window=>window?.bucket==='codex');
    if(!supported.length)continue;
    const seen=new Map();
    for(const window of supported) {
      const projected=cleanQuotaObservation({checkedAt:sample.checkedAt,windows:[window]},now);
      if(!projected)throw Error('Invalid shared quota window');
      const value=projected.windows[0];
      if(seen.has(value.window) && !isDeepStrictEqual(seen.get(value.window),value))throw Error('Conflicting quota windows');
      seen.set(value.window,value);
    }
    const cleaned=cleanQuotaObservation({checkedAt:sample.checkedAt,windows:supported},now);
    if(!cleaned)throw Error('Invalid shared quota observation');
    // Only the currently supported account bucket may cross devices. Retired or
    // arbitrary provider labels cannot carry private text through this channel.
    cleaned.windows=cleaned.windows.filter(window=>window.bucket==='codex');
    if(!cleaned.windows.length)continue;
    if(Date.parse(cleaned.checkedAt)>Date.parse(raw.checkedAt))throw Error('Observation newer than source');
    if(Date.parse(cleaned.checkedAt)<now-sharedQuotaLimits.historyMs)continue;
    if(samples.has(cleaned.checkedAt) && !isDeepStrictEqual(samples.get(cleaned.checkedAt),cleaned))throw Error('Conflicting quota observations');
    samples.set(cleaned.checkedAt,cleaned);
  }
  result.history=[...samples.values()].sort((a,b)=>a.checkedAt.localeCompare(b.checkedAt));
  if(raw.dailyUsageBuckets.length && raw.accountUsageCheckedAt==null)throw Error('Missing daily observation time');
  if(raw.accountUsageCheckedAt!==null && raw.accountUsageCheckedAt!==undefined) {
    if(!stamp(raw.accountUsageCheckedAt) || Date.parse(raw.accountUsageCheckedAt)>now)throw Error('Invalid daily observation time');
    result.dailyCheckedAt=raw.accountUsageCheckedAt;
    const days=new Map();
    for(const row of raw.dailyUsageBuckets) {
      if(typeof row?.startDate!=='string' || !/^\d{4}-\d\d-\d\d$/.test(row.startDate) ||
          !Number.isFinite(Date.parse(row.startDate)) || new Date(row.startDate).toISOString().slice(0,10)!==row.startDate ||
          Date.parse(row.startDate)>Date.parse(result.dailyCheckedAt) || !Number.isSafeInteger(row.tokens) || row.tokens<0)
        throw Error('Invalid shared daily total');
      if(days.has(row.startDate) && days.get(row.startDate).tokens!==row.tokens)throw Error('Conflicting shared daily totals');
      days.set(row.startDate,{startDate:row.startDate,tokens:row.tokens});
    }
    result.dailyUsageBuckets=[...days.values()].sort((a,b)=>a.startDate.localeCompare(b.startDate));
  }
  if(Buffer.byteLength(JSON.stringify(result))>sharedQuotaLimits.bytes)throw Error('Shared quota size exceeded');
  return result;
}

// Caller supplies the authenticated owner and generation. A received label is
// never enough to establish identity or permission. Extra fields are rejected.
export function parseSharedQuota(text,{host,generation,enabled=false,now=Date.now()}={}) {
  if(enabled!==true)throw Error('Quota sharing is not enabled');
  if(typeof text!=='string' || Buffer.byteLength(text)>sharedQuotaLimits.bytes)throw Error('Shared quota size exceeded');
  const raw=JSON.parse(text);
  const safe=createSharedQuota({...raw,accountUsageCheckedAt:raw?.dailyCheckedAt},{host,generation,enabled,now});
  if(!isDeepStrictEqual(raw,safe))throw Error('Invalid shared quota fields');
  return safe;
}
