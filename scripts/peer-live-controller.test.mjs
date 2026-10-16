import test from 'node:test';
import {EventEmitter} from 'node:events';
import assert from 'node:assert/strict';
import {PassThrough,Writable} from 'node:stream';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runSequence,createWorkerLink,cleanupWorkers,parseArguments,acceptsPipes,workerArguments} from './peer-live-controller.mjs';

import {parseFixtureArguments,exchangeFailure,diagnosticQuotaSync} from './peer-live-fixture.test.mjs';

const invitation='observatory-pair:v1:fictional-secret';
const steps=['ready','endpoint','host','probe','join','confirm','finish','acknowledged','service','publish',
  'exchange','repeat-exchange','restart','exchange-after-restart','quota-enable','quota-exchange','quota-repeat',
  'quota-disable-host','revoke','cleanup'];
function fakes(override=()=>undefined) {
  const commands=[],lines=[];
  let disabled=false,cleaned=0;
  const link=role=>({
    ready:async()=>({ready:true}),
    async send(command) {
      commands.push({role,command});
      const changed=override(role,command);
      if(changed!==undefined)return changed;
      switch(command.action) {
        case 'repair': return {status:role==='host'?'unpaired':'prepared'};
        case 'endpoint': return {endpoint:{kind:'tls',address:'10.0.0.1',port:1234}};
        case 'host': return {invitation};
        case 'probe': return {tcp:'connected'};
        case 'join': return {status:'awaiting-confirmation'};
        case 'confirm': return {status:'configuration-ready'};
        case 'finish': return {status:'acknowledged'};
        case 'acknowledged': return {acknowledged:true};
        case 'host-close': return {status:'closed'};
        case 'service': return {status:'sync-listening'};
        case 'stop-service': return {status:'stopped'};
        case 'publish': return {sequence:1};
        case 'exchange': return {status:'merged',transport:'ok'};
        case 'quota-enable': return {sharing:true,localRemaining:40};
        case 'quota-exchange': return {status:disabled?(role==='host'?'disabled':'peer-disabled'):'ok',
          peerRemaining:disabled?null:70,localRemaining:40,peerSamples:disabled?0:1};
        case 'quota-disable': disabled=true;return {sharing:false};
        case 'revoke': return {status:'revoked'};
        default: assert.fail('Unexpected action');
      }
    },
  });
  return {host:link('host'),join:link('join'),commands,lines,log:line=>lines.push(line),
    cleanup:async()=>{cleaned++;},get cleaned(){return cleaned;}};
}
test('full sequence passes in order and keeps invitations private',async()=>{
  const run=fakes();
  assert.equal(await runSequence(run),true);
  assert.deepEqual(run.lines,[...steps.map(step=>`step ${step}: ok`),'second exchanges used: 0','result: passed']);
  assert.ok(run.commands.every(({command})=>command.action!=='host-close'));
  assert.equal(run.cleaned,1);
  assert.ok(run.lines.every(line=>!line.includes(invitation)));
  const carrying=run.commands.filter(({command})=>JSON.stringify(command).includes(invitation));
  assert.deepEqual(carrying,[{role:'join',command:{action:'probe',invitation}},{role:'join',command:{action:'join',invitation}}]);
  assert.deepEqual(run.commands.filter(({command})=>command.action==='exchange').map(({role})=>role),['join','host','join','host','join','host']);
  assert.deepEqual(run.commands.filter(({command})=>['stop-service','service'].includes(command.action)).map(({role,command})=>[role,command.action]),
    [['host','service'],['join','service'],['host','stop-service'],['host','service'],['join','stop-service'],['join','service']]);
});
test('first failed finish stops commands and still cleans up',async()=>{
  const run=fakes((role,command)=>command.action==='finish'?{status:'local-ready'}:undefined);
  assert.equal(await runSequence(run),false);
  assert.equal(run.commands.at(-1).command.action,'finish');
  assert.deepEqual(run.lines.slice(-4),['step finish: failed','step cleanup: ok','second exchanges used: 0','result: stopped at finish']);
  assert.equal(run.cleaned,1);
});
test('error replies fail even if their success fields match',async()=>{
  const run=fakes((role,command)=>command.action==='finish'?{status:'acknowledged',error:invitation}:undefined);
  assert.equal(await runSequence(run),false);
  assert.equal(run.commands.at(-1).command.action,'finish');
  assert.ok(run.lines.every(line=>!line.includes(invitation)));
});
test('repaired inserts repair before endpoint on both workers',async()=>{
  const run=fakes();
  assert.equal(await runSequence({...run,repaired:true}),true);
  assert.deepEqual(run.lines.slice(0,3),['step ready: ok','step repair: ok','step endpoint: ok']);
  assert.deepEqual(run.commands.slice(0,2),[{role:'host',command:{action:'repair'}},{role:'join',command:{action:'repair'}}]);
});
function wire(respond,timeoutMs=30) {
  const input=new PassThrough(),requests=[];
  const output=new Writable({write(chunk,encoding,callback){
    const request=JSON.parse(chunk.toString());requests.push(request);
    respond?.(request,input);callback();
  }});
  const link=createWorkerLink(input,output,{timeoutMs});
  input.write('{"ready":true}\n');
  return {link,input,output,requests};
}
for(const kind of ['error','wrong id','timeout','closed','over-long line','invalid JSON'])test(`protocol ${kind} fails endpoint and cleans up`,async()=>{
  const run=fakes();
  const worker=wire((request,input)=>{
    if(kind==='closed')input.end();
    if(kind==='error')input.write(JSON.stringify({id:request.id,error:invitation})+'\n');
    if(kind==='wrong id')input.write(JSON.stringify({id:request.id+1})+'\n');
    if(kind==='over-long line')input.write('x'.repeat(65537));
    if(kind==='invalid JSON')input.write('not json\n');
  });
  assert.equal(await runSequence({...run,host:worker.link}),false);
  const reason=kind==='error'?'worker error':kind==='timeout'?'worker reply timeout':'worker link closed';
  assert.equal(worker.link.failureReason(),reason);
  assert.deepEqual(run.lines,['step ready: ok',`step endpoint: failed (${reason})`,'step cleanup: ok','second exchanges used: 0','result: stopped at endpoint']);
  assert.ok(run.lines.every(line=>!line.includes(invitation)));
  assert.equal(worker.requests.length,1);
  assert.equal(run.commands.length,0);
  assert.equal(run.cleaned,1);
  worker.input.destroy();worker.output.destroy();
});
test('links count independently, accept split lines and refuse command 65',async()=>{
  const respond=(request,input)=>{
    const raw=JSON.stringify({id:request.id,status:'ok'})+'\n';
    input.write(raw.slice(0,5));input.write(raw.slice(5));
  };
  const a=wire(respond),b=wire(respond);
  await a.link.ready();await b.link.ready();
  for(let i=0;i<64;i++)await a.link.send({action:'endpoint'});
  await assert.rejects(a.link.send({action:'endpoint'}));
  await b.link.send({action:'endpoint'});
  assert.deepEqual(a.requests.map(r=>r.id),Array.from({length:64},(_,i)=>i+1));
  assert.equal(b.requests[0].id,1);
  a.input.destroy();b.input.destroy();a.output.destroy();b.output.destroy();
});
test('one command per link is allowed in flight',async()=>{
  const worker=wire();await worker.link.ready();
  const pending=worker.link.send({action:'endpoint'});
  await assert.rejects(worker.link.send({action:'endpoint'}));
  worker.input.write('{"id":1}\n');await pending;
  assert.equal(worker.requests.length,1);
  worker.input.destroy();worker.output.destroy();
});
test('ready requires a valid first line and has a deadline',async()=>{
  for(const raw of ['{"id":1}\n','{"ready":true,"error":"private"}\n',null]) {
    const input=new PassThrough(),output=new PassThrough();
    const link=createWorkerLink(input,output,{timeoutMs:10});
    if(raw)input.write(raw);
    await assert.rejects(link.ready());input.destroy();output.destroy();
  }
});
test('cleanup closes every worker before waiting and rejects bad exits or timeout',async()=>{
  for(const remote of [false,true])for(const exit of [Promise.resolve(0),Promise.resolve(1),Promise.resolve(null),new Promise(()=>{})]) {
    const closed=[],workers=[0,1].map(index=>({close(){closed.push(index);},exited:exit,remote}));
    const result=cleanupWorkers(workers,{timeoutMs:10,remoteTimeoutMs:10});
    assert.deepEqual(closed,[0,1]);
    if(await Promise.race([exit,Promise.resolve('pending')])===0)await result;
    else await assert.rejects(result);
  }
});
test('cleanup gives remote workers 120 seconds and local workers 30 seconds',async()=>{
  const closed=[],durations=[];
  const workers=[false,true,false].map((remote,index)=>({remote,exited:Promise.resolve(0),close(){closed.push(index);}}));
  await cleanupWorkers(workers,{wait:(exit,ms)=>{
    assert.deepEqual(closed,[0,1,2]);
    durations.push(ms);
    return exit;
  }});
  assert.deepEqual(durations,[30000,120000,30000]);
});
test('cleanup failure prevents a passing result',async()=>{
  const run=fakes();
  assert.equal(await runSequence({...run,cleanup:async()=>{throw Error('private');}}),false);
  assert.deepEqual(run.lines.slice(-3),['step cleanup: failed','second exchanges used: 0','result: stopped at cleanup']);
});
test('strict command lines require pipes or sockets for both role streams',()=>{
  const info=kind=>({isFIFO:()=>kind==='pipe',isSocket:()=>kind==='socket'});
  assert.deepEqual(parseArguments(['--loopback','10.0.0.1','--repaired']),{address:'10.0.0.1',role:null,repaired:true});
  for(const input of ['file','terminal','pipe','socket'])for(const output of ['file','terminal','pipe','socket']) {
    const streams={stdin:info(input),stdout:info(output)},allowed=['pipe','socket'].includes(input) && ['pipe','socket'].includes(output);
    assert.equal(acceptsPipes(streams),allowed);
    for(const role of ['host','join']) {
      const args=['--role',role,'--local','10.0.0.1'];
      if(allowed)assert.equal(parseArguments(args,streams).role,role);
      else assert.throws(()=>parseArguments(args,streams));
    }
  }
  assert.equal(acceptsPipes(),false);
  assert.throws(()=>parseArguments(['--role','host','--local','10.0.0.1']));
  for(const args of [[],['--loopback','127.0.0.1'],['--loopback','10.0.0.1','extra'],
    ['--role','other','--local','10.0.0.1'],['--role','host','--local','8.8.8.8'],
    ['--repaired','--loopback','10.0.0.1'],['--loopback','10.0.0.1','--repaired','--repaired']])assert.throws(()=>parseArguments(args));
});
test('invalid CLI child exits one with only generic stderr',()=>{
  const controller=fileURLToPath(new URL('./peer-live-controller.mjs',import.meta.url));
  for(const args of [[],['--loopback','8.8.8.8'],['--loopback','10.0.0.1','--port','43128']]) {
    const child=spawnSync(process.execPath,[controller,...args],{encoding:'utf8',timeout:5000});
    assert.equal(child.status,1);assert.equal(child.stdout,'');
    assert.equal(child.stderr,'Fixture controller failed.\n');
  }
});

