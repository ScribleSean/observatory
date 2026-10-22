import {lstat,mkdir,open,rename,unlink,writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {readClaudeUsage} from './claude-usage-command.mjs';

// Claude Code limits, read by running the installed CLI's usage command for Pro
// and Max subscribers. This module keeps only the two percentages and reset
// times, plus a session cost if an older reading stored one. It never reads a credential, a
// transcript, a working directory or a session identifier.
export const CLAUDE_LIMITS_FOLDER='claude-limits';
export const CLAUDE_LIMITS_FILE='limits.json';
export const CLAUDE_LIMITS_CONSENT_FILE='consent.json';
const windows={five_hour:300,seven_day:10080};
const currentSeconds=10*60;

const isObject=value=>value!==null && typeof value==='object' && !Array.isArray(value);

function cleanWindow(raw,observedAt) {
  if(!isObject(raw))return null;
  const used=raw.used_percentage ?? raw.usedPercentage,resets=raw.resets_at ?? raw.resetsAt;
  if(typeof used!=='number' || !Number.isFinite(used) || used<0 || used>100)return null;
  // A reset more than eight days ahead cannot belong to either window.
  if(typeof resets!=='number' || !Number.isSafeInteger(Math.round(resets)) || resets<=observedAt || resets>observedAt+8*86400)return null;
  return {usedPercentage:Math.round(used*10)/10,resetsAt:Math.round(resets)};
}

function cleanCost(usd,observedAt) {
  if(typeof usd!=='number' || !Number.isFinite(usd) || usd<0 || usd>10000)return null;
  return {usd:Math.round(usd*100)/100,observedAt};
}

// Returns a sanitized record, or null when the input has no usable window or cost.
export function extractClaudeLimits(input,now=Date.now()) {
  const observedAt=Math.floor(now/1000);
  if(!isObject(input))return null;
  const record={observedAt,windows:{}};
  for(const name of Object.keys(windows)) {
    const window=cleanWindow(isObject(input.rate_limits)?input.rate_limits[name]:null,observedAt);
    if(window)record.windows[name]={...window,observedAt};
  }
  const cost=isObject(input.cost)?cleanCost(input.cost.total_cost_usd,observedAt):null;
  if(cost)record.sessionCost=cost;
  return Object.keys(record.windows).length || cost?record:null;
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
  const stored=raw.sessionCost;
  const cost=isObject(stored) && Number.isSafeInteger(stored.observedAt) && stored.observedAt>0 && stored.observedAt<=seconds+60
    ? cleanCost(stored.usd,stored.observedAt) : null;
  if(cost) {record.sessionCost=cost;record.observedAt=Math.max(record.observedAt,cost.observedAt);}
  return Object.keys(record.windows).length || cost?record:null;
}

// Several sessions report the same account. Within one reset period usage
// only rises, so keep the higher reading. A later reset time starts a new period.
export function mergeClaudeLimits(previous,next,now=Date.now()) {
  const saved=cleanStored(previous,now);
  if(!next)return saved;
  if(!saved)return next;
  const merged={observedAt:Math.max(saved.observedAt,next.observedAt),windows:{}};
  for(const name of Object.keys(windows)) {
    const before=saved.windows[name],after=next.windows[name];
    if(!before || !after) {if(before || after)merged.windows[name]=before ?? after;continue;}
    const samePeriod=Math.abs(before.resetsAt-after.resetsAt)<=120;
    // The kept higher value keeps its own observation time, so it shows as of when it was read.
    merged.windows[name]=samePeriod && before.usedPercentage>after.usedPercentage ? before : after;
  }
  const before=saved.sessionCost,after=next.sessionCost;
  const cost=after && (!before || after.observedAt>=before.observedAt)?after:before;
  if(cost)merged.sessionCost=cost;
  return merged;
}

const folderOf=runtime=>path.join(runtime,CLAUDE_LIMITS_FOLDER);

async function readInPlainLimitsFolder(runtime,read,{afterRead}={}) {
  if(typeof runtime!=='string' || !path.isAbsolute(runtime))throw Error('Unsafe Claude limits folder');
  const folder=folderOf(runtime),before=await lstat(folder);
  if(!before.isDirectory() || before.isSymbolicLink())throw Error('Unsafe Claude limits folder');
  const result=await read();
  if(afterRead)await afterRead();
  let after;
  try {after=await lstat(folder);}catch {throw Error('Unsafe Claude limits folder');}
  if(!after.isDirectory() || after.isSymbolicLink() || after.dev!==before.dev || after.ino!==before.ino)throw Error('Unsafe Claude limits folder');
  return result;
}

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

// Count member separators only after JSON.parse has validated the text.
function topLevelMembers(text,allDepths=false) {
  let depth=0,string=false,escaped=false,count=0;
  for(const character of text) {
    if(string) {
      if(escaped)escaped=false;
      else if(character==='\\')escaped=true;
      else if(character==='"')string=false;
    } else if(character==='"')string=true;
    else if(character==='{' || character==='[')depth++;
    else if(character==='}' || character===']')depth--;
    else if(character===':' && (allDepths || depth===1))count++;
  }
  return count;
}

export function parseLimitsConsentMarker(text) {
  try {
    const marker=JSON.parse(text);
    if(!isObject(marker))return false;
    const keys=Object.keys(marker);
    if(keys.length!==2 || !keys.includes('consent') || !keys.includes('givenAt') || topLevelMembers(text)!==keys.length)return false;
    if(marker.consent!==true || typeof marker.givenAt!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(marker.givenAt))return false;
    // Years 0001 to 9999 only, the range a .NET DateTime holds, so both apps read the same marker.
    return !marker.givenAt.startsWith('0000') && new Date(marker.givenAt).toISOString()===marker.givenAt;
  } catch {return false;}
}

export async function ensureClaudeLimitsFolder(runtime) {
  if(typeof runtime!=='string' || !path.isAbsolute(runtime))throw Error('Absolute runtime required');
  const folder=folderOf(runtime);
  await mkdir(folder,{recursive:true,mode:0o700});
  const info=await lstat(folder);
  if(!info.isDirectory() || info.isSymbolicLink())throw Error('Unsafe Claude limits folder');
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

export async function claudeLimitsConsent(runtime,options={}) {
  try {
    return await readInPlainLimitsFolder(runtime,async()=>{
      let consentMarker=false;
      try {
        consentMarker=parseLimitsConsentMarker(await plainText(path.join(folderOf(runtime),CLAUDE_LIMITS_CONSENT_FILE),4096));
      } catch {}
      return {given:consentMarker,consentMarker};
    },options);
  } catch {return {given:false,consentMarker:false};}
}

const base={provider:'Claude Code',scope:'account'};

// The snapshot shape matches the Codex quota source so one view can draw both.
export function claudeLimitsSource(stored,{enabled,now=Date.now()}={}) {
  if(!enabled)return {...base,status:'not-connected',windows:[]};
  const record=cleanStored(stored,now);
  const seconds=Math.floor(now/1000);
  if(!record)return {...base,status:'unavailable',windows:[]};
  const cost=record.sessionCost;
  const sessionCost=cost && seconds-cost.observedAt<currentSeconds
    ? {sessionCost:{usd:cost.usd,observedAt:new Date(cost.observedAt*1000).toISOString()}} : {};
  // A window whose reset time has passed has an unknown value until the next reading.
  const live=Object.entries(record.windows).filter(([,window])=>window.resetsAt>seconds);
  if(!live.length)return {...base,status:'unavailable',windows:[],...sessionCost};
  const checked=Math.max(...live.map(([,window])=>window.observedAt));
  return {...base,...sessionCost,status:seconds-checked<currentSeconds?'ok':'stale',checkedAt:new Date(checked*1000).toISOString(),
    windows:live.map(([name,window])=>({bucket:'claude',window:name,durationMinutes:windows[name],checkedAt:new Date(window.observedAt*1000).toISOString(),
      remainingPercent:Math.round((100-window.usedPercentage)*10)/10,resetsAt:new Date(window.resetsAt*1000).toISOString()}))};
}

// With consent given, each collection also asks the installed CLI for the
// current figures, so limits stay current when no terminal session is open.
// A failed or unexpected command result preserves the older reading.
// The settings file is the consent. A caller that passes enabled skips the old marker check.
export async function readClaudeLimits(runtime,{now=Date.now(),readUsage=readClaudeUsage,enabled:configured}={}) {
  const enabled=typeof configured==='boolean'?configured:(await claudeLimitsConsent(runtime)).given;
  if(!enabled)return claudeLimitsSource(null,{enabled:false,now});
  let usageCommand='failed';
  try {
    const result=await readUsage({cwd:path.join(runtime,CLAUDE_LIMITS_FOLDER),now});
    if(isObject(result) && ['read','not-found','failed','timed-out','unrecognized'].includes(result.status)) {
      if(result.status==='read') {
        // A reading the store cannot use is reported like an output that was not recognized.
        usageCommand='unrecognized';
        if(isObject(result.usage))usageCommand=await recordClaudeLimits(runtime,{rate_limits:result.usage.rate_limits},now)?'read':'unrecognized';
      } else if(result.usage===null)usageCommand=result.status;
    }
  } catch {usageCommand='failed';}
  let stored=null;
  try {stored=await plainFile(path.join(folderOf(runtime),CLAUDE_LIMITS_FILE),4096);}catch{}
  return {...claudeLimitsSource(stored,{enabled:true,now}),usageCommand};
}

export function attachClaudeLimits(result,source) {
  result.data.claudeLimits=source;
  return result;
}

// Rejects when the work has not settled in time, so the caller's fallback runs.
// Keep the timer referenced so pending work cannot let Node exit before the fallback.
export function withinTime(work,milliseconds) {
  let timer;
  const limit=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Timed out')),milliseconds);});
  return Promise.race([Promise.resolve(work),limit]).finally(()=>clearTimeout(timer));
}
