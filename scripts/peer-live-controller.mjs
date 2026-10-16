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
function deadline(promise,ms) {
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(failed()),ms);})])
    .finally(()=>clearTimeout(timer));
}
export function acceptsPipes({stdin,stdout}={}) {
  return [stdin,stdout].every(info=>Boolean(info && (info.isFIFO() || info.isSocket())));
}
export function parseArguments(args,streams={}) {
  const modeLength=args[0]==='--loopback'?2:4,values=args.slice(0,modeLength);
  let repaired=false,port,pauseAfterHost,pauseBeforeExchange;
  for(let i=modeLength;i<args.length;i++) {
    if(args[i]==='--repaired' && !repaired)repaired=true;
    else if(args[i]==='--port' && port===undefined && !/[^0-9]/.test(args[i+1]??'') &&
      Number(args[i+1])>=1024 && Number(args[i+1])<=65535)port=Number(args[++i]);
    else if(args[i]==='--pause-after-host' && pauseAfterHost===undefined &&
      !/[^0-9]/.test(args[i+1]??'') && Number(args[i+1])>=1 && Number(args[i+1])<=300)
      pauseAfterHost=Number(args[++i]);
    else if(args[i]==='--pause-before-exchange' && pauseBeforeExchange===undefined &&
      !/[^0-9]/.test(args[i+1]??'') && Number(args[i+1])>=1 && Number(args[i+1])<=300)
      pauseBeforeExchange=Number(args[++i]);
    else throw failed();
  }
  const optionalPort={...(port===undefined?{}:{port}),...(pauseAfterHost===undefined?{}:{pauseAfterHost}),
    ...(pauseBeforeExchange===undefined?{}:{pauseBeforeExchange})};
  if(values.length===2 && values[0]==='--loopback' && isPairingAddress(values[1]))
    return {address:values[1],repaired,role:null,...optionalPort};
  if(values.length===4 && values[0]==='--role' && ['host','join'].includes(values[1]) &&
    values[2]==='--local' && isPairingAddress(values[3]) && acceptsPipes(streams))
    return {address:values[3],repaired,role:values[1],...optionalPort};
  throw failed();
}