test('fixed port accepts every trailing option position and reaches local worker arguments',()=>{
  const info={isFIFO:()=>true,isSocket:()=>false},streams={stdin:info,stdout:info};
  const fixture=fileURLToPath(new URL('./peer-live-fixture.test.mjs',import.meta.url));
  for(const mode of [['--role','host','--local','10.0.0.1'],['--role','join','--local','10.0.0.1']]) {
    for(const suffix of [['--port','43128'],['--port','43128','--repaired'],['--repaired','--port','43128']]) {
      const options=parseArguments([...mode,...suffix],streams);
      assert.equal(options.port,43128);
      assert.equal(options.repaired,suffix.includes('--repaired'));
      assert.deepEqual(workerArguments(options.address,options.port),[fixture,'--live-peer','10.0.0.1','--port','43128']);
    }
    for(const port of ['1024','65535'])assert.equal(parseArguments([...mode,'--port',port],streams).port,Number(port));
    for(const value of ['0','1023','65536','43128x','+43128','-43128','43128.0',' 43128','43128\n','']) {
      for(const suffix of [['--port',value],['--port',value,'--repaired'],['--repaired','--port',value]])
        assert.throws(()=>parseArguments([...mode,...suffix],streams));
    }
    for(const suffix of [['--port'],['--repaired','--port'],['--port','--repaired'],
      ['--port','43128','--port','43128'],['--port','43128','--repaired','--repaired']])
      assert.throws(()=>parseArguments([...mode,...suffix],streams));
    const options=parseArguments(mode,streams);
    assert.deepEqual(workerArguments(options.address,options.port),[fixture,'--live-peer','10.0.0.1']);
  }
});
test('fixed port adds host-close only on host and requires closed before service',async()=>{
  const run=fakes();
  assert.equal(await runSequence({...run,port:43128}),true);
  const expected=[...steps];
  expected.splice(expected.indexOf('service'),0,'host-close');
  assert.deepEqual(run.lines,[...expected.map(step=>`step ${step}: ok`),'second exchanges used: 0','result: passed']);
  const index=run.commands.findIndex(({command})=>command.action==='host-close');
  assert.deepEqual(run.commands.slice(index-1,index+2),[
    {role:'host',command:{action:'acknowledged'}},
    {role:'host',command:{action:'host-close'}},
    {role:'host',command:{action:'service'}},
  ]);
  assert.equal(run.commands.filter(({command})=>command.action==='host-close').length,1);
  const failed=fakes((role,command)=>command.action==='host-close'?{status:'open'}:undefined);
  assert.equal(await runSequence({...failed,port:43128}),false);
  assert.equal(failed.commands.at(-1).command.action,'host-close');
  assert.equal(failed.cleaned,1);
});

