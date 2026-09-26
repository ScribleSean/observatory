import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {cleanAntigravityAllowance,collectAntigravityAllowance} from './antigravity-allowance.mjs';

const checkedAt='2026-09-25T12:00:00.000Z';
const bucket=(id='gemini',window='5h')=>({id,name:'PRIVATE label',window,remaining_fraction:0.75,
  reset_time:window==='5h'?'2026-09-25T17:00:00Z':'2026-10-02T12:00:00Z'});
const fixture=()=>({status:'SUCCESS',num_turns:0,conversation_id:'PRIVATE session',response:'PRIVATE response',
  usage:{input_tokens:0,output_tokens:0,thinking_tokens:0,cache_read_tokens:0,total_tokens:0},
  command:{name:'usage',data:{description:'PRIVATE description',groups:[
    {name:'PRIVATE group',description:'PRIVATE description',buckets:[bucket(),bucket('gemini','weekly')]}]}}});
const clean=value=>cleanAntigravityAllowance(value,'Mac',checkedAt);
const first=value=>value.command.data.groups[0].buckets[0];
const options={executable:'/synthetic/agy',host:'Mac',checkedAt};

test('projects only validated allowance windows and drops private fields',()=>{
  const result=clean(fixture());
  assert.deepEqual(result,{provider:'antigravity',host:'Mac',status:'ok',checkedAt,scope:'Provider-reported allowance',windows:[
    {bucket:'gemini',window:'5h',remainingPercent:75,durationMinutes:300,resetsAt:'2026-09-25T17:00:00.000Z'},
    {bucket:'gemini',window:'weekly',remainingPercent:75,durationMinutes:10080,resetsAt:'2026-10-02T12:00:00.000Z'}]});
  assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
  assert.equal(cleanAntigravityAllowance(fixture(),'Windows',checkedAt).host,'Windows');
});

test('zero and full remaining allowance are real observations',()=>{
  for(const [fraction,percent] of [[0,0],[1,100],[0.125,12.5]]) {
    const raw=fixture();first(raw).remaining_fraction=fraction;
    const result=clean(raw);
    assert.equal(result.status,'ok');assert.equal(result.windows[0].remainingPercent,percent);
  }
});

test('malformed or unfamiliar command envelopes are unsupported',()=>{
  for(const raw of [null,[],{},'PRIVATE',
    {...fixture(),status:'UNKNOWN'}, {...fixture(),command:{name:'model',data:{groups:[]}}},
    {...fixture(),command:null}, {...fixture(),usage:null}]) {
    assert.equal(clean(raw).status,'unsupported');assert.deepEqual(clean(raw).windows,[]);
  }
  for(const mutate of [raw=>delete raw.command.data.groups,raw=>raw.command.data.groups={},
    raw=>raw.command.data.groups=[null],raw=>raw.command.data.groups[0].buckets={},
    raw=>raw.command.data.groups[0].buckets=[null],raw=>raw.command.data.groups[0].buckets=[]]) {
    const raw=fixture();mutate(raw);assert.equal(clean(raw).status,'unsupported');
  }
});

test('model turns and nonzero or unknown invocation counters never become allowance observations',()=>{
  for(const num_turns of [1,-1,'0',null,undefined])assert.equal(clean({...fixture(),num_turns}).status,'unsupported');
  for(const key of Object.keys(fixture().usage))for(const value of [1,-1,'0',null,NaN]) {
    const raw=fixture();raw.usage[key]=value;assert.equal(clean(raw).status,'unsupported');
  }
  const missing=fixture();delete missing.usage.cache_read_tokens;
  assert.equal(clean(missing).status,'unsupported');
  const extra=fixture();extra.usage.new_counter=0;
  assert.equal(clean(extra).status,'unsupported');
});

test('authentication failures expose neither errors nor response text',()=>{
  const result=clean({...fixture(),status:'ERROR',error:'PRIVATE auth token',response:'PRIVATE account'});
  assert.equal(result.status,'unavailable');assert.deepEqual(result.windows,[]);
  assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
});

test('empty model configuration is unavailable rather than a zero quota',()=>{
  const raw=fixture();raw.command.data.groups=[];
  assert.equal(clean(raw).status,'unavailable');assert.deepEqual(clean(raw).windows,[]);
});

test('duplicate bucket windows across groups withhold the entire observation',()=>{
  const raw=fixture();raw.command.data.groups.push({buckets:[bucket()]});
  assert.equal(clean(raw).status,'unsupported');assert.deepEqual(clean(raw).windows,[]);
});

