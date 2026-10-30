// Today's tokens per working folder and session, from Claude Code and Codex logs.
// Only these values leave the reader: a folder's last name, a short hash of the
// session id, first and last request times, per-model counts and subagent counts.
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {TIME_ZONE} from '../lib/timezone.mjs';

export const LIMITS=Object.freeze({maxFiles:5000,maxTotalBytes:2*1024*1024*1024,maxLineBytes:16*1024*1024});
// A file last written before this window cannot hold a request from today.
const WINDOW_MS=26*3600000;
const MODEL=/^[a-z0-9][a-z0-9.-]{0,63}$/;
const NAME=/^[\p{L}\p{N}_.+ -]{1,64}$/u;
const object=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const count=value=>Number.isSafeInteger(value) && value>=0?value:null;

class Unavailable extends Error {}

export const sessionHash=(provider,id)=>createHash('sha256').update(`${provider}:${id}`).digest('hex').slice(0,10);
export const modelName=value=>typeof value==='string' && MODEL.test(value)?value:'unknown';

const formatters=new Map();
export function dayKey(at,timeZone=TIME_ZONE) {
  let formatter=formatters.get(timeZone);
  if(!formatter) {
    formatter=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});
    formatters.set(timeZone,formatter);
  }
  return formatter.format(at);
}

// The repository a folder belongs to, by its last name. Worktree folders are
// often named after a branch, so a worktree takes its repository's name: the
// folder above .claude/worktrees, the repository in a Codex log, the folder
// after Conductor's workspaces, or the folder above another worktrees folder.
// A folder named after the session's branch has the branch removed. The home
// folder is "~" and anything above it is left out, so a user name is never a
// project. Temporary folders are one project. Nothing else of the path is kept.
const TEMP=[['tmp'],['private','tmp'],['var','folders'],['private','var','folders']];
const segments=value=>value.replace(/^[\\/]{2}[?.][\\/]/,'').split(/[\\/]+/).filter(part=>part && part!=='.');
const folded=parts=>parts.map(part=>part.toLowerCase());
const startsWith=(parts,prefix)=>prefix.length<=parts.length && prefix.every((part,index)=>parts[index]===part);
const valid=name=>typeof name==='string' && NAME.test(name) && name!=='..'?name:null;
const repositoryName=value=>typeof value==='string'?valid(value.split(/[\\/:]+/).filter(Boolean).at(-1)?.replace(/\.git$/i,'')):null;

export function projectName(cwd,home='',{repository=null,branch=null}={}) {
  if(typeof cwd!=='string' || !(path.posix.isAbsolute(cwd) || path.win32.isAbsolute(cwd)))return null;
  const parts=segments(cwd),lower=folded(parts);
  const homeParts=typeof home==='string' && home?folded(segments(home)):null;
  if(TEMP.some(prefix=>startsWith(lower,prefix)) ||
    lower.some((part,index)=>part==='appdata' && lower[index+1]==='local' && lower[index+2]==='temp'))return 'temp';
  let folder=parts;
  const tree=lower.findIndex(part=>part==='worktrees' || part==='.worktrees');
  const conductor=lower.findIndex((part,index)=>part==='workspaces' && lower[index-1]==='conductor');
  if(tree>0 && lower[tree-1]==='.claude')folder=parts.slice(0,tree-1);
  else if(tree>=0) {
    const named=repositoryName(repository);
    if(named)return named;
    // Codex keeps worktrees as .codex/worktrees/<id>/<repository>.
    if(lower[tree-1]==='.codex')folder=tree+2<parts.length?parts.slice(0,tree+3):[];
    else folder=parts.slice(0,tree);
  } else if(conductor>=0)folder=conductor+1<parts.length?parts.slice(0,conductor+2):[];
  if(!folder.length)return null;
  const lowerFolder=folded(folder);
  if(homeParts) {
    if(lowerFolder.length===homeParts.length && startsWith(homeParts,lowerFolder))return '~';
    if(startsWith(homeParts,lowerFolder))return null;
  }
  let name=folder.at(-1);
  const slug=typeof branch==='string'?branch.split('/').filter(Boolean).at(-1)?.toLowerCase():null;
  if(folder===parts && slug && !['main','master','head','trunk','develop'].includes(slug)) {
    const lowerName=name.toLowerCase();
    if(lowerName===slug)return null;
    const cut=lowerName.length-slug.length-1;
    if(cut>0 && lowerName.endsWith(slug) && '-_. '.includes(lowerName[cut]))name=name.slice(0,cut);
  }
  return valid(name || null);
}

