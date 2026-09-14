import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {quotaArchiveControl} from './quota-archive-control.mjs';
import {readQuotaState,updateQuotaState} from './quota-store.mjs';

const start=Date.parse('2025-01-01T12:00:00Z');
const cli=fileURLToPath(new URL('./quota-archive-control.mjs',import.meta.url));
async function fixture(t) {
  const root=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-archive-control-')));
  t.after(()=>rm(root,{recursive:true,force:true}));return root;
}
async function save(root,scope,at,enabled=true) {
  const before=await readQuotaState(root,at);
  await updateQuotaState(root,{revision:before.revision,scope,enabled,
    observation:{status:'ok',checkedAt:new Date(at).toISOString(),secret:'excluded',
      windows:[{bucket:'codex',window:'primary',remainingPercent:70}]}},at);
}
test('opening an empty archive does not initialize collection or private storage',async t=>{
  const root=await fixture(t);
  assert.deepEqual((await quotaArchiveControl(root,{action:'accounts'})).accounts,[]);
  assert.deepEqual(await readdir(root),[]);
  await assert.rejects(quotaArchiveControl(root,{action:'delete'}));
  await assert.rejects(quotaArchiveControl(root,{action:'accounts',secret:'no'}));
});
test('native process protocol returns bounded JSON and generic failures without leaking input',async t=>{
  const root=await fixture(t);
  const run=input=>spawnSync(process.execPath,[cli,'--runtime',root],{input,encoding:'utf8',timeout:20000,maxBuffer:600000});
  const good=run(JSON.stringify({action:'accounts'}));
  assert.equal(good.status,0);assert.equal(JSON.parse(good.stdout).version,1);
  for(const input of ['private malformed input',JSON.stringify({action:'accounts',secret:'private'}),' '.repeat(2049)]) {
    const bad=run(input);assert.equal(bad.status,1);assert.equal(bad.stdout,'');
    assert.equal(bad.stderr.includes('private'),false);
  }
  assert.deepEqual(await readdir(root),[]);
});
test('account catalogue pages retained scopes without merging accounts or exposing state',async t=>{
  const root=await fixture(t),first='a'.repeat(64),second='b'.repeat(64);
  await save(root,first,start);await save(root,second,start+1);
  const a=await quotaArchiveControl(root,{action:'accounts',limit:1});
  assert.equal(a.accounts.length,1);assert.equal(a.accounts[0].scope,first);assert.equal(a.accounts[0].current,false);
  assert.equal(a.accounts[0].records,2);assert.equal(a.next,first);assert.ok(a.storageBytes>0);
  const b=await quotaArchiveControl(root,{action:'accounts',limit:1,after:a.next});
  assert.equal(b.accounts[0].scope,second);assert.equal(b.accounts[0].current,true);assert.equal(b.next,null);
  assert.equal(JSON.stringify(a).includes('salt'),false);assert.equal(JSON.stringify(a).includes('secret'),false);
  await save(root,second,start+2,false);
  const disabled=await quotaArchiveControl(root,{action:'accounts'});
  assert.equal(disabled.accounts.length,2);assert.ok(disabled.accounts.every(row=>!row.current));
});
test('history interface requires explicit bounds, retains pagination and rejects extra fields',async t=>{
  const root=await fixture(t),scope='a'.repeat(64);
  await save(root,scope,start);await save(root,scope,start+1);
  const query={action:'page',scope,kind:'observation',from:start,to:start+1,limit:1};
  const a=await quotaArchiveControl(root,query);
  assert.equal(a.records.length,1);assert.ok(a.next);
  const b=await quotaArchiveControl(root,{...query,after:a.next});
  assert.equal(b.records.length,1);assert.equal(b.next,null);
  assert.notEqual(a.records[0].checkedAt,b.records[0].checkedAt);
  assert.equal(JSON.stringify(a).includes('secret'),false);
  for(const override of [{from:undefined},{to:start-1},{scope:'email'},{limit:201},{after:{at:start,id:1,extra:true}},{url:'https://example.com'}])
    await assert.rejects(quotaArchiveControl(root,{...query,...override}));
});
