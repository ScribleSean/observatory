import {spawn,execFile} from 'node:child_process';
import path from 'node:path';

const argumentsList=Object.freeze(['--print','/usage','--print-timeout','20s','--output-format','json']);
const limits=Object.freeze({timeoutMs:25000,maxOutputBytes:65536});
const counterNames=['input_tokens','output_tokens','thinking_tokens','cache_read_tokens','total_tokens'];
const windowMinutes=Object.freeze({'5h':300,weekly:10080});
const clockToleranceMs=300000;
const object=value=>value!==null && typeof value==='object' && !Array.isArray(value);

function timestamp(value) {
  if(typeof value!=='string')return null;
  const match=/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if(!match || Number(match[2])>23 || Number(match[3])>59 || Number(match[4])>59)return null;
  const day=Date.parse(match[1]);
  if(!Number.isFinite(day) || new Date(day).toISOString().slice(0,10)!==match[1])return null;
  const time=Date.parse(value);
  return Number.isFinite(time)?time:null;
}

function source(host,checkedAt,status,windows=[]) {
  const time=timestamp(checkedAt);
  if(!['Mac','Windows'].includes(host) || time===null)throw Error('Invalid allowance source metadata');
  return {provider:'antigravity',host,status,checkedAt:new Date(time).toISOString(),scope:'Provider-reported allowance',windows};
}

// These are account allowance observations, not request tokens. Only the
// verified CLI command envelope is accepted. Free-form labels stay private.
export function cleanAntigravityAllowance(raw,host,checkedAt=new Date().toISOString()) {
  const invalid=source(host,checkedAt,'unsupported');
  if(!object(raw))return invalid;
  if(raw.status==='ERROR')return source(host,checkedAt,'unavailable');
  if(raw.status!=='SUCCESS' || raw.num_turns!==0 || !object(raw.usage) ||
    Object.keys(raw.usage).length!==counterNames.length || counterNames.some(key=>raw.usage[key]!==0) ||
    !object(raw.command) || raw.command.name!=='usage' || !object(raw.command.data))return invalid;
  const groups=raw.command.data.groups;
  if(!Array.isArray(groups) || groups.length>16)return invalid;
  if(!groups.length)return source(host,checkedAt,'unavailable');
  const windows=[],seen=new Set(),now=Date.parse(invalid.checkedAt);
  for(const group of groups) {
    if(!object(group) || !Array.isArray(group.buckets) || !group.buckets.length || group.buckets.length>32)return invalid;
    for(const bucket of group.buckets) {
      if(!object(bucket) || typeof bucket.id!=='string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}$/.test(bucket.id) ||
        typeof bucket.window!=='string' || !Object.hasOwn(windowMinutes,bucket.window) || typeof bucket.remaining_fraction!=='number' ||
        !Number.isFinite(bucket.remaining_fraction) || bucket.remaining_fraction<0 || bucket.remaining_fraction>1)return invalid;
      const key=`${bucket.id}:${bucket.window}`,reset=timestamp(bucket.reset_time),durationMinutes=windowMinutes[bucket.window];
      if(seen.has(key) || windows.length>=32 || reset===null || reset<=now ||
        reset>now+durationMinutes*60000+clockToleranceMs)return invalid;
      seen.add(key);
      windows.push({bucket:bucket.id,window:bucket.window,remainingPercent:bucket.remaining_fraction*100,
        durationMinutes,resetsAt:new Date(reset).toISOString()});
    }
  }
  return source(host,checkedAt,'ok',windows.sort((a,b)=>a.bucket.localeCompare(b.bucket) || a.durationMinutes-b.durationMinutes));
}

function runCommand(executable,args,{timeoutMs,maxOutputBytes}) {
  return new Promise((resolve,reject)=>{
    let child,forceTimer,settled=false,failed=false,size=0,chunks=[];
    const stop=force=>{
      if(!child?.pid)return;
      if(process.platform==='win32') {
        // Use the existing Windows collector's process-tree cleanup pattern.
        if(child.exitCode===null && child.signalCode===null)execFile(
          path.join(process.env.SystemRoot || 'C:/Windows','System32/taskkill.exe'),
          ['/PID',String(child.pid),'/T',...(force?['/F']:[])],
          {windowsHide:true,timeout:1000,killSignal:'SIGKILL',maxBuffer:1024},()=>{});
      } else {
        // The child has its own process group, so descendants are also stopped.
        try {process.kill(-child.pid,force?'SIGKILL':'SIGTERM');}catch {}
      }
    };
    const finish=(error,output)=>{
      if(settled)return;
      settled=true;clearTimeout(timer);clearTimeout(forceTimer);chunks=[];
      child?.stdout?.destroy();child?.unref();
      if(error)reject(Error('Allowance command unavailable'));
      else resolve(output);
    };
    const fail=()=>{
      if(settled || failed)return;
      failed=true;chunks=[];clearTimeout(timer);stop(false);
      forceTimer=setTimeout(()=>{stop(true);finish(true);},2000);
    };
    const timer=setTimeout(fail,timeoutMs);
    try {child=spawn(executable,args,{windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','ignore']});}
    catch {finish(true);return;}
    child.once('error',()=>{stop(true);finish(true);});
    child.stdout.once('error',fail);
    child.stdout.on('data',bytes=>{
      if(failed || settled)return;
      size+=bytes.length;
      if(size>maxOutputBytes){fail();return;}
      chunks.push(bytes);
    });
    child.once('close',code=>{
      // A successful CLI exit must not leave a local server descendant running.
      if(process.platform!=='win32')stop(true);
      finish(failed || code!==0,Buffer.concat(chunks).toString('utf8'));
    });
  });
}

// run(executable, args, limits) returns stdout text. Tests supply synthetic
// output through this seam without invoking an authenticated provider client.
export async function collectAntigravityAllowance({executable,host,checkedAt=new Date().toISOString(),run=runCommand}={}) {
  const unavailable=source(host,checkedAt,'unavailable');
  if(executable===undefined || executable===null || executable==='')return source(host,checkedAt,'not-connected');
  if(typeof executable!=='string' || !path.isAbsolute(executable) || executable.length>4096 ||
    ['\0','\r','\n'].some(character=>executable.includes(character)))return unavailable;
  let output;
  try {output=await run(executable,[...argumentsList],{...limits});}
  catch {return unavailable;}
  if(typeof output!=='string')return source(host,checkedAt,'unsupported');
  if(Buffer.byteLength(output)>limits.maxOutputBytes)return unavailable;
  let raw;
  try {raw=JSON.parse(output);}catch {return source(host,checkedAt,'unsupported');}
  return cleanAntigravityAllowance(raw,host,checkedAt);
}
