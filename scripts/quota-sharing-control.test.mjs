import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,lstat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {quotaSharingControl} from './quota-sharing-control.mjs';
import {createPairingConfigurations,initializePairing} from './peer-pairing.mjs';
import {readQuotaState,updateQuotaState} from './quota-store.mjs';
const now=Date.now(),scope='a'.repeat(64);
async function fixture(t,ready=true) {
  const runtime=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-sharing-control-')));
  t.after(()=>rm(runtime,{recursive:true,force:true}));
  const pair=createPairingConfigurations().Mac;
  if(ready) {
    await initializePairing(runtime,pair);
    const initial=await readQuotaState(runtime,now);
    await updateQuotaState(runtime,{revision:initial.revision,scope,
      observation:{status:'ok',checkedAt:new Date(now).toISOString(),windows:[{bucket:'codex',window:'primary',remainingPercent:60}]}},now);
  }
  return {runtime,pair};
}
test('settings status is private and enable requires a fresh confirmation',async t=>{
  const {runtime,pair}=await fixture(t);
  const status=await quotaSharingControl(runtime,undefined,now);
  assert.equal(status.canEnable,true);assert.equal(status.enabled,false);
  const text=JSON.stringify(status);
  for(const secret of [scope,pair.local.pairId,pair.local.deviceId,pair.local.comparisonSalt])assert.ok(!text.includes(secret));
  const enabled=await quotaSharingControl(runtime,{action:'enable',token:status.token},now);
  assert.equal(enabled.enabled,true);
  await assert.rejects(quotaSharingControl(runtime,{action:'enable',token:status.token},now),/expired/);
  const disabled=await quotaSharingControl(runtime,{action:'disable'},now);
  assert.equal(disabled.enabled,false);
  assert.equal((await readQuotaState(runtime,now)).history.samples.length,1);
});
test('old account observations and account switches invalidate confirmation',async t=>{
  const {runtime}=await fixture(t);
  const status=await quotaSharingControl(runtime,undefined,now);
  assert.equal((await quotaSharingControl(runtime,undefined,now+600001)).canEnable,false);
  await assert.rejects(quotaSharingControl(runtime,{action:'enable',token:status.token},now+600001));
  const state=await readQuotaState(runtime,now);
  await updateQuotaState(runtime,{revision:state.revision,scope:'b'.repeat(64),observation:{status:'needs-auth'}},now);
  await assert.rejects(quotaSharingControl(runtime,{action:'enable',token:status.token},now));
});
test('missing monitoring never creates quota storage and malformed requests do not enable',async t=>{
  const {runtime}=await fixture(t,false);
  assert.equal((await quotaSharingControl(runtime,undefined,now)).reason,'pairing-unavailable');
  await quotaSharingControl(runtime,{action:'disable'},now);
  await assert.rejects(lstat(path.join(runtime,'private-quota')),{code:'ENOENT'});
  await assert.rejects(quotaSharingControl(runtime,{action:'status',token:'x'},now));
  await assert.rejects(quotaSharingControl(runtime,{action:'enable',token:'x',shell:'bad'},now));
});
test('corrupt pairing blocks enable but never blocks local sharing disable',async t=>{
  const {runtime}=await fixture(t);
  const status=await quotaSharingControl(runtime,undefined,now);
  await quotaSharingControl(runtime,{action:'enable',token:status.token},now);
  await writeFile(path.join(runtime,'private-sync/pairing.json'),'{invalid');
  const disabled=await quotaSharingControl(runtime,{action:'disable'},now);
  assert.equal(disabled.enabled,false);assert.equal(disabled.reason,'pairing-unavailable');
  assert.equal((await readQuotaState(runtime,now)).sharing.enabled,false);
});
test('native CLI uses bounded JSON and emits only safe settings status',async t=>{
  const {runtime}=await fixture(t);
  const script=fileURLToPath(new URL('./quota-sharing-control.mjs',import.meta.url));
  const run=input=>execFileSync(process.execPath,[script,'--runtime',runtime],{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:15000});
  const status=JSON.parse(run(JSON.stringify({action:'status'})));
  assert.equal(status.canEnable,true);assert.equal(status.enabled,false);
  assert.equal(JSON.parse(run(JSON.stringify({action:'enable',token:status.token}))).enabled,true);
  assert.equal(JSON.parse(run(JSON.stringify({action:'disable'}))).enabled,false);
  assert.throws(()=>run(' '.repeat(1025)));
  assert.throws(()=>run(JSON.stringify({action:'enable',token:status.token})));
});
