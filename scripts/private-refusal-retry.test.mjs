import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,mkdir,writeFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {PRIVATE_PATH_REFUSAL,privateRefusalBudget} from './peer-directory.mjs';
import {readQuotaState} from './quota-store.mjs';

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

test('quota status succeeds during continuous synthetic journal churn',darwinOnly,async t=>{
  const runtime=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-private-churn-')));
  let churnDone;
  try {
    const python=await fixturePython(t,runtime);
    if(!python)return;
    await readQuotaState(runtime,Date.now());
    for(let run=0;run<3;run++) {
      const churn=spawn(process.execPath,['--input-type=module','-e',`
import {writeFileSync,unlinkSync} from 'node:fs'
import {performance} from 'node:perf_hooks'
const journal=process.argv[1]
const until=performance.now()+400
let changes=0
while(performance.now()<until) {
  writeFileSync(journal,'',{mode:0o600,flag:'wx'})
  unlinkSync(journal)
  changes++
}
process.stdout.write(String(changes))
`,path.join(runtime,'private-quota/state.sqlite-journal')],{timeout:15000});
      churnDone=collectChild(churn);
      const result=await status('scripts/quota-sharing-control.mjs',runtime,python);
      const writer=await churnDone;
      assert.equal(writer.code,0,writer.stderr);
      assert.equal(writer.signal,null);
      assert.ok(Number(writer.stdout)>0,'The synthetic journal changed during the churn process');
      assert.deepEqual(statusValue(result),quotaStatus,`Status run ${run+1}`);
    }
  } finally {
    try {if(churnDone)await churnDone;}
    finally {await rm(runtime,{recursive:true,force:true});}
  }
});
