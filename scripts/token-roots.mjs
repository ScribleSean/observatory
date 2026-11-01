// Reads Claude Code and Codex logs from more than one home folder on the same
// computer and adds the results together. On a Windows PC with the wsl source
// on, the home folders of its WSL distributions count toward that PC.
// Each reader runs once per folder, unchanged. Only the results are merged.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from '../lib/cycle-processes.mjs';
import {collectClaudeUsage} from './read-claude-usage.mjs';
import {collectSettings} from './read-settings.mjs';
import {collectProjectTokens} from './read-projects.mjs';

const LXSS='HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss';
// Distribution names WSL accepts. Anything else is skipped, so a name is safe in a path and in stored labels.
const DISTRO=/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
// Container engines keep their own distributions with no user logs. Opening them would start their VM.
const ENGINE=/^(docker-desktop|rancher-desktop|podman-machine)/i;
const USER=/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;

class Unreadable extends Error {}

// Distribution names from `reg query <Lxss> /s /v DistributionName`. Reading the
// registry does not start a distribution.
export function parseDistributions(output) {
  const names=[];
  for(const line of String(output).split(/\r?\n/)) {
    const match=/^\s+DistributionName\s+REG_SZ\s+(\S.*?)\s*$/.exec(line);
    if(match && DISTRO.test(match[1]) && !ENGINE.test(match[1]) && !names.includes(match[1]))names.push(match[1]);
  }
  return names;
}

export function listDistributions({exec=execFile}={}) {
  const reg=path.win32.join(process.env.SystemRoot || 'C:\\Windows','System32','reg.exe');
  return new Promise((resolve,reject)=>{
    exec(reg,['query',LXSS,'/s','/v','DistributionName'],{windowsHide:true,timeout:15000},(error,stdout)=>{
      // reg exits 1 when the key is missing: WSL has no distributions for this user.
      if(error && error.code===1)return resolve([]);
      if(error)return reject(error);
      resolve(parseDistributions(stdout));
    });
  });
}

// What a tool folder holds: 'absent' adds nothing, 'present' is read, and
// 'unreadable' makes that provider's total Unknown.
// A link counts as unreadable: Windows cannot follow a Linux link, and one that
// does resolve could point at folders that are already counted.
async function folderState(folder) {
  let info;
  try {info=await fs.lstat(folder);}
  catch(error) {return error.code==='ENOENT'?'absent':'unreadable';}
  return info.isDirectory() && !info.isSymbolicLink()?'present':'unreadable';
}

// The home folders under /home of each distribution, as seen from Windows.
// Opening a distribution's share starts it if it is stopped.
export async function wslRoots({distributions,share=name=>`\\\\wsl.localhost\\${name}`,join=(...parts)=>path.win32.join(...parts)}={}) {
  const roots=[];
  for(const name of distributions) {
    const homes=join(share(name),'home');
    const unreadable=()=>roots.push({label:`WSL ${name}`,unreadable:true});
    // A share that cannot be reached is Unknown. Only a reachable distribution without /home has no homes.
    try {await fs.stat(share(name));}
    catch {unreadable();continue;}
    let entries;
    try {entries=await fs.readdir(homes,{withFileTypes:true});}
    catch(error) {
      if(error.code!=='ENOENT')unreadable();
      continue;
    }
    // A linked or oddly named home could hold logs that would be missed, so it is Unknown too.
    if(entries.some(entry=>entry.isSymbolicLink() || (entry.isDirectory() && !USER.test(entry.name)))) {unreadable();continue;}
    for(const entry of entries.filter(entry=>entry.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name))) {
      const home=join(homes,entry.name);
      roots.push({label:`WSL ${name}`,key:`${name}\0${entry.name}`,home:`/home/${entry.name}`,
        claudeFolder:join(home,'.claude'),codexFolder:join(home,'.codex'),optional:true});
    }
  }
  return roots;
}