test('pause accepts all trailing option orders and rejects invalid or repeated values',()=>{
  const info={isFIFO:()=>true,isSocket:()=>false},streams={stdin:info,stdout:info};
  const permutations=items=>items.length?items.flatMap((item,index)=>
    permutations(items.filter((_,i)=>i!==index)).map(rest=>[...item,...rest])):[[]];
  for(const mode of [['--loopback','10.0.0.1'],['--role','host','--local','10.0.0.1'],['--role','join','--local','10.0.0.1']]) {
    for(const extras of [[],[['--port','43128']],[['--repaired']],[['--port','43128'],['--repaired']]]) {
      for(const suffix of permutations([['--pause-after-host','60'],...extras])) {
        if(mode[0]==='--loopback' && suffix.includes('--port')) {
          assert.throws(()=>parseArguments([...mode,...suffix],streams),{message:'Fixture controller failed'});
          continue;
        }
        assert.deepEqual(parseArguments([...mode,...suffix],streams),{
          address:'10.0.0.1',role:mode[0]==='--role'?mode[1]:null,
          repaired:suffix.includes('--repaired'),pauseAfterHost:60,
          ...(suffix.includes('--port')?{port:43128}:{}),
        });
      }
    }
    for(const value of ['1','120'])assert.equal(parseArguments([...mode,'--pause-after-host',value],streams).pauseAfterHost,Number(value));
    for(const value of ['0','121','300','301','60s','','+60','-60','60.0',' 60','60\n'])
      assert.throws(()=>parseArguments([...mode,'--pause-after-host',value],streams));
    for(const suffix of [['--pause-after-host'],['--pause-after-host','--repaired'],
      ['--pause-after-host','60','--pause-after-host','60']])
      assert.throws(()=>parseArguments([...mode,...suffix],streams));
  }
});
test('exchange pause accepts all trailing option orders and rejects invalid or repeated values',()=>{
  const info={isFIFO:()=>true,isSocket:()=>false},streams={stdin:info,stdout:info};
  const permutations=items=>items.length?items.flatMap((item,index)=>
    permutations(items.filter((_,i)=>i!==index)).map(rest=>[...item,...rest])):[[]];
  const extras=[['--pause-after-host','30'],['--port','43128'],['--repaired']];
  for(const mode of [['--loopback','10.0.0.1'],['--role','host','--local','10.0.0.1'],['--role','join','--local','10.0.0.1']]) {
    for(let mask=0;mask<8;mask++) {
      for(const suffix of permutations([['--pause-before-exchange','60'],...extras.filter((_,i)=>mask & (1<<i))])) {
        if(mode[0]==='--loopback' && suffix.includes('--port')) {
          assert.throws(()=>parseArguments([...mode,...suffix],streams),{message:'Fixture controller failed'});
          continue;
        }
        assert.deepEqual(parseArguments([...mode,...suffix],streams),{
          address:'10.0.0.1',role:mode[0]==='--role'?mode[1]:null,
          repaired:suffix.includes('--repaired'),pauseBeforeExchange:60,
          ...(suffix.includes('--pause-after-host')?{pauseAfterHost:30}:{}),
          ...(suffix.includes('--port')?{port:43128}:{}),
        });
      }
    }
    for(const value of ['1','120'])assert.equal(parseArguments([...mode,'--pause-before-exchange',value],streams).pauseBeforeExchange,Number(value));
    for(const value of ['0','121','300','301','60s','','+60','-60','60.0',' 60','60\n'])
      assert.throws(()=>parseArguments([...mode,'--pause-before-exchange',value],streams));
    for(const suffix of [['--pause-before-exchange'],['--pause-before-exchange','--repaired'],
      ['--pause-before-exchange','60','--pause-before-exchange','60']])
      assert.throws(()=>parseArguments([...mode,...suffix],streams));
  }
});
test('exchange pause waits between publish and exchange with either pause option combination',async()=>{
  for(const pauseAfterHost of [undefined,30]) {
    let release,started;
    const waiting=new Promise(resolve=>{started=resolve;});
    const run=fakes(),sleeps=[];
    const result=runSequence({...run,pauseAfterHost,pauseBeforeExchange:60,sleep:async ms=>{
      sleeps.push(ms);
      if(ms===30000) {
        assert.equal(run.commands.at(-1).command.action,'host');
        return;
      }
      assert.equal(ms,60000);
      started();
      await new Promise(resolve=>{release=resolve;});
    }});
    await waiting;
    assert.equal(run.commands.at(-1).command.action,'publish');
    assert.ok(run.commands.every(({command})=>command.action!=='exchange'));
    assert.deepEqual(run.lines.slice(-2),['step publish: ok','step pause-exchange: waiting 60 s']);
    release();
    assert.equal(await result,true);
    const index=run.lines.indexOf('step publish: ok');
    assert.deepEqual(run.lines.slice(index,index+4),[
      'step publish: ok','step pause-exchange: waiting 60 s','step pause-exchange: ok','step exchange: ok',
    ]);
    assert.deepEqual(sleeps,pauseAfterHost===undefined?[60000]:[30000,60000]);
  }
});
test('pause waits after host success and before probe with ordered status lines',async()=>{
  let release,started;
  const waiting=new Promise(resolve=>{started=resolve;});
  const run=fakes();
  const result=runSequence({...run,pauseAfterHost:60,sleep:async ms=>{
    assert.equal(ms,60000);
    started();
    await new Promise(resolve=>{release=resolve;});
  }});
  await waiting;
  assert.equal(run.commands.at(-1).command.action,'host');
  assert.deepEqual(run.lines.slice(-2),['step host: ok','step pause: waiting 60 s']);
  release();
  assert.equal(await result,true);
  assert.deepEqual(run.lines.slice(2,7),[
    'step host: ok','step pause: waiting 60 s','step pause: ok','step probe: ok','step join: ok',
  ]);
});
test('failed host never pauses',async()=>{
  const run=fakes((role,command)=>command.action==='host'?{}:undefined);
  assert.equal(await runSequence({...run,pauseAfterHost:60,sleep:()=>assert.fail('Unexpected sleep')}),false);
  assert.ok(run.lines.every(line=>!line.includes('pause')));
});
test('probe failure prints only allowed tcp words from replies',async()=>{
  for(const tcp of ['timeout','refused','unavailable','other',invitation,null,{},undefined]) {
    const run=fakes((role,command)=>command.action==='probe'?{tcp,private:invitation}:undefined);
    assert.equal(await runSequence(run),false);
    const suffix=['timeout','refused','unavailable'].includes(tcp)?` (${tcp})`:'';
    assert.deepEqual(run.lines.slice(-4),[`step probe: failed${suffix}`,'step cleanup: ok','second exchanges used: 0','result: stopped at probe']);
    assert.equal(run.commands.at(-1).command.action,'probe');
    assert.equal(run.cleaned,1);
    assert.ok(run.lines.every(line=>!line.includes(invitation)));
  }
});
test('probe error replies have a fixed reason and unknown failures stay generic',async()=>{
  for(const transportFailure of [false,true]) {
    const run=fakes((role,command)=>{
      if(command.action!=='probe')return;
      if(transportFailure)throw Error(invitation);
      return {tcp:'timeout',error:invitation};
    });
    assert.equal(await runSequence(run),false);
    assert.deepEqual(run.lines.slice(-4),[`step probe: failed${transportFailure?'':' (worker error)'}`,'step cleanup: ok','second exchanges used: 0','result: stopped at probe']);
  }
});