async function files(root,since,limits,budget={files:0,bytes:0}) {
  const found=[];
  const walk=async folder=>{
    let entries;
    try {entries=await fs.promises.readdir(folder,{withFileTypes:true});}
    catch(error) {if(error.code==='ENOENT')return;throw error;}
    for(const entry of entries) {
      const full=path.join(folder,entry.name);
      if(entry.isSymbolicLink())continue;
      if(entry.isDirectory()) {await walk(full);continue;}
      if(!entry.isFile() || !entry.name.endsWith('.jsonl'))continue;
      let info;
      // A file can be removed between listing and reading.
      try {info=await fs.promises.stat(full);}
      catch(error) {if(error.code==='ENOENT')continue;throw error;}
      if(info.mtimeMs<since)continue;
      budget.files+=1;
      budget.bytes+=info.size;
      found.push(full);
      if(budget.files>limits.maxFiles || budget.bytes>limits.maxTotalBytes)throw new Unavailable();
    }
  };
  await walk(root);
  return found.sort((a,b)=>a.localeCompare(b));
}

const EDGE=64*1024;
async function lines(file,limits,keep,each) {
  let input;
  try {input=fs.createReadStream(file);await new Promise((resolve,reject)=>input.once('open',resolve).once('error',reject));}
  catch(error) {input?.destroy();if(error.code==='ENOENT')return;throw error;}
  const reader=readline.createInterface({input,crlfDelay:Infinity});
  try {
    for await (const line of reader) {
      // A long line is looked at only by its ends, and skipped unless they hold the markers.
      if(line.length>limits.maxLineBytes ? !keep(line.slice(0,EDGE)+line.slice(-EDGE)) : !keep(line))continue;
      let event;
      // A line still being written is read on the next cycle.
      try {event=JSON.parse(line);} catch {continue;}
      if(object(event))each(event);
    }
  } finally {reader.close();input.destroy();}
}

function sessions() {
  const map=new Map();
  return {
    add({provider,id,project,at,model,values,subagent}) {
      const key=JSON.stringify([provider,id,project]);
      let row=map.get(key);
      if(!row) {row={provider,id,project,start:at,end:at,subagentTokens:0,models:new Map()};map.set(key,row);}
      row.start=Math.min(row.start,at);
      row.end=Math.max(row.end,at);
      const total=values.reduce((a,b)=>a+b,0);
      if(subagent===null || row.subagentTokens===null)row.subagentTokens=null;
      else if(subagent)row.subagentTokens+=total;
      let counts=row.models.get(model);
      if(!counts) {counts=[0,0,0,0];row.models.set(model,counts);}
      values.forEach((value,index)=>{counts[index]+=value;});
    },
    rows() {
      return [...map.values()].map(row=>({provider:row.provider,id:row.id,project:row.project,
        start:new Date(row.start).toISOString(),end:new Date(row.end).toISOString(),subagentTokens:row.subagentTokens,
        models:[...row.models].map(([model,[inputTokens,cacheReadTokens,cacheCreationTokens,outputTokens]])=>({model,
          inputTokens,cacheReadTokens,cacheCreationTokens,outputTokens,totalTokens:inputTokens+cacheReadTokens+cacheCreationTokens+outputTokens}))}));
    },
  };
}

// Claude Code: one request can be written several times as it streams, so the
// largest counts for each message id win. Subagent turns carry
// isSidechain and their parent's sessionId.
async function readClaude(folder,{today,timeZone,since,home,limits}) {
  const requests=new Map();
  for(const file of await files(path.join(folder,'projects'),since,limits)) {
    // A subagent file sits in <session id>/subagents/ and belongs to that session,
    // whatever session id its own events carry.
    const inSubagents=path.basename(path.dirname(file))==='subagents';
    const owner=inSubagents?path.basename(path.dirname(path.dirname(file))):null;
    const fallback=path.basename(file,'.jsonl');
    await lines(file,limits,line=>line.includes('"assistant"') && line.includes('"usage"'),event=>{
      if(event.type!=='assistant' || !object(event.message) || !object(event.message.usage))return;
      const usage=event.message.usage;
      const at=Date.parse(event.timestamp);
      // A line that cannot be dated might be today's, so it makes the day Unknown.
      if(!Number.isFinite(at))throw new Unavailable();
      if(dayKey(at,timeZone)!==today)return;
      const values=['input_tokens','cache_read_input_tokens','cache_creation_input_tokens','output_tokens'].map(key=>count(usage[key]));
      if(values.includes(null))throw new Unavailable();
      // Placeholder replies carry no message id and no usage.
      if(typeof event.message.id!=='string' || !event.message.id || values.every(value=>value===0))return;
      const key=event.message.id;
      const total=values.reduce((a,b)=>a+b,0);
      const prior=requests.get(key);
      if(prior && prior.total>=total)return;
      const id=owner ?? (typeof event.sessionId==='string' && event.sessionId?event.sessionId:fallback);
      requests.set(key,{total,record:{provider:'claude',id:sessionHash('claude',id),project:projectName(event.cwd,home,{branch:event.gitBranch}),
        at:prior?Math.min(prior.record.at,at):at,model:modelName(event.message.model),values,
        subagent:inSubagents || (typeof event.isSidechain==='boolean'?event.isSidechain:null)}});
    });
  }
  const result=sessions();
  for(const {record} of requests.values())result.add(record);
  return result.rows();
}

