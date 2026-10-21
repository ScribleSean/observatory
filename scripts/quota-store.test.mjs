import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,stat,symlink,writeFile,readFile,mkdir} from 'node:fs/promises';
import {testRuntimeBase} from './test-runtime-base.mjs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {readQuotaState,updateQuotaState} from './quota-store.mjs';

const runtimeBase=await testRuntimeBase('quota-store');
after(()=>rm(runtimeBase,{recursive:true,force:true}));
const now=Date.parse('2026-09-09T12:00:00Z'),scope='a'.repeat(64);
const observation={status:'ok',checkedAt:new Date(now).toISOString(),windows:[{bucket:'codex',window:'primary',remainingPercent:75}]};
async function fixture(action) {const runtime=await realpath(await mkdtemp(path.join(runtimeBase,'observatory-quota-')));try{await action(runtime);}finally{await rm(runtime,{recursive:true,force:true});}}
test('quota store survives reopen with private permissions and persisted retry deadline',async()=>fixture(async runtime=>{
  const initial=await readQuotaState(runtime,now);
  const result=await updateQuotaState(runtime,{revision:initial.revision,scope,observation,nextAttemptAt:now+300000},now);
  const reopened=await readQuotaState(runtime,now+1000);
  assert.equal(reopened.salt,initial.salt);assert.equal(reopened.revision,result.revision);
  assert.equal(reopened.history.status,'ok');assert.equal(reopened.history.samples.length,1);
  assert.equal(reopened.nextAttemptAt,now+300000);
  if(process.platform!=='win32')assert.equal((await stat(path.join(runtime,'private-quota/state.sqlite'))).mode&0o077,0);
}));

for(const status of ['ok','stale','unavailable','needs-auth','unsupported']) {
  test(`quota store preserves saved ${status} history on repeated reloads`,async()=>fixture(async runtime=>{
    let saved=await readQuotaState(runtime,now);
    if(status!=='unavailable')saved=await updateQuotaState(runtime,{revision:saved.revision,scope,observation:{...observation,
      accountUsage:{status:'ok',dailyUsageBuckets:[{startDate:'2026-09-09',tokens:123}]}}},now);
    if(status!=='ok')saved=await updateQuotaState(runtime,{revision:saved.revision,scope,
      observation:{status:status==='stale'?'rate-limited':status}},now);
    assert.equal(saved.history.status,status);
    for(const offset of [60000,120000]) {
      const reopened=await readQuotaState(runtime,now+offset);
      assert.deepEqual(reopened.history,saved.history);
    }
  }));
}

test('quota store refuses a tampered saved status',async()=>fixture(async runtime=>{
  const initial=await readQuotaState(runtime,now);
  await updateQuotaState(runtime,{revision:initial.revision,scope,observation},now);
  const db=new DatabaseSync(path.join(runtime,'private-quota/state.sqlite'));
  try {
    const saved=JSON.parse(db.prepare('SELECT record FROM quota_state WHERE slot=1').get().record);
    saved.history.status='invented';
    db.prepare('UPDATE quota_state SET record=? WHERE slot=1').run(JSON.stringify(saved));
  } finally {db.close();}
  await assert.rejects(readQuotaState(runtime,now+60000),/Invalid saved quota status/);
}));

test('quota store still trims expired samples instead of keeping an empty history ok',async()=>fixture(async runtime=>{
  const initial=await readQuotaState(runtime,now);
  await updateQuotaState(runtime,{revision:initial.revision,scope,observation},now);
  const reopened=await readQuotaState(runtime,now+31*86400000);
  assert.equal(reopened.history.status,'unavailable');
  assert.deepEqual(reopened.history.samples,[]);
}));
test('quota store reloads an expired stale history as unavailable, never stale with no samples',async()=>fixture(async runtime=>{
  let saved=await readQuotaState(runtime,now);
  saved=await updateQuotaState(runtime,{revision:saved.revision,scope,observation},now);
  saved=await updateQuotaState(runtime,{revision:saved.revision,scope,observation:{status:'rate-limited'}},now);
  assert.equal(saved.history.status,'stale');
  const reopened=await readQuotaState(runtime,now+31*86400000);
  assert.equal(reopened.history.status,'unavailable');
  assert.deepEqual(reopened.history.samples,[]);
}));
test('quota store does not reload a saved ok history as ok when the clock is behind its latest sample',async()=>fixture(async runtime=>{
  const initial=await readQuotaState(runtime,now);
  await updateQuotaState(runtime,{revision:initial.revision,scope,observation},now);
  const reopened=await readQuotaState(runtime,now-60000);
  assert.notEqual(reopened.history.status,'ok');
}));
test('quota store rejects late writes after disabling and does not resurrect readings',async()=>fixture(async runtime=>{
  const initial=await readQuotaState(runtime,now);
  const first=await updateQuotaState(runtime,{revision:initial.revision,scope,observation},now);
  await updateQuotaState(runtime,{revision:first.revision,enabled:false},now);
  await assert.rejects(updateQuotaState(runtime,{revision:first.revision,scope,observation},now),/superseded/);
  const final=await readQuotaState(runtime,now);
  assert.equal(final.history.status,'not-connected');assert.deepEqual(final.history.samples,[]);
}));
test('quota store refuses symlinked state without modifying its target',{skip:process.platform==='win32' && 'Requires POSIX symbolic links'},async()=>fixture(async runtime=>{
  const directory=path.join(runtime,'private-quota');await mkdir(directory,{mode:0o700});
  const target=path.join(runtime,'sentinel');await writeFile(target,'preserve');
  await symlink(target,path.join(directory,'state.sqlite'));
  await assert.rejects(readQuotaState(runtime,now));assert.equal(await readFile(target,'utf8'),'preserve');
}));