test('combined pauses cannot exceed 120 seconds',()=>{
  const info={isFIFO:()=>true,isSocket:()=>false},streams={stdin:info,stdout:info};
  for(const mode of [['--loopback','10.0.0.1'],['--role','host','--local','10.0.0.1'],['--role','join','--local','10.0.0.1']]) {
    for(const reverse of [false,true]) {
      for(const before of [60,61]) {
        const pauses=[['--pause-after-host','60'],['--pause-before-exchange',String(before)]];
        const args=[...mode,...(reverse?pauses.reverse():pauses).flat()];
        if(before===61)assert.throws(()=>parseArguments(args,streams),{message:'Fixture controller failed'});
        else {
          const options=parseArguments(args,streams);
          assert.equal(options.pauseAfterHost,60);
          assert.equal(options.pauseBeforeExchange,60);
        }
      }
    }
  }
});

const pipeInfo={isFIFO:()=>true,isSocket:()=>false};
const pipeStreams={stdin:pipeInfo,stdout:pipeInfo};
test('worker lifetime parses strictly and reaches fixture arguments in either order',()=>{
  const modes=[['--loopback','10.0.0.1'],['--role','host','--local','10.0.0.1'],['--role','join','--local','10.0.0.1']];
  for(const lifetime of ['60','300','600','1200']) {
    for(const mode of modes) {
      const options=parseArguments([...mode,'--worker-lifetime',lifetime],pipeStreams);
      assert.equal(options.workerLifetime,Number(lifetime));
      const args=workerArguments(options.address,options.port,options.workerLifetime).slice(1);
      assert.deepEqual(args,['--live-peer','10.0.0.1','--worker-lifetime',lifetime]);
      assert.deepEqual(parseFixtureArguments(args),{address:'10.0.0.1',workerLifetime:Number(lifetime)});
    }
    for(const suffix of [['--port','43128','--worker-lifetime',lifetime],['--worker-lifetime',lifetime,'--port','43128']]) {
      const options=parseArguments([...modes[1],...suffix],pipeStreams);
      const expected={address:'10.0.0.1',port:43128,workerLifetime:Number(lifetime)};
      assert.deepEqual(parseFixtureArguments(['--live-peer','10.0.0.1',...suffix]),expected);
      assert.deepEqual(parseFixtureArguments(workerArguments(options.address,options.port,options.workerLifetime).slice(1)),expected);
    }
  }
  assert.deepEqual(parseFixtureArguments(['--live-peer','10.0.0.1']),{address:'10.0.0.1'});
  for(const suffix of [[],['59'],['1201'],['600.0'],['+600'],['-600'],['6e2'],[' 600'],['600\n'],[''],['600','--worker-lifetime','600'],['600','unexpected']]) {
    const extra=['--worker-lifetime',...suffix];
    assert.equal(parseFixtureArguments(['--live-peer','10.0.0.1',...extra]),null);
    for(const mode of modes)assert.throws(()=>parseArguments([...mode,...extra],pipeStreams));
  }
  for(const extra of [['--port','43128','--port','43128'],['--unknown','600'],['--port'],['extra']])
    assert.equal(parseFixtureArguments(['--live-peer','10.0.0.1',...extra]),null);
});
test('pause budget reserves 180 seconds and caps each pause at 120 seconds',()=>{
  const mode=['--loopback','10.0.0.1'];
  for(const [lifetime,a,b,allowed] of [[600,120,120,true],[300,60,60,true],[300,60,61,false],
    [600,121,1,false],[600,1,121,false],[240,30,30,true],[240,30,31,false],[180,1,1,false],[60,1,1,false]]) {
    for(const suffix of [
      ['--worker-lifetime',String(lifetime),'--pause-after-host',String(a),'--pause-before-exchange',String(b)],
      ['--pause-before-exchange',String(b),'--pause-after-host',String(a),'--worker-lifetime',String(lifetime)],
    ]) {
      if(allowed)assert.equal(parseArguments([...mode,...suffix]).workerLifetime,lifetime);
      else assert.throws(()=>parseArguments([...mode,...suffix]));
    }
  }
});
test('exchange reasons allow only fixed status and transport words at every exchange step',async()=>{
  for(const [index,step] of ['exchange','repeat-exchange','exchange-after-restart'].entries()) {
    for(const status of ['merged','waiting','unavailable',invitation,{secret:invitation}]) {
      for(const transport of ['ok','unavailable','not-configured',invitation,{secret:invitation}]) {
        if(status==='merged' && transport==='ok')continue;
        let count=0;
        const run=fakes((role,command)=>command.action==='exchange' && ++count>=index*2+1?{status,transport,private:invitation}:undefined);
        assert.equal(await runSequence(run),false);
        const safeStatus=['merged','waiting','unavailable'].includes(status)?status:'other';
        const safeTransport=['ok','unavailable','not-configured'].includes(transport)?transport:'other';
        assert.ok(run.lines.includes(`step ${step}: failed (joining side, status ${safeStatus}, transport ${safeTransport})`));
        assert.ok(run.lines.every(line=>!line.includes(invitation)));
      }
    }
  }
});
test('exchange diagnostics name both senders and sanitize every diagnostic field',async()=>{
  for(const [index,step] of ['exchange','repeat-exchange','exchange-after-restart'].entries()) {
    for(const side of ['host','join']) {
      for(const stage of ['connect','tls','response','none',invitation,{}]) {
        for(const code of ['ETIMEDOUT','ECONNRESET','ECONNREFUSED','EHOSTUNREACH','ENETUNREACH','EPIPE','ECONNABORTED','none','other',invitation,{}]) {
          let count=0;
          const run=fakes((role,command)=>command.action==='exchange' && role===side && ++count>=index+1?
            {status:'merged',transport:'unavailable',failure:{stage,code},elapsedMs:1499,private:invitation}:undefined);
          assert.equal(await runSequence(run),false);
          const safeStage=typeof stage==='string' && stage!==invitation?stage:'other';
          const safeCode=typeof code==='string' && code!==invitation?code:'other';
          assert.deepEqual(run.lines.slice(-4),[
            `step ${step}: failed (${side==='host'?'hosting':'joining'} side, status merged, transport unavailable, stage ${safeStage}, code ${safeCode}, elapsed 1 s)`,
            'step cleanup: ok','second exchanges used: 1',`result: stopped at ${step}`,
          ]);
          assert.equal(run.cleaned,1);
          assert.ok(run.lines.every(line=>!line.includes(invitation)));
        }
      }
    }
  }
});
test('missing or malformed failure objects omit diagnostics',async()=>{
  for(const failure of [undefined,null,invitation,[],{}, {stage:'tls'}, {code:'none'},
    {stage:'tls',code:'none',private:invitation}]) {
    const run=fakes((role,command)=>command.action==='exchange'?
      {status:'merged',transport:'unavailable',failure,elapsedMs:invitation}:undefined);
    assert.equal(await runSequence(run),false);
    assert.deepEqual(run.lines.slice(-4),[
      'step exchange: failed (joining side, status merged, transport unavailable)',
      'step cleanup: ok','second exchanges used: 1','result: stopped at exchange',
    ]);
  }
});
test('elapsed diagnostics round seconds and never print arbitrary values',async()=>{
  for(const [elapsedMs,expected] of [[0,0],[1500,2],[30000,30],[-1,'other'],[Infinity,'other'],
    [NaN,'other'],[1e30,'other'],[invitation,'other'],[{},'other'],[undefined,'other']]) {
    const run=fakes((role,command)=>command.action==='exchange'?
      {status:'merged',transport:'unavailable',failure:{stage:'response',code:'none'},elapsedMs}:undefined);
    assert.equal(await runSequence(run),false);
    assert.equal(run.lines.at(-4),`step exchange: failed (joining side, status merged, transport unavailable, stage response, code none, elapsed ${expected} s)`);
  }
});
test('fixture event mapping identifies the failed stage without network access',()=>{
  assert.deepEqual(exchangeFailure(),{stage:'none',code:'none'});
  for(const [events,stage] of [
    [{socketCreated:false},'none'],
    [{socketCreated:true},'connect'],
    [{socketCreated:true,connected:true},'tls'],
    [{socketCreated:true,connected:true,secureConnected:true},'response'],
    [{socketCreated:true,connected:true,secureConnected:true,dataReceived:true},'response'],
  ]) {
    assert.deepEqual(exchangeFailure(events),{stage,code:'none'});
    for(const code of ['ETIMEDOUT','ECONNRESET','ECONNREFUSED','EHOSTUNREACH','ENETUNREACH','EPIPE','ECONNABORTED'])
      assert.deepEqual(exchangeFailure({...events,errorSeen:true,errorCode:code}),{stage,code});
    for(const errorCode of [undefined,null,invitation,{},'none'])
      assert.deepEqual(exchangeFailure({...events,errorSeen:true,errorCode}),{stage,code:'other'});
  }
});
test('quota reasons allow only fixed status words and peer reading presence',async()=>{
  for(const step of ['quota-enable','quota-exchange','quota-repeat','quota-disable-host']) {
    for(const status of ['ok','passive','disabled','peer-disabled','unavailable',invitation,{secret:invitation},undefined]) {
      for(const peerRemaining of [70,null,invitation]) {
        let count=0;
        const run=fakes((role,command)=>{
          const target=step==='quota-repeat'?'quota-exchange':step==='quota-disable-host'?'quota-disable':step;
          if(command.action!==target || (step==='quota-exchange'?++count<1:++count<(step==='quota-repeat'?3:1)))return;
          return {...(status===undefined?{}:{status}),peerRemaining,private:invitation};
        });
        assert.equal(await runSequence(run),false);
        const safeStatus=['ok','passive','disabled','peer-disabled','unavailable'].includes(status)?status:'other';
        const reason=`${['quota-exchange','quota-repeat'].includes(step)?'joining':'hosting'} side, `+(status===undefined?'':`status ${safeStatus}, `)+`peer reading ${typeof peerRemaining==='number'?'present':'absent'}`;
        assert.ok(run.lines.includes(`step ${step}: failed (${reason})`));
        assert.ok(run.lines.every(line=>!line.includes(invitation)));
      }
    }
  }
});
test('worker error takes priority over reply fields including readiness',async()=>{
  for(const action of ['ready','exchange','quota-enable','quota-exchange','quota-disable']) {
    const run=fakes((role,command)=>command.action===action?{error:invitation,status:invitation,transport:invitation}:undefined);
    if(action==='ready')run.host.ready=async()=>({ready:true,error:invitation});
    assert.equal(await runSequence(run),false);
    const step=action==='quota-disable'?'quota-disable-host':action;
    assert.ok(run.lines.includes(`step ${step}: failed (worker error)`));
    assert.ok(run.lines.every(line=>!line.includes(invitation)));
  }
});

