import {limits,limitsWithGaps,totals,duration,compact,freshness,recordedDays,today as dayKey,usd,deviceLabel} from './panel-data.mjs';
import strings from './strings.json' with {type:'json'};
import {TIME_ZONE} from './timezone.mjs';
import {snapshotFresh} from './freshness.mjs';
import {forecast,readAt,lastReading} from './forecast.mjs';
import {format as fill} from './format.mjs';
import {cleanHistoryPoints} from '../scripts/limit-history.mjs';
import {cleanSessions,findCollisions,collisionLine} from './same-repo.mjs';
import {cleanProjectTokens,unavailableProjectTokens} from '../scripts/project-tokens.mjs';
import {cleanLedgerRow,cleanConfigEcho} from '../scripts/snapshot-clean.mjs';
import {cleanLedgerHistory,LEDGER_HISTORY_SCHEMA} from './r2-shape.mjs';
import {EFFORTS,MODEL_NAME,SPEEDS} from './drift.mjs';

export const COMBINED_SCHEMA='observatory-combined/1';
export const HOSTS=['Mac','Windows','Linux'];
export const SUM_LABEL='not deduplicated';
// The limits setting that decides whether each engine is read at all.
const ENGINE_SOURCE={claude:'claudeLimits',codex:'codexLimits',grok:'grokLimits'};
// The setting that decides whether each tool's sessions are read at all.
const TOOL_SOURCE={claude:'claudeCode',codex:'codex'};
const ENGINE_VIEW={claude:'claudeLimits',codex:'quota',grok:'grokLimits'};
const SOURCE_KEYS=['activity','tokens','settings','providerTokenSources','activityHistory','limitHistory','projectTokens','modelDrift'];

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
  requests:{timeZone:text,checkedAt:text,days:[{date:text,count:number}]},notReported:[text],windows:[windowFields],history:[{checkedAt:text,windows:[windowFields]}]};
const modelName=value=>typeof value==='string' && MODEL_NAME.test(value);
const date=value=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const driftModel={model:modelName,replies:number,retries:number,toolCalls:number,thinking:[number],replySeconds:[number],outputTokens:[number],
  efforts:Object.fromEntries([...EFFORTS,'other','unset'].map(name=>[name,number])),
  speeds:Object.fromEntries([...SPEEDS,'other','unset'].map(name=>[name,number]))};
const rowFields={
  activity:{...source,days:[activityDay]},
  tokens:{...source,days:[tokenDay]},
  settings:{...source,profiles:[{date:text,model:text,effort:text,speed:text,totalTokens:number}]},
  providerTokenSources:{...source,provider:text,days:[tokenDay]},
  activityHistory:{...source,days:[activityDay],asOf:text,latestReadStatus:text,trackingStatus:text,trackingThrough:text},
  modelDrift:{...source,days:[{date,models:[driftModel]}]},
};

// A model name this version does not know (a newer family from a computer that updated first, or
// anything else) drops that one entry. The rest of the computer's snapshot still counts.
const knownModels=row=>!Array.isArray(row.days)?row:{...row,days:row.days.map(day=>!object(day) || !Array.isArray(day.models)?day
  :{...day,models:day.models.filter(entry=>!object(entry) || modelName(entry.model))})};

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

const unavailableHistory=(host,timeZone,status='unavailable')=>({host,status,checkedAt:null,schema:LEDGER_HISTORY_SCHEMA,
  timeZone:typeof timeZone==='string'?timeZone:TIME_ZONE,firstDate:null,sessionsFrom:null,days:[]});
