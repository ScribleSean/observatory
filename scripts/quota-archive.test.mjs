import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {readQuotaState,updateQuotaState,readQuotaArchive,inspectQuotaArchive,deleteQuotaArchive,setQuotaSharing} from './quota-store.mjs';

const start=Date.parse('2025-01-01T12:00:00Z'),scope='a'.repeat(64),other='b'.repeat(64);
const sample=(at=start)=>({status:'ok',checkedAt:new Date(at).toISOString(),privateToken:'not-retained',
  windows:[{bucket:'codex',window:'primary',remainingPercent:75}],
  accountUsage:{status:'ok',checkedAt:new Date(at).toISOString(),dailyUsageBuckets:[{startDate:'2025-01-01',tokens:123,secret:'not-retained'}]}});
async function fixture(t) {
  const root=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-quota-archive-')));
  t.after(()=>rm(root,{recursive:true,force:true}));return root;
}
async function save(root,at,options={}) {
  const before=await readQuotaState(root,at);
  return updateQuotaState(root,{revision:before.revision,scope,observation:sample(at),...options},at);
}
test('archive survives recent-cache expiry, monitoring disable, account change and reopen',async t=>{
  const root=await fixture(t);await save(root,start);
  const future=start+400*86400000;
  assert.equal((await readQuotaState(root,future)).history.samples.length,0);
  await save(root,future,{scope:other});
  await save(root,future+1,{enabled:false,scope:undefined});
  const page=await readQuotaArchive(root,{scope,kind:'observation'});
  assert.equal(page.records.length,1);assert.equal(page.records[0].checkedAt,new Date(start).toISOString());
  assert.equal((await readQuotaArchive(root,{scope:other,kind:'observation'})).records.length,1);
  assert.equal((await readQuotaArchive(root,{scope,kind:'daily'})).records[0].tokens,123);
  assert.equal(JSON.stringify(page).includes('privateToken'),false);
  assert.equal(JSON.stringify(await readQuotaArchive(root,{scope,kind:'daily'})).includes('secret'),false);
});
test('queries paginate in timestamp order with bounded limits and deduplicate readings',async t=>{
  const root=await fixture(t);
  for(let index=0;index<3;index++)await save(root,start+index*300000);
  await save(root,start+600000);
  const first=await readQuotaArchive(root,{scope,kind:'observation',limit:2});
  assert.equal(first.records.length,2);assert.ok(first.next);
  const second=await readQuotaArchive(root,{scope,kind:'observation',limit:2,after:first.next});
  assert.equal(second.records.length,1);assert.equal(second.next,null);
  assert.equal((await readQuotaArchive(root,{scope,kind:'observation',from:start+1,to:start+599999})).records.length,1);
  for(const query of [{limit:201},{scope:'raw-email'},{kind:'secret'},{after:{id:0,at:start}},{from:10,to:1}])
    await assert.rejects(readQuotaArchive(root,{scope,kind:'observation',...query}));
});
test('failed checks are not observations and superseded writes create no archive rows',async t=>{
  const root=await fixture(t),initial=await readQuotaState(root,start);
  await save(root,start);
  await save(root,start+1,{observation:{status:'rate-limited',message:'private error'}});
  await assert.rejects(updateQuotaState(root,{revision:initial.revision,scope,observation:sample(start+2)},start+2));
  const polls=await readQuotaArchive(root,{scope,kind:'poll'});
  assert.deepEqual(polls.records.map(row=>row.status),['ok','rate-limited']);
  assert.equal(JSON.stringify(polls).includes('private error'),false);
  assert.equal((await readQuotaArchive(root,{scope,kind:'observation'})).records.length,1);
});
test('legacy migration backfills before an expired cache is pruned and never repeats',async t=>{
  const root=await fixture(t);await save(root,start);
  const file=path.join(root,'private-quota','state.sqlite');
  const db=new DatabaseSync(file);
  try {db.exec('DROP TABLE quota_archive');} finally {db.close();}
  await readQuotaState(root,start+400*86400000);
  assert.equal((await readQuotaArchive(root,{scope,kind:'observation'})).records.length,1);
  await readQuotaState(root,start+401*86400000);
  assert.equal((await readQuotaArchive(root,{scope,kind:'observation'})).records.length,1);
});
test('unexpected archive schema fails closed without updating cache',async t=>{
  const root=await fixture(t);await save(root,start);
  const file=path.join(root,'private-quota','state.sqlite'),db=new DatabaseSync(file);
  let before;
  try {before=db.prepare('SELECT record FROM quota_state').get().record;db.exec('CREATE TABLE unexpected (secret TEXT)');}
  finally {db.close();}
  await assert.rejects(readQuotaArchive(root,{scope,kind:'observation'}));
  const after=new DatabaseSync(file);
  try {assert.equal(after.prepare('SELECT record FROM quota_state').get().record,before);} finally {after.close();}
});