test('unsafe bucket identifiers and unknown window schemas fail closed',()=>{
  for(const id of ['',null,[],{},'PRIVATE email@example.test','../private','a\nb','_private','x'.repeat(121)]) {
    const raw=fixture();first(raw).id=id;assert.equal(clean(raw).status,'unsupported');
  }
  for(const window of ['daily','primary',null,['5h'],{},5]) {
    const raw=fixture();first(raw).window=window;assert.equal(clean(raw).status,'unsupported');
  }
  const valid=fixture();first(valid).id='Gemini_3.5-pro';assert.equal(clean(valid).status,'ok');
});

test('nonfinite, negative, oversized, or coerced fractions are unsupported',()=>{
  for(const remaining_fraction of [NaN,Infinity,-Infinity,-0.01,1.01,'0.5',null,[],{}]) {
    const raw=fixture();first(raw).remaining_fraction=remaining_fraction;
    assert.equal(clean(raw).status,'unsupported');assert.deepEqual(clean(raw).windows,[]);
  }
});

test('reset dates must be valid, future, and consistent with their quota window',()=>{
  for(const reset_time of [null,0,'PRIVATE','2026-02-30T12:00:00Z','2026-09-25',
    '2026-09-25T24:00:00Z','2026-09-25T12:00:00Z','2026-09-25T11:59:59Z',
    '2026-09-25T17:05:00.001Z','2026-10-03T12:00:00Z']) {
    const raw=fixture();first(raw).reset_time=reset_time;assert.equal(clean(raw).status,'unsupported');
  }
  const tolerance=fixture();first(tolerance).reset_time='2026-09-25T17:05:00Z';
  assert.equal(clean(tolerance).status,'ok');
  const offset=fixture();first(offset).reset_time='2026-09-25T13:00:00-04:00';
  assert.equal(clean(offset).windows[0].resetsAt,'2026-09-25T17:00:00.000Z');
});

test('group and total bucket bounds reject incomplete successful results',()=>{
  const tooManyGroups=fixture();tooManyGroups.command.data.groups=Array.from({length:17},(_,n)=>({buckets:[bucket(`pool-${n}`)]}));
  assert.equal(clean(tooManyGroups).status,'unsupported');
  const raw=fixture();raw.command.data.groups=[{buckets:Array.from({length:32},(_,n)=>bucket(`pool-${n}`))}];
  assert.equal(clean(raw).windows.length,32);
  raw.command.data.groups.push({buckets:[bucket('another')]});
  assert.equal(clean(raw).status,'unsupported');
  const oversized=fixture();oversized.command.data.groups[0].buckets=Array.from({length:33},(_,n)=>bucket(`pool-${n}`));
  assert.equal(clean(oversized).status,'unsupported');
});

test('invalid source metadata is rejected without echoing it',()=>{
  for(const [host,time] of [['PRIVATE host',checkedAt],['Mac','PRIVATE date'],['Mac','2026-02-30T12:00:00Z']]) {
    assert.throws(()=>cleanAntigravityAllowance(fixture(),host,time),error=>
      error.message==='Invalid allowance source metadata' && !JSON.stringify(error).includes('PRIVATE'));
  }
});

test('collector invokes only the fixed quota command with bounded execution options',async()=>{
  const calls=[];
  const result=await collectAntigravityAllowance({...options,run:async(...args)=>{calls.push(args);return JSON.stringify(fixture());}});
  assert.equal(result.status,'ok');
  assert.deepEqual(calls,[['/synthetic/agy',['--print','/usage','--print-timeout','20s','--output-format','json'],
    {timeoutMs:25000,maxOutputBytes:65536}]]);
});

test('unconfigured or invalid executables never launch a command',async()=>{
  let calls=0;
  for(const executable of [undefined,null,'','relative/agy','/PRIVATE\npath',{},'/'+ 'x'.repeat(4096)]) {
    const result=await collectAntigravityAllowance({...options,executable,run:async()=>{calls++;throw Error('Must not run');}});
    assert.equal(result.status,[undefined,null,''].includes(executable)?'not-connected':'unavailable');
    assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
  }
  assert.equal(calls,0);
});

test('Windows collection is unsupported until process containment is verified',async()=>{
  const result=await collectAntigravityAllowance({...options,host:'Windows',run:()=>assert.fail('Windows must not launch')});
  assert.equal(result.status,'unsupported');assert.deepEqual(result.windows,[]);
});

test('execution errors including authentication and timeout stay unavailable without retries',async()=>{
  for(const code of ['ETIMEDOUT','EACCES','ENOENT','AUTH_FAILURE']) {
    let calls=0;
    const result=await collectAntigravityAllowance({...options,run:async()=>{
      calls++;throw Object.assign(Error('PRIVATE account and credential'),{code});
    }});
    assert.equal(result.status,'unavailable');assert.equal(calls,1);
    assert.deepEqual(result.windows,[]);assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
  }
});

