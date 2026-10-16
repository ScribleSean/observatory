import {fstatSync} from 'node:fs';
// Private test controller. Never included in installed packages.
import {spawn} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {isPairingAddress} from './peer-invitation.mjs';

const failed=()=>Error('Fixture controller failed');
const object=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const valid=value=>object(value) && !Object.hasOwn(value,'error');
const number=value=>typeof value==='number' && Number.isFinite(value);
function deadline(promise,ms,onTimeout=()=>{}) {
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>{onTimeout();reject(failed());},ms);})])
    .finally(()=>clearTimeout(timer));
}
export function acceptsPipes({stdin,stdout}={}) {
  return [stdin,stdout].every(info=>Boolean(info && (info.isFIFO() || info.isSocket())));
}
export function parseArguments(args,streams={}) {
  const modeLength=args[0]==='--loopback'?2:4,values=args.slice(0,modeLength);
  let repaired=false,port,pauseAfterHost,pauseBeforeExchange,workerLifetime;
  for(let i=modeLength;i<args.length;i++) {
    if(args[i]==='--repaired' && !repaired)repaired=true;
    else if(args[i]==='--worker-lifetime' && workerLifetime===undefined &&
      typeof args[i+1]==='string' && !/[^0-9]/.test(args[i+1]) && Number(args[i+1])>=60 && Number(args[i+1])<=1200)
      workerLifetime=Number(args[++i]);
    else if(args[i]==='--port' && port===undefined && !/[^0-9]/.test(args[i+1]??'') &&
      Number(args[i+1])>=1024 && Number(args[i+1])<=65535)port=Number(args[++i]);
    else if(args[i]==='--pause-after-host' && pauseAfterHost===undefined &&
      !/[^0-9]/.test(args[i+1]??'') && Number(args[i+1])>=1 && Number(args[i+1])<=120)
      pauseAfterHost=Number(args[++i]);
    else if(args[i]==='--pause-before-exchange' && pauseBeforeExchange===undefined &&
      !/[^0-9]/.test(args[i+1]??'') && Number(args[i+1])>=1 && Number(args[i+1])<=120)
      pauseBeforeExchange=Number(args[++i]);
    else throw failed();
  }
  if((pauseAfterHost??0)+(pauseBeforeExchange??0)>Math.max(0,(workerLifetime??300)-180) || (values[0]==='--loopback' && port!==undefined))throw failed();
  const optionalPort={...(port===undefined?{}:{port}),...(pauseAfterHost===undefined?{}:{pauseAfterHost}),
    ...(pauseBeforeExchange===undefined?{}:{pauseBeforeExchange}),...(workerLifetime===undefined?{}:{workerLifetime})};
  if(values.length===2 && values[0]==='--loopback' && isPairingAddress(values[1]))
    return {address:values[1],repaired,role:null,...optionalPort};
  if(values.length===4 && values[0]==='--role' && ['host','join'].includes(values[1]) &&
    values[2]==='--local' && isPairingAddress(values[3]) && acceptsPipes(streams))
    return {address:values[3],repaired,role:values[1],...optionalPort};
  throw failed();
}

