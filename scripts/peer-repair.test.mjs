import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,readFile,writeFile,readdir,access,symlink,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {preparePairingRepair} from './peer-repair.mjs';
import {withPeerStateLock} from './peer-lock.mjs';
import {setupPairing,setupStatus} from './peer-setup.mjs';
import {ensureWindowsPairing,windowsRepairReadiness} from './peer-setup-endpoint.mjs';
import {readPairing,readPendingPairing,initializePairing} from './peer-pairing.mjs';
import {readRepairConsent} from './peer-repair-consent.mjs';
import {revokePairing} from './peer-revocation.mjs';
import {createPeerPayload} from './peer-payload.mjs';
import {publishLocalPayload,readPeerState,acceptPeerState} from './peer-store.mjs';

const request={includeUbuntu:false,transport:{kind:'ssh-windows',hostAlias:'synthetic-host',
  remoteNode:'C:/Fixture/Runtime/node.exe',remoteScript:'C:/Fixture/Collector/peer-exchange.mjs',remoteRuntime:'C:/Fixture/Data'}};
const sendTo=windows=>async(_transport,pairing)=>ensureWindowsPairing(windows,{version:1,pairing},'win32');
const readiness=windows=>async()=> (await windowsRepairReadiness(windows,'win32')).nonce;
async function fixture(t) {
  const runtime=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-repair-')));
  t.after(()=>rm(runtime,{recursive:true,force:true}));return runtime;
}
async function bytes(directory) {
  return Object.fromEntries(await Promise.all((await readdir(directory)).map(async name=>[name,await readFile(path.join(directory,name))])));
}
const retired=async runtime=>(await readdir(runtime)).filter(name=>name.startsWith('private-sync-retired-'));
const payload=config=>createPeerPayload({collectedAt:new Date().toISOString(),activity:{status:'not-connected'},
  codex:config.codexHosts.map(host=>({host,status:'not-connected'})),
  dictation:['Wispr Flow'].map(source=>({source,status:'not-connected'}))},config);

test('both local retirements are required before authenticated setup replaces an existing pairing',async t=>{
  const mac=await fixture(t),windows=await fixture(t);
  await setupPairing(mac,request,sendTo(windows),'darwin');
  const oldMac=await readPairing(mac),oldWindows=await readPairing(windows);
  const record=await publishLocalPayload(mac,payload(oldMac.local),oldMac.local);
  await acceptPeerState(windows,record,oldWindows.peer);
  await revokePairing(mac);
  const before=await bytes(path.join(mac,'private-sync'));
  assert.deepEqual(await preparePairingRepair(mac),{status:'prepared'});
  assert.equal(await readPairing(mac),null);
  const archives=await retired(mac);assert.equal(archives.length,1);
  assert.deepEqual(await bytes(path.join(mac,archives[0])),before);
  if(process.platform!=='win32')assert.equal((await stat(path.join(mac,archives[0]))).mode&0o077,0);
  await assert.rejects(setupPairing(mac,request,sendTo(windows),'darwin',readiness(windows)));
  assert.deepEqual(await readPairing(windows),oldWindows);
  // No remote endpoint is permitted to retire Windows. This explicit local
  // operation stands for the native Windows confirmation in protocol tests.
  assert.deepEqual(await preparePairingRepair(windows),{status:'prepared'});
  await setupPairing(mac,request,sendTo(windows),'darwin',readiness(windows));
  const next=await readPairing(mac);
  for(const key of ['pairId','comparisonId','deviceId','comparisonSalt'])assert.notEqual(next.local[key],oldMac.local[key]);
  const nextWindows=await readPairing(windows);
  assert.equal(next.local.pairId,nextWindows.local.pairId);
  assert.equal(next.local.comparisonSalt,nextWindows.local.comparisonSalt);
  assert.deepEqual(await bytes(path.join(mac,archives[0])),before);
  await assert.rejects(publishLocalPayload(mac,record.payload,oldMac.local),/generation/);
  await assert.rejects(acceptPeerState(windows,record,oldWindows.peer),/generation/);
  await assert.rejects(readPeerState(mac,oldMac.local,Date.now(),'local'),/generation/);
  const newRecord=await publishLocalPayload(mac,payload(next.local),next.local);
  assert.equal(newRecord.revision.sequence,1);
  await acceptPeerState(windows,newRecord,nextWindows.peer);
  assert.equal((await readPeerState(windows,nextWindows.peer)).revision.sequence,1);
});

