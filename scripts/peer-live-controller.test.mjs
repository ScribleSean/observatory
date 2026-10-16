import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough,Writable} from 'node:stream';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runSequence,createWorkerLink,cleanupWorkers,parseArguments,acceptsPipes} from './peer-live-controller.mjs';

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