export function createWorkerLink(input,output,{timeoutMs=60000}={}) {
  let buffer=Buffer.alloc(0),pending=null,broken=false,ready=false,count=0,resolveReady,rejectReady,reason=null;
  const readiness=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  readiness.catch(()=>{});
  function fail(cause='worker link closed') {
    reason??=cause==='worker error' || cause==='worker reply timeout'?cause:'worker link closed';
    broken=true;buffer=Buffer.alloc(0);rejectReady(failed());
    if(pending){const current=pending;pending=null;current.reject(failed());}
  }
  input.on('error',fail);output.on('error',fail);
  input.on('end',fail);input.on('close',fail);output.on('close',fail);
  input.on('data',chunk=>{
    if(broken)return;
    buffer=Buffer.concat([buffer,Buffer.from(chunk)]);
    let newline;
    while((newline=buffer.indexOf(10))>=0) {
      if(newline>65536){fail();return;}
      const raw=buffer.subarray(0,newline);buffer=buffer.subarray(newline+1);
      let value;
      try {value=JSON.parse(raw.toString('utf8'));} catch {fail();return;}
      if(!valid(value)){fail(object(value) && Object.hasOwn(value,'error')?'worker error':'worker link closed');return;}
      if(!ready) {
        if(value.ready!==true || Object.hasOwn(value,'id')){fail();return;}
        ready=true;resolveReady(value);
      } else {
        if(!pending || value.id!==pending.id){fail();return;}
        const current=pending;pending=null;current.resolve(value);
      }
    }
    if(buffer.length>65536)fail();
  });
  return {
    failureReason:()=>reason,
    async ready() {
      try {const value=await deadline(readiness,timeoutMs,()=>fail('worker reply timeout'));if(broken)throw failed();return value;}
      catch {fail();throw failed();}
    },
    async send(command) {
      if(broken || !ready || pending || count>=64)throw failed();
      const id=++count;
      const reply=new Promise((resolve,reject)=>{
        pending={id,resolve,reject};
        try {output.write(JSON.stringify({id,command})+'\n');} catch {fail();}
      });
      try {return await deadline(reply,timeoutMs,()=>fail('worker reply timeout'));} catch {fail();throw failed();}
    },
    close() {output.end();},
  };
}

