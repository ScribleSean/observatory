import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {testRuntimeBase} from './test-runtime-base.mjs';
import {createPairingConfigurations,initializePairing} from './peer-pairing.mjs';
import {unavailableClaudeTokenSource} from './provider-token-sources.mjs';
import {readProviderTokenState,updateProviderTokenSource} from './provider-token-store.mjs';

const now=Date.parse('2026-10-18T12:00:00Z');
const runtimeBase=await testRuntimeBase('provider-token-store');
after(()=>rm(runtimeBase,{recursive:true,force:true}));
const source=at=>unavailableClaudeTokenSource('Mac',new Date(at).toISOString());
async function fixture(t) {
  const runtime=await realpath(await mkdtemp(path.join(runtimeBase,'store-')));
  t.after(()=>rm(runtime,{recursive:true,force:true}));
  const pair=createPairingConfigurations();
  pair.Mac.transport={kind:'ssh-windows',hostAlias:'synthetic',remoteNode:'C:/App/node.exe',remoteScript:'C:/App/peer-exchange.mjs',remoteRuntime:'C:/Runtime'};
  await initializePairing(runtime,pair.Mac);
  const file=path.join(runtime,'private-sync','provider-tokens.sqlite');
  await writeFile(file,'',{mode:0o600});
  return {runtime,file};
}

for(const operation of ['read','write'])test(`empty private provider database recovers on ${operation}`,async t=>{
  const {runtime}=await fixture(t);
  if(operation==='read')assert.equal((await readProviderTokenState(runtime,now)).source,null);
  for(const at of [now,now+1]) {
    const saved=await updateProviderTokenSource(runtime,source(at),at);
    assert.deepEqual(saved.source,source(at));
    assert.deepEqual(await readProviderTokenState(runtime,at),saved);
  }
});

for(const kind of ['table','non-SQLite','schema-free','application-id'])test(`provider database refuses ${kind} file`,async t=>{
  const {runtime,file}=await fixture(t);
  if(kind==='non-SQLite')await writeFile(file,'synthetic invalid database');
  else {
    const db=new DatabaseSync(file);
    db.exec(kind==='table'?'CREATE TABLE other(value TEXT)':kind==='application-id'?'PRAGMA application_id=123':'PRAGMA user_version=1');
    db.close();
  }
  const before=await readFile(file);
  assert.ok(before.length>0);
  const error=kind==='non-SQLite'?/file is not a database/:/Invalid provider database schema/;
  await assert.rejects(readProviderTokenState(runtime,now),error);
  await assert.rejects(updateProviderTokenSource(runtime,source(now),now),error);
  assert.deepEqual(await readFile(file),before);
});
