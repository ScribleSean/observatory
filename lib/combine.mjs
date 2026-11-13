import {limits,limitsWithGaps,totals,duration,compact,freshness,recordedDays,today as dayKey,usd,deviceLabel} from './panel-data.mjs';
import strings from './strings.json' with {type:'json'};
import {TIME_ZONE} from './timezone.mjs';
import {snapshotFresh} from './freshness.mjs';
import {forecast} from './forecast.mjs';
import {cleanHistoryPoints} from '../scripts/limit-history.mjs';
import {cleanProjectTokens,unavailableProjectTokens} from '../scripts/project-tokens.mjs';

export const COMBINED_SCHEMA='observatory-combined/1';
export const HOSTS=['Mac','Windows'];
export const SUM_LABEL='not deduplicated';
const SOURCE_KEYS=['activity','tokens','settings','providerTokenSources','activityHistory','limitHistory','projectTokens'];

const object=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const rows=value=>Array.isArray(value)?value.filter(object):[];
const time=value=>{const parsed=Date.parse(value);return Number.isFinite(parsed)?parsed:null;};

const text=value=>value===null || typeof value==='string';
const number=value=>value===null || (typeof value==='number' && Number.isFinite(value) && value>=0);
const counts={inputTokens:number,cacheReadTokens:number,cacheCreationTokens:number,outputTokens:number,totalTokens:number};
const estimate={usd:number,coveredTokens:number,excluded:number,checked:text};
const model={model:text,...counts,apiEstimate:estimate};
const tokenDay={date:text,...counts,hours:[number],models:[model],apiEstimate:estimate};
const amounts={map:number};
const activityDay={date:text,seconds:number,trackedSeconds:number,hours:[number],categories:amounts,apps:{map:amounts}};
const source={host:text,status:text,checkedAt:text,refusal:text,roots:[text]};
const windowFields={bucket:text,window:text,durationMinutes:number,remainingPercent:number,resetsAt:text,checkedAt:text};
const limitSource={status:text,checkedAt:text,refusal:text,plan:text,validUntil:text,
  requests:{timeZone:text,checkedAt:text,days:[{date:text,count:number}]},notReported:[text],windows:[windowFields],history:[{checkedAt:text,windows:[windowFields]}],
  pace:[{bucket:text,window:text,asOf:text,status:text,estimatedExhaustionAt:text}]};
const rowFields={
  activity:{...source,days:[activityDay]},
  tokens:{...source,days:[tokenDay]},
  settings:{...source,profiles:[{date:text,model:text,effort:text,speed:text,totalTokens:number}]},
  providerTokenSources:{...source,provider:text,days:[tokenDay]},
  activityHistory:{...source,days:[activityDay],asOf:text,latestReadStatus:text,trackingStatus:text,trackingThrough:text},
};

function approved(value,fields) {
  if(typeof fields==='function') {
    if(!fields(value))throw Error('invalid snapshot');
    return value;
  }
  if(Array.isArray(fields)) {
    if(!Array.isArray(value))throw Error('invalid snapshot');
    return value.map(row=>approved(row,fields[0]));
  }
  if(!object(value))throw Error('invalid snapshot');
  return Object.fromEntries(Object.entries(fields.map?value:fields).flatMap(([key,field])=>{
    const rule=fields.map ?? field;
    return value[key]===undefined?[]:[[key,approved(value[key],rule)]];
  }));
}

export function ownRows(snapshot,host,{now=Date.now()}={}) {
  if(!object(snapshot) || !HOSTS.includes(host))return null;
  const result=approved(snapshot,{collectedAt:text,timezone:text});
  for(const [key,fields] of Object.entries(rowFields)) {
    if(snapshot[key]!==undefined && !Array.isArray(snapshot[key]))throw Error('invalid snapshot');
    result[key]=(snapshot[key] ?? []).map(row=>{
      if(!object(row))throw Error('invalid snapshot');
      return row;
    }).filter(row=>row.host===host).map(row=>approved(row,fields));
  }
  result.projectTokens=rows(snapshot.projectTokens).filter(row=>row.host===host).slice(0,1).map(row=>{
    try {return cleanProjectTokens(row,{now});}
    catch {return unavailableProjectTokens(host,time(row.checkedAt) ?? now);}
  });
  result.limitHistory=rows(snapshot.limitHistory).filter(row=>row.host===host);
  result.limitHistory=result.limitHistory.slice(0,1).map(row=>({host,status:row.status==='ok'?'ok':'unavailable',
    checkedAt:typeof row.checkedAt==='string'?row.checkedAt:null,points:cleanHistoryPoints(row.points,host)}));
  result.quota=object(snapshot.quota)?approved(snapshot.quota,limitSource):null;
  result.claudeLimits=object(snapshot.claudeLimits)?approved(snapshot.claudeLimits,limitSource):null;
  result.grokLimits=object(snapshot.grokLimits)?approved(snapshot.grokLimits,limitSource):null;
  const name=snapshot.device?.name ?? snapshot.deviceNames?.[host];
  result.name=typeof name==='string' && name.trim()?name.trim().slice(0,64):host;
  return result;
}

