import {AsyncLocalStorage} from 'node:async_hooks';
import {spawn as nativeSpawn,execFile as nativeExecFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';

const cycles=new AsyncLocalStorage();

function launch(start,command,args,options,callback) {
  const cycle=cycles.getStore();
  if(cycle?.expired)throw Error('Cycle deadline exceeded');
  // Node's execFile does not forward detached to its internal spawn.
  const grouped=Boolean(cycle && start===nativeSpawn && process.platform!=='win32');
  const child=start(command,args,{...options,...(grouped?{detached:true}:{})},callback);
  if(cycle && child.pid) {
    const entry={child,grouped};
    cycle.children.add(entry);
    child.once('close',()=>{if(!cycle.expired)cycle.children.delete(entry);});
  }
  return child;
}

export function spawn(command,args,options={}) {
  return launch(nativeSpawn,command,args,options);
}
export function execFile(command,args,options={},callback) {
  return launch(nativeExecFile,command,args,options,callback);
}
execFile[promisify.custom]=(command,args,options)=>new Promise((resolve,reject)=>{
  execFile(command,args,options,(error,stdout,stderr)=>error?reject(error):resolve({stdout,stderr}));
});

function stop({child,grouped},signal) {
  try {
    if(process.platform==='win32' && child.pid) {
      const killer=nativeSpawn(path.join(process.env.SystemRoot || 'C:/Windows','System32/taskkill.exe'),
        ['/PID',String(child.pid),'/T',...(signal==='SIGKILL'?['/F']:[])],{stdio:'ignore',windowsHide:true});
      killer.on('error',()=>{try {child.kill(signal);}catch {}});
    } else if(grouped)process.kill(-child.pid,signal);
    else child.kill(signal);
  } catch {try {child.kill(signal);}catch {}}
}

export function withCycleDeadline(action,{deadlineMs,graceMs=250,onDeadline=()=>process.exit(2)}={}) {
  const cycle={children:new Set(),expired:false};
  return cycles.run(cycle,async()=>{
    const timer=setTimeout(()=>{
      cycle.expired=true;
      for(const entry of cycle.children)stop(entry,'SIGTERM');
      // Keep the escalation alive even if all direct children close during the grace period.
      setTimeout(async()=>{
        const closed=[...cycle.children].map(({child})=>
          child.exitCode!==null||child.signalCode!==null?Promise.resolve():new Promise(resolve=>child.once('close',resolve)));
        for(const entry of cycle.children)stop(entry,'SIGKILL');
        let reapTimer;
        try {
          await Promise.race([Promise.all(closed),new Promise(resolve=>{reapTimer=setTimeout(resolve,250);})]);
        } finally {clearTimeout(reapTimer);}
        onDeadline();
      },graceMs);
    },deadlineMs);
    timer.unref();
    try {return await action();}
    finally {clearTimeout(timer);}
  });
}
