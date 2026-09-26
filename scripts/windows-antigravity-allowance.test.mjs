import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtemp,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {directWindowsExecutable,findWindowsAntigravityExecutable,packagedWindowsAllowanceHelper,
  windowsCollectorLease,runWindowsAntigravityCommand,readWindowsAntigravityAllowance} from './windows-antigravity-allowance.mjs';

const helper='C:\\App\\WorkspaceObservatory.exe',executable='C:\\Tools\\agy.exe',checkedAt='2026-09-26T12:00:00Z';
const envelope=()=>({status:'SUCCESS',num_turns:0,usage:{input_tokens:0,output_tokens:0,thinking_tokens:0,cache_read_tokens:0,total_tokens:0},
  response:'PRIVATE',command:{name:'usage',data:{groups:[{name:'PRIVATE',buckets:[{id:'fixture',window:'5h',remaining_fraction:.75,reset_time:'2026-09-26T17:00:00Z'}]}]}}});
function childFixture({output='',code=0,onLease,closeOnEOF=true,hang=false}={}) {
  const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.exitCode=null;child.pid=123;child.kills=0;
  child.finish=value=>{if(child.exitCode!==null)return;child.exitCode=value;child.stdout.end();queueMicrotask(()=>child.emit('close',value));};
  child.kill=()=>{child.kills++;child.finish(1);return true;};child.unref=()=>{};
  child.stdin.on('data',bytes=>{onLease?.(bytes,child);if(!hang)setImmediate(()=>{child.stdout.write(output);child.finish(code);});});
  child.stdin.once('end',()=>{if(closeOnEOF)child.finish(1);});
  return child;
}

test('regular PE discovery rejects text, truncated signatures and linked executables',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'observatory-pe-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const file=path.join(root,'agy.exe'),header=Buffer.alloc(80);header.writeUInt16LE(0x5a4d);header.writeUInt32LE(64,60);header.writeUInt32LE(0x4550,64);
  await writeFile(file,header);assert.equal(await directWindowsExecutable(file),true);
  if(process.platform!=='win32'){const linked=path.join(root,'linked.exe');await symlink(file,linked);assert.equal(await directWindowsExecutable(linked),false);}
  for(const bytes of [Buffer.from('shell wrapper'),Buffer.alloc(80),header.subarray(0,67)]) {
    await writeFile(file,bytes);assert.equal(await directWindowsExecutable(file),false);
  }
  header.writeUInt32LE(0xffffffff,60);await writeFile(file,header);assert.equal(await directWindowsExecutable(file),false);
  assert.equal(await directWindowsExecutable(root),false);
});

test('Windows discovery searches only bounded absolute PATH directories for agy.exe',async()=>{
  const calls=[];
  const found=await findWindowsAntigravityExecutable({platform:'win32',searchPath:'relative;C:\\One;C:\\One;C:\\Two;C:\\Bad\nPath',
    inspect:async file=>{calls.push(file);return file==='C:\\Two\\agy.exe';},canonical:async file=>file});
  assert.equal(found,'C:\\Two\\agy.exe');assert.deepEqual(calls,['C:\\One\\agy.exe','C:\\Two\\agy.exe']);
  let count=0;
  await findWindowsAntigravityExecutable({platform:'win32',searchPath:Array.from({length:50},(_,i)=>`C:\\Dir${i}`).join(';'),inspect:async()=>{count++;return false;}});
  assert.equal(count,32);
  assert.equal(await findWindowsAntigravityExecutable({platform:'darwin',inspect:()=>assert.fail('Wrong platform discovered')}),null);
});

test('helper capability must name the paired package executable',async()=>{
  const options={scripts:'C:\\App\\Collector\\scripts',inspect:async()=>true};
  assert.equal(await packagedWindowsAllowanceHelper({...options,capability:helper}),helper);
  for(const capability of [undefined,'WorkspaceObservatory.exe','C:\\Other\\WorkspaceObservatory.exe','C:\\App\\other.exe'])
    assert.equal(await packagedWindowsAllowanceHelper({...options,capability}),null);
  assert.equal(await packagedWindowsAllowanceHelper({...options,scripts:'C:\\Source\\scripts',capability:helper}),null);
  assert.equal(await packagedWindowsAllowanceHelper({...options,capability:helper,inspect:async()=>false}),null);
});

test('native owner lease accepts exactly one byte and aborts on EOF or extra input',async()=>{
  for(const ending of ['eof','extra','error']) {
    const input=new PassThrough(),lease=windowsCollectorLease(input);
    input.write(Buffer.from([1]));assert.equal(await lease.ready,true);assert.equal(lease.signal.aborted,false);
    if(ending==='eof')input.end();else if(ending==='extra')input.write(Buffer.from([2]));else input.emit('error',Error('PRIVATE'));
    await new Promise(resolve=>setImmediate(resolve));assert.equal(lease.signal.aborted,true);lease.dispose();assert.equal(input.destroyed,true);
  }
});

