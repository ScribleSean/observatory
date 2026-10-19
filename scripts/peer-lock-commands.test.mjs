import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {peerLockWaitMs} from './peer-lock.mjs';
import {testRuntimeBase} from './test-runtime-base.mjs';
import {createPairingConfigurations,initializePairing} from './peer-pairing.mjs';

const runtimeBase=await testRuntimeBase('peer-lock-commands');
after(()=>rm(runtimeBase,{recursive:true,force:true}));
const env={...process.env,NODE_NO_WARNINGS:'1'};
/** @type {Array<[string, {action?: string, enabled?: boolean, version?: number, record?: null, pairing?: null, pairId?: string, deviceId?: string} | null, string | null]>} */
const cases=[
  ['sharing-choice',{action:'status'},null],
  ['sharing-choice',{action:'choose',enabled:false},'Sharing choice unavailable.\n'],
  ['quota-sharing-control',{action:'status'},'Allowance sharing settings could not be verified. Refresh settings before retrying.\n'],
  ['provider-token-sharing-control',{action:'status'},'Provider sharing settings could not be verified. Refresh settings before retrying.\n'],
  ['peer-exchange',{version:1,record:null},'Private peer exchange unavailable\n'],
  ['quota-exchange',{version:1,action:'exchange',pairId:'synthetic-pair',deviceId:'synthetic-device',record:null},'Private allowance exchange unavailable\n'],
  ['peer-setup-endpoint',{version:1,pairing:null},'Private pairing setup unavailable\n'],
  ['peer-repair',null,'Pairing repair could not be verified. Retained state was not deleted. Inspect this installation before retrying.\n'],
  ['peer-revocation',null,'Private pairing revocation could not be verified\n']
];

const commandOptions={
  'peer-exchange':{args:runtime=>[runtime],outerDeadlineMs:30000},
  'quota-exchange':{args:runtime=>[runtime],outerDeadlineMs:30000},
  'peer-setup-endpoint':{args:runtime=>[runtime],outerDeadlineMs:30000},
  'peer-repair':{args:runtime=>['--runtime',runtime,'--confirm-local-retirement']},
  'peer-revocation':{args:runtime=>['--runtime',runtime,'--revoke']}
};

function childProcess(t,args) {
  const child=spawn(process.execPath,args,{env,stdio:['pipe','pipe','pipe']});
  const closed=once(child,'close');
  t.after(async()=>{
    if(child.exitCode===null && child.signalCode===null)child.kill('SIGKILL');
    await closed;
  });
  let stdout='',stderr='';
  child.stdout.on('data',chunk=>{stdout+=chunk;});
  child.stderr.on('data',chunk=>{stderr+=chunk;});
  return {child,closed,output:()=>({stdout,stderr})};
}

for(const [name,request,message] of cases)test(
  `${name} ${request?.action??'request'} refuses a held lock before its outer deadline`,
  {timeout:process.platform==='win32'?120000:30000},async t=>{
    const runtime=await realpath(await mkdtemp(path.join(runtimeBase,'observatory-command-')));

    await initializePairing(runtime,createPairingConfigurations().Mac);
    const moduleURL=new URL('./peer-lock.mjs',import.meta.url).href;
    const holder=childProcess(t,['--input-type=module','-e',`
      import {withPeerStateLock} from ${JSON.stringify(moduleURL)}
      setInterval(()=>{},1000)
      await withPeerStateLock(process.argv[1],async()=>{
        process.stdout.write('ready')
        await new Promise(()=>{})
      })
    `,runtime]);
    let timer;
    try {
      await Promise.race([
        new Promise(resolve=>{
          holder.child.stdout.on('data',()=>{
            if(holder.output().stdout.includes('ready'))resolve();
          });
        }),
        holder.closed.then(()=>{throw Error(`Lock owner exited: ${holder.output().stderr}`);}),
        new Promise((resolve,reject)=>{
          timer=setTimeout(()=>reject(Error('Lock owner did not become ready')),process.platform==='win32'?60000:10000);
        })
      ]);
    } finally {clearTimeout(timer);}
    t.after(()=>rm(runtime,{recursive:true,force:true}));
    const command=await import(`./${name}.mjs`);
    const options=commandOptions[name];
    const args=options?.args(runtime)??['--runtime',runtime];
    const started=performance.now();
    const run=childProcess(t,[fileURLToPath(new URL(`./${name}.mjs`,import.meta.url)),...args]);
    run.child.stdin.end(request===null?'':JSON.stringify(request));
    const [code,signal]=await run.closed;
    const elapsed=performance.now()-started;
    t.diagnostic(`${name} ${request?.action??'request'} elapsed: ${elapsed.toFixed(0)} ms`);
    assert.equal(signal,null);
    if(message===null) {
      // A status read reports a busy lock as unavailable channels with exit 0, as before.
      assert.equal(code,0,JSON.stringify(run.output()));
      assert.equal(run.output().stderr,'');
      const status=JSON.parse(run.output().stdout);
      assert.equal(status.chosen,false);
      assert.ok(Object.values(status.channels).length>0);
      for(const state of Object.values(status.channels))assert.equal(state,'unavailable');
    } else {
      assert.equal(code,1,JSON.stringify(run.output()));
      assert.equal(run.output().stderr,message);
      assert.equal(run.output().stdout,'');
    }
    assert.equal(holder.child.exitCode,null);
    assert.equal(holder.child.signalCode,null);
    // Even on Mac the held lock must be reached, not an earlier request refusal.
    assert.ok(elapsed>=Math.min(command.peerLockWaitCapMs,process.platform==='win32'?15000:1000));
    const exitMs=command.commandExitMs?.()??options?.outerDeadlineMs??20000;
    assert.ok(elapsed<exitMs,`Command took ${elapsed} ms, bound ${exitMs} ms`);
    if(process.platform==='win32') {
      assert.ok(elapsed>=command.peerLockWaitCapMs);
      assert.ok(elapsed<peerLockWaitMs(),`${name} took ${elapsed} ms, uncapped wait ${peerLockWaitMs()} ms`);
    }
  }
);
