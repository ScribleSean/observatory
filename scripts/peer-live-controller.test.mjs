import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough,Writable} from 'node:stream';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runSequence,createWorkerLink,cleanupWorkers,parseArguments,acceptsPipes,workerArguments} from './peer-live-controller.mjs';

const invitation='observatory-pair:v1:fictional-secret';
const steps=['ready','endpoint','host','probe','join','confirm','finish','acknowledged','host-close','service','publish',
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
  assert.deepEqual(run.lines,[...steps.map(step=>`step ${step}: ok`),'result: passed']);
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
  assert.deepEqual(run.lines.slice(-3),['step finish: failed','step cleanup: ok','result: stopped at finish']);
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
for(const kind of ['error','wrong id','timeout','over-long line','invalid JSON'])test(`protocol ${kind} fails endpoint and cleans up`,async()=>{
  const run=fakes();
  const worker=wire((request,input)=>{
    if(kind==='error')input.write(JSON.stringify({id:request.id,error:invitation})+'\n');
    if(kind==='wrong id')input.write(JSON.stringify({id:request.id+1})+'\n');
    if(kind==='over-long line')input.write('x'.repeat(65537));
    if(kind==='invalid JSON')input.write('not json\n');
  });
  assert.equal(await runSequence({...run,host:worker.link}),false);
  assert.deepEqual(run.lines,['step ready: ok','step endpoint: failed','step cleanup: ok','result: stopped at endpoint']);
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
  for(const exit of [Promise.resolve(0),Promise.resolve(1),Promise.resolve(null),new Promise(()=>{})]) {
    const closed=[],workers=[0,1].map(index=>({close(){closed.push(index);},exited:exit}));
    const result=cleanupWorkers(workers,{timeoutMs:10});
    assert.deepEqual(closed,[0,1]);
    if(await Promise.race([exit,Promise.resolve('pending')])===0)await result;
    else await assert.rejects(result);
  }
});
test('cleanup failure prevents a passing result',async()=>{
  const run=fakes();
  assert.equal(await runSequence({...run,cleanup:async()=>{throw Error('private');}}),false);
  assert.deepEqual(run.lines.slice(-2),['step cleanup: failed','result: stopped at cleanup']);
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
  for(const args of [[],['--loopback','8.8.8.8']]) {
    const child=spawnSync(process.execPath,[controller,...args],{encoding:'utf8',timeout:5000});
    assert.equal(child.status,1);assert.equal(child.stdout,'');
    assert.equal(child.stderr,'Fixture controller failed.\n');
  }
});

test('fixed port accepts every trailing option position and reaches local worker arguments',()=>{
  const info={isFIFO:()=>true,isSocket:()=>false},streams={stdin:info,stdout:info};
  const fixture=fileURLToPath(new URL('./peer-live-fixture.test.mjs',import.meta.url));
  for(const mode of [['--loopback','10.0.0.1'],['--role','host','--local','10.0.0.1'],['--role','join','--local','10.0.0.1']]) {
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
test('host-close runs only on host and requires closed before service',async()=>{
  const run=fakes();
  assert.equal(await runSequence(run),true);
  const index=run.commands.findIndex(({command})=>command.action==='host-close');
  assert.deepEqual(run.commands.slice(index-1,index+2),[
    {role:'host',command:{action:'acknowledged'}},
    {role:'host',command:{action:'host-close'}},
    {role:'host',command:{action:'service'}},
  ]);
  assert.equal(run.commands.filter(({command})=>command.action==='host-close').length,1);
  const failed=fakes((role,command)=>command.action==='host-close'?{status:'open'}:undefined);
  assert.equal(await runSequence(failed),false);
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
        assert.deepEqual(parseArguments([...mode,...suffix],streams),{
          address:'10.0.0.1',role:mode[0]==='--role'?mode[1]:null,
          repaired:suffix.includes('--repaired'),pauseAfterHost:60,
          ...(suffix.includes('--port')?{port:43128}:{}),
        });
      }
    }
    for(const value of ['1','300'])assert.equal(parseArguments([...mode,'--pause-after-host',value],streams).pauseAfterHost,Number(value));
    for(const value of ['0','301','60s','','+60','-60','60.0',' 60','60\n'])
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
        assert.deepEqual(parseArguments([...mode,...suffix],streams),{
          address:'10.0.0.1',role:mode[0]==='--role'?mode[1]:null,
          repaired:suffix.includes('--repaired'),pauseBeforeExchange:60,
          ...(suffix.includes('--pause-after-host')?{pauseAfterHost:30}:{}),
          ...(suffix.includes('--port')?{port:43128}:{}),
        });
      }
    }
    for(const value of ['1','300'])assert.equal(parseArguments([...mode,'--pause-before-exchange',value],streams).pauseBeforeExchange,Number(value));
    for(const value of ['0','301','60s','','+60','-60','60.0',' 60','60\n'])
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
    assert.deepEqual(run.lines.slice(-3),[`step probe: failed${suffix}`,'step cleanup: ok','result: stopped at probe']);
    assert.equal(run.commands.at(-1).command.action,'probe');
    assert.equal(run.cleaned,1);
    assert.ok(run.lines.every(line=>!line.includes(invitation)));
  }
});
test('probe error replies and transport failures keep generic failure lines',async()=>{
  for(const transportFailure of [false,true]) {
    const run=fakes((role,command)=>{
      if(command.action!=='probe')return;
      if(transportFailure)throw Error(invitation);
      return {tcp:'timeout',error:invitation};
    });
    assert.equal(await runSequence(run),false);
    assert.deepEqual(run.lines.slice(-3),['step probe: failed','step cleanup: ok','result: stopped at probe']);
  }
});