// The folders one provider is read from. A root marked optional adds nothing
// when its folder is missing. Any folder that exists but cannot be read throws.
// This computer's own folder is always read, and an invalid setting for it is Unknown.
// Two roots that resolve to the same folder are Unknown rather than counted twice.
async function folders(roots,field) {
  const found=[],seen=new Set();
  for(const root of roots) {
    if(root.unreadable || !root[field])throw new Unreadable();
    if(root.optional) {
      const state=await folderState(root[field]);
      if(state==='unreadable')throw new Unreadable();
      if(state==='absent')continue;
    }
    const real=await fs.realpath(root[field]).catch(()=>null);
    if(real!==null) {
      const key=process.platform==='win32'?real.toLowerCase():real;
      if(seen.has(key))throw new Unreadable();
      seen.add(key);
    }
    found.push(root);
  }
  return found;
}

export const labelsOf=roots=>[...new Set(roots.map(root=>root.label))];

const COUNTERS=['inputTokens','cacheReadTokens','cacheCreationTokens','outputTokens','totalTokens','requestCount'];
const byText=(a,b)=>a<b?-1:a>b?1:0;
const add=(target,source,keys)=>{for(const key of keys)target[key]=(target[key]??0)+(source[key]??0);};

export function mergeClaude(results) {
  if(results.some(result=>result?.status==='unavailable' || !result))return {provider:'claude-code',status:'unavailable'};
  const ok=results.filter(result=>result.status==='ok');
  if(!ok.length)return results.find(result=>result.status==='not-found') ?? {provider:'claude-code',status:'not-found'};
  if(ok.length===1)return ok[0];
  const days=new Map();
  for(const result of ok)for(const day of result.days) {
    let row=days.get(day.date);
    if(!row) {
      row={date:day.date,...Object.fromEntries(COUNTERS.map(key=>[key,0])),models:new Map(),hours:Array(24).fill(0)};
      days.set(day.date,row);
    }
    add(row,day,COUNTERS);
    if(Array.isArray(day.hours) && Array.isArray(row.hours) && day.hours.length===24)day.hours.forEach((value,hour)=>{row.hours[hour]+=value;});
    else row.hours=null;
    for(const model of day.models) {
      if(!row.models.has(model.model))row.models.set(model.model,{model:model.model,...Object.fromEntries(COUNTERS.map(key=>[key,0]))});
      add(row.models.get(model.model),model,COUNTERS);
    }
  }
  return {...ok[0],days:[...days.keys()].sort(byText).map(date=>{
    const {hours,...row}=days.get(date);
    return {...row,models:[...row.models.keys()].sort(byText).map(name=>row.models.get(name)),...(hours?{hours}:{})};
  })};
}

const PROFILE=['inputTokens','cacheReadTokens','cacheCreationTokens','outputTokens','reasoningOutputTokens','totalTokens'];
function mergeRows(lists,keyFields,counters) {
  const merged=new Map();
  for(const list of lists)for(const row of list ?? []) {
    const key=JSON.stringify(keyFields.map(field=>row[field]));
    if(!merged.has(key))merged.set(key,{...row});
    else add(merged.get(key),row,counters);
  }
  return [...merged.values()];
}

export function mergeCodex(results) {
  if(results.length===1)return results[0];
  const hours=new Map();
  for(const result of results)for(const entry of result.hourTotals ?? []) {
    if(!hours.has(entry.date))hours.set(entry.date,Array(24).fill(0));
    entry.hours.forEach((value,hour)=>{hours.get(entry.date)[hour]+=value;});
  }
  const {tokenProfiles:_retained,...first}=results[0];
  const retained=results.every(result=>Array.isArray(result.tokenProfiles));
  return {...first,
    ...(retained?{tokenProfiles:mergeRows(results.map(result=>result.tokenProfiles),['date','model','effort','speed'],PROFILE)}:{}),
    profiles:mergeRows(results.map(result=>result.profiles),['date','model','effort','speed'],PROFILE),
    hourTotals:[...hours.keys()].sort(byText).map(date=>({date,hours:hours.get(date)})),
    tools:mergeRows(results.map(result=>result.tools),['date','category','tool','namespace'],['count'])};
}