for(const [index,step] of ['exchange','repeat-exchange','exchange-after-restart','quota-exchange'].entries()) {
  for(const side of ['host','join']) {
    for(const passes of [true,false])test(`${step} on ${side} uses one identical second request that ${passes?'passes':'fails'}`,async()=>{
      const action=index===3?'quota-exchange':'exchange',target=index===3?1:index+1;
      const label=side==='host'?'hosting side':'joining side';
      let count=0;
      const run=fakes((role,command)=>{
        if(role!==side || command.action!==action)return;
        count++;
        if(count===target)return {status:'unavailable',transport:'unavailable',private:invitation};
        if(count===target+1) {
          assert.equal(run.lines.at(-1),`step ${step}: second exchange (${reason})`);
          if(!passes)return {status:'waiting',transport:'not-configured',private:invitation};
        }
      });
      const reason=index===3?`${label}, status unavailable, peer reading absent`:`${label}, status unavailable, transport unavailable`;
      assert.equal(await runSequence(run),passes);
      const requests=run.commands.filter(({role,command})=>role===side && command.action===action);
      assert.deepEqual(requests[target-1],requests[target]);
      assert.equal(run.lines.filter(line=>line.includes(': second exchange (')).length,1);
      for(const line of run.lines.filter(line=>line.includes(' side')))assert.equal(line.match(/ side/g).length,1);
      assert.equal(run.lines.at(-2),'second exchanges used: 1');
      if(passes)assert.ok(run.lines.includes(`step ${step}: ok`));
      else {
        const finalReason=index===3?`${label}, status other, peer reading absent`:`${label}, status waiting, transport not-configured`;
        assert.equal(run.lines.at(-4),`step ${step}: failed (${finalReason})`);
        assert.equal(run.lines.at(-1),`result: stopped at ${step}`);
        assert.equal(requests.length,target+1);
        assert.deepEqual(run.commands.at(-1),requests.at(-1));
      }
      assert.ok(run.lines.every(line=>!line.includes(invitation)));
    });
  }
}
test('counts second requests on both sides across every eligible step',async()=>{
  const counts=new Map();
  const run=fakes((role,{action})=>{
    if(!['exchange','quota-exchange'].includes(action))return;
    const key=role+action,count=(counts.get(key)??0)+1;
    counts.set(key,count);
    if(action==='exchange' && count%2===1 || action==='quota-exchange' && count===1)
      return {status:'unavailable',transport:'unavailable'};
  });
  assert.equal(await runSequence(run),true);
  assert.equal(run.lines.at(-2),'second exchanges used: 8');
});
test('quota repeat uses the passing joining reply after a second exchange',async()=>{
  for(const repeatSamples of [4,5]) {
    let count=0,hostCount=0;
    const run=fakes((role,{action})=>{
      if(action!=='quota-exchange')return;
      if(role==='host')return ++hostCount===1?{status:'ok',peerRemaining:70,peerSamples:99}:undefined;
      count++;
      if(count===1)return {status:'unavailable',peerRemaining:70,peerSamples:100};
      if(count<=3 || (count===4 && repeatSamples===5))return {status:'ok',peerRemaining:70,peerSamples:count===2?4:repeatSamples};
    });
    assert.equal(await runSequence(run),repeatSamples===4);
    assert.ok(run.lines.includes('step quota-exchange: ok'));
    assert.ok(run.lines.includes(repeatSamples===4?'step quota-repeat: ok':'step quota-repeat: failed (joining side, status ok, peer reading present)'));
    assert.equal(run.lines.at(-2),`second exchanges used: ${repeatSamples===4?1:2}`);
  }
});
test('every other request keeps the stop rule',async()=>{
  const eligible=new Set(['exchange','repeat-exchange','exchange-after-restart','quota-exchange','quota-repeat','quota-disable-host']);
  let step;
  const targets=[];
  const reference=fakes();
  const originalLog=reference.log;
  await runSequence({...reference,repaired:true,port:43128,log:line=>{
    if(line.startsWith('step ') && line.endsWith(': ok')) {
      step=line.slice(5,-4);
      for(let i=targets.length;i<reference.commands.length;i++)targets.push(step);
    }
    originalLog(line);
  }});
  for(const [index,target] of targets.entries()) {
    if(eligible.has(target))continue;
    let count=0;
    const run=fakes(()=>++count===index+1?{}:undefined);
    assert.equal(await runSequence({...run,repaired:true,port:43128}),false);
    assert.equal(run.commands.length,index+1);
    assert.equal(run.lines.at(-2),'second exchanges used: 0');
    assert.equal(run.lines.at(-1),`result: stopped at ${target}`);
  }
});
for(const kind of ['closed','timeout','error'])test(`exchange link ${kind} stops without a second request`,async()=>{
  const run=fakes(),original=run.join.send;
  const worker=wire((request,input)=>{
    if(kind==='closed')input.end();
    if(kind==='error')input.write(JSON.stringify({id:request.id,error:invitation})+'\n');
  });
  await worker.link.ready();
  run.join.send=command=>command.action==='exchange'?worker.link.send(command):original(command);
  run.join.failureReason=worker.link.failureReason;
  assert.equal(await runSequence(run),false);
  assert.equal(worker.requests.length,1);
  assert.equal(run.lines.at(-2),'second exchanges used: 0');
  const reason=kind==='closed'?'worker link closed':kind==='timeout'?'worker reply timeout':'worker error';
  assert.equal(run.lines.at(-4),`step exchange: failed (${reason})`);
});

