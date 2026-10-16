import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,writeFile,readFile,symlink} from 'node:fs/promises';
import {testRuntimeBase} from './test-runtime-base.mjs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createPairingConfigurations,validatePairing,initializePairing,readPairing} from './peer-pairing.mjs';
import {createPeerPayload} from './peer-payload.mjs';
import {createPeerRecord,acceptPeerState,readPeerState} from './peer-store.mjs';
import {revokePairing} from './peer-revocation.mjs';

const runtimeBase=await testRuntimeBase('peer-pairing');
after(()=>rm(runtimeBase,{recursive:true,force:true}));

async function fixture(t,settled=()=>undefined) {
  const runtime=await realpath(await mkdtemp(path.join(runtimeBase,'observatory-pairing-')));
  t.after(async()=>{
    // Cancellation can leave the current ACL operation settling asynchronously.
    await Promise.resolve(settled()).catch(()=>{});
    await rm(runtime,{recursive:true,force:true});
  });return runtime;
}
test('pair generation shares comparison credentials but has distinct device identities',()=>{
  const pairs=createPairingConfigurations(),other=createPairingConfigurations();
  assert.equal(pairs.Mac.local.comparisonSalt,pairs.Windows.local.comparisonSalt);
  assert.equal(Object.hasOwn(pairs.Mac.peer,'codexHosts'),false);
  assert.notEqual(pairs.Mac.local.deviceId,pairs.Windows.local.deviceId);
  assert.notEqual(pairs.Mac.local.pairId,other.Mac.local.pairId);
  assert.ok(!('comparisonSalt' in pairs.Mac.peer));
  const bad=structuredClone(pairs.Mac);bad.peer.deviceId=bad.local.deviceId;
  assert.throws(()=>validatePairing(bad));
});
test('new pairings reject options and legacy single-host configurations normalize',()=>{
  for(const option of [true,false,null,{},[]])assert.throws(()=>createPairingConfigurations(option));
  assert.ok(createPairingConfigurations(undefined));
  const pair=createPairingConfigurations().Mac,legacy=structuredClone(pair);
  legacy.local.codexHosts=['Mac'];legacy.peer.codexHosts=['Windows'];
  assert.deepEqual(validatePairing(legacy),pair);
  legacy.peer.codexHosts=['Windows','Ubuntu'];
  assert.throws(()=>validatePairing(legacy));
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
// On hosted Windows runners the first paired collection phase took 8 s to 21 s across 61 jobs (median about 15 s).
// Each paired collector run makes 23 serial private-folder checks (counted on Windows CI run 38856761302) and each one starts PowerShell, so each phase allows 60 s.
const lifecyclePhaseTimeout=60000;
test('normal native CLI loads pairing, publishes local state and merges a validated peer',
  {skip:!['darwin','win32'].includes(process.platform),timeout:5*lifecyclePhaseTimeout},async t=>{
    let runtime,pair,at,peerHost,run,activePhase,completed=false;
    await t.test('setup',{timeout:lifecyclePhaseTimeout},phase=>activePhase=(async()=>{
      runtime=await fixture(t,()=>activePhase);
      const mac=process.platform==='darwin',host=mac?'Mac':'Windows';
      pair=createPairingConfigurations()[host];await initializePairing(runtime,pair);
      phase.signal.throwIfAborted();
      const sourceConfig=mac?{activity:false,codex:false,wispr:false,typewhisper:false}:
        {activity:false,codex:false,wispr:false,wslDistribution:null};
      await writeFile(path.join(runtime,'collector.config.json'),JSON.stringify(sourceConfig));
      phase.signal.throwIfAborted();
      at=new Date().toISOString();peerHost=pair.peer.host;
      const peerPayload=createPeerPayload({collectedAt:at,activity:{status:'not-connected'},
        codex:[{host:peerHost,status:'not-connected'}],dictation:['Wispr Flow']
          .map(source=>({source,status:'not-connected'}))},pair.peer);
      await acceptPeerState(runtime,createPeerRecord(peerPayload,pair.peer,1),pair.peer);
      const script=fileURLToPath(new URL(mac?'./collect-mac.mjs':'./collect-windows.mjs',import.meta.url));
      run=async phase=>{
        t.signal.throwIfAborted();
        phase.signal.throwIfAborted();
        const countFile=process.platform==='win32'?path.join(await fixture(t,()=>activePhase),'powershell-count.txt'):null;
        const started=performance.now();
        try {
          const {stdout}=await promisify(execFile)(process.execPath,[script],{env:{...process.env,OBSERVATORY_RUNTIME:runtime,
            OBSERVATORY_PYTHON:process.env.OBSERVATORY_PYTHON,...(countFile?{OBSERVATORY_COUNT_POWERSHELL:countFile}:{})},
          encoding:'utf8',windowsHide:true,signal:AbortSignal.any([t.signal,phase.signal])});
          return stdout;
        } finally {
          const ms=Math.round(performance.now()-started);
          let count='';
          if(countFile)try {
            const match=(await readFile(countFile,'utf8')).trim().split(/\r?\n/).at(-1).match(/^private-sync-acl (\d+)$/);
            if(match)count=` with ${match[1]} private-folder checks`;
          } catch {}
          phase.diagnostic(`collector run ${ms} ms${count}`);
        }
      };
      completed=!phase.signal.aborted;
    })());
    if(!completed || t.signal.aborted)return;
    completed=false;
    await t.test('initial publish, privacy and merge',{timeout:lifecyclePhaseTimeout},phase=>activePhase=(async()=>{
      const output=await run(phase);assert.equal(JSON.parse(output).state,'partial');
      assert.equal((await readPeerState(runtime,pair.local,Date.now(),'local')).revision.sequence,1);
      const dashboard=await readFile(path.join(runtime,'public/local/usage.json'),'utf8');
      const data=JSON.parse(dashboard);
      assert.equal(data.activity.find(row=>row.host===peerHost).checkedAt,at);
      for(const secret of [pair.local.comparisonSalt,pair.local.pairId,pair.local.comparisonId])assert.ok(!dashboard.includes(secret));
      assert.ok(!dashboard.includes('inventory'));
      completed=!phase.signal.aborted;
    })());
    if(!completed || t.signal.aborted)return;
    completed=false;
    await t.test('revision advance',{timeout:lifecyclePhaseTimeout},phase=>activePhase=(async()=>{
      await run(phase);assert.equal((await readPeerState(runtime,pair.local,Date.now(),'local')).revision.sequence,2);
      completed=!phase.signal.aborted;
    })());
    if(!completed || t.signal.aborted)return;
    completed=false;
    const pairingFile=path.join(runtime,'private-sync/pairing.json');
    await t.test('corrupt configuration withholds peer data',{timeout:lifecyclePhaseTimeout},phase=>activePhase=(async()=>{
      await writeFile(pairingFile,'{}');
      assert.equal(JSON.parse(await run(phase)).state,'partial');
      const corrupt=JSON.parse(await readFile(path.join(runtime,'public/local/usage.json'),'utf8'));
      assert.notEqual(corrupt.activity.find(row=>row.host===peerHost).checkedAt,at);
      completed=!phase.signal.aborted;
    })());
    if(!completed || t.signal.aborted)return;
    await t.test('revocation withholds peer data',{timeout:lifecyclePhaseTimeout},phase=>activePhase=(async()=>{
      await writeFile(pairingFile,JSON.stringify(pair));
      phase.signal.throwIfAborted();
      await revokePairing(runtime);
      assert.equal(JSON.parse(await run(phase)).state,'partial');
      const standalone=JSON.parse(await readFile(path.join(runtime,'public/local/usage.json'),'utf8'));
      assert.notEqual(standalone.activity.find(row=>row.host===peerHost).checkedAt,at);
      assert.equal(JSON.parse(await readFile(path.join(runtime,'private-sync/pairing.json'),'utf8')).local.pairId,pair.local.pairId);
    })());
  });

test('repair confirmations accept either host key and reject invalid maps',()=>{
  const pair=createPairingConfigurations().Mac,a='a'.repeat(64),b='b'.repeat(64);
  for(const repair of [{mac:a},{windows:b},{mac:a,windows:b}])
    assert.deepEqual(validatePairing({...pair,repair}).repair,repair);
  for(const repair of [{},{mac:a,windows:a},{mac:a,extra:b},{mac:null},{windows:'A'.repeat(64)},[],null])
    assert.throws(()=>validatePairing({...pair,repair}),{message:'Invalid repair confirmations'});
});

test('local repair consent ignores only the other device key',async t=>{
  const runtime=await fixture(t),pair={...createPairingConfigurations().Mac,repair:{windows:'b'.repeat(64)}};
  await initializePairing(runtime,pair);
  assert.deepEqual(await readPairing(runtime),pair);
});