export const CLOCK_SKEW_MS=2*60000;
const readingTime=(source,now)=>{
  const at=['ok','stale'].includes(source?.status)?time(source.checkedAt):null;
  return at!==null && at<=now+CLOCK_SKEW_MS?at:null;
};

// A source with a current limit beats one without (a request count alone), then the newest reading wins.
function freshest(devices,key,now) {
  const sources=devices.filter(device=>object(device.rows?.[key])).map(device=>({source:device.rows[key],from:device.host,at:readingTime(device.rows[key],now)}));
  const limited=entry=>rows(entry.source.windows).length>0 && !(time(entry.source.validUntil)<=now)?1:0;
  const read=sources.filter(entry=>entry.at!==null).sort((a,b)=>limited(b)-limited(a) || b.at-a.at);
  if(read.length)return read[0];
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
  const grok=freshest(devices,'grokLimits',now);
  view.grokLimits=grok?{...grok.source,observedOn:grok.from}:{provider:'Grok',scope:'account',status:'not-connected',windows:[]};
  return view;
}

function today(view,device,now) {
  if(!device.rows)return {host:device.host,name:device.name,missing:true,seconds:null,codexTokens:null,claudeTokens:null,tokens:null,usd:null};
  view={...view,timezone:device.rows.timezone ?? TIME_ZONE};
  const t=totals(view,device.host,'day',now);
  const noRecords=strings.status.noRecords;
  let {codexTokens,claudeTokens,usd}=t;
  if(codexTokens===null && t.codexNote===noRecords)codexTokens=0;
  if(claudeTokens===null && t.claudeNote===noRecords)claudeTokens=0;
  if(usd===null && codexTokens===0)usd=0;
  const seconds=t.seconds;
  const enabled=key=>device.rows[key].some(row=>row.status!=='not-connected');
  const claudeOn=device.rows.providerTokenSources.some(row=>row.status!=='not-connected');
  // Cache reads are re-sent context, often 95% of a day's total, so the headline leaves them out and
  // keeps them as their own number.
  const cached=(total,cache)=>total===0?0:cache;
  const parts=[enabled('tokens')?[codexTokens,cached(codexTokens,t.codexCacheRead)]:undefined,
    claudeOn?[claudeTokens,cached(claudeTokens,t.claudeCacheRead)]:undefined].filter(value=>value!==undefined);
  const known=parts.length>0 && parts.every(([total,cache])=>total!==null && cache!==null);
  const tokens=known?parts.reduce((sum,[total,cache])=>sum+Math.max(0,total-cache),0):null;
  const cacheReadTokens=known?parts.reduce((sum,[,cache])=>sum+cache,0):null;
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
  const activityDay=enabled('activity') && seconds!==null?recordedDays(view,'activity',device.host).find(day=>day.date===date):null;
  const categories=Object.entries(activityDay?.categories ?? {}).filter(([,value])=>typeof value==='number' && value>0)
    .sort((a,b)=>b[1]-a[1]).slice(0,3).map(([name,value])=>({name,seconds:value}));
  const cost=costs.length===0 || costs.some(value=>value===null)?null:costs.reduce((a,b)=>a+b,0);
  return {host:device.host,name:device.name,collectedAt:device.rows.collectedAt,
    seconds:enabled('activity')?seconds:null,screenTimeOn:enabled('activity'),
    codexTokens,claudeTokens,tokens,cacheReadTokens,usd:cost,categories,
    costs:{codex:enabled('tokens')?usd:undefined,claude:claudeOn?claudeUsd:undefined}};
}

export function sum(values) {
  if(!values.length || values.some(value=>value===null || value===undefined))return null;
  return values.reduce((a,b)=>a+b,0);
}

const clock=value=>{const at=time(value);return at===null?'Unknown':new Date(at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});};
const show=(value,format)=>value===null || value===undefined?'Unknown':format(value);
const percent=value=>value===null?'Unknown':`${Math.round(value)}%`;

