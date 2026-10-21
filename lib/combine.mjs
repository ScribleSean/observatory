// Combine each computer's own snapshot into one combined.json.
// Limits belong to the account, so the freshest reading wins and they are never added.
// Tokens and screen time are shown per computer, plus a sum labeled "not deduplicated"
// that is Unknown when any computer's value is Unknown.
import {limits,totals,duration,compact,freshness} from './panel-data.mjs';
import strings from './strings.json' with {type:'json'};

export const COMBINED_SCHEMA='observatory-combined/1';
export const HOSTS=['Mac','Windows'];
export const SUM_LABEL='not deduplicated';
const SOURCE_KEYS=['activity','tokens','settings','providerTokenSources','activityHistory','dictation'];
const STALE_MS=15*60000;

const object=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const rows=value=>Array.isArray(value)?value.filter(object):[];
const time=value=>{const parsed=Date.parse(value);return Number.isFinite(parsed)?parsed:null;};

// Only the rows a computer collected about itself. Older snapshots also carried
// rows they received from a paired device, and those must not be reused.
export function ownRows(snapshot,host) {
  if(!object(snapshot) || !HOSTS.includes(host))return null;
  const result={collectedAt:snapshot.collectedAt,timezone:snapshot.timezone};
  for(const key of SOURCE_KEYS)result[key]=rows(snapshot[key]).filter(row=>row.host===host);
  result.quota=object(snapshot.quota)?snapshot.quota:null;
  result.claudeLimits=object(snapshot.claudeLimits)?snapshot.claudeLimits:null;
  const name=snapshot.device?.name ?? snapshot.deviceNames?.[host];
  result.name=typeof name==='string' && name.trim()?name.trim().slice(0,64):host;
  return result;
}

// A reading dated in the future (beyond a small clock skew) is not trusted to win.
export const CLOCK_SKEW_MS=2*60000;
const readingTime=(source,now)=>{
  const at=['ok','stale'].includes(source?.status)?time(source.checkedAt):null;
  return at!==null && at<=now+CLOCK_SKEW_MS?at:null;
};

// The freshest usable reading of an account-wide source across computers.
function freshest(devices,key,now) {
  const sources=devices.filter(device=>object(device.rows?.[key])).map(device=>({source:device.rows[key],from:device.host,at:readingTime(device.rows[key],now)}));
  const read=sources.filter(entry=>entry.at!==null).sort((a,b)=>b.at-a.at);
  if(read.length)return read[0];
  // No reading anywhere: keep a failed source so its note shows, never a number.
  return sources.find(entry=>entry.source.status!=='not-connected') ?? null;
}

function mergedView(devices,generatedAt,now) {
  const view={schema:2,timezone:devices.find(d=>d.rows)?.rows.timezone ?? 'America/New_York',collectedAt:generatedAt,
    combined:{host:'Combined',status:'unavailable'},combinedTokens:{host:'All',status:'unavailable'},
    combinedSettings:{host:'All',status:'unavailable'},agents:[],agentSource:{host:'Local',status:'not-connected'},deviceNames:{}};
  for(const key of SOURCE_KEYS)view[key]=[];
  for(const host of HOSTS) {
    const device=devices.find(d=>d.host===host);
    if(!device) {
      view.activity.push({host,status:'not-connected'});
      view.tokens.push({host,status:'not-connected'});
      continue;
    }
    view.deviceNames[host]=device.name;
    if(!device.rows) {
      // A listed computer with no snapshot is Unknown, never zero.
      view.activity.push({host,status:'unavailable'});
      view.tokens.push({host,status:'unavailable'});
      view.settings.push({host,status:'unavailable'});
      continue;
    }
    for(const key of SOURCE_KEYS) {
      const own=device.rows[key];
      if(own.length)view[key].push(...own);
      else if(['activity','tokens'].includes(key))view[key].push({host,status:'not-connected'});
    }
  }
  const quota=freshest(devices,'quota',now);
  view.quota=quota?{...quota.source,observedOn:quota.from}:{status:'not-connected',provider:'Codex',scope:'account',windows:[]};
  const claude=freshest(devices,'claudeLimits',now);
  view.claudeLimits=claude?{...claude.source,observedOn:claude.from}:{provider:'Claude Code',scope:'account',status:'not-connected',windows:[]};
  return view;
}

