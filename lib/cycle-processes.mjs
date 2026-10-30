import {AsyncLocalStorage} from 'node:async_hooks';
import {spawn as nativeSpawn,execFile as nativeExecFile} from 'node:child_process';
import {promisify,getSystemErrorName} from 'node:util';
import path from 'node:path';

const cycles=new AsyncLocalStorage();

function launch(start,command,args,options,callback) {
  const cycle=cycles.getStore();
  if(cycle?.expired)throw Error('Cycle deadline exceeded');
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
export function execFile(command,args,options,callback) {
  if(!cycles.getStore() || process.platform==='win32')return launch(nativeExecFile,command,args,options,callback);
  if(typeof args==='function') {callback=args;args=[];options={};}
  else if(args && !Array.isArray(args)) {callback=options;options=args;args=[];}
  if(typeof options==='function') {callback=options;options={};}
  // execFile ignores detached, so use spawn to create a process group in a POSIX cycle.
  return groupedExecFile(command,args??[],options??{},callback);
}
execFile[promisify.custom]=(...args)=>{
  let child;
  const promise=new Promise((resolve,reject)=>{
    child=execFile(...args,(error,stdout,stderr)=>{
      if(error)reject(Object.assign(error,{stdout,stderr}));
      else resolve({stdout,stderr});
    });
  });
  promise.child=child;
  return promise;
};

function groupedExecFile(command,args,options,callback) {
  const {encoding='utf8',maxBuffer=1024*1024,timeout=0,killSignal='SIGTERM'}=options;
  if(typeof maxBuffer!=='number' || maxBuffer<0)throw Object.assign(new RangeError('Invalid maxBuffer'),{code:'ERR_OUT_OF_RANGE'});
  if(!Number.isInteger(timeout) || timeout<0)throw Object.assign(new RangeError('Invalid timeout'),{code:'ERR_OUT_OF_RANGE'});
  // Handle the timer here so streams close on timeout even when a descendant
  // still holds the pipes open. Spawn validates killSignal.
  const child=launch(nativeSpawn,command,args,{
    cwd:options.cwd,env:options.env,gid:options.gid,uid:options.uid,
    shell:options.shell,signal:options.signal,killSignal,
  });
  const output={stdout:[],stderr:[]};
  let error,finished=false,timer;
  const kill=()=>{
    child.stdout.destroy();
    child.stderr.destroy();
    try {child.kill(killSignal);}catch(cause) {error=cause;finish();}
  };
  const finish=(code,signal)=>{
    if(finished)return;
    finished=true;
    clearTimeout(timer);
    const merge=name=>child[name].readableEncoding?output[name].join(''):Buffer.concat(output[name]);
    const stdout=merge('stdout'),stderr=merge('stderr');
    const cmd=[command,...args].join(' ');
    if(!error && (code!==0 || signal!==null))error=Object.assign(Error(`Command failed: ${cmd}\n${stderr}`),{
      code:code<0?getSystemErrorName(code):code,killed:child.killed,signal,
    });
    if(error)error.cmd=cmd;
    callback?.(error??null,stdout,stderr);
  };
  for(const name of ['stdout','stderr']) {
    const stream=child[name];
    if(encoding!=='buffer' && Buffer.isEncoding(encoding))stream.setEncoding(encoding);
    let length=0;
    stream.on('data',chunk=>{
      const size=stream.readableEncoding?Buffer.byteLength(chunk,stream.readableEncoding):chunk.length;
      const remaining=maxBuffer-length;
      length+=size;
      if(length>maxBuffer) {
        output[name].push(chunk.slice(0,remaining));
        error=Object.assign(new RangeError(`${name} maxBuffer length exceeded`),{code:'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'});
        kill();
      } else output[name].push(chunk);
    });
  }
  child.once('error',cause=>{error=cause;child.stdout.destroy();child.stderr.destroy();finish();});
  child.once('close',finish);
  if(timeout>0)timer=setTimeout(kill,timeout);
  return child;
}

function stop({child,grouped},signal) {
  try {
    if(process.platform==='win32' && child.pid) {
      const killer=nativeSpawn(path.join(process.env.SystemRoot || 'C:/Windows','System32/taskkill.exe'),
        ['/PID',String(child.pid),'/T',...(signal==='SIGKILL'?['/F']:[])],{stdio:'ignore',windowsHide:true});
      killer.on('error',()=>{try {child.kill(signal);}catch {}});
    } else if(grouped) {
      process.kill(-child.pid,signal);
      child.killed=true;
    }
    else child.kill(signal);
  } catch {try {child.kill(signal);}catch {}}
}

export function withCycleDeadline(action,{deadlineMs,graceMs=250,onDeadline=()=>process.exit(2),
  shutdownSignals=[],onShutdown=()=>process.exit(0)}={}) {
  const cycle={children:new Set(),expired:false};
  return cycles.run(cycle,async()=>{
    let graceTimer;
    /** @type {Promise<void>|undefined} */
    let shutdown;
    const stopCycle=done=>{
      cycle.expired=true;
      for(const entry of cycle.children)stop(entry,'SIGTERM');
      // Keep escalation alive even if direct children close during the grace period.
      return new Promise(resolve=>{
        graceTimer=setTimeout(async()=>{
          const closed=[...cycle.children].map(({child})=>
            child.exitCode!==null||child.signalCode!==null?Promise.resolve():new Promise(resolve=>child.once('close',resolve)));
          for(const entry of cycle.children)stop(entry,'SIGKILL');
          let reapTimer;
          try {
            await Promise.race([Promise.all(closed),new Promise(resolve=>{reapTimer=setTimeout(resolve,250);})]);
          } finally {clearTimeout(reapTimer);}
          done();
          resolve();
        },graceMs);
      });
    };
    const timer=setTimeout(()=>{void stopCycle(onDeadline);},deadlineMs);
    timer.unref();
    const onSignal=()=>{
      if(shutdown)return;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      shutdown=stopCycle(onShutdown);
    };
    for(const signal of shutdownSignals)process.on(signal,onSignal);
    try {return await action();}
    finally {
      clearTimeout(timer);
      // A cancelled action can finish during grace. Quit must still kill descendants.
      if(shutdown)await shutdown;
      clearTimeout(graceTimer);
      for(const signal of shutdownSignals)process.off(signal,onSignal);
    }
  });
}