// A project list without the tools whose source is off: their sessions go, each project's total drops by what they
// spent, and what cannot be split by tool (the estimate, the subagent share, the unlisted "other" row) reads Unknown.
function withoutTools(list,toolsOff) {
  if(list.status!=='ok' || !list.providers.some(name=>toolsOff.includes(name)))return list;
  const projects=list.projects.map(project=>{
    const gone=project.sessions.filter(session=>toolsOff.includes(session.provider));
    if(!gone.length)return project;
    const spent=gone.reduce((total,session)=>total+session.totalTokens,0);
    return {...project,totalTokens:Math.max(0,project.totalTokens-spent),sessionCount:Math.max(0,project.sessionCount-gone.length),
      sessions:project.sessions.filter(session=>!toolsOff.includes(session.provider)),subagentTokens:null,usd:null};
  }).filter(project=>project.totalTokens>0);
  return {...list,providers:list.providers.filter(name=>!toolsOff.includes(name)),projects,other:null};
}

// titles and salt: this computer's own `sessions.titles` setting and title salt, applied to every
// computer's ledger it reads, so a hub with titles off never shows another computer's titles.
export function ownRows(snapshot,host,{now=Date.now(),titles=true,salt=null,toolsOff=[]}={}) {
  if(!object(snapshot) || !HOSTS.includes(host))return null;
  const result=approved(snapshot,{collectedAt:text,timezone:text});
  for(const [key,fields] of Object.entries(rowFields)) {
    if(snapshot[key]!==undefined && !Array.isArray(snapshot[key]))throw Error('invalid snapshot');
    result[key]=(snapshot[key] ?? []).map(row=>{
      if(!object(row))throw Error('invalid snapshot');
      return row;
    }).filter(row=>row.host===host).map(row=>approved(key==='modelDrift'?knownModels(row):row,fields));
  }
  // Codex tokens are read only while its source is on, so a copy another computer carries shows none.
  if(toolsOff.includes('codex')){result.tokens=[];result.settings=[];}
  result.projectTokens=rows(snapshot.projectTokens).filter(row=>row.host===host).slice(0,1).map(row=>{
    try {return withoutTools(cleanProjectTokens(row,{now}),toolsOff);}
    catch {return unavailableProjectTokens(host,time(row.checkedAt) ?? now);}
  });
  // Sessions are per computer, so each computer's ledger row is kept as it is and nothing is added twice.
  result.ledger=rows(snapshot.ledger).filter(row=>row.host===host).slice(0,1).map(row=>{
    try {
      const clean=cleanLedgerRow(row,{titles,salt});
      // A tool whose source the settings turn off has no sessions on any surface, even in a copy another computer carries.
      return Array.isArray(clean.tools)?{...clean,tools:clean.tools.filter(tool=>!toolsOff.includes(tool?.tool))}:clean;
    }
    catch {return {host,status:'unavailable'};}
  });
  // The settings echo: what that computer reads, for the Settings view and the source filter.
  result.configEcho=null;
  if(snapshot.configEcho!==undefined)try {result.configEcho=cleanConfigEcho(snapshot.configEcho,host);} catch {result.configEcho=null;}
  // A tool that computer's own settings turn off adds nothing, even from days it kept from before.
  const historyOff=[...toolsOff,...Object.entries(TOOL_SOURCE).filter(([,key])=>result.configEcho?.sources?.[key]===false).map(([tool])=>tool)];
  // The daily ledger history (lib/r2-shape.mjs), kept as that computer wrote it, with this computer's titles setting.
  result.ledgerHistory=rows(snapshot.ledgerHistory).filter(row=>row.host===host).slice(0,1).map(row=>{
    try {
      const clean=cleanLedgerHistory(row,{titles});
      // A tool whose source is off has no days on any surface either.
      return historyOff.length?{...clean,days:clean.days.filter(day=>!historyOff.includes(day?.tool))}:clean;
    }
    catch {return unavailableHistory(host,result.timezone);}
  });
  result.limitHistory=rows(snapshot.limitHistory).filter(row=>row.host===host);
  result.limitHistory=result.limitHistory.slice(0,1).map(row=>({host,status:row.status==='ok'?'ok':'unavailable',
    checkedAt:typeof row.checkedAt==='string'?row.checkedAt:null,points:cleanHistoryPoints(row.points,host)}));
  result.sessions=rows(snapshot.sessions).filter(row=>row.host===host).slice(0,1).map(row=>({host,status:row.status==='ok'?'ok':'unavailable',
    checkedAt:typeof row.checkedAt==='string'?row.checkedAt:null,sessions:row.status==='ok'?cleanSessions(row.sessions):[]}));
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
// A window that has reset says nothing about the current period, so a reading whose windows have all reset is no
// current limit. A computer that is up now (a recent snapshot, not dated ahead, not switched off) and says the tool is
// signed out beats any reading that is not a current limit from a computer that is up, so an old reading from a
// computer that is off never hides a sign-in that is needed on this one. A computer that is up keeps its reading
// through a missed read or two, as before.
function freshest(devices,key,now) {
  const sources=devices.filter(device=>object(device.rows?.[key])).map(device=>({source:device.rows[key],from:device.host,at:readingTime(device.rows[key],now),
    up:device.off!==true && snapshotFresh(time(device.rows.collectedAt),now) && time(device.rows.collectedAt)<=now+CLOCK_SKEW_MS}));
  // A time that is missing has not passed (null <= now is true in JavaScript, so it is checked first).
  const passed=iso=>{const at=time(iso);return at!==null && at<=now;};
  const limited=entry=>rows(entry.source.windows).some(window=>!passed(window?.resetsAt)) && !passed(entry.source.validUntil)?1:0;
  const read=sources.filter(entry=>entry.at!==null).sort((a,b)=>limited(b)-limited(a) || b.at-a.at);
  const signedOut=sources.find(entry=>entry.up && entry.source.status==='needs-auth');
  if(read.length && !signedOut)return read[0];
  if(signedOut)return read.find(entry=>limited(entry) && entry.up) ?? signedOut;
  return sources.find(entry=>entry.source.status!=='not-connected') ?? null;
}

function mergedView(devices,generatedAt,now,sourcesOff=[],toolsOff=[]) {
  // A tool off on this computer has no card of its own only when no computer reads it.
  const connected={codex:devices.some(d=>d.rows?.tokens?.some(row=>row.status!=='not-connected')),
    claude:devices.some(d=>d.rows?.providerTokenSources?.some(row=>row.provider==='claude-code' && row.status!=='not-connected'))};
  toolsOff=toolsOff.filter(tool=>!connected[tool]);
  const view={schema:2,timezone:devices.find(d=>d.rows)?.rows.timezone ?? TIME_ZONE,collectedAt:generatedAt,
    combined:{host:'Combined',status:'unavailable'},combinedTokens:{host:'All',status:'unavailable'},
    combinedSettings:{host:'All',status:'unavailable'},deviceNames:{},sourcesOff,toolsOff};
  for(const key of SOURCE_KEYS)view[key]=[];
  // One ledger row per computer, kept as that computer wrote it (lib/ledger-shape.mjs); a computer with
  // a snapshot but no ledger reads not connected, one whose snapshot could not be read unavailable.
  view.ledger=[];
  // The same for the daily history, and each computer's settings echo (round 2, lib/r2-shape.mjs).
  view.ledgerHistory=[];
  view.config=[];
  for(const host of HOSTS) {
    const device=devices.find(d=>d.host===host);
    if(!device) {
      // Linux is optional: no row appears for a computer nobody has set up.
      if(host==='Linux')continue;
      view.activity.push({host,status:'not-connected'});
      view.tokens.push({host,status:'not-connected'});
      view.ledger.push({host,status:'not-connected'});
      view.ledgerHistory.push(unavailableHistory(host,view.timezone,'not-connected'));
      continue;
    }
    view.deviceNames[host]=device.name;
    view.ledger.push(device.rows?.ledger?.[0] ?? {host,status:device.rows?'not-connected':'unavailable'});
    view.ledgerHistory.push(device.rows?.ledgerHistory?.[0] ?? unavailableHistory(host,view.timezone,device.rows?'not-connected':'unavailable'));
    if(device.rows?.configEcho)view.config.push(device.rows.configEcho);
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
  // Limits belong to one account, so an engine whose limits source is off is read from no computer, even from a copy
  // another computer carries, and its history is dropped with it.
  view.limitHistory=view.limitHistory.map(row=>Array.isArray(row.points)?{...row,points:row.points.filter(point=>!sourcesOff.includes(point?.p))}:row);
  for(const engine of sourcesOff) {
    const key=ENGINE_VIEW[engine];
    view[key]={provider:view[key].provider ?? (engine==='codex'?'Codex':engine==='grok'?'Grok':'Claude Code'),scope:'account',status:'not-connected',windows:[]};
  }
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
    seconds:enabled('activity')?seconds:null,screenTimeOn:enabled('activity'),tokensOn:parts.length>0,usdOn:costs.length>0,
    codexTokens,claudeTokens,tokens,cacheReadTokens,usd:cost,categories,
    costs:{codex:enabled('tokens')?usd:undefined,claude:claudeOn?claudeUsd:undefined}};
}

export function sum(values) {
  if(!values.length || values.some(value=>value===null || value===undefined))return null;
  return values.reduce((a,b)=>a+b,0);
}

const show=(value,format)=>value===null || value===undefined?'Unknown':format(value);

// The All line. A number with two or more contributors is a sum and says so. With one it is that computer's number, and
// with none it reads off. The label is said once when every number is a sum, else beside each sum.
function allLine(both) {
  /** @type {[string,string,(value:number)=>string,string][]} */
  const measures=[['seconds','screen',duration,'screen time'],['tokens','tokens',compact,'tokens'],['usd','API-equivalent',usd,'API-equivalent']];
  const parts=measures.map(([key,word,make,name])=>{
    const count=both.contributors[key];
    return {count,text:count===0?`${name} off`:`${show(both[key],make)} ${word}`};
  });
  const summed=parts.filter(part=>part.count>1);
  const once=summed.length>0 && parts.every(part=>part.count===0 || part.count>1);
  const line=parts.map(part=>part.count>1 && !once?`${part.text} (sum, ${SUM_LABEL})`:part.text).join(' · ');
  return `  All: ${line}${once?` (sum, ${SUM_LABEL})`:''}`;
}

const SOURCE_FOR={claude:'claudeLimits',codex:'quota',grok:'grokLimits'};

// Repositories where two or more live sessions overlap, across every computer. A computer whose
// session list is older than DEVICE_FRESH_MS is left out, so a closed session lingers for at most that long.
// The dashboard also hides the line once the whole summary is stale.
export function collisionsFor(devices,now) {
  const live=devices.flatMap(device=>{
    const row=device.rows?.sessions?.[0];
    if(row?.status!=='ok' || !snapshotFresh(time(row.checkedAt),now))return [];
    return row.sessions.map(session=>({...session,host:device.host}));
  });
  const names=Object.fromEntries(devices.map(device=>[device.host,device.name]));
  return findCollisions(live).map(collision=>({...collision,line:collisionLine(collision,host=>names[host] ?? host)}));
}

function glance(view,devices,now,settings) {
  const sourcesOff=view.sourcesOff ?? [];
  const rows=limitsWithGaps(limits(view,now)).map(row=>{
    const source=view[SOURCE_FOR[row.provider]];
    const window=source?.windows?.find(window=>window.bucket===row.bucket && window.window===row.windowId);
    const own=time(window?.checkedAt),checked=time(source?.checkedAt);
    return {...row,from:source?.observedOn ?? null,
      checkedAt:own!==null && checked!==null && own<=checked?window.checkedAt:source?.checkedAt ?? null,
      resetsAt:window?.resetsAt ?? null};
  });
  const perDevice=devices.map(device=>({...today(view,device,now),state:device.state,stateLabel:device.stateLabel,
    freshness:device.rows?freshness(device.rows.collectedAt,now):{label:'No snapshot',stale:true},
    ...(device.error?{error:device.error}:{})}));
  // Each number counts its own contributors. A computer that is off, or has that source off, adds nothing to it. A
  // computer with no snapshot is a contributor with an Unknown value, so the number is Unknown. With one contributor the
  // number is just that computer's. With none the number is off.
  const on=perDevice.filter(d=>d.state!=='off');
  const contributors=(flag)=>on.filter(d=>d.missing || d[flag]);
  const counts={seconds:contributors('screenTimeOn').length,tokens:contributors('tokensOn').length,usd:contributors('usdOn').length};
  const added=(flag,key)=>sum(contributors(flag).map(d=>d[key]));
  const both=on.length>1?{seconds:added('screenTimeOn','seconds'),tokens:added('tokensOn','tokens'),
    cacheReadTokens:added('tokensOn','cacheReadTokens'),usd:added('usdOn','usd'),contributors:counts,label:SUM_LABEL}:null;
  const outlook=forecast(view,rows,{now,timeZone:view.timezone ?? TIME_ZONE,settings,hide:sourcesOff});
  // An engine that reads Off keeps no number anywhere, so an old allowance never resurfaces in the menu bar.
  const off=new Map(outlook.engines.filter(engine=>engine.status==='off').map(engine=>[engine.engine,engine.phrase]));
  const limitRows=rows.map(row=>off.has(row.provider)?{...row,remaining:null,low:false,spent:false,stale:true,off:true,note:off.get(row.provider)}:row);
  const current=limitRows.filter(row=>row.remaining!==null && !row.stale);
  const lowest=current.length?Math.min(...current.map(row=>row.remaining)):null;
  const title=outlook.menu ?? (lowest===null?'?':`${Math.round(lowest)}%`);
  const collisions=collisionsFor(devices,now);
  // A Linux computer has no standard label, so it shows under its own device name.
  const label=d=>d.host==='Linux'?d.name:deviceLabel(d.host);
  const lines=[
    ...collisions.map(collision=>collision.line),
    ...(collisions.length?['']:[]),
    'Limits',
    ...limitRows.map(row=>{
      const stored=outlook.windows.find(window=>window.engine===row.provider && window.windowId===row.windowId);
      const said=stored && (stored.status==='runs-out' || stored.status==='out')?stored:null;
      // The reset reads as the stored forecast words it (the same label as the Week page and the status), never as a countdown.
      // A reading that is old says its last value and when it was read, the way an old forecast does, or Unknown past its reset.
      const last=row.off?null:lastReading(row,now,view.timezone ?? TIME_ZONE);
      const resetPart=time(row.resetsAt)===null?strings.status.resetUnknown:time(row.resetsAt)<=now?strings.limits.resetPending:stored?.resets ?? strings.status.resetUnknown;
      // A window the provider does not report is just "Not reported", and a gap or off row keeps its own note.
      const reset=row.absent?'':row.windowId?[resetPart,last?.asOf].filter(Boolean).join(strings.formats.separator):row.note;
      return `  ${row.name}${row.window?' '+row.window:''}: ${last===null?row.absent ?? 'Unknown':fill(strings.week.used,{value:Math.round(100-last.remaining)})}${row.off?' · '+row.note:reset?' · '+reset:''}${said?' · '+said.phrase:''}`;
    }),
    '',
    'Today',
    ...perDevice.map(d=>d.state==='off'?`  ${label(d)}: ${d.stateLabel}`:d.missing?`  ${label(d)}: Unknown · no snapshot${d.error?' ('+d.error+')':''}`:
      `  ${label(d)}: ${d.screenTimeOn?show(d.seconds,duration):'screen time off'} screen · ${show(d.tokens,compact)} tokens · ${show(d.usd,usd)} API-equivalent · as of ${d.stateLabel}`),
    ...(both?[allLine(both)]:[]),
  ];
  return {title,lowest,forecast:outlook,collisions,limits:limitRows,today:perDevice,both,lines:[outlook.sentence,'',...lines]};
}

// limitsOff: the engines whose limits are off for the whole account. The hub decides it from its settings and stores it
// in the combined view, and a spoke that recombines passes that list back, so every computer shows the same thing.
// sources: this computer's own settings, which hide only this computer's own usage rows.
export function combine(devices,{now=Date.now(),generatedBy,engines={},sources={},limitsOff,titles=true,salt=null}={}) {
  const seen=new Set();
  const toolsOff=Object.entries(TOOL_SOURCE).filter(([,key])=>sources[key]===false).map(([tool])=>tool);
  const prepared=devices.map(device=>{
    if(!HOSTS.includes(device.host) || seen.has(device.host))throw Error('Each computer needs a distinct host: Mac, Windows or Linux');
    seen.add(device.host);
    const rows=ownRows(device.snapshot,device.host,{now,titles,salt,toolsOff:device.host===generatedBy?toolsOff:[]});
    const offSince=device.off===true && typeof device.offSince==='string' && /^\d{4}-\d{2}-\d{2}$/.test(device.offSince)?device.offSince:null;
    return {host:device.host,name:rows?.name ?? device.name ?? device.host,rows,error:device.off?null:device.error ?? null,off:device.off===true,offSince};
  });
  const generatedAt=new Date(now).toISOString();
  const sourcesOff=Array.isArray(limitsOff)?limitsOff.filter(engine=>engine in ENGINE_SOURCE):Object.entries(ENGINE_SOURCE).filter(([,key])=>sources[key]===false).map(([engine])=>engine);
  const view=mergedView(prepared,generatedAt,now,sourcesOff,toolsOff);
  const states=prepared.map(device=>({...device,...deviceState(device,now,view.timezone ?? TIME_ZONE)}));
  return {schema:COMBINED_SCHEMA,generatedAt,generatedBy,
    devices:states.map(device=>({host:device.host,name:device.name,collectedAt:device.rows?.collectedAt ?? null,
      stale:!device.rows || !snapshotFresh(time(device.rows.collectedAt),now),state:device.state,stateLabel:device.stateLabel,
      ...(device.offSince?{offSince:device.offSince}:{}),...(device.error?{error:device.error}:{})})),
    snapshots:Object.fromEntries(prepared.filter(d=>d.rows).map(d=>[d.host,d.rows])),
    view,glance:glance(view,states,now,engines)};
}

export function carriedDevice(combined,host) {
  if(!object(combined) || combined.schema!==COMBINED_SCHEMA)return null;
  const own=combined.snapshots?.[host];
  if(!object(own))return null;
  // A computer the hub's settings turn off stays Off on every computer that carries its copy.
  const stored=rows(combined.devices).find(device=>device.host===host && device.state==='off');
  const offSince=typeof stored?.offSince==='string'?stored.offSince:null;
  return {host,name:own.name,snapshot:{...own,device:{host,name:own.name}},...(stored?{off:true,...(offSince?{offSince}:{})}:{})};
}

/**
 * Each computer's state, decided once here and shown as stored by every surface:
 * off when the settings turn it off, missing with no snapshot, late when its snapshot is old or the last pull failed,
 * and current otherwise. The label is "Off", "No snapshot" or the time of its last reading, which always names the day.
 */
export function deviceState(device,now,timeZone) {
  if(device.off)return {state:'off',stateLabel:strings.today.off};
  const at=time(device.rows?.collectedAt);
  if(!device.rows || at===null)return {state:'missing',stateLabel:strings.today.noSnapshot};
  const label=readAt(new Date(at).toISOString(),{now,timeZone});
  return {state:device.error || !snapshotFresh(at,now)?'late':'current',stateLabel:label};
}
