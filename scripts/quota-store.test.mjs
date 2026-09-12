import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,stat,symlink,writeFile,readFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {readQuotaState,updateQuotaState,setQuotaSharing} from './quota-store.mjs';
const now=Date.parse('2026-09-09T12:00:00Z'),scope='a'.repeat(64);
const observation={status:'ok',checkedAt:new Date(now).toISOString(),windows:[{bucket:'codex',window:'primary',remainingPercent:75}]};
async function fixture(action) {const runtime=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-quota-')));try{await action(runtime);}finally{await rm(runtime,{recursive:true,force:true});}}
test('quota store survives reopen with private permissions and persisted retry deadline',async()=>fixture(async runtime=>{
  const initial=await readQuotaState(runtime,now);
  const result=await updateQuotaState(runtime,{revision:initial.revision,scope,observation,nextAttemptAt:now+300000},now);
  const reopened=await readQuotaState(runtime,now+1000);
  assert.equal(reopened.salt,initial.salt);assert.equal(reopened.revision,result.revision);
  assert.equal(reopened.history.status,'stale');assert.equal(reopened.history.samples.length,1);
  assert.equal(reopened.nextAttemptAt,now+300000);
  if(process.platform!=='win32')assert.equal((await stat(path.join(runtime,'private-quota/state.sqlite'))).mode&0o077,0);
}));
test('quota store rejects late writes after disabling and does not resurrect readings',async()=>fixture(async runtime=>{
  const initial=await readQuotaState(runtime,now);
  const first=await updateQuotaState(runtime,{revision:initial.revision,scope,observation},now);
  await updateQuotaState(runtime,{revision:first.revision,enabled:false},now);
  await assert.rejects(updateQuotaState(runtime,{revision:first.revision,scope,observation},now),/superseded/);
  const final=await readQuotaState(runtime,now);
  assert.equal(final.history.status,'not-connected');assert.deepEqual(final.history.samples,[]);
}));
test('quota store refuses symlinked state without modifying its target',{skip:process.platform==='win32'},async()=>fixture(async runtime=>{
  const directory=path.join(runtime,'private-quota');await mkdir(directory,{mode:0o700});
  const target=path.join(runtime,'sentinel');await writeFile(target,'preserve');
  await symlink(target,path.join(directory,'state.sqlite'));
  await assert.rejects(readQuotaState(runtime,now));assert.equal(await readFile(target,'utf8'),'preserve');
}));

test('sharing requires a known account, persists consent and rotates on new consent',async()=>fixture(async runtime=>{
  const initial=await readQuotaState(runtime,now),pairingId='c'.repeat(64);
  assert.equal(initial.sharing.enabled,false);
  await assert.rejects(setQuotaSharing(runtime,{revision:initial.revision,enabled:true,pairingId},now),/current account/);
  const collected=await updateQuotaState(runtime,{revision:initial.revision,scope,observation},now);
  const shared=await setQuotaSharing(runtime,{revision:collected.revision,enabled:true,pairingId},now);
  assert.equal(shared.sharing.enabled,true);assert.notEqual(shared.sharing.generation,scope);
  assert.deepEqual((await readQuotaState(runtime,now)).sharing,shared.sharing);
  const renewed=await setQuotaSharing(runtime,{revision:shared.revision,enabled:true,pairingId:'d'.repeat(64)},now);
  assert.notEqual(renewed.sharing.generation,shared.sharing.generation);
  const disabled=await setQuotaSharing(runtime,{revision:renewed.revision,enabled:false},now);
  assert.equal(disabled.sharing.enabled,false);assert.equal(disabled.history.samples.length,1);
  await assert.rejects(updateQuotaState(runtime,{revision:renewed.revision,scope,observation},now),/superseded/);
}));

test('account changes, sign-out and monitoring disable revoke sharing without automatic reenable',async()=>{
  for(const change of [{scope:'b'.repeat(64),observation},{scope,observation:{status:'needs-auth'}},{enabled:false}]) {
    await fixture(async runtime=>{
      const initial=await readQuotaState(runtime,now);
      const collected=await updateQuotaState(runtime,{revision:initial.revision,scope,observation},now);
      const shared=await setQuotaSharing(runtime,{revision:collected.revision,enabled:true,pairingId:'c'.repeat(64)},now);
      const changed=await updateQuotaState(runtime,{revision:shared.revision,...change},now);
      assert.equal(changed.sharing.enabled,false);assert.equal(changed.sharing.generation,null);
      const resumed=await updateQuotaState(runtime,{revision:changed.revision,scope,observation},now);
      assert.equal(resumed.sharing.enabled,false);
    });
  }
});
