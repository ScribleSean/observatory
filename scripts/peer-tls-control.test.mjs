import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {mkdtemp,realpath,rm,lstat,readdir} from 'node:fs/promises';
import {testRuntimeBase} from './test-runtime-base.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createTLSSetupController,serveTLSSetupControl} from './peer-tls-control.mjs';
import {createInvitation,encodeInvitation} from './peer-invitation.mjs';

import {initializePairing,createPairingConfigurations,readPairing} from './peer-pairing.mjs';
import {withPeerStateLock} from './peer-lock.mjs';
import {chooseSharing,readSharingChoice} from './sharing-choice.mjs';

const runtimeBase=await testRuntimeBase('peer-tls-control');
after(()=>rm(runtimeBase,{recursive:true,force:true}));

const invite=()=>createInvitation({address:'10.0.0.2',port:43128,certificateSha256:'a'.repeat(64)});
test('controller exposes only invitation and peer fingerprint, never internal handles or configuration',async()=>{
  let closed=0,confirmed=0;
  const host={invitation:invite(),status:()=> 'confirming',pending:()=>({claimId:'private-handle',peerCertificateSha256:'b'.repeat(64)}),
    cancel:async()=>{closed++;},confirm:async(id)=>{assert.equal(id,'private-handle');confirmed++;return {private:'configuration'};}};
  const controller=createTLSSetupController('/fixture',{startHost:async()=>host});
  assert.equal((await controller.run({action:'host-start',address:'10.0.0.2',port:0})).status,'hosting');
  const status=await controller.run({action:'status'});
  assert.deepEqual(status,{status:'confirming',peerCertificateSha256:'b'.repeat(64)});
  const command={action:'host-confirm',peerCertificateSha256:'b'.repeat(64),localEndpoint:{},peerEndpoint:{}};
  await assert.rejects(controller.run({...command,includeUbuntu:false}));
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
  let cancelled=false,secondCancelled=false;
  const cancellation=controller.cancel().then(result=>{cancelled=true;return result;});
  const second=controller.run({action:'cancel'}).then(result=>{secondCancelled=true;return result;});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(cancelled,false);assert.equal(secondCancelled,false);
  assert.equal((await controller.run({action:'status'})).status,'idle');
  assert.equal((await controller.run({action:'pending-peer'})).peerAddress,null);
  await assert.rejects(controller.run({action:'host-start',address:'10.0.0.2',port:0}));
  finish({cancel:async()=>{closed++;}});
  assert.deepEqual(await cancellation,{status:'cancelled'});
  assert.deepEqual(await second,{status:'cancelled'});
  assert.deepEqual(await operation,{status:'cancelled'});assert.equal(closed,1);
});

test('cancel closes the listener before waiting for confirmation settlement',async()=>{
  for(const rejected of [false,true]) {
    let finish,listenerClosed=false,cancelled=false;
    const host={invitation:invite(),status:()=> 'confirming',
      pending:()=>({claimId:'synthetic',peerCertificateSha256:'b'.repeat(64)}),
      confirm:()=>new Promise((resolve,reject)=>{finish=()=>rejected?reject(Error('Synthetic failure')):resolve();}),
      cancel:async()=>{listenerClosed=true;}};
    const controller=createTLSSetupController('/fixture',{startHost:async()=>host});
    await controller.run({action:'host-start',address:'10.0.0.2',port:0});
    const operation=controller.run({action:'host-confirm',peerCertificateSha256:'b'.repeat(64),localEndpoint:{},peerEndpoint:{}})
      .catch(()=>({status:'unavailable'}));
    const cancellation=controller.cancel().then(result=>{cancelled=true;return result;});
    const second=controller.cancel();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(listenerClosed,true);assert.equal(cancelled,false);
    assert.equal((await controller.run({action:'status'})).status,'idle');
    finish();
    assert.ok(['cancelled','unavailable'].includes((await operation).status));
    assert.deepEqual(await cancellation,{status:'cancelled'});
    assert.deepEqual(await second,{status:'cancelled'});
  }
});