test('quota diagnostics report fixed words on either side and reject malformed objects',async()=>{
  for(const side of ['host','join'])for(const failure of [undefined,null,[],{},
    {stage:'tls',code:'ECONNRESET',request:'status'},
    {stage:'response',code:'none',request:'exchange'},
    {stage:invitation,code:invitation,request:invitation},
    {stage:'connect',code:'none',request:'status',private:invitation}]) {
    const run=fakes((role,{action})=>role===side && action==='quota-exchange'?
      {status:'unavailable',failure,elapsedMs:1550}:undefined);
    assert.equal(await runSequence(run),false);
    const label=side==='host'?'hosting':'joining';
    let reason=`${label} side, status unavailable, peer reading absent`;
    if(failure && !Array.isArray(failure) && Object.keys(failure).length===3) {
      const safe=failure.stage===invitation?{stage:'other',code:'other',request:'other'}:failure;
      reason+=`, stage ${safe.stage}, code ${safe.code}, request ${safe.request}, elapsed 2 s`;
    }
    assert.ok(run.lines.includes(`step quota-exchange: failed (${reason})`));
    assert.ok(run.lines.includes(`step quota-exchange: second exchange (${reason})`));
    assert.ok(run.lines.every(line=>!line.includes(invitation)));
  }
});

