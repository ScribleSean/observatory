import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,readFile,writeFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setupPairing,complementaryWindowsPairing,setupStatus} from './peer-setup.mjs';
import {ensureWindowsPairing} from './peer-setup-endpoint.mjs';
import {readPairing,readPendingPairing,createPairingConfigurations,initializePairing,
  preparePendingPairing,activatePendingPairing} from './peer-pairing.mjs';
import {revokePairing} from './peer-revocation.mjs';

async function fixture(t) {
  const runtime=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-setup-')));
  t.after(()=>rm(runtime,{recursive:true,force:true}));return runtime;
}
const request=()=>({includeUbuntu:false,transport:{kind:'ssh-windows',hostAlias:'fixture-host',
  remoteNode:'C:/Test/Runtime/node.exe',remoteScript:'C:/Test/Collector/peer-exchange.mjs',remoteRuntime:'C:/Test/Private'}});
const sendTo=windows=>async(_transport,pairing)=>ensureWindowsPairing(windows,{version:1,pairing},'win32');

test('SSH setup rejects TLS before staging a pairing or contacting the peer',async t=>{
  const mac=await fixture(t),transport={kind:'tls',address:'100.64.0.2',port:43128};
  let calls=0;
  const remote=async()=>{calls++;throw Error('Must not contact peer');};
  await assert.rejects(setupPairing(mac,{includeUbuntu:false,transport},remote,'darwin',remote),/SSH/);
  const pair={...createPairingConfigurations().Mac,transport};
  assert.throws(()=>complementaryWindowsPairing(pair),/SSH/);
  await assert.rejects(preparePendingPairing(mac,pair),/SSH/);
  assert.equal(calls,0);
  assert.equal(await readPendingPairing(mac),null);
  assert.equal(await readPairing(mac),null);
  await assert.rejects(access(path.join(mac,'private-sync')),{code:'ENOENT'});
});

test('status is read-only and exposes only the saved request through pending and active setup',async t=>{
  const mac=await fixture(t),windows=await fixture(t),input=request();
  assert.deepEqual(await setupStatus(mac,'darwin'),{status:'unpaired',request:null});
  await assert.rejects(access(path.join(mac,'private-sync')));
  await assert.rejects(setupPairing(mac,input,async()=>{throw Error('Offline');},'darwin'));
  const pending=await readFile(path.join(mac,'private-sync/setup.pending.json'));
  assert.deepEqual(await setupStatus(mac,'darwin'),{status:'pending',request:input});
  assert.deepEqual(await readFile(path.join(mac,'private-sync/setup.pending.json')),pending);
  await setupPairing(mac,input,sendTo(windows),'darwin');
  assert.deepEqual(await setupStatus(mac,'darwin'),{status:'paired',request:input});
  await revokePairing(mac);
  assert.deepEqual(await setupStatus(mac,'darwin'),{status:'needs-repair',request:null});
});

test('status reports repair without leaking values from corrupt state',async t=>{
  const mac=await fixture(t),input=request();
  assert.deepEqual(await setupStatus(mac,'win32'),{status:'needs-repair',request:null});
  assert.deepEqual(await setupStatus(path.join(mac,'missing'),'darwin'),{status:'needs-repair',request:null});
  await assert.rejects(setupPairing(mac,input,async()=>{throw Error('Offline');},'darwin'));
  const pending=path.join(mac,'private-sync/setup.pending.json');
  await writeFile(pending,'private corrupt bytes',{mode:0o600});
  assert.deepEqual(await setupStatus(mac,'darwin'),{status:'needs-repair',request:null});
  assert.equal(await readFile(pending,'utf8'),'private corrupt bytes');
});

test('status refuses conflicting generations and orphaned private state',async t=>{
  const mac=await fixture(t),input=request();
  await assert.rejects(setupPairing(mac,input,async()=>{throw Error('Offline');},'darwin'));
  const directory=path.join(mac,'private-sync');
  const other=createPairingConfigurations().Mac;
  other.transport=input.transport;
  await writeFile(path.join(directory,'pairing.json'),JSON.stringify(other),{mode:0o600});
  assert.deepEqual(await setupStatus(mac,'darwin'),{status:'needs-repair',request:null});
  await rm(path.join(directory,'pairing.json'));
  await rm(path.join(directory,'setup.pending.json'));
  await writeFile(path.join(directory,'orphaned-state'),'fixture',{mode:0o600});
  assert.deepEqual(await setupStatus(mac,'darwin'),{status:'needs-repair',request:null});
});

test('first setup acknowledges Windows before activating Mac and safely repeats',async t=>{
  const mac=await fixture(t),windows=await fixture(t),input=request();
  let sent;
  const send=async(transport,pairing)=>{
    assert.equal(await readPairing(mac),null);
    const pending=await readPendingPairing(mac);
    assert.deepEqual(pending.transport,transport);
    assert.deepEqual(complementaryWindowsPairing(pending),pairing);
    sent=pairing;return sendTo(windows)(transport,pairing);
  };
  assert.deepEqual(await setupPairing(mac,input,send,'darwin'),{status:'paired'});
  const active=await readPairing(mac);
  assert.deepEqual(await readPairing(windows),sent);
  assert.equal(await readPendingPairing(mac),null);
  assert.deepEqual(await setupPairing(mac,input,sendTo(windows),'darwin'),{status:'paired'});
  assert.deepEqual(await readPairing(mac),active);
  assert.deepEqual(await readPairing(windows),sent);
});

