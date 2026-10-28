import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFile as nativeExecFile} from 'node:child_process';
import {promisify} from 'node:util';
import {execFile,withCycleDeadline} from '../lib/cycle-processes.mjs';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';

const helper=new URL('../lib/cycle-processes.mjs',import.meta.url).href;
const alive=pid=>{try {process.kill(pid,0);return true;}catch(error) {if(error.code==='ESRCH')return false;throw error;}};

test('tick finishing during deadline grace exits successfully with a fake clock',async()=>{
  const runner=spawn(process.execPath,['--input-type=module','-e',`
    import assert from 'node:assert/strict';
    import {mock} from 'node:test';
    import {withCycleDeadline} from ${JSON.stringify(helper)};
    import {tick} from ${JSON.stringify(new URL('../scripts/tick.mjs',import.meta.url).href)};
    import {withFolder,testConfig} from ${JSON.stringify(new URL('./helpers.mjs',import.meta.url).href)};
    await withFolder(async folder=>{
      mock.timers.enable({apis:['setTimeout','Date']});
      let release,started;
      const waiting=new Promise(resolve=>{release=resolve;});
      const ready=new Promise(resolve=>{started=resolve;});
      const pending=withCycleDeadline(()=>tick(testConfig(folder),{
        collectStep:async()=>{started();await waiting;return {status:{state:'ok'}};},
        spokeStep:async()=>({generatedAt:new Date().toISOString(),glance:{title:'Test'}}),
      }),{deadlineMs:1000,graceMs:250});
      await ready;
      mock.timers.tick(1000);
      mock.timers.tick(100);
      release();
      assert.equal((await pending).value.collect,'ok');
      mock.timers.tick(1000);
      await Promise.resolve();
      mock.timers.reset();
    });
  `],{stdio:['ignore','pipe','pipe']});
  let errors='';
  runner.stderr.on('data',data=>{errors+=data;});
  const [code]=await once(runner,'close');
  assert.equal(code,0,errors);
});

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

for (const exitsDuringGrace of [false,true]) {
  test(`Quit cancels and reaps a cycle tree when its direct child ${exitsDuringGrace?'exits during grace':'ignores SIGTERM'}`,
    {timeout:10000},async()=>{
    const nested="process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)";
    const childCode=(exitsDuringGrace?"":"process.on('SIGTERM',()=>{});")+
      `const child=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(nested)}],{stdio:['ignore','pipe','ignore']});`+
      "console.log(child.pid);child.stdout.pipe(process.stdout);setInterval(()=>{},1000)";
    const runner=spawn(process.execPath,['--input-type=module','-e',`
      import {spawn,withCycleDeadline} from ${JSON.stringify(helper)};
      process.on('message',()=>process.emit('SIGTERM'));
      await withCycleDeadline(async()=>{
        const child=spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:['ignore','pipe','ignore']});
        console.log(child.pid);
        child.stdout.pipe(process.stdout);
        await new Promise(resolve=>child.once('exit',resolve));
      },{deadlineMs:60000,graceMs:100,shutdownSignals:['SIGTERM']});
    `],{stdio:['ignore','pipe','pipe','ipc']});
    let output='',errors='';
    const pids=()=>output.trim().split('\n').map(Number).filter(pid=>Number.isInteger(pid)&&pid>0);
    runner.stderr.on('data',data=>{errors+=data;});
    const ready=new Promise(resolve=>runner.stdout.on('data',data=>{output+=data;if(output.includes('ready'))resolve();}));
    try {
      await ready;
      const closed=once(runner,'close');
      if(process.platform==='win32')runner.send('quit');
      else runner.kill('SIGTERM');
      const [code]=await closed;
      assert.equal(code,0,errors);
      assert.equal(pids().length,2,output);
      for(const pid of pids()) {
        for(let attempt=0;attempt<100&&alive(pid);attempt++)await delay(20);
        assert.equal(alive(pid),false,`child ${pid} survived Quit`);
      }
    } finally {
      runner.kill('SIGKILL');
      for(const pid of pids())if(alive(pid))process.kill(pid,'SIGKILL');
    }
  });
}
