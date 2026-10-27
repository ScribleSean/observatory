import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';

const helper=new URL('../lib/cycle-processes.mjs',import.meta.url).href;
const alive=pid=>{try {process.kill(pid,0);return true;}catch(error) {if(error.code==='ESRCH')return false;throw error;}};

for(const [method,tree] of [['spawn',false],['execFile',false],['spawn',true]]) {
  test(`cycle deadline stops a long-running ${method} ${tree?'process group':'child'}, including SIGKILL escalation`,{timeout:10000,skip:tree&&process.platform==='win32'?'POSIX process groups only':false},async()=>{
    const runner=spawn(process.execPath,['--input-type=module','-e',`
      import {${method},withCycleDeadline} from ${JSON.stringify(helper)};
      await withCycleDeadline(async()=>{
        const child=${method}(process.execPath,['-e',
          ${JSON.stringify("process.on('SIGTERM',()=>{});"+(tree?"const nested=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(nested.pid);":"")+"console.log('ready');setInterval(()=>{},1000)")}],
          {stdio:['ignore','pipe','ignore']}${method==='execFile'?',()=>{}':''});
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
