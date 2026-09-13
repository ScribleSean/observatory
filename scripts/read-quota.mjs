import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import {visibleQuotaBucket} from './quota-buckets.mjs';

export function cleanQuota(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw Error('Invalid quota response');
  const windows = [];
  const buckets = result.rateLimitsByLimitId || (result.rateLimits ? {default:result.rateLimits} : {});
  if(typeof buckets!=='object' || Array.isArray(buckets) || Object.keys(buckets).length>16)throw Error('Invalid quota buckets');
  for (const [id, bucket] of Object.entries(buckets)) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || !visibleQuotaBucket(id)) continue;
    for (const name of ['primary','secondary']) {
      const w = bucket?.[name];
      if (!w || typeof w.usedPercent !== 'number' || !Number.isFinite(w.usedPercent) || w.usedPercent < 0 || w.usedPercent > 100) continue;
      windows.push({bucket:id, window:name, remainingPercent:100-w.usedPercent,
        durationMinutes:Number.isInteger(w.windowDurationMins) && w.windowDurationMins > 0 ? w.windowDurationMins : null,
        resetsAt:Number.isSafeInteger(w.resetsAt) && w.resetsAt > 0 && w.resetsAt < 8640000000000 ? new Date(w.resetsAt * 1000).toISOString() : null});
    }
  }
  return {status:windows.length ? 'ok' : 'unavailable', checkedAt:new Date().toISOString(), provider:'Codex', windows};
}

// Account totals are a separate series from local transcript token counts.
// Missing daily buckets stay missing. They are not evidence of zero usage.
export function cleanAccountUsage(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw Error('Invalid usage response');
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const summary = Object.fromEntries(['lifetimeTokens','peakDailyTokens','longestRunningTurnSec','currentStreakDays','longestStreakDays']
    .map(key => [key,count(result.summary?.[key])]));
  const seconds=result.summary?.longestRunningTurnSec;
  summary.longestRunningTurnSec=typeof seconds==='number' && Number.isFinite(seconds) && seconds>=0 && seconds<=Number.MAX_SAFE_INTEGER?seconds:null;
  const days = new Map();
  if (Array.isArray(result.dailyUsageBuckets)) {
    if (result.dailyUsageBuckets.length > 36600) throw Error('Usage response too large');
    for (const row of result.dailyUsageBuckets) {
      const date = row?.startDate;
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date || count(row.tokens) === null) continue;
      // Duplicate dates replace, never add. Both rows describe the same day.
      days.set(date,{startDate:date,tokens:row.tokens});
    }
  }
  const dailyUsageBuckets = [...days.values()].sort((a,b) => a.startDate.localeCompare(b.startDate));
  return {status:dailyUsageBuckets.length || Object.values(summary).some(value => value !== null) ? 'ok' : 'unavailable',
    checkedAt:new Date().toISOString(),provider:'Codex',scope:'account',summary,dailyUsageBuckets};
}

export const readQuota = executable => withAccountClient(executable,async request=>cleanQuota(await request('account/rateLimits/read')));
export const readAccountUsage = executable => withAccountClient(executable,async request=>cleanAccountUsage(await request('account/usage/read')));

function unavailable(status='unavailable',stage='client') {return Object.assign(Error('Account usage unavailable'),{status,stage});}
function accountScope(result,salt) {
  const account=result?.account;
  if(!account)throw unavailable('needs-auth','identity');
  if(account.type!=='chatgpt')throw unavailable('unsupported','identity');
  const id=typeof account.id==='string' && account.id ? account.id : account.email;
  if(typeof id!=='string' || !id || id.length>1024)throw unavailable('unsupported','identity');
  return createHmac('sha256',Buffer.from(salt,'hex')).update(`codex-account:${id}`).digest('hex');
}