test('joining keeps private identity out of responses and aborts an in-flight claim',async()=>{
  let entered;
  const started=new Promise(resolve=>{entered=resolve;});
  const controller=createTLSSetupController('/fixture',{readRepair:async()=>null,readIdentity:async()=>({key:'private-key'}),
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
  const runtime=await realpath(await mkdtemp(path.join(runtimeBase,'observatory-control-test-')));
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

test('join confirmation accepts only the action key',async()=>{
  let received=0;
  const controller=createTLSSetupController('/fixture',{readRepair:async()=>null,readIdentity:async()=>({}),
    claim:async()=>({status:'awaiting-confirmation'}),receive:async(_runtime,_invitation,options)=>{
      assert.ok(options.signal);received++;return {status:'acknowledged'};
    }});
  await controller.run({action:'join-claim',invitation:encodeInvitation(invite())});
  await assert.rejects(controller.run({action:'join-confirm',includeUbuntu:false}));
  assert.equal(received,0);
  assert.deepEqual(await controller.run({action:'join-confirm'}),{status:'acknowledged'});
  assert.equal(received,1);
});

test('repair consent reaches the claim but never controller or pipe replies',async()=>{
  const nonce='d'.repeat(64);
  for(const repairNonce of [nonce,null]) {
    const controller=createTLSSetupController('/fixture',{readRepair:async()=>repairNonce,readIdentity:async()=>({}),
      claim:async(_invitation,_identity,options)=>{
        assert.equal(options.repairNonce,repairNonce);assert.ok(options.signal);
        return {status:'awaiting-confirmation',repairNonce};
      }});
    const input=new PassThrough(),output=new PassThrough(),replies=[];
    output.on('data',bytes=>replies.push(bytes.toString()));
    const serving=serveTLSSetupControl('/fixture',input,output,{controller});
    for(const [id,command] of [[1,{action:'join-claim',invitation:encodeInvitation(invite())}],[2,{action:'status'}]]) {
      const response=once(output,'data');input.write(JSON.stringify({id,command})+'\n');await response;
    }
    input.end();await serving;
    assert.equal(replies.join('').includes(nonce),false);
    assert.equal(JSON.parse(replies[0]).status,'awaiting-confirmation');
  }
  let claimed=false;
  const broken=createTLSSetupController('/fixture',{readIdentity:async()=>({}),readRepair:async()=>{throw Error(nonce);},
    claim:async()=>{claimed=true;}});
  await assert.rejects(broken.run({action:'join-claim',invitation:encodeInvitation(invite())}),{message:'Setup command unavailable'});
  assert.equal(claimed,false);
  const controller=createTLSSetupController('/fixture',{startHost:async()=>({invitation:invite(),
    pending:()=>({peerCertificateSha256:'b'.repeat(64),peerRepairNonce:nonce}),status:()=> 'confirming',cancel:async()=>{}})});
  for(const command of [{action:'host-start',address:'10.0.0.2',port:0},{action:'status'},{action:'cancel'}])
    assert.equal(JSON.stringify(await controller.run(command)).includes(nonce),false);
});

for(const mode of ['host','join'])test(`${mode} sharing failure keeps the committed confirmation`,async()=>{
  for(const sharing of [undefined,false,true,'true'])for(const broken of [false,true]) {
    let confirmed=0,chosen=0,cancelled=0;
    const controller=createTLSSetupController('/fixture',{
      startHost:async()=>({invitation:invite(),pending:()=>({claimId:'synthetic',peerCertificateSha256:'b'.repeat(64)}),
        status:()=>confirmed?'configuration-ready':'confirming',
        confirm:async()=>{confirmed++;},cancel:async()=>{cancelled++;}}),
      readRepair:async()=>null,readIdentity:async()=>({}),claim:async()=>({status:'awaiting-confirmation'}),
      receive:async()=>{confirmed++;return {status:'local-ready'};},
      choose:async(runtime,choice)=>{
        assert.equal(runtime,'/fixture');assert.deepEqual(choice,{enabled:true});assert.equal(confirmed,1);chosen++;
        if(broken)throw Error('Synthetic choice failure');
      }});
    if(mode==='host')await controller.run({action:'host-start',address:'10.0.0.2',port:0});
    else await controller.run({action:'join-claim',invitation:encodeInvitation(invite())});
    const command=mode==='host'?{action:'host-confirm',peerCertificateSha256:'b'.repeat(64),localEndpoint:{},peerEndpoint:{}}:{action:'join-confirm'};
    if(sharing!==undefined)command.sharing=sharing;
    if(typeof sharing==='string') {
      await assert.rejects(controller.run(command));assert.equal(confirmed,0);
    } else if(sharing===true && broken) {
      const input=new PassThrough(),output=new PassThrough();
      const serving=serveTLSSetupControl('/fixture',input,output,{controller});
      const response=once(output,'data');
      input.write(JSON.stringify({id:1,command})+'\n');
      assert.deepEqual(JSON.parse((await response)[0]),{id:1,status:mode==='host'?'configuration-ready':'local-ready'});
      assert.equal((await controller.run({action:'status'})).status,mode==='host'?'configuration-ready':'local-ready');
      assert.equal(confirmed,1);assert.equal(chosen,1);assert.equal(cancelled,0);
      input.end();await serving;
    } else assert.deepEqual(await controller.run(command),{status:mode==='host'?'configuration-ready':'local-ready'});
    assert.equal(chosen,sharing===true?1:0);
  }
});
test('join sharing waits for a ready pairing and also records acknowledged success',async()=>{
  for(const status of ['awaiting-confirmation','acknowledged']) {
    let chosen=0;
    const controller=createTLSSetupController('/fixture',{readRepair:async()=>null,readIdentity:async()=>({}),
      claim:async()=>({status:'awaiting-confirmation'}),receive:async()=>({status}),choose:async()=>{chosen++;}});
    await controller.run({action:'join-claim',invitation:encodeInvitation(invite())});
    assert.deepEqual(await controller.run({action:'join-confirm',sharing:true}),{status});
    assert.equal(chosen,status==='acknowledged'?1:0);
  }
});

async function choiceFixture(t,mode,receive=async()=>({status:'local-ready'})) {
  const runtime=await realpath(await mkdtemp(path.join(runtimeBase,'observatory-control-choice-')));
  t.after(()=>rm(runtime,{recursive:true,force:true}));
  await initializePairing(runtime,createPairingConfigurations().Mac);
  const pair=await readPairing(runtime);
  const controller=createTLSSetupController(runtime,{
    startHost:async()=>({invitation:invite(),pending:()=>({claimId:'synthetic',peerCertificateSha256:'b'.repeat(64)}),
      status:()=> 'configuration-ready',confirm:async()=>{},cancel:async()=>{}}),
    readRepair:async()=>null,readIdentity:async()=>({}),claim:async()=>({status:'awaiting-confirmation'}),
    receive});
  t.after(()=>controller.cancel());
  if(mode==='host')await controller.run({action:'host-start',address:'10.0.0.2',port:0});
  else await controller.run({action:'join-claim',invitation:encodeInvitation(invite())});
  const command=mode==='host'?{action:'host-confirm',peerCertificateSha256:'b'.repeat(64),localEndpoint:{},peerEndpoint:{}}:{action:'join-confirm'};
  return {runtime,pair,controller,command};
}

for(const mode of ['host','join'])test(`${mode} committed confirmation survives a real sharing lock timeout and permits retry`,async t=>{
  const {runtime,pair,controller,command}=await choiceFixture(t,mode);
  let acquired,release;
  const ready=new Promise(resolve=>{acquired=resolve;}),held=new Promise(resolve=>{release=resolve;});
  // Start confirmation outside the lock context so it cannot reuse the lease.
  const locking=withPeerStateLock(runtime,async()=>{acquired();await held;});
  try {
    await Promise.race([ready,locking]);
    assert.deepEqual(await controller.run({...command,sharing:true}),{status:mode==='host'?'configuration-ready':'local-ready'});
  } finally {release();await locking;}
  assert.equal((await readPairing(runtime)).local.pairId,pair.local.pairId);
  const choice=await readSharingChoice(runtime);
  assert.equal(choice.chosen,false);
  assert.deepEqual(choice.channels,{'codex-limits':'off','claude-code-tokens':'off'});
  await assert.rejects(lstat(path.join(runtime,'private-sync','sharing-choice.json')),{code:'ENOENT'});
  assert.deepEqual((await readdir(path.join(runtime,'private-sync'))).filter(name=>name.endsWith('.pending')),[]);
  await chooseSharing(runtime,{enabled:true});
  assert.equal((await readSharingChoice(runtime)).chosen,true);
});

for(const sharing of [true,false,undefined])test(`host committed confirmation records real sharing only for true with choice ${sharing}`,async t=>{
  const {runtime,controller,command}=await choiceFixture(t,'host');
  if(sharing!==undefined)command.sharing=sharing;
  assert.deepEqual(await controller.run(command),{status:'configuration-ready'});
  assert.equal((await readSharingChoice(runtime)).chosen,sharing===true);
});

test('join retry records real sharing after a lock timeout',async t=>{
  let received=0;
  const {runtime,controller,command}=await choiceFixture(t,'join',async()=>({status:++received===1?'local-ready':'acknowledged'}));
  let acquired,release;
  const ready=new Promise(resolve=>{acquired=resolve;}),held=new Promise(resolve=>{release=resolve;});
  // Start confirmation outside the lock context so it cannot reuse the lease.
  const locking=withPeerStateLock(runtime,async()=>{acquired();await held;});
  try {
    await Promise.race([ready,locking]);
    assert.deepEqual(await controller.run({...command,sharing:true}),{status:'local-ready'});
  } finally {release();await locking;}
  assert.deepEqual(await readSharingChoice(runtime),{version:1,chosen:false,channels:{'codex-limits':'off','claude-code-tokens':'off'}});
  assert.deepEqual(await controller.run({...command,sharing:true}),{status:'acknowledged'});
  assert.equal((await readSharingChoice(runtime)).chosen,true);
  assert.equal(received,2);
});

for(const sharing of [true,false,undefined])test(`join committed confirmation records real sharing only for true with choice ${sharing}`,async t=>{
  const {runtime,controller,command}=await choiceFixture(t,'join');
  if(sharing!==undefined)command.sharing=sharing;
  assert.deepEqual(await controller.run(command),{status:'local-ready'});
  assert.equal((await readSharingChoice(runtime)).chosen,sharing===true);
});