test('Windows-first retirement refuses the old Mac generation until Mac confirms too',async t=>{
  const mac=await fixture(t),windows=await fixture(t);
  await setupPairing(mac,request,sendTo(windows),'darwin');
  const old=await readPairing(mac);
  await preparePairingRepair(windows);
  await assert.rejects(setupPairing(mac,request,sendTo(windows),'darwin',readiness(windows)),/confirmation/);
  assert.deepEqual(await readPairing(mac),old);
  assert.equal(await readPairing(windows),null);
  await preparePairingRepair(mac);
  await setupPairing(mac,request,sendTo(windows),'darwin',readiness(windows));
  const fresh=await readPairing(mac);
  await preparePairingRepair(windows);
  await assert.rejects(setupPairing(mac,request,sendTo(windows),'darwin',readiness(windows)),/confirmation/);
  assert.deepEqual(await readPairing(mac),fresh);
});

test('lost repair reply preserves confirmation tokens and the same pending generation',async t=>{
  const mac=await fixture(t),windows=await fixture(t);
  await setupPairing(mac,request,sendTo(windows),'darwin');
  await preparePairingRepair(mac);await preparePairingRepair(windows);
  const macConsent=await readRepairConsent(mac),windowsConsent=await readRepairConsent(windows);
  await assert.rejects(setupPairing(mac,request,async(transport,pairing)=>{
    await sendTo(windows)(transport,pairing);throw Error('Synthetic lost reply');
  },'darwin',readiness(windows)));
  const pending=await readPendingPairing(mac),remote=await readPairing(windows);
  assert.equal(await readPairing(mac),null);
  await setupPairing(mac,request,sendTo(windows),'darwin',async()=>{throw Error('A retry must not request new confirmations');});
  assert.deepEqual(await readPairing(mac),pending);
  assert.deepEqual(await readPairing(windows),remote);
  assert.equal(await readRepairConsent(mac),macConsent);
  assert.equal(await readRepairConsent(windows),windowsConsent);
});

test('confirmation can be prepared on a fresh device without manufacturing a backup',async t=>{
  const mac=await fixture(t),windows=await fixture(t);
  assert.deepEqual(await preparePairingRepair(mac),{status:'unpaired'});
  assert.deepEqual(await preparePairingRepair(windows),{status:'unpaired'});
  assert.deepEqual(await retired(mac),[]);assert.deepEqual(await retired(windows),[]);
  await setupPairing(mac,request,sendTo(windows),'darwin',readiness(windows));
  assert.equal((await readPairing(mac)).repair.mac,await readRepairConsent(mac));
});

test('missing confirmation fails closed and a retired configuration cannot be restored through setup',async t=>{
  const mac=await fixture(t),windows=await fixture(t);
  await setupPairing(mac,request,sendTo(windows),'darwin');
  const old=await readPairing(mac);
  await preparePairingRepair(mac);
  await assert.rejects(initializePairing(mac,old),/confirmation/);
  await rm(path.join(mac,'private-repair/prepared.json'));
  await assert.rejects(setupPairing(mac,request,sendTo(windows),'darwin',readiness(windows)),/confirmation/);
  assert.equal((await setupStatus(mac,'darwin')).status,'needs-repair');
  assert.equal((await retired(mac)).length,1);
});

