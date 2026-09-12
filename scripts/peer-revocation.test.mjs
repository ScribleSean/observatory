import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,readFile,writeFile,symlink,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createPairingConfigurations,initializePairing,readPairing} from './peer-pairing.mjs';
import {revokePairing} from './peer-revocation.mjs';
import {createPeerPayload} from './peer-payload.mjs';
import {publishLocalPayload,readPeerState,acceptPeerState,createPeerRecord} from './peer-store.mjs';
import {exchangePeerRecord} from './peer-exchange.mjs';
import {finalizePeerCollection} from './peer-finalize.mjs';
import {readQuotaState,updateQuotaState,setQuotaSharing} from './quota-store.mjs';

async function fixture(t) {
  const runtime=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-revocation-')));
  t.after(()=>rm(runtime,{recursive:true,force:true}));
  return runtime;
}
const payload=config=>createPeerPayload({collectedAt:new Date().toISOString(),activity:{status:'not-connected'},
  codex:config.codexHosts.map(host=>({host,status:'not-connected'})),
  dictation:(config.host==='Mac'?['Wispr Flow','TypeWhisper']:['Wispr Flow'])
    .map(source=>({source,status:'not-connected'}))},config);

test('revocation is durable, idempotent, and preserves existing private state',async t=>{
  const runtime=await fixture(t),pair=createPairingConfigurations()[process.platform==='win32'?'Windows':'Mac'];
  await initializePairing(runtime,pair);
  const local=payload(pair.local),remote=createPeerRecord(payload(pair.peer),pair.peer,1);
  await publishLocalPayload(runtime,local,pair.local);
  await acceptPeerState(runtime,remote,pair.peer);
  const pairingPath=path.join(runtime,'private-sync/pairing.json'),dbPath=path.join(runtime,'private-sync/state.sqlite');
  const pairingBefore=await readFile(pairingPath),dbBefore=await readFile(dbPath);
  assert.deepEqual(await revokePairing(runtime),{status:'revoked'});
  assert.deepEqual(await revokePairing(runtime),{status:'revoked'});
  await assert.rejects(readPairing(runtime),/revoked/);
  await assert.rejects(readPeerState(runtime,pair.peer),/revoked/);
  await assert.rejects(publishLocalPayload(runtime,local,pair.local),/revoked/);
  await assert.rejects(acceptPeerState(runtime,remote,pair.peer),/revoked/);
  await assert.rejects(initializePairing(runtime,pair));
  await assert.rejects(exchangePeerRecord(runtime,{version:1,record:remote}));
  const data={syntheticStandalone:true};
  const result=await finalizePeerCollection(runtime,{data,peer:{status:'ready',payload:local}},pair);
  assert.equal(result.data,data);
  assert.deepEqual(result.peer,{status:'unavailable'});
  assert.deepEqual(await readFile(pairingPath),pairingBefore);
  assert.deepEqual(await readFile(dbPath),dbBefore);
});

test('revocation works before setup and with malformed pairing, without implicit repair',async t=>{
  const runtime=await fixture(t);
  await revokePairing(runtime);
  await assert.rejects(lstat(path.join(runtime,'private-quota')),{code:'ENOENT'});
  await assert.rejects(initializePairing(runtime,createPairingConfigurations().Mac));
  await writeFile(path.join(runtime,'private-sync/pairing.json'),'{broken',{mode:0o600});
  await revokePairing(runtime);
  await assert.rejects(readPairing(runtime));
  assert.equal(await readFile(path.join(runtime,'private-sync/pairing.json'),'utf8'),'{broken');
});

test('disconnect revokes quota consent, preserves local readings and fences late collection',async t=>{
  const runtime=await fixture(t),now=Date.now(),scope='a'.repeat(64);
  await initializePairing(runtime,createPairingConfigurations().Mac);
  const initial=await readQuotaState(runtime,now);
  const observation={status:'ok',checkedAt:new Date(now).toISOString(),windows:[{bucket:'codex',window:'primary',remainingPercent:75}]};
  const collected=await updateQuotaState(runtime,{revision:initial.revision,scope,observation},now);
  const shared=await setQuotaSharing(runtime,{revision:collected.revision,enabled:true,pairingId:'c'.repeat(64)},now);
  await revokePairing(runtime);
  const after=await readQuotaState(runtime,now);
  assert.equal(after.sharing.enabled,false);assert.equal(after.sharing.generation,null);
  assert.deepEqual(after.history.samples,shared.history.samples);
  await assert.rejects(updateQuotaState(runtime,{revision:shared.revision,scope,observation},now),/superseded/);
});

test('quota cleanup failure leaves the pairing fence in place',async t=>{
  const runtime=await fixture(t);
  await initializePairing(runtime,createPairingConfigurations().Mac);
  await readQuotaState(runtime);
  await writeFile(path.join(runtime,'private-quota/state.sqlite'),'invalid database');
  await assert.rejects(revokePairing(runtime));
  await assert.rejects(readPairing(runtime),/revoked/);
});

test('even an empty interrupted marker disables pairing',async t=>{
  const runtime=await fixture(t),pair=createPairingConfigurations().Mac;
  await initializePairing(runtime,pair);
  await writeFile(path.join(runtime,'private-sync/revoked'),'',{mode:0o600});
  await assert.rejects(readPairing(runtime),/revoked/);
});

test('linked revocation marker is never followed or overwritten',{skip:process.platform==='win32'},async t=>{
  const runtime=await fixture(t),other=await fixture(t);
  await initializePairing(runtime,createPairingConfigurations().Mac);
  const target=path.join(other,'sentinel');await writeFile(target,'preserve');
  await symlink(target,path.join(runtime,'private-sync/revoked'));
  await assert.rejects(readPairing(runtime),/revoked/);
  await assert.rejects(revokePairing(runtime),/Unsafe/);
  assert.equal(await readFile(target,'utf8'),'preserve');
});

test('CLI requires explicit operation and reports no private pairing values',async t=>{
  const runtime=await fixture(t),pair=createPairingConfigurations().Mac;
  await initializePairing(runtime,pair);
  const script=fileURLToPath(new URL('./peer-revocation.mjs',import.meta.url));
  assert.throws(()=>execFileSync(process.execPath,[script,'--runtime',runtime],{stdio:'pipe'}));
  assert.deepEqual(await readPairing(runtime),pair);
  const output=execFileSync(process.execPath,[script,'--runtime',runtime,'--revoke'],{encoding:'utf8',timeout:20000});
  assert.match(output,/disabled locally/);
  for(const secret of [pair.local.pairId,pair.local.comparisonSalt,pair.local.deviceId])assert.ok(!output.includes(secret));
  await assert.rejects(readPairing(runtime));
});

test('CLI also runs when its script is reached through a filesystem alias',{skip:process.platform==='win32'},async t=>{
  const runtime=await fixture(t),alias=path.join(await fixture(t),'revoke.mjs');
  await symlink(fileURLToPath(new URL('./peer-revocation.mjs',import.meta.url)),alias);
  const output=execFileSync(process.execPath,[alias,'--runtime',runtime,'--revoke'],{encoding:'utf8',timeout:20000});
  assert.match(output,/disabled locally/);
  await assert.rejects(readPairing(runtime),/revoked/);
});