// Today's numbers for one computer. "No records" means the source was read and
// nothing happened today, which is zero. Anything else without a number is Unknown.
function today(view,device,now) {
  if(!device.rows)return {host:device.host,name:device.name,missing:true,seconds:null,codexTokens:null,claudeTokens:null,tokens:null,usd:null};
  const t=totals(view,device.host,'day',now);
  const noRecords=strings.status.noRecords;
  let {codexTokens,claudeTokens,usd}=t;
  if(codexTokens===null && t.codexNote===noRecords)codexTokens=0;
  if(claudeTokens===null && t.claudeNote===noRecords)claudeTokens=0;
  if(usd===null && codexTokens===0)usd=0;
  // Screen time read with no activity today is also a real zero.
  let seconds=t.seconds;
  if(seconds===null && t.timeNote===noRecords)seconds=0;
  const enabled=key=>device.rows[key].some(row=>row.status!=='not-connected');
  const claudeOn=device.rows.providerTokenSources.some(row=>row.status!=='not-connected');
  // A source that is switched off is left out of the total, not counted as Unknown.
  const parts=[enabled('tokens')?codexTokens:undefined,claudeOn?claudeTokens:undefined].filter(value=>value!==undefined);
  const tokens=parts.length===0 || parts.some(value=>value===null)?null:parts.reduce((a,b)=>a+b,0);
  return {host:device.host,name:device.name,collectedAt:device.rows.collectedAt,
    seconds:enabled('activity')?seconds:null,screenTimeOn:enabled('activity'),
    codexTokens,claudeTokens,tokens,usd};
}

export function sum(values) {
  if(!values.length || values.some(value=>value===null || value===undefined))return null;
  return values.reduce((a,b)=>a+b,0);
}

// The apps compute ages when they display. Lines carry a clock time, which never goes out of date.
const clock=value=>{const at=time(value);return at===null?'Unknown':new Date(at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});};
const show=(value,format)=>value===null || value===undefined?'Unknown':format(value);
const percent=value=>value===null?'Unknown':`${Math.round(value)}%`;

function glance(view,devices,now) {
  const limitRows=limits(view,now).map(row=>({...row,
    from:row.provider==='claude'?view.claudeLimits.observedOn ?? null:view.quota.observedOn ?? null}));
  const perDevice=devices.map(device=>({...today(view,device,now),
    freshness:device.rows?freshness(device.rows.collectedAt,now):{label:'No snapshot',stale:true},
    ...(device.error?{error:device.error}:{})}));
  const both=perDevice.length>1?{seconds:sum(perDevice.map(d=>d.seconds)),tokens:sum(perDevice.map(d=>d.tokens)),
    usd:sum(perDevice.map(d=>d.usd)),label:SUM_LABEL}:null;
  const current=limitRows.filter(row=>row.remaining!==null && !row.stale);
  const lowest=current.length?Math.min(...current.map(row=>row.remaining)):null;
  const title=lowest===null?'?':`${Math.round(lowest)}%`;
  const lines=[
    'Limits',
    ...limitRows.map(row=>`  ${row.name}${row.window?' '+row.window:''}: ${row.remaining===null?'Unknown':percent(row.remaining)+' left'}${row.note?' · '+row.note:''}`),
    '',
    'Today',
    ...perDevice.map(d=>d.missing?`  ${d.name}: Unknown · no snapshot${d.error?' ('+d.error+')':''}`:
      `  ${d.name}: ${d.screenTimeOn?show(d.seconds,duration):'screen time off'} screen · ${show(d.tokens,compact)} tokens · as of ${clock(d.collectedAt)}`),
    ...(both?[`  Both: ${show(both.seconds,duration)} screen · ${show(both.tokens,compact)} tokens (sum, ${SUM_LABEL})`]:[]),
  ];
  return {title,lowest,limits:limitRows,today:perDevice,both,lines};
}

// devices: [{host,name,snapshot,error?}], each snapshot that computer's own usage.json
// (or a device entry carried in an earlier combined.json).
export function combine(devices,{now=Date.now(),generatedBy}={}) {
  const seen=new Set();
  const prepared=devices.map(device=>{
    if(!HOSTS.includes(device.host) || seen.has(device.host))throw Error('Each computer needs a distinct host, Mac or Windows');
    seen.add(device.host);
    const rows=ownRows(device.snapshot,device.host);
    return {host:device.host,name:rows?.name ?? device.name ?? device.host,rows,error:device.error ?? null};
  });
  const generatedAt=new Date(now).toISOString();
  const view=mergedView(prepared,generatedAt,now);
  return {schema:COMBINED_SCHEMA,generatedAt,generatedBy,
    devices:prepared.map(device=>({host:device.host,name:device.name,collectedAt:device.rows?.collectedAt ?? null,
      stale:!device.rows || !(now-time(device.rows.collectedAt)<=STALE_MS),...(device.error?{error:device.error}:{})})),
    snapshots:Object.fromEntries(prepared.filter(d=>d.rows).map(d=>[d.host,d.rows])),
    view,glance:glance(view,prepared,now)};
}

// A device entry from an earlier combined.json, so a spoke can recombine on its own.
export function carriedDevice(combined,host) {
  if(!object(combined) || combined.schema!==COMBINED_SCHEMA)return null;
  const rows=combined.snapshots?.[host];
  if(!object(rows))return null;
  return {host,name:rows.name,snapshot:{...rows,device:{host,name:rows.name}}};
}
