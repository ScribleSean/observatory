// Today's tokens by project and session, checked at the boundary. The same
// check runs on this computer's reading and on a snapshot from the other one.
import {estimate} from './api-estimate.mjs';

export const MAX_PROJECTS=20;
export const MAX_SESSIONS=10;
const PROVIDERS=['claude','codex'];
const HOSTS=['Mac','Windows'];
const COUNTERS=['inputTokens','cacheReadTokens','cacheCreationTokens','outputTokens','totalTokens'];
const NAME=/^[\p{L}\p{N}_.+ ~-]{1,64}$/u;
const MODEL=/^[a-z0-9][a-z0-9.-]{0,63}$/;
const HASH=/^[0-9a-f]{10}$/;
const DATE=/^\d{4}-\d\d-\d\d$/;

const object=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const count=value=>Number.isSafeInteger(value) && value>=0;
const usd=value=>value===null || (typeof value==='number' && Number.isFinite(value) && value>=0);
const instant=value=>typeof value==='string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString()===value;
const fail=()=>{throw Error('Invalid project tokens');};
const add=(a,b)=>{const total=a+b;if(!Number.isSafeInteger(total))fail();return total;};
const sumOf=(rows,key)=>rows.reduce((total,row)=>add(total,row[key]),0);
// Unknown when any part is Unknown.
const knownSum=(rows,key)=>rows.some(row=>row[key]===null)?null:rows.reduce((total,row)=>total+row[key],0);
// An estimate is a number only when every token in it has a price.
const priced=models=>{const value=estimate(models);return value.usd!==null && value.coveredTokens===sumOf(models,'totalTokens')?value.usd:null;};

function cleanModel(raw) {
  if(!object(raw) || !(raw.model==='unknown' || (typeof raw.model==='string' && MODEL.test(raw.model))) || COUNTERS.some(key=>!count(raw[key])) ||
    raw.inputTokens+raw.cacheReadTokens+raw.cacheCreationTokens+raw.outputTokens!==raw.totalTokens)fail();
  return {model:raw.model,...Object.fromEntries(COUNTERS.map(key=>[key,raw[key]]))};
}

function cleanSession(raw) {
  if(!object(raw) || typeof raw.id!=='string' || !HASH.test(raw.id) || !PROVIDERS.includes(raw.provider) ||
    !instant(raw.start) || !instant(raw.end) || raw.start>raw.end || !Array.isArray(raw.models) || !raw.models.length || raw.models.length>50)fail();
  const models=raw.models.map(cleanModel);
  if(new Set(models.map(row=>row.model)).size!==models.length)fail();
  const totalTokens=sumOf(models,'totalTokens');
  if(raw.totalTokens!==totalTokens || !(raw.subagentTokens===null || (count(raw.subagentTokens) && raw.subagentTokens<=totalTokens)) || !usd(raw.usd))fail();
  return {id:raw.id,provider:raw.provider,start:raw.start,end:raw.end,totalTokens,subagentTokens:raw.subagentTokens,usd:raw.usd,models};
}

function cleanProject(raw,{other=false}={}) {
  if(!object(raw) || (other?raw.name!==null:!(raw.name===null || (typeof raw.name==='string' && NAME.test(raw.name)))) ||
    !count(raw.totalTokens) || !count(raw.sessionCount) || !(raw.subagentTokens===null || (count(raw.subagentTokens) && raw.subagentTokens<=raw.totalTokens)) ||
    !usd(raw.usd) || !Array.isArray(raw.sessions) || raw.sessions.length>(other?0:MAX_SESSIONS) || raw.sessions.length>raw.sessionCount)fail();
  const sessions=raw.sessions.map(cleanSession);
  if(new Set(sessions.map(row=>row.provider+row.id)).size!==sessions.length || sumOf(sessions,'totalTokens')>raw.totalTokens ||
    (sessions.length===raw.sessionCount && sumOf(sessions,'totalTokens')!==raw.totalTokens))fail();
  return {name:raw.name,totalTokens:raw.totalTokens,subagentTokens:raw.subagentTokens,usd:raw.usd,sessionCount:raw.sessionCount,sessions};
}

export function unavailableProjectTokens(host,checkedAt,status='unavailable') {
  return {host,status,checkedAt:new Date(checkedAt).toISOString()};
}

// Validates a stored row. Anything not listed here is dropped.
export function cleanProjectTokens(raw) {
  if(!object(raw) || !HOSTS.includes(raw.host) || !instant(raw.checkedAt))fail();
  if(raw.status!=='ok') {
    if(!['unavailable','not-connected'].includes(raw.status))fail();
    return unavailableProjectTokens(raw.host,raw.checkedAt,raw.status);
  }
  if(typeof raw.date!=='string' || !DATE.test(raw.date) || !Array.isArray(raw.providers) || !raw.providers.length ||
    raw.providers.some(name=>!PROVIDERS.includes(name)) || new Set(raw.providers).size!==raw.providers.length ||
    !Array.isArray(raw.projects) || raw.projects.length>MAX_PROJECTS)fail();
  const projects=raw.projects.map(row=>cleanProject(row));
  const other=raw.other===null?null:cleanProject(raw.other,{other:true});
  return {host:raw.host,status:'ok',checkedAt:raw.checkedAt,date:raw.date,providers:[...raw.providers],projects,other};
}

// Turns the reader's sessions into the stored row: projects by tokens, each
// with its largest sessions, and the rest of the projects folded into one row.
export function buildProjectTokens(raw,host,checkedAt) {
  const at=new Date(checkedAt).toISOString();
  if(!object(raw) || !object(raw.providers))fail();
  const enabled=PROVIDERS.filter(name=>raw.providers[name]);
  if(!enabled.length || enabled.some(name=>raw.providers[name].status!=='ok' || !Array.isArray(raw.providers[name].sessions)))
    return unavailableProjectTokens(host,at);
  const groups=new Map();
  for(const name of enabled)for(const session of raw.providers[name].sessions) {
    if(!object(session) || session.provider!==name || !Array.isArray(session.models))fail();
    const models=session.models.map(cleanModel);
    const row={id:session.id,provider:name,start:session.start,end:session.end,totalTokens:sumOf(models,'totalTokens'),
      subagentTokens:session.subagentTokens,usd:priced(models),models};
    const key=session.project ?? null;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(row);
  }
  const byTokens=(a,b)=>b.totalTokens-a.totalTokens || String(a.name ?? a.id).localeCompare(String(b.name ?? b.id));
  const projects=[...groups].map(([name,sessions])=>({name,totalTokens:sumOf(sessions,'totalTokens'),
    subagentTokens:knownSum(sessions,'subagentTokens'),usd:knownSum(sessions,'usd'),sessionCount:sessions.length,
    sessions:sessions.sort(byTokens).slice(0,MAX_SESSIONS)})).sort(byTokens);
  const rest=projects.slice(MAX_PROJECTS);
  const other=rest.length?{name:null,totalTokens:sumOf(rest,'totalTokens'),subagentTokens:knownSum(rest,'subagentTokens'),
    usd:knownSum(rest,'usd'),sessionCount:sumOf(rest,'sessionCount'),sessions:[]}:null;
  return cleanProjectTokens({host,status:'ok',checkedAt:at,date:raw.date,providers:enabled,projects:projects.slice(0,MAX_PROJECTS),other});
}
