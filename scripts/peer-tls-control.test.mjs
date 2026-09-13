import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createTLSSetupController,serveTLSSetupControl} from './peer-tls-control.mjs';
import {createInvitation,encodeInvitation} from './peer-invitation.mjs';

const invite=()=>createInvitation({address:'10.0.0.2',port:43128,certificateSha256:'a'.repeat(64)});
test('controller exposes only invitation and peer fingerprint, never internal handles or configuration',async()=>{
  let closed=0,confirmed=0;
  const host={invitation:invite(),status:()=> 'confirming',pending:()=>({claimId:'private-handle',peerCertificateSha256:'b'.repeat(64)}),
    cancel:async()=>{closed++;},confirm:async(id)=>{assert.equal(id,'private-handle');confirmed++;return {private:'configuration'};}};
  const controller=createTLSSetupController('/fixture',{startHost:async()=>host});
  assert.equal((await controller.run({action:'host-start',address:'10.0.0.2',port:0})).status,'hosting');
  const status=await controller.run({action:'status'});
  assert.deepEqual(status,{status:'confirming',peerCertificateSha256:'b'.repeat(64)});
  const command={action:'host-confirm',peerCertificateSha256:'b'.repeat(64),localEndpoint:{},peerEndpoint:{},includeUbuntu:false};
  await assert.rejects(controller.run({...command,peerCertificateSha256:'c'.repeat(64)}));
  assert.equal(confirmed,0);
  assert.deepEqual(await controller.run(command),{status:'configuration-ready'});
  assert.deepEqual(await controller.run({action:'cancel'}),{status:'cancelled'});assert.equal(closed,1);
  assert.deepEqual(await controller.run({action:'status'}),{status:'idle',peerCertificateSha256:null});
});

test('cancellation closes a host that finishes starting after cancellation',async()=>{
  let finish,closed=0;
  const controller=createTLSSetupController('/fixture',{startHost:()=>new Promise(resolve=>{finish=resolve;})});
  const operation=controller.run({action:'host-start',address:'10.0.0.2',port:0});
  assert.equal((await controller.run({action:'status'})).status,'working');
  await assert.rejects(controller.run({action:'join-claim',invitation:encodeInvitation(invite())}));
  await controller.cancel();
  finish({cancel:async()=>{closed++;}});
  assert.deepEqual(await operation,{status:'cancelled'});assert.equal(closed,1);
});

test('joining keeps private identity out of responses and aborts an in-flight claim',async()=>{
  let entered;
  const started=new Promise(resolve=>{entered=resolve;});
  const controller=createTLSSetupController('/fixture',{readIdentity:async()=>({key:'private-key'}),
    claim:async(_invite,identity,{signal})=>{
      assert.equal(identity.key,'private-key');entered();
      return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('private error')),{once:true}));
    }});
  const claiming=controller.run({action:'join-claim',invitation:encodeInvitation(invite())});
  const rejected=assert.rejects(claiming);await started;
  await controller.cancel();await rejected;
  assert.equal((await controller.run({action:'status'})).status,'idle');
});

test('control pipes bound frames, suppress raw errors and close on parent EOF',async()=>{
  const input=new PassThrough(),output=new PassThrough();let closed=0;
  const serving=serveTLSSetupControl('/fixture',input,output,{controller:{
    run:async()=>{throw Error('private internal details');},cancel:async()=>{closed++;}}});
  const response=once(output,'data');
  input.write(JSON.stringify({id:1,command:{action:'status'}})+'\n');
  assert.deepEqual(JSON.parse((await response)[0]),{id:1,status:'unavailable'});
  input.end();await serving;assert.equal(closed,1);
  const oversized=new PassThrough(),sink=new PassThrough();
  const refused=assert.rejects(serveTLSSetupControl('/fixture',oversized,sink));
  oversized.write('x'.repeat(16385));await refused;
});

test('duplicate request IDs and truncated frames fail closed',async()=>{
  for(const malformed of [JSON.stringify({id:1,command:{action:'status'}})+'\n','{']) {
    const input=new PassThrough(),output=new PassThrough();let cancelled=0;
    const serving=serveTLSSetupControl('/fixture',input,output,{controller:{run:async()=>({status:'idle'}),cancel:async()=>{cancelled++;}}});
    const response=once(output,'data');input.write(JSON.stringify({id:1,command:{action:'status'}})+'\n');await response;
    const refused=assert.rejects(serving);input.end(malformed);await refused;assert.equal(cancelled,1);
  }
});

test('real child process exchanges status through pipes and exits when the parent closes stdin',async t=>{
  const runtime=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-control-test-')));
  t.after(()=>rm(runtime,{recursive:true,force:true}));
  const child=spawn(process.execPath,[fileURLToPath(new URL('./peer-tls-control.mjs',import.meta.url)),'--runtime',runtime],
    {stdio:['pipe','pipe','pipe']});
  const timeout=setTimeout(()=>child.kill('SIGKILL'),10000);
  t.after(()=>{clearTimeout(timeout);if(child.exitCode===null)child.kill('SIGKILL');});
  const finished=once(child,'close'),response=once(child.stdout,'data');
  child.stdin.write(JSON.stringify({id:1,command:{action:'status'}})+'\n');
  assert.deepEqual(JSON.parse((await response)[0]),{id:1,status:'idle',peerCertificateSha256:null});
  child.stdin.end();const [code,signal]=await finished;
  assert.equal(code,0);assert.equal(signal,null);
});
