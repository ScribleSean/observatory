import {limits,totals,duration,compact,freshness,recordedDays,today as dayKey} from './panel-data.mjs';
import strings from './strings.json' with {type:'json'};
import {TIME_ZONE} from './timezone.mjs';
import {cleanHistoryPoints} from '../scripts/limit-history.mjs';

export const COMBINED_SCHEMA='observatory-combined/1';
export const HOSTS=['Mac','Windows'];
export const SUM_LABEL='not deduplicated';
const SOURCE_KEYS=['activity','tokens','settings','providerTokenSources','activityHistory','dictation','limitHistory'];
const STALE_MS=15*60000;

const object=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const rows=value=>Array.isArray(value)?value.filter(object):[];
const time=value=>{const parsed=Date.parse(value);return Number.isFinite(parsed)?parsed:null;};

export function ownRows(snapshot,host) {
  if(!object(snapshot) || !HOSTS.includes(host))return null;
  const result={collectedAt:snapshot.collectedAt,timezone:snapshot.timezone};
  for(const key of SOURCE_KEYS)result[key]=rows(snapshot[key]).filter(row=>row.host===host);
  result.limitHistory=result.limitHistory.slice(0,1).map(row=>({host,status:row.status==='ok'?'ok':'unavailable',
    checkedAt:typeof row.checkedAt==='string'?row.checkedAt:null,points:cleanHistoryPoints(row.points,host)}));
  result.quota=object(snapshot.quota)?snapshot.quota:null;
  result.claudeLimits=object(snapshot.claudeLimits)?snapshot.claudeLimits:null;
  const name=snapshot.device?.name ?? snapshot.deviceNames?.[host];
  result.name=typeof name==='string' && name.trim()?name.trim().slice(0,64):host;
  return result;
}

export const CLOCK_SKEW_MS=2*60000;
const readingTime=(source,now)=>{
  const at=['ok','stale'].includes(source?.status)?time(source.checkedAt):null;
  return at!==null && at<=now+CLOCK_SKEW_MS?at:null;
};

function freshest(devices,key,now) {
  const sources=devices.filter(device=>object(device.rows?.[key])).map(device=>({source:device.rows[key],from:device.host,at:readingTime(device.rows[key],now)}));
  const read=sources.filter(entry=>entry.at!==null).sort((a,b)=>b.at-a.at);
  if(read.length)return read[0];
  // No reading anywhere: keep a failed source so its note shows, never a number.
  return sources.find(entry=>entry.source.status!=='not-connected') ?? null;
}

function mergedView(devices,generatedAt,now) {
  const view={schema:2,timezone:devices.find(d=>d.rows)?.rows.timezone ?? TIME_ZONE,collectedAt:generatedAt,
    combined:{host:'Combined',status:'unavailable'},combinedTokens:{host:'All',status:'unavailable'},
    combinedSettings:{host:'All',status:'unavailable'},deviceNames:{}};
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

function today(view,device,now) {
  if(!device.rows)return {host:device.host,name:device.name,missing:true,seconds:null,codexTokens:null,claudeTokens:null,tokens:null,usd:null};
  const t=totals(view,device.host,'day',now);
  const noRecords=strings.status.noRecords;
  let {codexTokens,claudeTokens,usd}=t;
  if(codexTokens===null && t.codexNote===noRecords)codexTokens=0;
  if(claudeTokens===null && t.claudeNote===noRecords)claudeTokens=0;
  if(usd===null && codexTokens===0)usd=0;
  const seconds=t.seconds;
  const enabled=key=>device.rows[key].some(row=>row.status!=='not-connected');
  const claudeOn=device.rows.providerTokenSources.some(row=>row.status!=='not-connected');
  const parts=[enabled('tokens')?codexTokens:undefined,claudeOn?claudeTokens:undefined].filter(value=>value!==undefined);
  const tokens=parts.length===0 || parts.some(value=>value===null)?null:parts.reduce((a,b)=>a+b,0);
  let claudeUsd=null;
  if(claudeOn && claudeTokens===0)claudeUsd=0;
  else if(claudeOn && claudeTokens!==null) {
    const date=dayKey(view.timezone,new Date(now));
    const day=device.rows.providerTokenSources.find(row=>row.provider==='claude-code')?.days?.find(row=>row.date===date);
    const value=day?.apiEstimate?.usd;
    claudeUsd=typeof value==='number' && Number.isFinite(value) && value>=0?value:null;
  }
  const costs=[enabled('tokens')?usd:undefined,claudeOn?claudeUsd:undefined].filter(value=>value!==undefined);
  const date=dayKey(view.timezone,new Date(now));
  const activityDay=enabled('activity') && seconds!==null?recordedDays(view,'activity',device.host,now).find(day=>day.date===date):null;
  const categories=Object.entries(activityDay?.categories ?? {}).filter(([,value])=>typeof value==='number' && value>0)
    .sort((a,b)=>b[1]-a[1]).slice(0,3).map(([name,value])=>({name,seconds:value}));
  const cost=costs.length===0 || costs.some(value=>value===null)?null:costs.reduce((a,b)=>a+b,0);
  return {host:device.host,name:device.name,collectedAt:device.rows.collectedAt,
    seconds:enabled('activity')?seconds:null,screenTimeOn:enabled('activity'),
    codexTokens,claudeTokens,tokens,usd:cost,categories,
    costs:{codex:enabled('tokens')?usd:undefined,claude:claudeOn?claudeUsd:undefined}};
}

export function sum(values) {
  if(!values.length || values.some(value=>value===null || value===undefined))return null;
  return values.reduce((a,b)=>a+b,0);
}

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
  const money=value=>`$${value<10?value.toFixed(2):Math.round(value).toLocaleString('en-US')}`;
  const lines=[
    'Limits',
    ...limitRows.map(row=>`  ${row.name}${row.window?' '+row.window:''}: ${row.remaining===null?'Unknown':percent(row.remaining)+' left'}${row.note?' · '+row.note:''}`),
    '',
    'Today',
    ...perDevice.map(d=>d.missing?`  ${d.name}: Unknown · no snapshot${d.error?' ('+d.error+')':''}`:
      `  ${d.name}: ${d.screenTimeOn?show(d.seconds,duration):'screen time off'} screen · ${show(d.tokens,compact)} tokens · ${show(d.usd,money)} API-equivalent · as of ${clock(d.collectedAt)}`),
    ...(both?[`  Both: ${show(both.seconds,duration)} screen · ${show(both.tokens,compact)} tokens · ${show(both.usd,money)} (sum, ${SUM_LABEL})`]:[]),
  ];
  return {title,lowest,limits:limitRows,today:perDevice,both,lines};
}

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

export function carriedDevice(combined,host) {
  if(!object(combined) || combined.schema!==COMBINED_SCHEMA)return null;
  const rows=combined.snapshots?.[host];
  if(!object(rows))return null;
  return {host,name:rows.name,snapshot:{...rows,device:{host,name:rows.name}}};
}