test('explicit deletion invalidates collectors, clears current cache and sharing, and preserves other accounts',async t=>{
  const root=await fixture(t);await save(root,start,{scope:other});await save(root,start+1);
  const current=await readQuotaState(root,start+1);
  await setQuotaSharing(root,{revision:current.revision,enabled:true,pairingId:'c'.repeat(64)},start+1);
  const pending=await readQuotaState(root,start+1);
  const before=await inspectQuotaArchive(root,{scope},start+1);
  assert.ok(before.storageBytes>0 && before.storageBytes<before.storageLimitBytes);
  assert.equal(before.groups.reduce((sum,row)=>sum+row.count,0),3);
  await assert.rejects(deleteQuotaArchive(root,{scope,token:before.token,confirmation:'yes'},start+1));
  await assert.rejects(deleteQuotaArchive(root,{scope:other,token:before.token,confirmation:'delete-account-history'},start+1));
  assert.equal((await deleteQuotaArchive(root,{scope,token:before.token,confirmation:'delete-account-history'},start+1)).deletedRecords,3);
  await assert.rejects(updateQuotaState(root,{revision:pending.revision,scope,observation:sample(start+2)},start+2),/superseded/);
  assert.equal((await readQuotaArchive(root,{scope,kind:'observation'})).records.length,0);
  assert.equal((await readQuotaArchive(root,{scope:other,kind:'observation'})).records.length,1);
  const after=await readQuotaState(root,start+2);
  assert.equal(after.history.samples.length,0);assert.equal(after.sharing.enabled,false);
  assert.equal((await inspectQuotaArchive(root,{scope},start+2)).token,null);
  await assert.rejects(deleteQuotaArchive(root,{scope,token:before.token,confirmation:'delete-account-history'},start+2));
});

test('stale deletion cannot erase newer records and deleting an old account preserves the active account',async t=>{
  const root=await fixture(t);await save(root,start);
  const old=await inspectQuotaArchive(root,{scope},start);
  await save(root,start+1,{scope:other});
  await assert.rejects(deleteQuotaArchive(root,{scope,token:old.token,confirmation:'delete-account-history'},start+1),/expired/);
  const fresh=await inspectQuotaArchive(root,{scope},start+1);
  await deleteQuotaArchive(root,{scope,token:fresh.token,confirmation:'delete-account-history'},start+1);
  assert.equal((await readQuotaState(root,start+1)).history.scope,other);
  assert.equal((await readQuotaArchive(root,{scope:other,kind:'observation'})).records.length,1);
});

test('deletion cannot initialize an unconfigured quota store',async t=>{
  const root=await fixture(t);
  await assert.rejects(deleteQuotaArchive(root,{scope,token:'c'.repeat(64),confirmation:'delete-account-history'},start));
  await assert.rejects(lstat(path.join(root,'private-quota')),{code:'ENOENT'});
  await assert.rejects(lstat(path.join(root,'private-repair')),{code:'ENOENT'});
});