test('lost reply retains an inactive pending generation and retry does not change credentials',async t=>{
  const mac=await fixture(t),windows=await fixture(t),input=request();
  await assert.rejects(setupPairing(mac,input,async(transport,pairing)=>{
    await sendTo(windows)(transport,pairing);throw Error('Reply lost');
  },'darwin'));
  assert.equal(await readPairing(mac),null);
  const pending=await readPendingPairing(mac),remote=await readPairing(windows);
  assert.deepEqual(complementaryWindowsPairing(pending),remote);
  await setupPairing(mac,input,sendTo(windows),'darwin');
  assert.deepEqual(await readPairing(mac),pending);
  assert.deepEqual(await readPairing(windows),remote);
});

test('retry cannot change its target or Ubuntu scope, and revocation stops setup',async t=>{
  const mac=await fixture(t),input=request();let calls=0;
  const offline=async()=>{calls++;throw Error('Offline');};
  await assert.rejects(setupPairing(mac,input,offline,'darwin'));
  const before=await readFile(path.join(mac,'private-sync/setup.pending.json'));
  await assert.rejects(setupPairing(mac,{...input,includeUbuntu:true},offline,'darwin'));
  await assert.rejects(setupPairing(mac,{...input,transport:{...input.transport,hostAlias:'different-host'}},offline,'darwin'));
  assert.equal(calls,1);
  assert.deepEqual(await readFile(path.join(mac,'private-sync/setup.pending.json')),before);
  await revokePairing(mac);
  await assert.rejects(setupPairing(mac,input,offline,'darwin'));
  assert.equal(calls,1);
});

test('existing remote pairing is never overwritten by a different generation',async t=>{
  const mac=await fixture(t),windows=await fixture(t),other=createPairingConfigurations().Windows;
  await initializePairing(windows,other);
  const before=await readFile(path.join(windows,'private-sync/pairing.json'));
  await assert.rejects(setupPairing(mac,request(),sendTo(windows),'darwin'));
  assert.equal(await readPairing(mac),null);
  assert.deepEqual(await readFile(path.join(windows,'private-sync/pairing.json')),before);
});

test('malformed acknowledgement never activates the pending Mac pairing',async t=>{
  const mac=await fixture(t);
  await assert.rejects(setupPairing(mac,request(),async()=>({version:1,status:'ready',extra:true}),'darwin'));
  assert.equal(await readPairing(mac),null);
  assert.ok(await readPendingPairing(mac));
});

test('partial activation and unrelated state require explicit repair, not overwrite',async t=>{
  const mac=await fixture(t),desired=createPairingConfigurations().Mac;
  desired.transport=request().transport;
  await preparePendingPairing(mac,desired);
  const file=path.join(mac,'private-sync/pairing.json');
  await writeFile(file,'{partial',{mode:0o600});
  await assert.rejects(activatePendingPairing(mac,desired));
  assert.equal(await readFile(file,'utf8'),'{partial');
  await rm(file);
  await writeFile(path.join(mac,'private-sync/state.sqlite'),'synthetic existing watermark',{mode:0o600});
  await assert.rejects(activatePendingPairing(mac,desired));
  await assert.rejects(access(file),{code:'ENOENT'});
});

test('activation resumes after active config was saved but pending cleanup was interrupted',async t=>{
  const mac=await fixture(t),desired=createPairingConfigurations().Mac;
  desired.transport=request().transport;
  await preparePendingPairing(mac,desired);
  await writeFile(path.join(mac,'private-sync/pairing.json'),JSON.stringify(desired),{mode:0o600});
  assert.deepEqual(await activatePendingPairing(mac,desired),desired);
  assert.equal(await readPendingPairing(mac),null);
});

test('endpoint rejects wrong platform, Mac configurations and protocol extras without writes',async t=>{
  const windows=await fixture(t),pair=createPairingConfigurations();
  for(const [payload,platform] of [[{version:1,pairing:pair.Windows},'darwin'],
    [{version:1,pairing:pair.Mac},'win32'],[{version:1,pairing:pair.Windows,extra:true},'win32']])
    await assert.rejects(ensureWindowsPairing(windows,payload,platform));
  assert.equal(await readPairing(windows),null);
});

test('concurrent setup attempts converge without replacing the winning generation',async t=>{
  const mac=await fixture(t),windows=await fixture(t),input=request();
  const results=await Promise.allSettled([setupPairing(mac,input,sendTo(windows),'darwin'),
    setupPairing(mac,input,sendTo(windows),'darwin')]);
  assert.ok(results.some(result=>result.status==='fulfilled'));
  await setupPairing(mac,input,sendTo(windows),'darwin');
  assert.deepEqual(complementaryWindowsPairing(await readPairing(mac)),await readPairing(windows));
  assert.equal(await readPendingPairing(mac),null);
});

test('revocation during the remote call prevents subsequent local activation',async t=>{
  const mac=await fixture(t),windows=await fixture(t);
  await assert.rejects(setupPairing(mac,request(),async(transport,pairing)=>{
    const response=await sendTo(windows)(transport,pairing);
    await revokePairing(mac);return response;
  },'darwin'));
  await assert.rejects(readPairing(mac),/revoked/);
  await assert.rejects(access(path.join(mac,'private-sync/pairing.json')),{code:'ENOENT'});
  // The acknowledged remote write remains; local revocation is not a remote rollback.
  assert.equal((await readPairing(windows)).local.host,'Windows');
});