// Codex: each token_count event carries the running total and the last turn.
// A forked session can repeat its parent's events, so a repeated time and
// running total is counted once. A thread with a parent is a subagent.
async function readCodex(folder,{today,timeZone,since,home,limits}) {
  const result=sessions(),seen=new Set();
  const roots=['sessions','archived_sessions'].map(name=>path.join(folder,name));
  const found=[],budget={files:0,bytes:0};
  for(const root of roots)found.push(...await files(root,since,limits,budget));
  for(const file of found) {
    let id=path.basename(file,'.jsonl'),project=null,repository=null,branch=null,model='unknown',subagent=null,prior=null;
    await lines(file,limits,line=>line.includes('"session_meta"') || line.includes('"turn_context"') || line.includes('"token_count"'),event=>{
      const payload=object(event.payload)?event.payload:{};
      if(event.type==='session_meta') {
        if(typeof payload.id==='string' && payload.id)id=payload.id;
        repository=object(payload.git) && typeof payload.git.repository_url==='string'?payload.git.repository_url:null;
        branch=object(payload.git) && typeof payload.git.branch==='string'?payload.git.branch:null;
        project=projectName(payload.cwd,home,{repository,branch});
        const parent=typeof payload.parent_thread_id==='string' && payload.parent_thread_id?payload.parent_thread_id:null;
        subagent=parent!==null || (object(payload.source) && Object.hasOwn(payload.source,'subagent')) || payload.thread_source==='subagent';
        if(parent)id=parent;
        return;
      }
      if(event.type==='turn_context') {
        model=modelName(payload.model);
        // A new folder that has no safe name is Unknown, not the previous project.
        if(typeof payload.cwd==='string')project=projectName(payload.cwd,home,{repository,branch});
        return;
      }
      if(event.type!=='event_msg' || payload.type!=='token_count' || !object(payload.info))return;
      const total=payload.info.total_token_usage,last=payload.info.last_token_usage;
      if(!object(total))return;
      const running=JSON.stringify(total);
      if(running===prior)return;
      prior=running;
      const at=Date.parse(event.timestamp);
      if(!Number.isFinite(at))throw new Unavailable();
      if(dayKey(at,timeZone)!==today)return;
      const identity=JSON.stringify([event.timestamp,running]);
      if(seen.has(identity))return;
      seen.add(identity);
      // The running total moved but the turn's own usage is missing: that usage is Unknown, not zero.
      if(!object(last)) {if(Object.values(total).some(value=>typeof value==='number' && value>0))throw new Unavailable();return;}
      const input=count(last.input_tokens),cached=count(last.cached_input_tokens),written=count(last.cache_write_input_tokens ?? 0),output=count(last.output_tokens);
      if([input,cached,written,output].includes(null) || input<cached+written)throw new Unavailable();
      // Codex input includes cache reads and writes, and output includes reasoning.
      const values=[input-cached-written,cached,written,output];
      if(values.every(value=>value===0))return;
      result.add({provider:'codex',id:sessionHash('codex',id),project,at,model,values,subagent});
    });
  }
  return result.rows();
}

// Each provider is 'ok' with its sessions, or 'unavailable'. A provider that
// is turned off is left out.
export async function collectProjectTokens({claudeFolder=null,codexFolder=null,now=new Date(),timeZone=TIME_ZONE,home='',limits={}}={}) {
  const options={today:dayKey(now,timeZone),timeZone,since:now.getTime()-WINDOW_MS,home,limits:{...LIMITS,...limits}};
  const read=async(folder,reader)=>{
    if(folder===null)return null;
    try {
      if(!(await fs.promises.stat(folder)).isDirectory())return {status:'unavailable'};
      return {status:'ok',sessions:await reader(folder,options)};
    } catch {return {status:'unavailable'};}
  };
  const [claude,codex]=await Promise.all([read(claudeFolder,readClaude),read(codexFolder,readCodex)]);
  return {date:options.today,timeZone,providers:{...(claude?{claude}:{}),...(codex?{codex}:{})}};
}
