import {lstat,mkdir,readFile,rename,unlink,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {runClaudeUsage} from './claude-usage-command.mjs';

// Claude Code passes rate_limits to a status line command for Pro and Max
// subscribers after the first response of a session. This module keeps only
// the two percentages and reset times. It never reads a credential, a
// transcript, a working directory or a session identifier.
export const CLAUDE_LIMITS_FOLDER='claude-limits';
export const CLAUDE_LIMITS_FILE='limits.json';
export const CLAUDE_STATUSLINE_FILE='statusline.json';
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

// Returns a sanitized record, or null when the input has no usable window.
export function extractClaudeLimits(input,now=Date.now()) {
  const observedAt=Math.floor(now/1000);
  if(!isObject(input) || !isObject(input.rate_limits))return null;
  const record={observedAt,windows:{}};
  for(const name of Object.keys(windows)) {
    const window=cleanWindow(input.rate_limits[name],observedAt);
    if(window)record.windows[name]={...window,observedAt};
  }
  return Object.keys(record.windows).length?record:null;
}

function cleanStored(raw,now) {
  const seconds=Math.floor(now/1000);
  if(!isObject(raw) || !isObject(raw.windows))return null;
  const record={observedAt:0,windows:{}};
  for(const name of Object.keys(windows)) {
    const stored=raw.windows[name];
    if(!isObject(stored) || !Number.isSafeInteger(stored.observedAt) || stored.observedAt<=0 || stored.observedAt>seconds+60)continue;
    const window=cleanWindow(stored,stored.observedAt);
    if(!window)continue;
    record.windows[name]={...window,observedAt:stored.observedAt};
    record.observedAt=Math.max(record.observedAt,stored.observedAt);
  }
  return Object.keys(record.windows).length?record:null;
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
    merged.windows[name]=samePeriod && before.usedPercentage>after.usedPercentage
      ? {...before,observedAt:after.observedAt} : after;
  }
  return merged;
}

const folderOf=runtime=>path.join(runtime,CLAUDE_LIMITS_FOLDER);

async function plainFile(file,limit) {
  const info=await lstat(file);
  if(!info.isFile() || info.isSymbolicLink() || info.size>limit)throw Error('Unsafe Claude limits file');
  return JSON.parse(await readFile(file,'utf8'));
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

export async function claudeStatuslineInstalled(runtime) {
  try {return isObject(await plainFile(path.join(folderOf(runtime),CLAUDE_STATUSLINE_FILE),16384));}
  catch {return false;}
}

const base={provider:'Claude Code',scope:'account'};

// The snapshot shape matches the Codex quota source so one view can draw both.
export function claudeLimitsSource(stored,{enabled,now=Date.now()}={}) {
  if(!enabled)return {...base,status:'not-connected',windows:[]};
  const record=cleanStored(stored,now);
  const seconds=Math.floor(now/1000);
  if(!record)return {...base,status:'unavailable',windows:[]};
  // A window whose reset time has passed has an unknown value until the next reading.
  const live=Object.entries(record.windows).filter(([,window])=>window.resetsAt>seconds);
  if(!live.length)return {...base,status:'unavailable',windows:[]};
  const checked=Math.max(...live.map(([,window])=>window.observedAt));
  return {...base,status:seconds-checked<currentSeconds?'ok':'stale',checkedAt:new Date(checked*1000).toISOString(),
    windows:live.map(([name,window])=>({bucket:'claude',window:name,durationMinutes:windows[name],
      remainingPercent:Math.round((100-window.usedPercentage)*10)/10,resetsAt:new Date(window.resetsAt*1000).toISOString()}))};
}

// With consent given, each collection also asks the installed CLI for the
// current figures, so limits stay current when no terminal session is open.
// A failed or unexpected command result changes nothing.
export async function readClaudeLimits(runtime,{now=Date.now(),readUsage=runClaudeUsage}={}) {
  const enabled=await claudeStatuslineInstalled(runtime);
  if(!enabled)return claudeLimitsSource(null,{enabled:false,now});
  try {
    const usage=await readUsage({cwd:path.join(runtime,CLAUDE_LIMITS_FOLDER),now});
    if(usage)await recordClaudeLimits(runtime,usage,now);
  } catch {}
  let stored=null;
  try {stored=await plainFile(path.join(folderOf(runtime),CLAUDE_LIMITS_FILE),4096);}catch{}
  return claudeLimitsSource(stored,{enabled:true,now});
}

export function attachClaudeLimits(result,source) {
  result.data.claudeLimits=source;
  return result;
}
