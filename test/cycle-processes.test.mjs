import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFile as nativeExecFile} from 'node:child_process';
import {promisify} from 'node:util';
import {execFile,withCycleDeadline} from '../lib/cycle-processes.mjs';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';

const helper=new URL('../lib/cycle-processes.mjs',import.meta.url).href;
const alive=pid=>{try {process.kill(pid,0);return true;}catch(error) {if(error.code==='ESRCH')return false;throw error;}};

test('cycle execFile preserves native output and error fields',async()=>{
  const cases=[
    ['encoded output',process.execPath,['-e',"process.stdout.write('héllo');process.stderr.write('error')"],{encoding:'utf16le'}],
    ['buffer output',process.execPath,['-e',"process.stdout.write(Buffer.from([0,255,128]))"],{encoding:null}],
    ['nonzero exit',process.execPath,['-e',"process.stdout.write('out');process.stderr.write('err');process.exitCode=7"],{}],
    ['stdout maxBuffer',process.execPath,['-e',"process.stdout.write('123456789')"],{maxBuffer:4}],
    ['stderr maxBuffer',process.execPath,['-e',"process.stderr.write('123456789')"],{maxBuffer:4}],
    ['timeout',process.execPath,['-e','setInterval(()=>{},1000)'],{timeout:150,killSignal:'SIGKILL'}],
    ['missing executable',`${process.execPath}-missing`,[],{}],
  ];
  const run=(execute,file,args,options)=>new Promise(resolve=>{
    execute(file,args,options,(error,stdout,stderr)=>resolve({stdout,stderr,error:error && {
      code:error.code,killed:error.killed,signal:error.signal,cmd:error.cmd,
    }}));
  });
  for(const [name,file,args,options] of cases) {
    const expected=await run(nativeExecFile,file,args,options);
    const actual=await withCycleDeadline(()=>run(execFile,file,args,options),{deadlineMs:5000});
    assert.deepEqual(actual,expected,name);
  }
});

test('cycle execFile preserves stdin, environment and promisify results',async()=>{
  await withCycleDeadline(async()=>{
    const execute=promisify(execFile);
    const pending=execute(process.execPath,['-e',
      "process.stdin.on('data',data=>process.stdout.write(process.env.CYCLE_TEST+':'+data));process.stderr.write('err')"],
    {env:{...process.env,CYCLE_TEST:'value'},maxBuffer:Infinity});
    assert.ok(pending.child.pid);
    pending.child.stdin.end('input');
    assert.deepEqual(await pending,{stdout:'value:input',stderr:'err'});
    await assert.rejects(execute(process.execPath,['-e',"process.stdout.write('out');process.stderr.write('err');process.exitCode=7"]),
      error=>error.code===7 && error.killed===false && error.signal===null && error.stdout==='out' && error.stderr==='err');
    const withoutArgs=execute(process.execPath,{});
    withoutArgs.child.stdin.end("console.log('optional args')");
    assert.equal((await withoutArgs).stdout,'optional args\n');
  },{deadlineMs:5000});
});

for(const [method,tree] of [['spawn',false],['execFile',false],['spawn',true],['execFile',true]]) {
  test(`cycle deadline stops a long-running ${method} ${tree?'process group':'child'}, including SIGKILL escalation`,{timeout:10000,skip:tree&&process.platform==='win32'?'POSIX process groups only':false},async()=>{
    const runner=spawn(process.execPath,['--input-type=module','-e',`
      import {${method},withCycleDeadline} from ${JSON.stringify(helper)};
      await withCycleDeadline(async()=>{
        const child=${method}(process.execPath,['-e',
          ${JSON.stringify("process.on('SIGTERM',()=>{});"+(tree?"const nested=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(nested.pid);":"")+"console.log('ready');setInterval(()=>{},1000)")}],
          {stdio:['ignore','pipe','ignore']}${method==='execFile'?`,error=>{
            if(error.code!==null || !error.killed || error.signal!=='SIGKILL')throw Error('Unexpected deadline error fields');
          }`:''});
        console.log(child.pid);
        child.stdout.on('data',data=>process.stdout.write(data));
        await new Promise(()=>{});
      },{deadlineMs:1000,graceMs:100});
    `],{stdio:['ignore','pipe','pipe']});
    let output='',errors='';
    const pids=()=>output.trim().split('\n').map(Number).filter(pid=>Number.isInteger(pid)&&pid>0);
    runner.stdout.on('data',data=>{output+=data;});
    runner.stderr.on('data',data=>{errors+=data;});
    try {
      const [code]=await once(runner,'close');
      assert.equal(code,2,errors);
      assert.ok(output.includes('ready'),output);
      assert.equal(pids().length,tree?2:1,output);
      for(const pid of pids()) {
        for(let attempt=0;attempt<100&&alive(pid);attempt++)await delay(20);
        assert.equal(alive(pid),false,`child ${pid} survived the cycle deadline`);
      }
    } finally {
      runner.kill('SIGKILL');
      for(const pid of pids())if(alive(pid))process.kill(pid,'SIGKILL');
    }
  });
}
