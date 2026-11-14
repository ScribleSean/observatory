// Reads Claude Code transcripts into daily numbers per model for the drift view: how long each reply
// thought, how long it took, how many tokens it wrote, and how many retries and errors there were.
// Only numbers, dates and model names leave this file. Prompts, replies, paths and session names never do.
// Values are kept as small histograms so files and computers can be merged before a median is taken.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {TIME_ZONE} from '../lib/timezone.mjs';
import {writeAtomic} from '../lib/atomic-file.mjs';
import {binOf,EFFORTS,MODEL_NAME} from '../lib/drift.mjs';

export const KEEP_DAYS=45;
export const MAX_FILES=50_000;
export const MAX_TOTAL_BYTES=4*1024*1024*1024;
export const MAX_LINE_BYTES=4*1024*1024;
// A gap longer than this between the request and the reply is the user away, not the model working.
export const MAX_REPLY_SECONDS=30*60;
const CACHE_FILE='model-drift.json';
const CACHE_VERSION=1;

function dayFormatter(timeZone) {
  const format=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});
  return ms=>format.format(ms);
}

function emptyStats() {
  return {replies:0,retries:0,thinking:{},replySeconds:{},outputTokens:{},efforts:{}};
}

function addTo(histogram,value) {
  const bin=binOf(value);
  histogram[bin]=(histogram[bin] ?? 0)+1;
}

function statsFor(days,date,model) {
  const day=days[date] ??= {};
  return day[model] ??= emptyStats();
}

const isoTime=value=>{
  if(typeof value!=='string')return null;
  const ms=Date.parse(value);
  return Number.isFinite(ms)?ms:null;
};

// One transcript's lines, in order, into {date: {model: stats}}. Retry lines name no model, so they
// count against the model the session used last.
// Lines are pushed one at a time, so a file is never held in memory whole.
function driftParser({timeZone=TIME_ZONE}={}) {
  const dayOf=dayFormatter(timeZone);
  const days={};
  const replies=new Map();
  let lastRequestAt=null,lastModel=null;
  const retry=at=>{if(lastModel && at!==null)statsFor(days,dayOf(at),lastModel).retries++;};
  const push=line=>{
    if(line.length>MAX_LINE_BYTES)return;
    const assistant=line.includes('"type":"assistant"'),user=line.includes('"type":"user"'),failed=line.includes('"api_error"');
    if(!assistant && !user && !failed)return;
    let entry;
    try {entry=JSON.parse(line);} catch {return;}
    if(entry===null || typeof entry!=='object')return;
    const at=isoTime(entry.timestamp);
    if(entry.type==='user') {if(at!==null)lastRequestAt=at;return;}
    if(entry.type==='system' && entry.subtype==='api_error') {retry(at);return;}
    if(entry.type!=='assistant' || at===null)return;
    const message=entry.message ?? {};
    if(entry.isApiErrorMessage===true || !MODEL_NAME.test(message.model ?? '')) {
      if(entry.isApiErrorMessage===true)retry(at);
      return;
    }
    lastModel=message.model;
    const id=typeof message.id==='string'?message.id:typeof entry.requestId==='string'?entry.requestId:`line-${replies.size}`;
    let reply=replies.get(id);
    if(!reply) {
      reply={model:message.model,requestAt:lastRequestAt,lastAt:at,output:0,thinkingMs:0,effort:null};
      replies.set(id,reply);
    }
    reply.lastAt=Math.max(reply.lastAt,at);
    const output=message.usage?.output_tokens;
    if(Number.isSafeInteger(output) && output>reply.output)reply.output=output;
    const thinking=entry.thinkingDurationMs;
    if(typeof thinking==='number' && Number.isFinite(thinking) && thinking>reply.thinkingMs)reply.thinkingMs=thinking;
    if(typeof entry.effort==='string')reply.effort=EFFORTS.includes(entry.effort)?entry.effort:'other';
  };
  const finish=()=>{
    for(const reply of replies.values()) {
      const stats=statsFor(days,dayOf(reply.lastAt),reply.model);
      stats.replies++;
      if(reply.output>0)addTo(stats.outputTokens,reply.output);
      if(reply.thinkingMs>0)addTo(stats.thinking,reply.thinkingMs/1000);
      if(reply.requestAt!==null) {
        const seconds=(reply.lastAt-reply.requestAt)/1000;
        if(seconds>=0 && seconds<=MAX_REPLY_SECONDS)addTo(stats.replySeconds,seconds);
      }
      const effort=reply.effort ?? 'unset';
      stats.efforts[effort]=(stats.efforts[effort] ?? 0)+1;
    }
    return days;
  };
  return {push,finish};
}

export function driftFromLines(lines,options) {
  const parser=driftParser(options);
  for(const line of lines)parser.push(line);
  return parser.finish();
}

// Splits a stream into lines and drops any line longer than the cap as it goes, so one huge line is
// never held in memory whole.
export async function* boundedLines(stream,maxBytes=MAX_LINE_BYTES) {
  let pending=[],size=0,skipping=false;
  for await(const chunk of stream) {
    let start=0;
    for(let end=chunk.indexOf(10);end!==-1;end=chunk.indexOf(10,start)) {
      if(!skipping && size+end-start<=maxBytes) {
        pending.push(chunk.subarray(start,end));
        yield Buffer.concat(pending).toString('utf8').replace(/\r$/,'');
      }
      pending=[];size=0;skipping=false;start=end+1;
    }
    if(start<chunk.length && !skipping) {
      size+=chunk.length-start;
      if(size>maxBytes) {pending=[];skipping=true;}
      else pending.push(chunk.subarray(start));
    }
  }
  if(!skipping && pending.length)yield Buffer.concat(pending).toString('utf8');
}

