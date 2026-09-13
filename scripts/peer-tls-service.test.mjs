import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createTrustedSyncService} from './peer-tls-service.mjs';

const binding=port=>({pairing:{localEndpoint:{kind:'tls',address:'10.0.0.2',port}},trust:{version:1}});
function fixture() {
  let current=null,starts=0,closes=0,scheduled=0;
  const live=[];
  const service=createTrustedSyncService('/synthetic',{read:async()=>current,
    start:async(_runtime,endpoint,options)=>{
      assert.deepEqual(endpoint,options.expectedPairing.localEndpoint);starts++;
      const value={open:true,isListening(){return this.open;},async close(){if(this.open)closes++;this.open=false;}};
      live.push(value);return value;
    },schedule:()=>++scheduled,unschedule:()=>scheduled--});
  return {service,live,set:value=>current=value,counts:()=>({starts,closes,scheduled})};
}
test('service reuses unchanged binding and closes before replacement or revocation',async()=>{
  const f=fixture();
  assert.deepEqual(await f.service.run({action:'status'}),{status:'sync-disabled'});
  f.set(binding(43128));
  assert.deepEqual(await f.service.reconcile(),{status:'sync-listening'});
  await f.service.reconcile();assert.equal(f.counts().starts,1);
  f.set(binding(43129));await f.service.reconcile();
  assert.deepEqual(f.counts(),{starts:2,closes:1,scheduled:1});
  f.set(null);assert.deepEqual(await f.service.reconcile(),{status:'sync-disabled'});
  assert.equal(f.counts().closes,2);
  await f.service.cancel();await f.service.cancel();
  assert.equal(f.counts().scheduled,0);
  await assert.rejects(f.service.run({action:'status'}));
});
test('service retries a dead listener and never accepts setup commands',async()=>{
  const f=fixture();f.set(binding(43128));await f.service.reconcile();
  f.live[0].open=false;await f.service.reconcile();assert.equal(f.counts().starts,2);
  await assert.rejects(f.service.run({action:'host-start'}));
  await assert.rejects(f.service.run({action:'status',address:'0.0.0.0'}));
  await f.service.cancel();
});
test('cancellation drains a late start without leaving its listener alive',async()=>{
  let resolveStart,closed=0;
  const started=new Promise(resolve=>resolveStart=resolve);
  const service=createTrustedSyncService('/synthetic',{read:async()=>binding(43128),start:()=>started});
  const opening=service.reconcile();await Promise.resolve();await Promise.resolve();
  const closing=service.cancel();
  resolveStart({isListening:()=>true,close:async()=>closed++});
  await Promise.all([opening,closing]);assert.equal(closed,1);
});
test('failed revalidation closes the just-created listener',async()=>{
  let reads=0,closed=0;
  const service=createTrustedSyncService('/synthetic',{
    read:async()=>{if(++reads>1)throw Error('changed');return binding(43128);},
    start:async()=>({isListening:()=>true,close:async()=>closed++})});
  assert.deepEqual(await service.reconcile(),{status:'unavailable'});
  assert.equal(closed,1);await service.cancel();
});
test('native-owned child stays inert without pairing and exits on parent EOF',{timeout:15000},async()=>{
  const runtime=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-sync-service-')));
  const child=spawn(process.execPath,[fileURLToPath(new URL('./peer-tls-service.mjs',import.meta.url)),'--runtime',runtime],{stdio:['pipe','pipe','pipe']});
  try {
    const exit=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
    const reply=new Promise((resolve,reject)=>{
      let data='';child.stdout.on('data',chunk=>{data+=chunk;if(data.length>8192)reject(Error('Reply limit'));else if(data.includes('\n'))resolve(JSON.parse(data.trim()));});
      child.once('error',reject);
    });
    child.stdin.write(JSON.stringify({id:1,command:{action:'status'}})+'\n');
    assert.deepEqual(await reply,{id:1,status:'sync-disabled'});
    child.stdin.end();assert.deepEqual(await exit,{code:0,signal:null});
  } finally {if(child.exitCode===null)child.kill();await rm(runtime,{recursive:true,force:true});}
});