export async function runSequence({host:H,join:J,repaired=false,port,pauseAfterHost,pauseBeforeExchange,sleep:wait=sleep,log=line=>process.stderr.write(line+'\n'),cleanup}) {
  let stopped=null,invitation=null,joinEndpoint=null,probeFailure=null,replyFailure=null,activeStep=null,secondExchanges=0;
  const status=word=>reply=>reply.status===word;
  async function receive(link,operation) {
    try {return await operation();}
    catch {
      const reason=link.failureReason?.();
      if(['worker error','worker link closed','worker reply timeout'].includes(reason))replyFailure=reason;
      throw failed();
    }
  }
  function checkReply(reply,check,link) {
    if(object(reply) && Object.hasOwn(reply,'error'))replyFailure='worker error';
    else if(valid(reply) && check(reply))return;
    else if(['exchange','repeat-exchange','exchange-after-restart'].includes(activeStep)) {
      const status=['merged','waiting','unavailable'].includes(reply?.status)?reply.status:'other';
      const transport=['ok','unavailable','not-configured'].includes(reply?.transport)?reply.transport:'other';
      replyFailure=`${link===H?'hosting':'joining'} side, status ${status}, transport ${transport}`;
      const failure=reply?.failure;
      if(object(failure) && Object.keys(failure).length===2 && Object.hasOwn(failure,'stage') && Object.hasOwn(failure,'code')) {
        const stage=['connect','tls','response','none'].includes(failure.stage)?failure.stage:'other';
        const code=['ETIMEDOUT','ECONNRESET','ECONNREFUSED','EHOSTUNREACH','ENETUNREACH','EPIPE','ECONNABORTED','other','none']
          .includes(failure.code)?failure.code:'other';
        const elapsed=number(reply.elapsedMs) && reply.elapsedMs>=0 && Number.isSafeInteger(Math.round(reply.elapsedMs/1000))?
          Math.round(reply.elapsedMs/1000):'other';
        replyFailure+=`, stage ${stage}, code ${code}, elapsed ${elapsed} s`;
      }
    } else if(['quota-enable','quota-exchange','quota-repeat','quota-disable-host'].includes(activeStep)) {
      const status=['ok','passive','disabled','peer-disabled','unavailable'].includes(reply?.status)?reply.status:'other';
      replyFailure=`${link===H?'hosting':'joining'} side, `+(object(reply) && Object.hasOwn(reply,'status')?`status ${status}, `:'')+
        `peer reading ${typeof reply?.peerRemaining==='number'?'present':'absent'}`;
      const failure=reply?.failure;
      if(object(failure) && Object.keys(failure).length===3 && ['stage','code','request'].every(key=>Object.hasOwn(failure,key))) {
        const stage=['none','connect','tls','response'].includes(failure.stage)?failure.stage:'other';
        const code=['ETIMEDOUT','ECONNRESET','ECONNREFUSED','EHOSTUNREACH','ENETUNREACH','EPIPE','ECONNABORTED','other','none']
          .includes(failure.code)?failure.code:'other';
        const request=['status','exchange'].includes(failure.request)?failure.request:'other';
        const elapsed=number(reply.elapsedMs) && reply.elapsedMs>=0 && Number.isSafeInteger(Math.round(reply.elapsedMs/1000))?
          Math.round(reply.elapsedMs/1000):'other';
        replyFailure+=`, stage ${stage}, code ${code}, request ${request}, elapsed ${elapsed} s`;
      }
    }
    throw failed();
  }
  async function send(link,action,check,extra={}) {
    const command={action,...extra};
    let reply=await receive(link,()=>link.send(command));
    try {checkReply(reply,check,link);}
    catch (error) {
      if(!valid(reply) || !['exchange','repeat-exchange','exchange-after-restart','quota-exchange','quota-repeat','quota-disable-host'].includes(activeStep))throw error;
      log(`step ${activeStep}: second exchange (${link===H?'hosting':'joining'} side, ${replyFailure})`);
      secondExchanges++;
      replyFailure=null;
      reply=await receive(link,()=>link.send(command));
      checkReply(reply,check,link);
    }
    return reply;
  }
  async function both(action,check,links=[H,J]) {for(const link of links)await send(link,action,check);}
  const endpoint=reply=>object(reply.endpoint) && reply.endpoint.kind==='tls' &&
    isPairingAddress(reply.endpoint.address) && Number.isInteger(reply.endpoint.port) && reply.endpoint.port>0 && reply.endpoint.port<=65535;
  const exchange=()=>both('exchange',r=>r.status==='merged' && r.transport==='ok',[J,H]);
  let hostEndpoint=null,peerSamples=null;
  const steps=[
    ['ready',async()=>{for(const link of [H,J]){const reply=await receive(link,()=>link.ready());checkReply(reply,r=>r.ready===true);}}],
    ...(repaired?[['repair',()=>both('repair',r=>['unpaired','prepared'].includes(r.status))]]:[]),
    ['endpoint',async()=>{hostEndpoint=(await send(H,'endpoint',endpoint)).endpoint;joinEndpoint=(await send(J,'endpoint',endpoint)).endpoint;}],
    ['host',async()=>{invitation=(await send(H,'host',r=>typeof r.invitation==='string' && r.invitation.startsWith('observatory-pair:v1:'))).invitation;}],
    ...(pauseAfterHost===undefined?[]:[['pause',async()=>{
      log(`step pause: waiting ${pauseAfterHost} s`);
      await wait(pauseAfterHost*1000);
    }]]),
    ['probe',()=>send(J,'probe',r=>{
      if(['timeout','refused','unavailable'].includes(r.tcp))probeFailure=r.tcp;
      return r.tcp==='connected';
    },{invitation})],
    ['join',async()=>{try {await send(J,'join',status('awaiting-confirmation'),{invitation});} finally {invitation=null;}}],
    ['confirm',()=>send(H,'confirm',status('configuration-ready'),{peerEndpoint:joinEndpoint})],
    ['finish',()=>send(J,'finish',status('acknowledged'))],
    ['acknowledged',()=>send(H,'acknowledged',r=>r.acknowledged===true)],
    ...(port===undefined?[]:[['host-close',()=>send(H,'host-close',status('closed'))]]),
    ['service',()=>both('service',status('sync-listening'))],
    ['publish',()=>both('publish',r=>Number.isInteger(r.sequence) && r.sequence>0)],
    ...(pauseBeforeExchange===undefined?[]:[['pause-exchange',async()=>{
      log(`step pause-exchange: waiting ${pauseBeforeExchange} s`);
      await wait(pauseBeforeExchange*1000);
    }]]),
    ['exchange',exchange],['repeat-exchange',exchange],
    ['restart',async()=>{for(const link of [H,J]){await send(link,'stop-service',status('stopped'));await send(link,'service',status('sync-listening'));}}],
    ['exchange-after-restart',exchange],
    ['quota-enable',()=>both('quota-enable',r=>r.sharing===true && number(r.localRemaining))],
    ['quota-exchange',async()=>{for(const link of [J,H]){const reply=await send(link,'quota-exchange',r=>r.status==='ok' && number(r.peerRemaining) && Number.isInteger(r.peerSamples) && r.peerSamples>=0);if(link===J)peerSamples=reply.peerSamples;}}],
    ['quota-repeat',()=>send(J,'quota-exchange',r=>r.status==='ok' && Number.isInteger(r.peerSamples) && r.peerSamples>=0 && r.peerSamples<=peerSamples)],
    ['quota-disable-host',async()=>{await send(H,'quota-disable',r=>r.sharing===false);await send(J,'quota-exchange',r=>r.peerRemaining===null && number(r.localRemaining));await send(H,'quota-exchange',status('disabled'));}],
    ['revoke',()=>both('revoke',status('revoked'))],
  ];
  try {
    for(const [name,run] of steps) {
      activeStep=name;replyFailure=null;
      try {await run();log(`step ${name}: ok`);}
      catch {stopped=name;log(`step ${name}: failed${replyFailure?` (${replyFailure})`:name==='probe' && probeFailure?` (${probeFailure})`:''}`);break;}
    }
  } finally {
    invitation=null;hostEndpoint=null;joinEndpoint=null;
    try {await cleanup();log('step cleanup: ok');}
    catch {log('step cleanup: failed');stopped??='cleanup';}
  }
  log(`second exchanges used: ${secondExchanges}`);
  log(stopped?`result: stopped at ${stopped}`:'result: passed');
  return stopped===null;
}