test('corrupt bytes are preserved and retries without active state do not retire twice',async t=>{
  const mac=await fixture(t),windows=await fixture(t);
  await setupPairing(mac,request,sendTo(windows),'darwin');
  const source=path.join(mac,'private-sync');
  await writeFile(path.join(source,'pairing.json'),'{partial private configuration',{mode:0o600});
  await writeFile(path.join(source,'state.sqlite'),'synthetic corrupt database',{mode:0o600});
  const before=await bytes(source);
  await preparePairingRepair(mac);
  const names=await retired(mac),saved=await bytes(path.join(mac,names[0]));
  assert.equal(names.length,1);
  for(const [name,value] of Object.entries(before))assert.deepEqual(saved[name],value);
  assert.ok(saved.revoked);
  assert.deepEqual(await preparePairingRepair(mac),{status:'unpaired'});
  assert.deepEqual(await retired(mac),names);
});

test('retirement refuses linked state and leaves its destination unchanged',async t=>{
  const mac=await fixture(t),windows=await fixture(t),other=await fixture(t);
  await setupPairing(mac,request,sendTo(windows),'darwin');
  await writeFile(path.join(other,'sentinel'),'unchanged');
  if(process.platform==='win32')await symlink(other,path.join(mac,'private-sync/linked'),'junction');
  else await symlink(path.join(other,'sentinel'),path.join(mac,'private-sync/linked'));
  await assert.rejects(preparePairingRepair(mac));
  assert.deepEqual(await retired(mac),[]);
  assert.equal(await readFile(path.join(other,'sentinel'),'utf8'),'unchanged');
});

test('retirement waits for a peer operation and preserves state when the lock remains busy',async t=>{
  const mac=await fixture(t),windows=await fixture(t);
  await setupPairing(mac,request,sendTo(windows),'darwin');
  const before=await bytes(path.join(mac,'private-sync'));
  let release;
  const waiting=new Promise(resolve=>{release=resolve;});
  let ready;
  const started=new Promise(resolve=>{ready=resolve;});
  const owner=withPeerStateLock(mac,async()=>{ready();await waiting;});
  await started;
  try {await assert.rejects(preparePairingRepair(mac),/locked/);}
  finally {release();await owner;}
  assert.deepEqual(await bytes(path.join(mac,'private-sync')),before);
  await preparePairingRepair(mac);
  assert.equal((await retired(mac)).length,1);
});

test('process death releases the repair lock without deleting a lock file',async t=>{
  const runtime=await fixture(t);
  const module=new URL('./peer-lock.mjs',import.meta.url).href;
  const code=`import {withPeerStateLock} from ${JSON.stringify(module)};
    await withPeerStateLock(process.argv[1],async()=>{process.stdout.write('ready');await new Promise(()=>{});});`;
  // The interval keeps the synthetic lock owner alive until this test kills it.
  const child=spawn(process.execPath,['--input-type=module','-e','setInterval(()=>{},1000);'+code,runtime],{stdio:['ignore','pipe','pipe']});
  t.after(()=>{if(child.exitCode===null && child.signalCode===null)child.kill('SIGKILL');});
  await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('Lock owner exited');})]);
  await assert.rejects(withPeerStateLock(runtime,()=>{}),/locked/);
  const exited=once(child,'exit');child.kill('SIGKILL');await exited;
  await withPeerStateLock(runtime,async()=>{});
  await access(path.join(runtime,'private-repair/operation.sqlite'));
});

test('detached async work cannot inherit a lease after its operation has returned',async t=>{
  const runtime=await fixture(t);let resume,detached;
  await withPeerStateLock(runtime,async()=>{
    const signal=new Promise(resolve=>{resume=resolve;});
    detached=signal.then(()=>withPeerStateLock(runtime,()=>{}));
  });
  await withPeerStateLock(runtime,async()=>{
    resume();await assert.rejects(detached,/locked/);
  });
});
