import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,mkdir,writeFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {PRIVATE_PATH_REFUSAL,privateRefusalBudget} from './peer-directory.mjs';
import {readQuotaState} from './quota-store.mjs';
import {createPairingConfigurations,initializePairing} from './peer-pairing.mjs';
import {quotaSharingControl} from './quota-sharing-control.mjs';
import {providerTokenSharingControl} from './provider-token-sharing-control.mjs';

function budget(options={}) {
  let clock=0;
  const waits=[];
  const retry=privateRefusalBudget({platform:'darwin',now:()=>clock,wait:async ms=>{waits.push(ms);clock+=ms;},...options});
  return {retry,waits};
}
test('Darwin retries the exact refusal and returns the successful result',async()=>{
  const {retry,waits}=budget();
  let calls=0;
  assert.equal(await retry(()=>{if(++calls<3)throw Error(PRIVATE_PATH_REFUSAL);return 'ready';}),'ready');
  assert.equal(calls,3);
  assert.deepEqual(waits,[20,20]);
});
for(const platform of ['win32','linux'])test(`${platform} rethrows the same refusal without waiting`,async()=>{
  const {retry,waits}=budget({platform}),error=Error(PRIVATE_PATH_REFUSAL);
  let calls=0;
  await assert.rejects(retry(()=>{calls++;throw error;}),actual=>actual===error);
  assert.equal(calls,1);
  assert.deepEqual(waits,[]);
});
for(const message of ['Private sync access-control verification failed','Private directory ancestry changed during verification',`${PRIVATE_PATH_REFUSAL} `,'Synthetic failure'])
  test(`does not retry ${message}`,async()=>{
    const {retry,waits}=budget(),error=Error(message);
    let calls=0;
    await assert.rejects(retry(()=>{calls++;throw error;}),actual=>actual===error);
    assert.equal(calls,1);
    assert.deepEqual(waits,[]);
  });
test('the deadline stops retries and preserves the last error',async()=>{
  const {retry,waits}=budget({budgetMs:40});
  const errors=[Error(PRIVATE_PATH_REFUSAL),Error(PRIVATE_PATH_REFUSAL)];
  let calls=0;
  await assert.rejects(retry(()=>{throw errors[calls++];}),actual=>actual===errors[1]);
  assert.equal(calls,2);
  assert.deepEqual(waits,[20,20]);
});
test('a refusal at an expired deadline does not wait',async()=>{
  const {retry,waits}=budget({budgetMs:0}),error=Error(PRIVATE_PATH_REFUSAL);
  await assert.rejects(retry(()=>{throw error;}),actual=>actual===error);
  assert.deepEqual(waits,[]);
});
test('two operations share one deadline',async()=>{
  const {retry,waits}=budget({budgetMs:60});
  let firstCalls=0,secondCalls=0;
  assert.equal(await retry(()=>{if(++firstCalls<3)throw Error(PRIVATE_PATH_REFUSAL);return 'ready';}),'ready');
  const error=Error(PRIVATE_PATH_REFUSAL);
  await assert.rejects(retry(()=>{secondCalls++;throw error;}),actual=>actual===error);
  assert.equal(firstCalls,3);
  assert.equal(secondCalls,1);
  assert.deepEqual(waits,[20,20,20]);
});

const darwinOnly={skip:process.platform!=='darwin'?'Requires the macOS private-path check':false,timeout:120000};
const quotaStatus={version:1,enabled:false,canEnable:false,reason:'pairing-unavailable',token:null};

async function fixturePython(t,runtime) {
  const selected=process.env.OBSERVATORY_PYTHON;
  if(!selected) {t.skip('OBSERVATORY_PYTHON must select a source Python runtime');return null;}
  let python;
  try {
    python=await realpath(selected);
    if(selected.includes('.app/') || python.includes('.app/')) {
      t.skip('A source Python runtime outside an installed app is required');return null;
    }
    const {stdout}=await promisify(execFile)(python,['-I','-B','scripts/private-path-acl.py','--private',runtime],
      {encoding:'utf8',timeout:15000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
    assert.equal(stdout.trim(),'private-path-acl: ok');
  } catch {
    t.skip('The selected Python cannot run private-path-acl.py on a private temporary fixture');return null;
  }
  return python;
}

function collectChild(child) {
  return new Promise((resolve,reject)=>{
    let stdout='',stderr='';
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',chunk=>{stdout+=chunk;});
    child.stderr.on('data',chunk=>{stderr+=chunk;});
    child.on('error',reject);
    child.on('close',(code,signal)=>resolve({code,signal,stdout,stderr}));
  });
}

function status(script,runtime,python) {
  // The preload preserves an explicit OBSERVATORY_PYTHON, including the wrapper.
  const child=spawn(process.execPath,['--import','./native/tests/test-source-runtime.mjs',script,'--runtime',runtime],
    {env:{...process.env,OBSERVATORY_PYTHON:python,PYTHONDONTWRITEBYTECODE:'1',NODE_NO_WARNINGS:'1'},timeout:15000});
  const result=collectChild(child);
  child.stdin.end(JSON.stringify({action:'status'}));
  return result;
}

function statusValue(result) {
  assert.equal(result.code,0,result.stderr);
  assert.equal(result.signal,null);
  return JSON.parse(result.stdout);
}

const shellQuote=value=>`"${value.replace(/[\\"$`]/g,character=>'\\'+character)}"`;
async function refusalWrapper(folder,python,leaf) {
  const counter=path.join(folder,leaf+'.refused');
  const wrapper=path.join(folder,leaf+'-python');
  await writeFile(wrapper,`#!/bin/sh
counter=${shellQuote(counter)}
if [ "$#" -eq 5 ] && [ "$1" = "-I" ] && [ "$2" = "-B" ] && [ "$4" = "--private" ]
then
  if [ "$5" != "\${5%/${leaf}}" ] && [ ! -e "$counter" ]
  then
    touch "$counter"
    exit 1
  fi
fi
exec ${shellQuote(python)} "$@"
`,{mode:0o700});
  return {wrapper,counter};
}

