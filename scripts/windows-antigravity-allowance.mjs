import {spawn} from 'node:child_process';
import {lstat,open,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {cleanAntigravityAllowance} from './antigravity-allowance.mjs';

const maximumOutput=65536;
const absolute=value=>typeof value==='string' && /^[A-Za-z]:[\\/]/.test(value) && value.length<=4096 && !/[\0\r\n]/.test(value);
const unavailable=()=>Error('Windows allowance command unavailable');

// Check a regular PE file without executing it. Shell wrappers and links are excluded.
export async function directWindowsExecutable(file) {
  let handle;
  try {
    const info=await lstat(file);
    if(!info.isFile() || info.isSymbolicLink() || info.size<68)return false;
    handle=await open(file,'r');
    const header=Buffer.alloc(64);
    if((await handle.read(header,0,64,0)).bytesRead!==64 || header.readUInt16LE(0)!==0x5a4d)return false;
    const offset=header.readUInt32LE(60);
    if(offset<64 || offset>info.size-4)return false;
    const signature=Buffer.alloc(4);
    return (await handle.read(signature,0,4,offset)).bytesRead===4 && signature.readUInt32LE(0)===0x00004550;
  } catch {return false;}
  finally {await handle?.close();}
}

export async function findWindowsAntigravityExecutable({platform=process.platform,searchPath=process.env.PATH || '',
  inspect=directWindowsExecutable,canonical=realpath}={}) {
  if(platform!=='win32' || typeof searchPath!=='string' || searchPath.length>16384)return null;
  const directories=[...new Set(searchPath.split(';').filter(absolute))].slice(0,32);
  for(const directory of directories) {
    const file=path.win32.join(directory,'agy.exe');
    if(!absolute(file))continue;
    try {
      if(await inspect(file)) {
        const resolved=await canonical(file);
        if(absolute(resolved) && path.win32.basename(resolved).toLowerCase()==='agy.exe')return resolved;
      }
    } catch {}
  }
  return null;
}

// Only the native launcher advertises this paired package capability. This
// value does not enable the provider. The configured Windows gate stays closed.
export async function packagedWindowsAllowanceHelper({capability=process.env.OBSERVATORY_ANTIGRAVITY_HELPER,
  scripts=path.dirname(fileURLToPath(import.meta.url)),inspect=directWindowsExecutable}={}) {
  if(!absolute(capability) || !absolute(scripts) || path.win32.basename(scripts).toLowerCase()!=='scripts' ||
    path.win32.basename(path.win32.dirname(scripts)).toLowerCase()!=='collector')return null;
  const expected=path.win32.resolve(scripts,'../..','WorkspaceObservatory.exe');
  if(path.win32.normalize(capability).toLowerCase()!==expected.toLowerCase())return null;
  try {return await inspect(expected)?expected:null;}catch {return null;}
}

// A native app owns the sole writer. The Node entrypoint owns this read end.
// Dispose after collection so a successful operation cannot keep Node alive.
export function windowsCollectorLease(input,{timeoutMs=2000}={}) {
  const controller=new AbortController();
  let resolveReady,received=false,disposed=false;
  const ready=new Promise(resolve=>{resolveReady=resolve;});
  const abort=()=>{clearTimeout(timer);controller.abort();resolveReady(false);};
  const data=bytes=>{
    if(received || bytes.length!==1 || bytes[0]!==1){abort();return;}
    received=true;clearTimeout(timer);resolveReady(true);
  };
  const timer=setTimeout(abort,timeoutMs);
  input.on('data',data);input.once('end',abort);input.once('close',abort);input.once('error',abort);
  input.resume();
  return {ready,signal:controller.signal,dispose(){
    if(disposed)return;disposed=true;clearTimeout(timer);
    input.removeListener('data',data);input.removeListener('end',abort);input.removeListener('close',abort);input.removeListener('error',abort);
    controller.abort();resolveReady(false);input.destroy();
  }};
}

export function runWindowsAntigravityCommand(executable,{helper,signal,spawnProcess=spawn,timeoutMs=40000,cleanupMs=5000}={}) {
  if(!absolute(executable) || !/\.exe$/i.test(executable) || !absolute(helper) || !/\.exe$/i.test(helper) ||
    (spawnProcess===spawn && process.platform!=='win32') || signal?.aborted ||
    !Number.isInteger(timeoutMs) || timeoutMs<1 || timeoutMs>40000 || !Number.isInteger(cleanupMs) || cleanupMs<1 || cleanupMs>5000)
    return Promise.reject(unavailable());
  return new Promise((resolve,reject)=>{
    let child,settled=false,failed=false,size=0,chunks=[],forceTimer,finishTimer;
    const finish=(error,code)=>{
      if(settled)return;settled=true;
      clearTimeout(timer);clearTimeout(forceTimer);clearTimeout(finishTimer);signal?.removeEventListener('abort',fail);
      child?.stdin?.destroy();child?.stdout?.destroy();
      if(error || failed || code!==0){chunks=[];reject(unavailable());return;}
      try {const output=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));chunks=[];resolve(output);}
      catch {chunks=[];reject(unavailable());}
    };
    const fail=()=>{
      if(settled)return;
      // Close only our lease. The helper performs the owned job cleanup.
      child?.stdin?.end();
      if(failed)return;failed=true;chunks=[];clearTimeout(timer);
      forceTimer=setTimeout(()=>{
        try {if(child && child.exitCode===null)child.kill();}catch {}
        finishTimer=setTimeout(()=>{child?.unref();finish(true);},1000);
      },cleanupMs);
    };
    const timer=setTimeout(fail,timeoutMs);
    signal?.addEventListener('abort',fail,{once:true});
    try {child=spawnProcess(helper,['--antigravity-usage',executable],{windowsHide:true,shell:false,stdio:['pipe','pipe','ignore']});}
    catch {finish(true);return;}
    child.once('error',()=>{if(child.pid)fail();else finish(true);});
    child.once('close',code=>finish(false,code));
    child.stdin.on('error',fail);child.stdout.on('error',fail);
    child.stdout.on('data',bytes=>{
      if(settled || failed)return;
      size+=bytes.length;
      if(size>maximumOutput){fail();return;}
      chunks.push(bytes);
    });
    if(signal?.aborted){fail();return;}
    // Do not call end here. EOF is cancellation, including collector death.
    child.stdin.write(Buffer.from([1]),error=>{if(error)fail();});
  });
}

export async function readWindowsAntigravityAllowance({executable,helper,checkedAt=new Date().toISOString(),signal,
  run=runWindowsAntigravityCommand}={}) {
  const failed={...cleanAntigravityAllowance(null,'Windows',checkedAt),status:'unavailable'};
  if(signal?.aborted)return failed;
  let output;
  try {output=await run(executable,{helper,signal});}catch {return failed;}
  if(signal?.aborted || typeof output!=='string' || Buffer.byteLength(output)>maximumOutput)return failed;
  let raw;
  try {raw=JSON.parse(output);}catch {return cleanAntigravityAllowance(null,'Windows',checkedAt);}
  return cleanAntigravityAllowance(raw,'Windows',checkedAt);
}
