// Grok usage from files on this computer only. Nothing here opens a network connection.
// - grok.appFolder: the Grok Bot app's data folder. The app caches its own weekly usage reading there
//   (percent used, next reset, plan) and says how long that reading stays good.
// - grok.requestLog: a JSON-lines file with one line per request and an ISO time in `at`. Only the
//   count per day is kept; the rest of each line is never copied.
import {lstat,open,readdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {ENGINE_OFF_MS} from '../lib/freshness.mjs';

const CACHE_FOLDER='sand-client-persistence';
const WEEKLY_SLICE='.weekly-usage.cache';
const WEEK_MINUTES=7*24*60;
const MAX_CACHE_BYTES=65536;
const MAX_LOG_BYTES=4*1024*1024;
const LOG_DAYS=14;
const MAX_FILES=2000;

export const notConnected=()=>({status:'not-connected',provider:'Grok',scope:'account',windows:[]});

// The app names each cached slice by its key, lowercase base32 without padding.
export function sliceName(file) {
  const stem=file.replace(/\.blob$/,'');
  if(stem===file || !/^[a-z2-7]{1,1000}$/.test(stem))return null;
  const alphabet='abcdefghijklmnopqrstuvwxyz234567';
  let bits=0,value=0;
  const bytes=[];
  for(const char of stem) {
    value=(value<<5)|alphabet.indexOf(char);bits+=5;
    if(bits>=8) {bytes.push((value>>>(bits-8))&255);bits-=8;}
  }
  return Buffer.from(bytes).toString('utf8');
}

const finite=value=>typeof value==='number' && Number.isFinite(value);
const plan=value=>{
  const name=typeof value==='string'?value.trim().toLowerCase():'';
  return /^[a-z][a-z0-9 _-]{0,31}$/.test(name)?name:null;
};

/** One cached weekly reading, cleaned to what the dashboard shows, or null when it is not one. */
export function cleanWeeklyUsage(raw) {
  const value=raw?.value;
  if(raw?.schemaVersion!==2 || value?.kind!=='present')return null;
  const usage=value.reading?.usage,readAt=value.reading?.readAtMs;
  if(!usage || !finite(readAt) || readAt<=0 || readAt>=8640000000000)return null;
  const checkedAt=new Date(readAt).toISOString();
  // The app's own expiry, but never longer than an engine may go unread.
  const expires=finite(value.expiresAtMs)?Math.min(value.expiresAtMs,readAt+ENGINE_OFF_MS):readAt;
  const windows=[];
  if(usage.hasNonZeroIncludedLimit===true && finite(usage.percentUsed) && usage.percentUsed>=0 && usage.percentUsed<=100) {
    const reset=finite(usage.nextResetMs) && usage.nextResetMs>0 && usage.nextResetMs<8640000000000?new Date(usage.nextResetMs).toISOString():null;
    windows.push({bucket:'grok',window:'weekly',durationMinutes:WEEK_MINUTES,
      remainingPercent:Math.round((100-usage.percentUsed)*10)/10,resetsAt:reset,checkedAt});
  }
  return {checkedAt,validUntil:new Date(Math.max(readAt,expires)).toISOString(),plan:plan(usage.unifiedPlanName),windows};
}

// Opened without following links and checked on the open file, so nothing can be swapped in between.
async function smallFile(file,limit) {
  // Non-blocking, so a named pipe planted under a matching name cannot stall collection.
  const handle=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW ?? 0)|(constants.O_NONBLOCK ?? 0));
  try {
    const info=await handle.stat();
    if(!info.isFile() || info.size>limit)return null;
    return await handle.readFile('utf8');
  } finally {await handle.close();}
}

/** The newest weekly reading in the app's cache folder, or null. */
export async function readWeeklyUsage(appFolder) {
  const folder=path.join(appFolder,CACHE_FOLDER);
  if(!(await lstat(folder)).isDirectory())return null;
  const names=(await readdir(folder)).filter(name=>sliceName(name)?.endsWith(WEEKLY_SLICE)).slice(0,MAX_FILES);
  let best=null;
  for(const name of names) {
    try {
      const text=await smallFile(path.join(folder,name),MAX_CACHE_BYTES);
      const reading=text===null?null:cleanWeeklyUsage(JSON.parse(text));
      if(reading && (!best || reading.checkedAt>best.checkedAt))best=reading;
    } catch {}
  }
  return best;
}

/** Requests per local day over the last two weeks, from JSON lines with an `at` time; null when no line has one. */
export function countRequests(text,{now=Date.now(),timeZone}) {
  const day=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});
  const from=now-LOG_DAYS*24*3600000;
  const counts=new Map();
  let lines=0,timed=0;
  for(const line of text.split('\n')) {
    if(!line.trim())continue;
    lines++;
    let at;
    try {at=Date.parse(JSON.parse(line)?.at);}catch {continue;}
    if(!Number.isFinite(at))continue;
    timed++;
    if(at<from || at>now)continue;
    const date=day.format(at);
    counts.set(date,(counts.get(date)??0)+1);
  }
  // A log with lines but no times in them is the wrong file or format: no count, not zero.
  if(lines && !timed)return null;
  return [...counts].sort(([a],[b])=>a.localeCompare(b)).map(([date,count])=>({date,count}));
}

// The end of the log only: old lines are outside the two weeks anyway.
async function logTail(file) {
  const info=await lstat(file);
  if(!info.isFile())return null;
  // No following a link swapped in after the check.
  const handle=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW ?? 0)|(constants.O_NONBLOCK ?? 0));
  try {
    if(!(await handle.stat()).isFile())return null;
    const length=Math.min(info.size,MAX_LOG_BYTES);
    const buffer=Buffer.alloc(length);
    const {bytesRead}=await handle.read(buffer,0,length,info.size-length);
    const text=buffer.subarray(0,bytesRead).toString('utf8');
    return length<info.size?text.slice(text.indexOf('\n')+1):text;
  } finally {await handle.close();}
}

export async function readGrokUsage({appFolder=null,requestLog=null,now=Date.now(),timeZone}={}) {
  // Nothing to read means no Grok tile at all.
  if(!appFolder && !requestLog)return notConnected();
  const reading=appFolder?await readWeeklyUsage(appFolder).catch(()=>null):null;
  let days=null;
  if(requestLog) {
    // A log that is missing or unreadable gives no count, never a made-up zero.
    try {const text=await logTail(requestLog);days=text===null?null:countRequests(text,{now,timeZone});}
    catch {days=null;}
  }
  const requests=days?{requests:{timeZone,checkedAt:new Date(now).toISOString(),days}}:{};
  // Past the app's own expiry a limit reading gives way to a live log; with no log it stays,
  // reading as Unknown until it is a day old and as Off after that.
  const old=reading && now-Date.parse(reading.checkedAt)>=ENGINE_OFF_MS;
  const expired=reading && Date.parse(reading.validUntil)<=now;
  if(old && !days)return {status:'stale',provider:'Grok',scope:'account',checkedAt:reading.checkedAt,windows:[]};
  if(reading && !old && !(expired && days))return {status:'ok',provider:'Grok',scope:'account',...reading,...requests};
  // A request log alone still counts: no limit, just the requests.
  if(days)return {status:'ok',provider:'Grok',scope:'account',checkedAt:new Date(now).toISOString(),windows:[],...requests};
  return {status:'unavailable',provider:'Grok',scope:'account',windows:[]};
}