test('status commands recover from one deterministic private-path refusal',darwinOnly,async t=>{
  const runtime=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-private-refusal-')));
  let wrappers;
  try {
    const python=await fixturePython(t,runtime);
    if(!python)return;
    wrappers=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-refusal-wrapper-')));
    await readQuotaState(runtime,Date.now());
    await mkdir(path.join(runtime,'private-sync'),{mode:0o700});
    const expected=statusValue(await status('scripts/sharing-choice.mjs',runtime,python));
    await t.test('quota status retries the injected private-quota refusal',async()=>{
      const {wrapper,counter}=await refusalWrapper(wrappers,python,'private-quota');
      const result=await status('scripts/quota-sharing-control.mjs',runtime,wrapper);
      await access(counter);
      assert.deepEqual(statusValue(result),quotaStatus);
    });
    await t.test('sharing choice retries the injected private-sync refusal',async()=>{
      const {wrapper,counter}=await refusalWrapper(wrappers,python,'private-sync');
      const result=await status('scripts/sharing-choice.mjs',runtime,wrapper);
      await access(counter);
      assert.deepEqual(statusValue(result),expected);
    });
  } finally {
    if(wrappers)await rm(wrappers,{recursive:true,force:true});
    await rm(runtime,{recursive:true,force:true});
  }
});

// Churn uses a neutral file name. A name SQLite uses itself, such as state.sqlite-journal,
// also trips the quota store's own sidecar guard, which is a different refusal.
function startChurn(runtime,milliseconds) {
  const churn=spawn(process.execPath,['--input-type=module','-e',`
import {writeFileSync,unlinkSync} from 'node:fs'
import {performance} from 'node:perf_hooks'
const file=process.argv[1]
const until=performance.now()+Number(process.argv[2])
let changes=0
while(performance.now()<until) {
  writeFileSync(file,'',{mode:0o600,flag:'wx'})
  unlinkSync(file)
  if(++changes===1)process.stderr.write('ready')
}
process.stdout.write(String(changes))
`,path.join(runtime,'private-quota/synthetic-churn.tmp'),String(milliseconds)],{timeout:30000});
  const ready=new Promise((resolve,reject)=>{
    churn.stderr.once('data',resolve);
    churn.once('error',reject);
    churn.once('close',()=>reject(Error('The churn process ended before it started')));
  });
  const done=collectChild(churn);
  return {churn,ready,done};
}

test('quota status succeeds when private-quota churn stops within the retry budget',darwinOnly,async t=>{
  const runtime=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-private-churn-')));
  let current;
  try {
    const python=await fixturePython(t,runtime);
    if(!python)return;
    await readQuotaState(runtime,Date.now());
    for(let run=0;run<3;run++) {
      current=startChurn(runtime,400);
      await current.ready;
      const result=await status('scripts/quota-sharing-control.mjs',runtime,python);
      const writer=await current.done;
      assert.equal(writer.code,0,writer.stderr);
      assert.ok(Number(writer.stdout)>0,'The synthetic file changed during the churn process');
      assert.deepEqual(statusValue(result),quotaStatus,`Status run ${run+1}`);
    }
  } finally {
    try {if(current)await current.done;}
    finally {await rm(runtime,{recursive:true,force:true});}
  }
});