for(const [step,side,action,target] of [
  ['quota-repeat','join','quota-exchange',2],
  ['quota-disable-host','host','quota-disable',1],
  ['quota-disable-host','join','quota-exchange',3],
  ['quota-disable-host','host','quota-exchange',2],
])for(const passes of [true,false])test(`${step} ${side} ${action} retries once and ${passes?'continues':'stops'}`,async()=>{
  let count=0;
  const run=fakes((role,command)=>{
    if(role!==side || command.action!==action)return;
    count++;
    if(count===target || (!passes && count===target+1))return {status:'unavailable'};
  });
  assert.equal(await runSequence(run),passes);
  const requests=run.commands.filter(({role,command})=>role===side && command.action===action);
  assert.deepEqual(requests[target-1],requests[target]);
  const label=side==='host'?'hosting':'joining';
  assert.ok(run.lines.includes(`step ${step}: second exchange (${label} side, status unavailable, peer reading absent)`));
  assert.equal(run.lines.at(-2),'second exchanges used: 1');
  if(!passes) {
    assert.equal(run.lines.at(-4),`step ${step}: failed (${label} side, status unavailable, peer reading absent)`);
    assert.equal(requests.length,target+1);
    assert.deepEqual(run.commands.at(-1),requests.at(-1));
  }
});