export async function cleanupWorkers(workers,{timeoutMs=30000}={}) {
  const closed=workers.map(worker=>{try {worker.close();return true;} catch {return false;}});
  const results=await Promise.allSettled(workers.map(worker=>deadline(worker.exited,timeoutMs)));
  if(closed.includes(false) || results.some(result=>result.status!=='fulfilled' || result.value!==0))throw failed();
}
export function workerArguments(address,port,workerLifetime) {
  const fixturePath=fileURLToPath(new URL('./peer-live-fixture.test.mjs',import.meta.url));
  return [fixturePath,'--live-peer',address,...(port===undefined?[]:['--port',String(port)]),...(workerLifetime===undefined?[]:['--worker-lifetime',String(workerLifetime)])];
}
function localWorker(address,port,workerLifetime) {
  const env={...process.env};
  for(const key of Object.keys(env))if(['NODE_OPTIONS','NODE_PATH','NODE_EXTRA_CA_CERTS'].includes(key.toUpperCase()))delete env[key];
  const child=spawn(process.execPath,workerArguments(address,port,workerLifetime),{stdio:['pipe','pipe','ignore'],env});
  const exited=new Promise(resolve=>{child.once('error',()=>resolve(1));child.once('exit',code=>resolve(code));});
  return {...createWorkerLink(child.stdout,child.stdin),exited};
}
async function main() {
  const options=parseArguments(process.argv.slice(2),{stdin:fstatSync(0),stdout:fstatSync(1)});
  const workers=[];
  let passed=false;
  try {
    const local=localWorker(options.address,options.port,options.workerLifetime);workers.push(local);
    let remote;
    if(options.role) {
      const exited=new Promise(resolve=>{process.stdin.once('end',()=>resolve(0));process.stdin.once('error',()=>resolve(1));process.stdin.once('close',()=>resolve(process.stdin.readableEnded?0:1));});
      remote={...createWorkerLink(process.stdin,process.stdout),exited};
    } else remote=localWorker(options.address,options.port,options.workerLifetime);
    workers.push(remote);
    passed=await runSequence({host:options.role==='join'?remote:local,join:options.role==='join'?local:remote,
      repaired:options.repaired,port:options.port,pauseAfterHost:options.pauseAfterHost,pauseBeforeExchange:options.pauseBeforeExchange,
      cleanup:()=>cleanupWorkers(workers)});
  } catch {
    process.stderr.write('Fixture controller failed.\n');
    try {await cleanupWorkers(workers);} catch {}
  }
  process.exit(passed?0:1);
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(()=>{process.stderr.write('Fixture controller failed.\n');process.exitCode=1;});