export function mergeProjects(results) {
  const [first]=results;
  const providers={};
  for(const name of ['claude','codex']) {
    const parts=results.map(result=>result.providers[name]).filter(Boolean);
    if(!parts.length)continue;
    providers[name]=parts.every(part=>part.status==='ok')?{status:'ok',sessions:parts.flatMap(part=>part.sessions)}:{status:'unavailable'};
  }
  return {date:first.date,timeZone:first.timeZone,providers};
}

// Each folder keeps its own private cache, for Claude Code as for Codex.
export async function readClaudeRoots(roots,{cacheFor=()=>null,read=collectClaudeUsage}={}) {
  let found;
  try {found=await folders(roots,'claudeFolder');}
  catch {return {provider:'claude-code',status:'unavailable'};}
  const result=mergeClaude(await Promise.all(found.map(async root=>read(root.claudeFolder,{cacheDirectory:await cacheFor(root)}))));
  return {...result,roots:labelsOf(found)};
}

// Each Codex folder keeps its own private cache.
export async function readCodexRoots(roots,{cacheFor,read=collectSettings}) {
  const found=await folders(roots,'codexFolder');
  const results=[];
  for(const root of found)results.push(await read(root.codexFolder,{cacheDirectory:await cacheFor(root)}));
  return {...mergeCodex(results),roots:labelsOf(found)};
}

// The first root is this computer's own home, so its result carries the day.
// A WSL session started in the Windows home would be named after the Windows
// user, so that name, the WSL user names and the folder holding homes are never project names there.
export async function readProjectRoots(roots,{claude,codex,now,read=collectProjectTokens}) {
  const unknown={providers:{...(claude?{claude:{status:'unavailable'}}:{}),...(codex?{codex:{status:'unavailable'}}:{})}};
  const own=roots.find(root=>!root.optional);
  // The other users' names under /home are hidden too, since a session can start in another user's home.
  const hidden=new Set([own?.home,...roots.filter(root=>root.optional && root.home).map(root=>root.home)]
    .map(home=>path.win32.basename(home ?? '').toLowerCase()).filter(Boolean).concat('users'));
  const hide=result=>({...result,providers:Object.fromEntries(Object.entries(result.providers).map(([name,part])=>[name,
    part.status!=='ok'?part:{...part,sessions:part.sessions.map(session=>hidden.has(String(session.project).toLowerCase())?{...session,project:null}:session)}]))});
  const parts=[];
  for(const root of roots) {
    if(!root.optional) {
      if((claude && !root.claudeFolder) || (codex && !root.codexFolder)) {parts.push(unknown);continue;}
      parts.push(await read({claudeFolder:claude?root.claudeFolder:null,codexFolder:codex?root.codexFolder:null,home:root.home,now}));
      continue;
    }
    if(root.unreadable) {parts.push(unknown);continue;}
    const [claudeState,codexState]=await Promise.all([claude?folderState(root.claudeFolder):'absent',codex?folderState(root.codexFolder):'absent']);
    if(claudeState==='unreadable' || codexState==='unreadable') {parts.push(unknown);continue;}
    if(claudeState==='absent' && codexState==='absent')continue;
    parts.push(hide(await read({claudeFolder:claudeState==='present'?root.claudeFolder:null,codexFolder:codexState==='present'?root.codexFolder:null,home:root.home,now})));
  }
  return mergeProjects(parts);
}

// A private cache folder name for one WSL home that holds no user or distribution name.
export const cacheName=root=>`wsl-${createHash('sha256').update(root.key).digest('hex').slice(0,12)}`;