async function driftFromFile(file,options) {
  const parser=driftParser(options);
  for await(const line of boundedLines(fs.createReadStream(file)))parser.push(line);
  return parser.finish();
}

function mergeHistogram(into,from) {
  for(const [bin,count] of Object.entries(from))into[bin]=(into[bin] ?? 0)+count;
}

export function mergeDays(into,from) {
  for(const [date,models] of Object.entries(from))for(const [model,stats] of Object.entries(models)) {
    const target=statsFor(into,date,model);
    target.replies+=stats.replies;
    target.retries+=stats.retries;
    for(const key of ['thinking','replySeconds','outputTokens','efforts'])mergeHistogram(target[key],stats[key]);
  }
  return into;
}

// Sparse histograms become flat [bin, count, bin, count] lists, which carry no free-form keys.
const pairs=histogram=>Object.entries(histogram).map(([bin,count])=>[Number(bin),count]).sort((a,b)=>a[0]-b[0]).flat();

export function driftRow(days,{now=new Date(),timeZone=TIME_ZONE,keepDays=KEEP_DAYS}={}) {
  const first=dayFormatter(timeZone)(now.getTime()-(keepDays-1)*86400000);
  return Object.keys(days).filter(date=>date>=first).sort().map(date=>({date,models:Object.entries(days[date]).sort(([a],[b])=>a.localeCompare(b))
    .map(([model,stats])=>({model,replies:stats.replies,retries:stats.retries,thinking:pairs(stats.thinking),
      replySeconds:pairs(stats.replySeconds),outputTokens:pairs(stats.outputTokens),
      efforts:Object.fromEntries([...EFFORTS,'other','unset'].map(name=>[name,stats.efforts[name] ?? 0]))}))}));
}

async function walk(directory,found) {
  const entries=await fs.promises.readdir(directory,{withFileTypes:true});
  for(const entry of entries) {
    if(entry.isSymbolicLink())continue;
    const full=path.join(directory,entry.name);
    if(entry.isDirectory())await walk(full,found);
    else if(entry.isFile() && entry.name.endsWith('.jsonl')) {
      if(found.length>=MAX_FILES)throw Error('too many transcript files');
      found.push(full);
    }
  }
}

const hash=text=>createHash('sha256').update(text).digest('hex').slice(0,32);

async function loadCache(directory,timeZone) {
  if(!directory)return new Map();
  try {
    const body=JSON.parse(await fs.promises.readFile(path.join(directory,CACHE_FILE),'utf8'));
    return body?.version===CACHE_VERSION && body.timeZone===timeZone?new Map(Object.entries(body.files ?? {})):new Map();
  } catch {return new Map();}
}

// One Claude folder (a home's .claude) into {date: {model: stats}}. Each file is read again only when
// its size or modified time changed. The cache keys files by a hash of their relative path.
// Files untouched since before the kept days cannot add to them, so they are skipped. If the rest is
// still over the size cap the result is unavailable rather than silently partial.
export async function collectModelDrift(claudeFolder,{cacheDirectory=null,timeZone=TIME_ZONE,now=new Date(),keepDays=KEEP_DAYS,maxBytes=MAX_TOTAL_BYTES}={}) {
  const projects=path.join(claudeFolder,'projects');
  const info=await fs.promises.lstat(projects).catch(()=>null);
  if(!info)return {status:'not-found',days:{}};
  if(!info.isDirectory())return {status:'unavailable',days:{}};
  const files=[];
  await walk(projects,files);
  const cache=await loadCache(cacheDirectory,timeZone);
  const kept={};
  const days={};
  let bytes=0;
  const oldest=now.getTime()-(keepDays+1)*86400000;
  for(const file of files) {
    const stat=await fs.promises.stat(file).catch(()=>null);
    if(!stat || stat.mtimeMs<oldest)continue;
    bytes+=stat.size;
    if(bytes>maxBytes)return {status:'unavailable',days:{}};
    const key=hash(path.relative(projects,file));
    const old=cache.get(key);
    let fileDays;
    if(old && old.size===stat.size && old.mtimeMs===stat.mtimeMs)fileDays=old.days;
    else fileDays=await driftFromFile(file,{timeZone});
    kept[key]={size:stat.size,mtimeMs:stat.mtimeMs,days:fileDays};
    mergeDays(days,fileDays);
  }
  if(cacheDirectory) {
    // The cache only saves time. The numbers stand without it.
    try {await writeAtomic(path.join(cacheDirectory,CACHE_FILE),JSON.stringify({version:CACHE_VERSION,timeZone,files:kept}));} catch {}
  }
  return {status:'ok',days};
}

// Every Claude folder this computer counts as its own (its home and, on a PC, WSL), merged.
export async function readModelDriftRoots(roots,{cacheFor=async()=>null,read=collectModelDrift,now=new Date()}={}) {
  const days={};
  let any=false;
  for(const root of roots) {
    if(root.unreadable)return {status:'unavailable'};
    if(!root.claudeFolder)continue;
    let cacheDirectory=null;
    try {cacheDirectory=await cacheFor(root);} catch {}
    const result=await read(root.claudeFolder,{cacheDirectory});
    if(result.status==='unavailable')return {status:'unavailable'};
    if(result.status!=='ok')continue;
    any=true;
    mergeDays(days,result.days);
  }
  return any?{status:'ok',days:driftRow(days,{now})}:{status:'not-found'};
}
