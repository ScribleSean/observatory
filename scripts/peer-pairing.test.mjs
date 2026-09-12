import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,writeFile,readFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createPairingConfigurations,validatePairing,initializePairing,readPairing} from './peer-pairing.mjs';
import {createPeerPayload} from './peer-payload.mjs';
import {createPeerRecord,acceptPeerState,readPeerState} from './peer-store.mjs';
import {revokePairing} from './peer-revocation.mjs';

async function fixture(t) {
  const runtime=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-pairing-')));
  t.after(()=>rm(runtime,{recursive:true,force:true}));return runtime;
}
test('pair generation shares comparison credentials but has distinct device identities',()=>{
  const pairs=createPairingConfigurations(true),other=createPairingConfigurations();
  assert.equal(pairs.Mac.local.comparisonSalt,pairs.Windows.local.comparisonSalt);
  assert.deepEqual(pairs.Mac.peer.codexHosts,['Windows','Ubuntu']);
  assert.notEqual(pairs.Mac.local.deviceId,pairs.Windows.local.deviceId);
  assert.notEqual(pairs.Mac.local.pairId,other.Mac.local.pairId);
  assert.ok(!('comparisonSalt' in pairs.Mac.peer));
  const bad=structuredClone(pairs.Mac);bad.peer.deviceId=bad.local.deviceId;
  assert.throws(()=>validatePairing(bad));
});
test('private pairing round-trips and existing state cannot be overwritten',async t=>{
  const runtime=await fixture(t),pair=createPairingConfigurations().Mac;
  assert.equal(await readPairing(runtime),null);
  await initializePairing(runtime,pair);assert.deepEqual(await readPairing(runtime),pair);
  await assert.rejects(initializePairing(runtime,createPairingConfigurations().Mac));
  assert.deepEqual(await readPairing(runtime),pair);
  await writeFile(path.join(runtime,'private-sync/pairing.json'),'{broken');
  await assert.rejects(readPairing(runtime));
});
test('linked pairing file is rejected without reading its target', {skip:process.platform==='win32'},async t=>{
  const runtime=await fixture(t),other=await fixture(t),pair=createPairingConfigurations().Mac;
  await initializePairing(runtime,pair);
  const file=path.join(runtime,'private-sync/pairing.json');await rm(file);
  await writeFile(path.join(other,'private.json'),JSON.stringify(pair));
  await symlink(path.join(other,'private.json'),file);await assert.rejects(readPairing(runtime));
});
test('normal native CLI loads pairing, publishes local state and merges a validated peer',
  {skip:!['darwin','win32'].includes(process.platform),timeout:30000},async t=>{
    const runtime=await fixture(t),mac=process.platform==='darwin',host=mac?'Mac':'Windows';
    const pair=createPairingConfigurations()[host];await initializePairing(runtime,pair);
    const sourceConfig=mac?{activity:false,codex:false,wispr:false,typewhisper:false}:
      {activity:false,codex:false,wispr:false,wslDistribution:null};
    await writeFile(path.join(runtime,'collector.config.json'),JSON.stringify(sourceConfig));
    const at=new Date().toISOString(),peerHost=pair.peer.host;
    const peerPayload=createPeerPayload({collectedAt:at,activity:{status:'not-connected'},
      codex:[{host:peerHost,status:'not-connected'}],dictation:['Wispr Flow']
        .map(source=>({source,status:'not-connected'}))},pair.peer);
    await acceptPeerState(runtime,createPeerRecord(peerPayload,pair.peer,1),pair.peer);
    const script=fileURLToPath(new URL(mac?'./collect-mac.mjs':'./collect-windows.mjs',import.meta.url));
    const run=()=>execFileSync(process.execPath,[script],{env:{...process.env,OBSERVATORY_RUNTIME:runtime,
      OBSERVATORY_PYTHON:mac?'/usr/bin/python3':process.env.OBSERVATORY_PYTHON},encoding:'utf8',timeout:20000});
    const output=run();assert.equal(JSON.parse(output).state,'partial');
    assert.equal((await readPeerState(runtime,pair.local,Date.now(),'local')).revision.sequence,1);
    const dashboard=await readFile(path.join(runtime,'public/local/usage.json'),'utf8');
    const data=JSON.parse(dashboard);
    assert.equal(data.activity.find(row=>row.host===peerHost).checkedAt,at);
    for(const secret of [pair.local.comparisonSalt,pair.local.pairId,pair.local.comparisonId])assert.ok(!dashboard.includes(secret));
    assert.ok(!dashboard.includes('inventory'));
    run();assert.equal((await readPeerState(runtime,pair.local,Date.now(),'local')).revision.sequence,2);
    // Corrupt configuration also withholds peer data without breaking collection.
    const pairingFile=path.join(runtime,'private-sync/pairing.json');
    await writeFile(pairingFile,'{}');
    assert.equal(JSON.parse(run()).state,'partial');
    const corrupt=JSON.parse(await readFile(path.join(runtime,'public/local/usage.json'),'utf8'));
    assert.notEqual(corrupt.activity.find(row=>row.host===peerHost).checkedAt,at);
    await writeFile(pairingFile,JSON.stringify(pair));
    // Revocation must stop peer reuse while preserving normal local collection.
    await revokePairing(runtime);
    assert.equal(JSON.parse(run()).state,'partial');
    const standalone=JSON.parse(await readFile(path.join(runtime,'public/local/usage.json'),'utf8'));
    assert.notEqual(standalone.activity.find(row=>row.host===peerHost).checkedAt,at);
    assert.equal(JSON.parse(await readFile(path.join(runtime,'private-sync/pairing.json'),'utf8')).local.pairId,pair.local.pairId);
  });