test('output schema drift and output overflow cannot become successful observations',async()=>{
  for(const [output,status] of [['PRIVATE text report','unsupported'],['{','unsupported'],[null,'unsupported'],
    [{stdout:'PRIVATE'},'unsupported'],[' '.repeat(65537),'unavailable'],['é'.repeat(32769),'unavailable']]) {
    const result=await collectAntigravityAllowance({...options,run:async()=>output});
    assert.equal(result.status,status);assert.deepEqual(result.windows,[]);
    assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
  }
});

// Shell exec preserves the fixture PID and exact Node path, including spaces and quotes.
const nodeLauncher=`#!/bin/sh\n':' //; exec '${process.execPath.replaceAll("'", "'\\''")}' "$0" "$@"`;
async function syntheticExecutable(t,body) {
  const directory=await mkdtemp(path.join(tmpdir(),'observatory-agy-test-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const file=path.join(directory,'client');
  await writeFile(file,`${nodeLauncher}\n${body}\n`,{mode:0o700});
  return {file,directory};
}

test('production runner reads a synthetic executable and discards its stderr',{skip:process.platform==='win32'},async t=>{
  const listenerCounts=['exit','SIGTERM','SIGINT'].map(signal=>process.listenerCount(signal));
  const {file}=await syntheticExecutable(t,`process.stderr.write('PRIVATE');process.stdout.write(${JSON.stringify(JSON.stringify(fixture()))});`);
  const result=await collectAntigravityAllowance({...options,executable:file});
  assert.equal(result.status,'ok');assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
  assert.deepEqual(['exit','SIGTERM','SIGINT'].map(signal=>process.listenerCount(signal)),listenerCounts);
});

test('production runner handles launch failure without exposing paths',{skip:process.platform==='win32'},async()=>{
  const result=await collectAntigravityAllowance({...options,executable:path.join(tmpdir(),'PRIVATE-missing-client')});
  assert.equal(result.status,'unavailable');assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
});

test('production runner rejects failed exits and excessive output',{skip:process.platform==='win32'},async t=>{
  for(const body of ["process.stderr.write('PRIVATE auth');process.exit(1);", "process.stdout.write('x'.repeat(65537));"]) {
    const {file}=await syntheticExecutable(t,body);
    const result=await collectAntigravityAllowance({...options,executable:file});
    assert.equal(result.status,'unavailable');assert.deepEqual(result.windows,[]);
  }
});

test('a hung synthetic client gets normal termination followed by forced process cleanup',{skip:process.platform==='win32'},async t=>{
  const {file,directory}=await syntheticExecutable(t,'');
  const ready=path.join(directory,'ready'),terminated=path.join(directory,'terminated');
  await writeFile(file,`${nodeLauncher}\nconst fs=require('node:fs');
    process.on('SIGTERM',()=>fs.writeFileSync(${JSON.stringify(terminated)},'term'));
    fs.writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>{},1000);\n`,{mode:0o700});
  t.mock.timers.enable({apis:['setTimeout']});
  const pending=collectAntigravityAllowance({...options,executable:file});
  let pid;
  for(let attempt=0;attempt<100;attempt++) {
    try {pid=Number(await readFile(ready,'utf8'));break;}catch {await delay(10);}
  }
  assert.ok(Number.isSafeInteger(pid));
  t.after(()=>{try {process.kill(pid,'SIGKILL');}catch {}});
  t.mock.timers.tick(25000);
  let normalTermination=false;
  for(let attempt=0;attempt<100;attempt++) {
    try {normalTermination=(await readFile(terminated,'utf8'))==='term';break;}catch {await delay(10);}
  }
  assert.equal(normalTermination,true);
  t.mock.timers.tick(2000);
  const result=await pending;
  assert.equal(result.status,'unavailable');
  let alive=true;
  for(let attempt=0;attempt<100;attempt++) {
    try {process.kill(pid,0);await delay(10);}catch {alive=false;break;}
  }
  assert.equal(alive,false);
});

test('a successful synthetic client cannot leave a server descendant running',{skip:process.platform==='win32'},async t=>{
  const {file,directory}=await syntheticExecutable(t,'');
  const childPid=path.join(directory,'child-pid');
  await writeFile(file,`${nodeLauncher}\nconst fs=require('node:fs');
    const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
    fs.writeFileSync(${JSON.stringify(childPid)},String(child.pid));child.unref();
    process.stdout.write(${JSON.stringify(JSON.stringify(fixture()))});\n`,{mode:0o700});
  const result=await collectAntigravityAllowance({...options,executable:file});
  assert.equal(result.status,'ok');
  const pid=Number(await readFile(childPid,'utf8'));
  t.after(()=>{try {process.kill(pid,'SIGKILL');}catch {}});
  let alive=true;
  for(let attempt=0;attempt<100;attempt++) {
    try {process.kill(pid,0);await delay(10);}catch {alive=false;break;}
  }
  assert.equal(alive,false);
});