// No raw account fields leave this function. The owner client performs auth.
// Checking the account on both sides prevents mixing readings across a switch.
export function readAccountSnapshot(executable,salt,options={}) {
  if(typeof salt!=='string' || !/^[a-f0-9]{64}$/.test(salt))throw Error('Private account salt required');
  const dailyUsageScope=options.dailyUsageScope ?? null;
  if(dailyUsageScope!==null && (typeof dailyUsageScope!=='string' || !/^[a-f0-9]{64}$/.test(dailyUsageScope)))throw Error('Invalid daily usage scope');
  let observedScope;
  return withAccountClient(executable,async request=>{
    const scope=accountScope(await request('account/read',{refreshToken:false}),salt);
    observedScope=scope;
    const [quota,accountUsage]=await Promise.all([
      request('account/rateLimits/read').then(cleanQuota),
      // A recent daily observation only suppresses a read for the same verified
      // account. An account switch must never reuse the previous daily series.
      scope===dailyUsageScope ? Promise.resolve(null) :
        request('account/usage/read').then(cleanAccountUsage).catch(error=>({status:error.status || 'unavailable',provider:'Codex',scope:'account',dailyUsageBuckets:[]})),
    ]);
    if(accountScope(await request('account/read',{refreshToken:false}),salt)!==scope)throw unavailable('needs-auth');
    return {scope,...quota,...(accountUsage?{accountUsage}:{})};
  },options).catch(error=>{
    // A later request or process-close failure must not hide an account change
    // already observed by the owner client. Only its opaque key leaves here.
    throw Object.assign(unavailable(error.status,error.stage),observedScope?{scope:observedScope}:{});
  });
}

async function withAccountClient(executable,action,{timeoutMs=15000,spawnProcess=spawn}={}) {
  if(!Number.isInteger(timeoutMs) || timeoutMs<1 || timeoutMs>60000)throw Error('Invalid account read timeout');
  const launchFailure=error=>unavailable('unavailable',
    ['EACCES','EPERM'].includes(error?.code)?'launch-permission-denied':error?.code==='ENOENT'?'launch-not-found':'launch');
  let child;
  try {child=spawnProcess(executable,['app-server'],{windowsHide:true,stdio:['pipe','pipe','ignore']});}
  catch(error) {throw launchFailure(error);}
  let buffer='',sequence=0,closed=false,failure=null;
  const pending=new Map();
  const fail=error=>{failure=error;for(const item of pending.values())item.reject(unavailable(error.status,
    error.stage.startsWith('launch')?error.stage:item.method));pending.clear();};
  const closedPromise=new Promise(resolve=>child.once('close',()=>{closed=true;fail(unavailable());resolve();}));
  child.once('error',error=>fail(launchFailure(error)));
  child.stdin.on('error',()=>fail(unavailable()));
  child.stdout.setEncoding('utf8');
  child.stdout.on('data',bytes=>{
    buffer+=bytes;
    if(Buffer.byteLength(buffer)>1_000_000) {fail(unavailable());child.kill();return;}
    let end;
    while((end=buffer.indexOf('\n'))>=0) {
      const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
      let row;try{row=JSON.parse(line);}catch{continue;}
      const item=pending.get(row?.id);if(!item)continue;
      pending.delete(row.id);
      if(row.error)item.reject(unavailable(row.error.code===-32601?'unsupported':row.error.code===429?'rate-limited':'unavailable',item.method));
      else item.resolve(row.result);
    }
  });
  const send=value=>child.stdin.write(JSON.stringify(value)+'\n');
  const request=(method,params={})=>new Promise((resolve,reject)=>{
    if(failure || closed) {reject(failure || unavailable());return;}
    const id=++sequence;pending.set(id,{resolve,reject,method});
    try{send({id,method,params});}catch{pending.delete(id);reject(unavailable());}
  });
  const timer=setTimeout(()=>{fail(unavailable());child.kill();},timeoutMs);
  try {
    await request('initialize',{clientInfo:{name:'workspace_observatory',version:'0.1.0'}});
    send({method:'initialized'});
    return await action(request);
  } finally {
    clearTimeout(timer);
    child.stdin.end();
    if(!closed)child.kill();
    let killTimer;
    try {
      await Promise.race([closedPromise,new Promise((resolve,reject)=>{
        killTimer=setTimeout(()=>{if(!closed)child.kill('SIGKILL');reject(Error('Account reader did not close'));},2000);
      })]);
    } finally {clearTimeout(killTimer);}
  }
}