export function createWorkerLink(input,output,{timeoutMs=60000}={}) {
  let buffer=Buffer.alloc(0),pending=null,broken=false,ready=false,count=0,resolveReady,rejectReady;
  const readiness=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  readiness.catch(()=>{});
  function fail() {
    broken=true;buffer=Buffer.alloc(0);rejectReady(failed());
    if(pending){const current=pending;pending=null;current.reject(failed());}
  }
  input.on('error',fail);output.on('error',fail);
  input.on('end',fail);input.on('close',fail);
  input.on('data',chunk=>{
    if(broken)return;
    buffer=Buffer.concat([buffer,Buffer.from(chunk)]);
    let newline;
    while((newline=buffer.indexOf(10))>=0) {
      if(newline>65536){fail();return;}
      const raw=buffer.subarray(0,newline);buffer=buffer.subarray(newline+1);
      let value;
      try {value=JSON.parse(raw.toString('utf8'));} catch {fail();return;}
      if(!valid(value)){fail();return;}
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
    async ready() {
      try {const value=await deadline(readiness,timeoutMs);if(broken)throw failed();return value;}
      catch {fail();throw failed();}
    },
    async send(command) {
      if(broken || !ready || pending || count>=64)throw failed();
      const id=++count;
      const reply=new Promise((resolve,reject)=>{
        pending={id,resolve,reject};
        try {output.write(JSON.stringify({id,command})+'\n');} catch {fail();}
      });
      try {return await deadline(reply,timeoutMs);} catch {fail();throw failed();}
    },
    close() {output.end();},
  };
}

export async function runSequence({host:H,join:J,repaired=false,pauseAfterHost,pauseBeforeExchange,sleep:wait=sleep,log=line=>process.stderr.write(line+'\n'),cleanup}) {
  let stopped=null,invitation=null,joinEndpoint=null,probeFailure=null;
  const status=word=>reply=>reply.status===word;
  async function send(link,action,check,extra={}) {
    const reply=await link.send({action,...extra});
    if(!valid(reply) || !check(reply))throw failed();
    return reply;
  }
  async function both(action,check,links=[H,J]) {for(const link of links)await send(link,action,check);}
  const endpoint=reply=>object(reply.endpoint) && reply.endpoint.kind==='tls' &&
    isPairingAddress(reply.endpoint.address) && Number.isInteger(reply.endpoint.port) && reply.endpoint.port>0 && reply.endpoint.port<=65535;
  const exchange=()=>both('exchange',r=>r.status==='merged' && r.transport==='ok',[J,H]);
  let hostEndpoint=null,peerSamples=null;
  const steps=[
    ['ready',async()=>{for(const link of [H,J]){const reply=await link.ready();if(!valid(reply) || reply.ready!==true)throw failed();}}],
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
    ['host-close',()=>send(H,'host-close',status('closed'))],
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
      try {await run();log(`step ${name}: ok`);}
      catch {stopped=name;log(`step ${name}: failed${name==='probe' && probeFailure?` (${probeFailure})`:''}`);break;}
    }
  } finally {
    invitation=null;hostEndpoint=null;joinEndpoint=null;
    try {await cleanup();log('step cleanup: ok');}
    catch {log('step cleanup: failed');stopped??='cleanup';}
  }
  log(stopped?`result: stopped at ${stopped}`:'result: passed');
  return stopped===null;
}

export async function cleanupWorkers(workers,{timeoutMs=30000}={}) {
  const closed=workers.map(worker=>{try {worker.close();return true;} catch {return false;}});
  const results=await Promise.allSettled(workers.map(worker=>deadline(worker.exited,timeoutMs)));
  if(closed.includes(false) || results.some(result=>result.status!=='fulfilled' || result.value!==0))throw failed();
}
export function workerArguments(address,port) {
  const fixturePath=fileURLToPath(new URL('./peer-live-fixture.test.mjs',import.meta.url));
  return [fixturePath,'--live-peer',address,...(port===undefined?[]:['--port',String(port)])];
}
function localWorker(address,port) {
  const env={...process.env};
  for(const key of Object.keys(env))if(['NODE_OPTIONS','NODE_PATH','NODE_EXTRA_CA_CERTS'].includes(key.toUpperCase()))delete env[key];
  const child=spawn(process.execPath,workerArguments(address,port),{stdio:['pipe','pipe','ignore'],env});
  const exited=new Promise(resolve=>{child.once('error',()=>resolve(1));child.once('exit',code=>resolve(code));});
  return {...createWorkerLink(child.stdout,child.stdin),exited};
}
async function main() {
  const options=parseArguments(process.argv.slice(2),{stdin:fstatSync(0),stdout:fstatSync(1)});
  const workers=[];
  let passed=false;
  try {
    const local=localWorker(options.address,options.port);workers.push(local);
    let remote;
    if(options.role) {
      const exited=new Promise(resolve=>{process.stdin.once('end',()=>resolve(0));process.stdin.once('error',()=>resolve(1));process.stdin.once('close',()=>resolve(process.stdin.readableEnded?0:1));});
      remote={...createWorkerLink(process.stdin,process.stdout),exited};
    } else remote=localWorker(options.address,options.port);
    workers.push(remote);
    passed=await runSequence({host:options.role==='join'?remote:local,join:options.role==='join'?local:remote,
      repaired:options.repaired,pauseAfterHost:options.pauseAfterHost,pauseBeforeExchange:options.pauseBeforeExchange,
      cleanup:()=>cleanupWorkers(workers)});
  } catch {
    process.stderr.write('Fixture controller failed.\n');
    try {await cleanupWorkers(workers);} catch {}
  }
  process.exit(passed?0:1);
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(()=>{process.stderr.write('Fixture controller failed.\n');process.exitCode=1;});