test('missing or invalid owner leases fail closed and disposal releases stdin',async()=>{
  for(const bytes of [null,Buffer.from([0]),Buffer.from([1,1])]) {
    const input=new PassThrough(),lease=windowsCollectorLease(input,{timeoutMs:10});
    if(bytes)input.write(bytes);assert.equal(await lease.ready,false);assert.equal(lease.signal.aborted,true);lease.dispose();
  }
  const input=new PassThrough(),lease=windowsCollectorLease(input);input.write(Buffer.from([1]));await lease.ready;lease.dispose();lease.dispose();
  assert.equal(input.destroyed,true);assert.equal(input.listenerCount('data'),0);
});

test('bridge passes fixed argv and holds its lease through exact successful output',async()=>{
  let child;
  const result=await runWindowsAntigravityCommand(executable,{helper,spawnProcess:(file,args,options)=>{
    assert.equal(file,helper);assert.deepEqual(args,['--antigravity-usage',executable]);
    assert.deepEqual(options,{windowsHide:true,shell:false,stdio:['pipe','pipe','ignore']});
    return child=childFixture({output:'{"fixture":true}',onLease:bytes=>assert.deepEqual(bytes,Buffer.from([1]))});
  }});
  assert.equal(result,'{"fixture":true}');assert.equal(child.kills,0);assert.equal(child.stdin.destroyed,true);
});

test('pre-aborted and invalid command requests never spawn',async()=>{
  const abort=new AbortController();abort.abort();
  for(const options of [{signal:abort.signal},{helper:'relative'},{timeoutMs:40001}])
    await assert.rejects(runWindowsAntigravityCommand(executable,{helper,spawnProcess:()=>assert.fail('Must not spawn'),...options}),/unavailable/);
});

test('cancellation closes the lease, waits for exit and discards partial output',async()=>{
  const abort=new AbortController();let child;
  await assert.rejects(runWindowsAntigravityCommand(executable,{helper,signal:abort.signal,spawnProcess:()=>child=childFixture({hang:true,
    onLease:(_bytes,process)=>{process.stdout.write('PRIVATE partial');queueMicrotask(()=>abort.abort());}})}),/unavailable/);
  assert.equal(child.exitCode,1);assert.equal(child.kills,0);
});

test('abort during spawn sends no handshake and closes the new lease',async()=>{
  const abort=new AbortController();let child;
  await assert.rejects(runWindowsAntigravityCommand(executable,{helper,signal:abort.signal,spawnProcess:()=>{
    child=childFixture({hang:true,onLease:()=>assert.fail('Handshake after abort')});abort.abort();return child;
  }}),/unavailable/);
  assert.equal(child.exitCode,1);
});

test('timeout and overflow use bounded helper-only termination when EOF is ignored',async()=>{
  for(const overflow of [false,true]) {
    let child;
    await assert.rejects(runWindowsAntigravityCommand(executable,{helper,timeoutMs:20,cleanupMs:10,spawnProcess:()=>
      child=childFixture({hang:true,closeOnEOF:false,onLease:(_bytes,process)=>{if(overflow)process.stdout.write(Buffer.alloc(65537));}})}),/unavailable/);
    assert.equal(child.kills,1);assert.equal(child.exitCode,1);
  }
});

test('nonzero exit, invalid UTF-8 and spawn errors never return output',async()=>{
  for(const fixture of [{output:'PRIVATE',code:7},{output:Buffer.from([0xff])}])
    await assert.rejects(runWindowsAntigravityCommand(executable,{helper,spawnProcess:()=>childFixture(fixture)}),/unavailable/);
  await assert.rejects(runWindowsAntigravityCommand(executable,{helper,spawnProcess:()=>{throw Error('PRIVATE');}}),error=>!error.message.includes('PRIVATE'));
});

test('Windows output uses the existing zero-model validator and strips private text',async()=>{
  const options={executable,helper,checkedAt};
  const good=await readWindowsAntigravityAllowance({...options,run:async()=>JSON.stringify(envelope())});
  assert.equal(good.host,'Windows');assert.equal(good.status,'ok');assert.equal(good.windows[0].remainingPercent,75);
  assert.equal(JSON.stringify(good).includes('PRIVATE'),false);
  for(const mutate of [raw=>raw.num_turns=1,raw=>raw.usage.total_tokens=1,raw=>raw.command.name='model',raw=>raw.command.data.groups[0].buckets.push(raw.command.data.groups[0].buckets[0])]) {
    const raw=envelope();mutate(raw);const result=await readWindowsAntigravityAllowance({...options,run:async()=>JSON.stringify(raw)});
    assert.equal(result.status,'unsupported');assert.deepEqual(result.windows,[]);
  }
  assert.equal((await readWindowsAntigravityAllowance({...options,run:async()=>'{'})).status,'unsupported');
  assert.equal((await readWindowsAntigravityAllowance({...options,run:async()=>{throw Error('PRIVATE auth');}})).status,'unavailable');
});