test('quota status gives the right answer or a clean refusal when private-quota churn outlasts the retry budget',darwinOnly,async t=>{
  const runtime=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-private-churn-long-')));
  let current;
  try {
    const python=await fixturePython(t,runtime);
    if(!python)return;
    await readQuotaState(runtime,Date.now());
    current=startChurn(runtime,20000);
    await current.ready;
    const started=performance.now();
    const result=await status('scripts/quota-sharing-control.mjs',runtime,python);
    const elapsed=performance.now()-started;
    // Continuous churn can outlast any bounded retry, and a loaded machine can leave a clean window
    // in which one full check passes. The guarantee is the right answer or a clean refusal after the
    // whole budget, never a wrong answer.
    if(result.code===0) {
      assert.deepEqual(statusValue(result),quotaStatus);
    } else {
      assert.equal(result.code,1);
      assert.equal(result.signal,null);
      assert.equal(result.stdout,'');
      assert.equal(result.stderr.trim(),'Allowance sharing settings could not be verified. Refresh settings before retrying.');
      assert.ok(elapsed>=1000,`The status read gave up after ${Math.round(elapsed)} ms`);
    }
  } finally {
    try {if(current) {current.churn.kill('SIGTERM');await current.done;}}
    finally {await rm(runtime,{recursive:true,force:true});}
  }
});

// Reuse the pairing setup from quota-sharing-control.test.mjs without account observations.
async function pairedRuntime(runtime) {
  await initializePairing(runtime,createPairingConfigurations().Mac);
  await readQuotaState(runtime,Date.now());
}

for(const [name,control] of [['quota',quotaSharingControl],['provider-token',providerTokenSharingControl]]) {
  test(`${name} paired status recovers from a private-sync refusal`,darwinOnly,async t=>{
    const runtime=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-paired-refusal-')));
    let wrappers;
    try {
      const python=await fixturePython(t,runtime);
      if(!python)return;
      await pairedRuntime(runtime);
      wrappers=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-paired-wrapper-')));
      const script=`scripts/${name}-sharing-control.mjs`;
      const expected=statusValue(await status(script,runtime,python));
      assert.notEqual(expected.reason,'pairing-unavailable');
      const {wrapper,counter}=await refusalWrapper(wrappers,python,'private-sync');
      const actual=statusValue(await status(script,runtime,wrapper));
      await access(counter);
      if(name==='provider-token')assert.deepEqual(actual,expected);
      else assert.equal(actual.reason,expected.reason);
    } finally {
      if(wrappers)await rm(wrappers,{recursive:true,force:true});
      await rm(runtime,{recursive:true,force:true});
    }
  });

  test(`${name} status still answers when the budget ends during a pairing retry`,darwinOnly,async t=>{
    const runtime=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-status-expiry-')));
    const originalPython=process.env.OBSERVATORY_PYTHON;
    let wrappers;
    try {
      const python=await fixturePython(t,runtime);
      if(!python)return;
      await pairedRuntime(runtime);
      const expected=await control(runtime);
      wrappers=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-expiry-wrapper-')));
      const {wrapper,counter}=await refusalWrapper(wrappers,python,'private-sync');
      process.env.OBSERVATORY_PYTHON=wrapper;
      // The clock passes the deadline during the only wait, after the pairing read asked for a retry.
      let clock=0;
      const actual=await control(runtime,{action:'status'},Date.now(),{now:()=>clock,wait:async()=>{clock=2000;}});
      await access(counter);
      assert.deepEqual(actual,expected);
    } finally {
      if(originalPython===undefined)delete process.env.OBSERVATORY_PYTHON;
      else process.env.OBSERVATORY_PYTHON=originalPython;
      if(wrappers)await rm(wrappers,{recursive:true,force:true});
      await rm(runtime,{recursive:true,force:true});
    }
  });

  test(`${name} status releases the peer lock during retry wait`,darwinOnly,async t=>{
    const runtime=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-status-lock-')));
    const originalPython=process.env.OBSERVATORY_PYTHON;
    let wrappers;
    try {
      const python=await fixturePython(t,runtime);
      if(!python)return;
      await pairedRuntime(runtime);
      const expected=await control(runtime);
      wrappers=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-lock-wrapper-')));
      const {wrapper,counter}=await refusalWrapper(wrappers,python,'private-sync');
      process.env.OBSERVATORY_PYTHON=wrapper;
      let waits=0,acquired=false;
      const actual=await control(runtime,{action:'status'},Date.now(),{
        now:()=>0,
        wait:async()=>{
          waits++;
          // A separate process cannot inherit the lock's reentrant async context.
          const child=spawn(process.execPath,['--import','./native/tests/test-source-runtime.mjs','--input-type=module','-e',`
import {withPeerStateLock} from './scripts/peer-lock.mjs'
await withPeerStateLock(process.argv[1],async()=>process.stdout.write('acquired'))
`,runtime],{env:{...process.env,OBSERVATORY_PYTHON:python},timeout:15000});
          const result=await collectChild(child);
          acquired=result.code===0 && result.stdout==='acquired';
        }
      });
      await access(counter);
      assert.equal(waits,1);
      assert.equal(acquired,true,'A concurrent process must acquire the peer lock during the retry wait');
      assert.deepEqual(actual,expected);
    } finally {
      if(originalPython===undefined)delete process.env.OBSERVATORY_PYTHON;
      else process.env.OBSERVATORY_PYTHON=originalPython;
      if(wrappers)await rm(wrappers,{recursive:true,force:true});
      await rm(runtime,{recursive:true,force:true});
    }
  });
}
