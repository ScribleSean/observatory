import {lstat,mkdir,open,rename,unlink,writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {readClaudeUsage} from './claude-usage-command.mjs';
import {assertPrivateOwner} from '../lib/private-folder.mjs';
import {READING_FRESH_MS} from '../lib/freshness.mjs';

export const CLAUDE_LIMITS_FOLDER='claude-limits';
export const CLAUDE_LIMITS_FILE='limits.json';
const windows={five_hour:300,seven_day:10080};

const isObject=value=>value!==null && typeof value==='object' && !Array.isArray(value);

function cleanWindow(raw,observedAt) {
  if(!isObject(raw))return null;
  const used=raw.used_percentage ?? raw.usedPercentage,resets=raw.resets_at ?? raw.resetsAt;
  if(typeof used!=='number' || !Number.isFinite(used) || used<0 || used>100)return null;
  if(typeof resets!=='number' || !Number.isSafeInteger(Math.round(resets)) || resets<=observedAt || resets>observedAt+8*86400)return null;
  return {usedPercentage:Math.round(used*10)/10,resetsAt:Math.round(resets)};
}

export function extractClaudeLimits(input,now=Date.now()) {
  const observedAt=Math.floor(now/1000);
  if(!isObject(input))return null;
  const record={observedAt,windows:{}};
  for(const name of Object.keys(windows)) {
    const window=cleanWindow(isObject(input.rate_limits)?input.rate_limits[name]:null,observedAt);
    if(window)record.windows[name]={...window,observedAt};
  }
  return Object.keys(record.windows).length?record:null;
}

function cleanStored(raw,now) {
  const seconds=Math.floor(now/1000);
  if(!isObject(raw))return null;
  const record={observedAt:0,windows:{}};
  for(const name of Object.keys(windows)) {
    const stored=isObject(raw.windows)?raw.windows[name]:null;
    if(!isObject(stored) || !Number.isSafeInteger(stored.observedAt) || stored.observedAt<=0 || stored.observedAt>seconds+60)continue;
    const window=cleanWindow(stored,stored.observedAt);
    if(!window)continue;
    record.windows[name]={...window,observedAt:stored.observedAt};
    record.observedAt=Math.max(record.observedAt,stored.observedAt);
  }
  return Object.keys(record.windows).length?record:null;
}

export function mergeClaudeLimits(previous,next,now=Date.now()) {
  const saved=cleanStored(previous,now);
  if(!next)return saved;
  if(!saved)return next;
  const merged={observedAt:Math.max(saved.observedAt,next.observedAt),windows:{}};
  for(const name of Object.keys(windows)) {
    const before=saved.windows[name],after=next.windows[name];
    if(!before || !after) {if(before || after)merged.windows[name]=before ?? after;continue;}
    const samePeriod=Math.abs(before.resetsAt-after.resetsAt)<=120;
    merged.windows[name]=samePeriod && before.usedPercentage>after.usedPercentage ? before : after;
  }
  return merged;
}

const folderOf=runtime=>path.join(runtime,CLAUDE_LIMITS_FOLDER);

async function plainText(file,limit) {
  let handle;
  try {
    const before=await lstat(file);
    if(!before.isFile() || before.isSymbolicLink() || before.nlink>1 || before.size>limit)throw Error('Unsafe Claude limits file');
    handle=await open(file,constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const info=await handle.stat();
    if(!info.isFile() || info.nlink>1 || info.size>limit || info.dev!==before.dev || info.ino!==before.ino)throw Error('Unsafe Claude limits file');
    const buffer=Buffer.alloc(limit+1);
    let size=0;
    while(size<buffer.length) {
      const {bytesRead}=await handle.read(buffer,size,buffer.length-size,null);
      if(!bytesRead)break;
      size+=bytesRead;
    }
    if(size>limit)throw Error('Unsafe Claude limits file');
    return buffer.toString('utf8',0,size);
  } finally {await handle?.close().catch(()=>{});}
}

async function plainFile(file,limit) {
  return JSON.parse(await plainText(file,limit));
}

export async function ensureClaudeLimitsFolder(runtime) {
  if(typeof runtime!=='string' || !path.isAbsolute(runtime))throw Error('Absolute runtime required');
  const folder=folderOf(runtime);
  await mkdir(folder,{recursive:true,mode:0o700});
  const info=await lstat(folder);
  if(!info.isDirectory() || info.isSymbolicLink())throw Error('Unsafe Claude limits folder');
  assertPrivateOwner(info,folder);
  return folder;
}

export async function writeJsonAtomic(file,value) {
  const temporary=path.join(path.dirname(file),`.${path.basename(file)}-${randomUUID()}.tmp`);
  try {await writeFile(temporary,JSON.stringify(value),{flag:'wx',mode:0o600});await rename(temporary,file);}
  finally {await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}

export async function recordClaudeLimits(runtime,input,now=Date.now()) {
  const next=extractClaudeLimits(input,now);
  if(!next)return null;
  const folder=await ensureClaudeLimitsFolder(runtime);
  const file=path.join(folder,CLAUDE_LIMITS_FILE);
  let previous=null;
  try {previous=await plainFile(file,4096);}catch{}
  const merged=mergeClaudeLimits(previous,next,now);
  await writeJsonAtomic(file,merged);
  return merged;
}

const base={provider:'Claude Code',scope:'account'};

export function claudeLimitsSource(stored,{enabled,now=Date.now()}={}) {
  if(!enabled)return {...base,status:'not-connected',windows:[]};
  const record=cleanStored(stored,now);
  const seconds=Math.floor(now/1000);
  if(!record)return {...base,status:'unavailable',windows:[]};
  const live=Object.entries(record.windows).filter(([,window])=>window.resetsAt>seconds);
  if(!live.length)return {...base,status:'unavailable',windows:[]};
  const checked=Math.max(...live.map(([,window])=>window.observedAt));
  return {...base,status:(seconds-checked)*1000<READING_FRESH_MS?'ok':'stale',checkedAt:new Date(checked*1000).toISOString(),
    windows:live.map(([name,window])=>({bucket:'claude',window:name,durationMinutes:windows[name],checkedAt:new Date(window.observedAt*1000).toISOString(),
      remainingPercent:Math.round((100-window.usedPercentage)*10)/10,resetsAt:new Date(window.resetsAt*1000).toISOString()}))};
}

export async function readClaudeLimits(runtime,{now=Date.now(),readUsage=readClaudeUsage,enabled=false}={}) {
  if(enabled!==true)return claudeLimitsSource(null,{enabled:false,now});
  let usageCommand='failed';
  try {
    const result=await readUsage({cwd:path.join(runtime,CLAUDE_LIMITS_FOLDER),now});
    if(isObject(result) && ['read','not-found','failed','timed-out','unrecognized'].includes(result.status)) {
      if(result.status==='read') {
        usageCommand='unrecognized';
        if(isObject(result.usage))usageCommand=await recordClaudeLimits(runtime,{rate_limits:result.usage.rate_limits},now)?'read':'unrecognized';
      } else if(result.usage===null)usageCommand=result.status;
    }
  } catch {usageCommand='failed';}
  let stored=null;
  try {stored=await plainFile(path.join(folderOf(runtime),CLAUDE_LIMITS_FILE),4096);}catch{}
  return {...claudeLimitsSource(stored,{enabled:true,now}),usageCommand};
}

// Keep the timer referenced so pending work cannot let Node exit before the fallback.
export function withinTime(work,milliseconds) {
  let timer;
  const limit=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Timed out')),milliseconds);});
  return Promise.race([Promise.resolve(work),limit]).finally(()=>clearTimeout(timer));
}