const SOURCE_FOR={claude:'claudeLimits',codex:'quota',grok:'grokLimits'};

function glance(view,devices,now,settings) {
  const rows=limitsWithGaps(limits(view,now)).map(row=>{
    const source=view[SOURCE_FOR[row.provider]];
    const window=source?.windows?.find(window=>window.bucket===row.bucket && window.window===row.windowId);
    const own=time(window?.checkedAt),checked=time(source?.checkedAt);
    return {...row,from:source?.observedOn ?? null,
      checkedAt:own!==null && checked!==null && own<=checked?window.checkedAt:source?.checkedAt ?? null,
      resetsAt:window?.resetsAt ?? null};
  });
  const perDevice=devices.map(device=>({...today(view,device,now),
    freshness:device.rows?freshness(device.rows.collectedAt,now):{label:'No snapshot',stale:true},
    ...(device.error?{error:device.error}:{})}));
  const both=perDevice.length>1?{seconds:sum(perDevice.map(d=>d.seconds)),tokens:sum(perDevice.map(d=>d.tokens)),
    cacheReadTokens:sum(perDevice.map(d=>d.cacheReadTokens)),
    usd:sum(perDevice.map(d=>d.usd)),label:SUM_LABEL}:null;
  const outlook=forecast(view,rows,{now,timeZone:view.timezone ?? TIME_ZONE,settings});
  // An engine that reads Off keeps no number anywhere, so an old allowance never resurfaces in the menu bar.
  const off=new Map(outlook.engines.filter(engine=>engine.status==='off').map(engine=>[engine.engine,engine.phrase]));
  const limitRows=rows.map(row=>off.has(row.provider)?{...row,remaining:null,low:false,spent:false,stale:true,off:true,note:off.get(row.provider)}:row);
  const current=limitRows.filter(row=>row.remaining!==null && !row.stale);
  const lowest=current.length?Math.min(...current.map(row=>row.remaining)):null;
  const title=outlook.menu ?? (lowest===null?'?':`${Math.round(lowest)}%`);
  const lines=[
    'Limits',
    ...limitRows.map(row=>`  ${row.name}${row.window?' '+row.window:''}: ${row.remaining===null?row.absent ?? 'Unknown':percent(row.remaining)+' left'}${row.note?' · '+row.note:''}`),
    '',
    'Today',
    ...perDevice.map(d=>d.missing?`  ${deviceLabel(d.host)}: Unknown · no snapshot${d.error?' ('+d.error+')':''}`:
      `  ${deviceLabel(d.host)}: ${d.screenTimeOn?show(d.seconds,duration):'screen time off'} screen · ${show(d.tokens,compact)} tokens · ${show(d.usd,usd)} API-equivalent · as of ${clock(d.collectedAt)}`),
    ...(both?[`  Both: ${show(both.seconds,duration)} screen · ${show(both.tokens,compact)} tokens · ${show(both.usd,usd)} (sum, ${SUM_LABEL})`]:[]),
  ];
  return {title,lowest,forecast:outlook,limits:limitRows,today:perDevice,both,lines:[outlook.sentence,'',...lines]};
}

export function combine(devices,{now=Date.now(),generatedBy,engines={}}={}) {
  const seen=new Set();
  const prepared=devices.map(device=>{
    if(!HOSTS.includes(device.host) || seen.has(device.host))throw Error('Each computer needs a distinct host, Mac or Windows');
    seen.add(device.host);
    const rows=ownRows(device.snapshot,device.host,{now});
    return {host:device.host,name:rows?.name ?? device.name ?? device.host,rows,error:device.error ?? null};
  });
  const generatedAt=new Date(now).toISOString();
  const view=mergedView(prepared,generatedAt,now);
  return {schema:COMBINED_SCHEMA,generatedAt,generatedBy,
    devices:prepared.map(device=>({host:device.host,name:device.name,collectedAt:device.rows?.collectedAt ?? null,
      stale:!device.rows || !snapshotFresh(time(device.rows.collectedAt),now),...(device.error?{error:device.error}:{})})),
    snapshots:Object.fromEntries(prepared.filter(d=>d.rows).map(d=>[d.host,d.rows])),
    view,glance:glance(view,prepared,now,engines)};
}

export function carriedDevice(combined,host) {
  if(!object(combined) || combined.schema!==COMBINED_SCHEMA)return null;
  const rows=combined.snapshots?.[host];
  if(!object(rows))return null;
  return {host,name:rows.name,snapshot:{...rows,device:{host,name:rows.name}}};
}
