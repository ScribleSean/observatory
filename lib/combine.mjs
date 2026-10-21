// Combine each computer's own snapshot into one combined.json.
// Limits belong to the account, so the freshest reading wins and they are never added.
// Tokens and screen time are shown per computer, plus a sum labeled "not deduplicated"
// that is Unknown when any computer's value is Unknown.
import {limits,totals,duration,compact,freshness,recordedDays,today as dayKey} from './panel-data.mjs';
import strings from './strings.json' with {type:'json'};
import {TIME_ZONE} from './timezone.mjs';
import {cleanAgentActivity} from '../scripts/read-agents.mjs';

export const COMBINED_SCHEMA='observatory-combined/1';
export const HOSTS=['Mac','Windows'];
export const SUM_LABEL='not deduplicated';
const SOURCE_KEYS=['activity','tokens','settings','providerTokenSources','activityHistory','dictation','agentActivity'];
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
  // Agent rows go through the reader's allowlist again, whichever computer wrote them.
  result.agentActivity=result.agentActivity.map(row=>cleanAgentActivity(row,host)).filter(Boolean).slice(0,1);
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
  const view={schema:2,timezone:devices.find(d=>d.rows)?.rows.timezone ?? TIME_ZONE,collectedAt:generatedAt,
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
  // API-equivalent cost: the Codex estimate plus the Claude Code estimate for today.
  // Unknown when either enabled part is Unknown. A source with no records today costs 0.
  let claudeUsd=null;
  if(claudeOn && claudeTokens===0)claudeUsd=0;
  else if(claudeOn && claudeTokens!==null) {
    const date=dayKey(view.timezone,new Date(now));
    const day=device.rows.providerTokenSources.find(row=>row.provider==='claude-code')?.days?.find(row=>row.date===date);
    const value=day?.apiEstimate?.usd;
    claudeUsd=typeof value==='number' && Number.isFinite(value) && value>=0?value:null;
  }
  const costs=[enabled('tokens')?usd:undefined,claudeOn?claudeUsd:undefined].filter(value=>value!==undefined);
  // Where today's time went: the largest app categories, in seconds.
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

// The apps compute ages when they display. Lines carry a clock time, which never goes out of date.
const clock=value=>{const at=time(value);return at===null?'Unknown':new Date(at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});};
const show=(value,format)=>value===null || value===undefined?'Unknown':format(value);
const percent=value=>value===null?'Unknown':`${Math.round(value)}%`;

const AGENT_ORDER=['waiting','working','idle','unknown','done'];
const AGENT_WORD={waiting:'waiting on you',working:'working',idle:'idle',unknown:'Unknown',done:'done',stopped:'stopped'};

// What each computer's agents are doing. Old snapshots keep their time, so a
// stale "working" is shown with its age rather than as current.
export function agentSummary(devices,now) {
  return devices.map(device=>{
    const row=device.rows?.agentActivity?.[0];
    if(!row || row.status==='not-connected')return {host:device.host,name:device.name,status:'off'};
    if(row.status!=='ok')return {host:device.host,name:device.name,status:'unknown',checkedAt:row.checkedAt ?? null};
    const sessions=Array.isArray(row.sessions)?row.sessions:[];
    const jobs=Array.isArray(row.jobs)?row.jobs:[];
    const counts=Object.fromEntries(AGENT_ORDER.map(status=>[status,sessions.filter(s=>s.status===status).length]));
    const stale=!(now-time(row.checkedAt)<=STALE_MS);
    return {host:device.host,name:device.name,status:'ok',checkedAt:row.checkedAt,stale,counts,
      sessions,jobs,claudeFound:row.claudeStatus==='ok',codexFound:row.codexStatus==='ok',claudeStatus:row.claudeStatus,codexStatus:row.codexStatus,
      jobsRunning:jobs.filter(job=>job.status==='working').length};
  });
}

function agentLines(agents) {
  const lines=[];
  for(const device of agents) {
    if(device.status==='off')continue;
    // A read that failed is Unknown, never "nothing running".
    if(device.status!=='ok' || device.claudeStatus==='unavailable') {lines.push(`  ${device.name}: Unknown`);continue;}
    const parts=AGENT_ORDER.filter(status=>status!=='done' && device.counts[status]).map(status=>`${device.counts[status]} ${AGENT_WORD[status]}`);
    if(device.jobsRunning)parts.push(`${device.jobsRunning} Codex job${device.jobsRunning>1?'s':''} running`);
    lines.push(`  ${device.name}: ${parts.join(' · ') || 'nothing running'}${device.stale?` · as of ${clock(device.checkedAt)}`:''}`);
    for(const session of device.sessions.filter(s=>['waiting','working'].includes(s.status)).slice(0,5))
      lines.push(`    ${session.project ?? 'Unknown project'}${session.name?' · '+session.name:''} · ${AGENT_WORD[session.status]}`);
  }
  return lines;
}

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
  const agents=agentSummary(devices,now);
  const waiting=agents.reduce((total,device)=>total+(device.status==='ok' && !device.stale?device.counts.waiting:0),0);
  const working=agents.reduce((total,device)=>total+(device.status==='ok' && !device.stale?device.counts.working+device.jobsRunning:0),0);
  const agentText=agentLines(agents);
  const money=value=>`$${value<10?value.toFixed(2):Math.round(value).toLocaleString('en-US')}`;
  const lines=[
    'Limits',
    ...limitRows.map(row=>`  ${row.name}${row.window?' '+row.window:''}: ${row.remaining===null?'Unknown':percent(row.remaining)+' left'}${row.note?' · '+row.note:''}`),
    ...(agentText.length?['','Agents',...agentText]:[]),
    '',
    'Today',
    ...perDevice.map(d=>d.missing?`  ${d.name}: Unknown · no snapshot${d.error?' ('+d.error+')':''}`:
      `  ${d.name}: ${d.screenTimeOn?show(d.seconds,duration):'screen time off'} screen · ${show(d.tokens,compact)} tokens · ${show(d.usd,money)} API-equivalent · as of ${clock(d.collectedAt)}`),
    ...(both?[`  Both: ${show(both.seconds,duration)} screen · ${show(both.tokens,compact)} tokens · ${show(both.usd,money)} (sum, ${SUM_LABEL})`]:[]),
  ];
  return {title,lowest,waiting,working,limits:limitRows,agents,today:perDevice,both,lines};
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