test('fixture quota diagnostics map the last socket without network access',async()=>{
  for(const request of ['status','exchange'])for(const stage of ['none','connect','tls','response']) {
    let ticks=0,calls=0;
    const sockets=[];
    const result=await diagnosticQuotaSync('synthetic-runtime',{
      clock:()=>ticks++?1249:0,
      connect:()=>{
        if(stage==='none')throw Error('Synthetic connection failure');
        const socket=new EventEmitter();
        sockets.push(socket);
        return socket;
      },
      quotaRequest:async(runtime,transport,input,{connect})=>{
        assert.equal(runtime,'synthetic-runtime');
        assert.deepEqual(transport,{synthetic:true});
        calls++;
        if(input.action==='status' && request==='exchange') {
          const socket=connect();
          socket.emit('connect');socket.emit('secureConnect');socket.emit('data');
          return {status:'ready',record:null};
        }
        const socket=connect();
        if(['tls','response'].includes(stage))socket.emit('connect');
        if(stage==='response')socket.emit('secureConnect');
        socket.emit('error',{code:'ECONNREFUSED',message:invitation});
        throw Error('Synthetic failure');
      },
      sync:async(runtime,{request:send})=>{
        try {
          await send({synthetic:true},{action:'status'});
          await send({synthetic:true},{action:'exchange'});
        } catch {}
        return {status:'unavailable',peer:null};
      },
    });
    const expectedRequest=stage==='none'?'status':request;
    assert.equal(calls,expectedRequest==='status'?1:2);
    assert.deepEqual(result,{status:'unavailable',peer:null,
      failure:{stage,code:stage==='none'?'none':'ECONNREFUSED',request:expectedRequest},elapsedMs:1200});
  }
  const success={status:'ok',peer:null};
  assert.deepEqual(await diagnosticQuotaSync('synthetic-runtime',{sync:async()=>success}),success);
  const result=await diagnosticQuotaSync('synthetic-runtime',{
    connect:()=>new EventEmitter(),
    quotaRequest:async(_runtime,_transport,_input,{connect})=>{connect().emit('error',{code:invitation});},
    sync:async(_runtime,{request})=>{await request({}, {action:invitation});return {status:'unavailable'};},
    clock:()=>0,
  });
  assert.deepEqual(result,{status:'unavailable',failure:{stage:'connect',code:'other',request:'other'},elapsedMs:0});
});
