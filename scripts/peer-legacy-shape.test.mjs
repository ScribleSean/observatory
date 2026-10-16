import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,X509Certificate} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtemp,realpath,rm,writeFile,readFile,stat,readdir} from 'node:fs/promises';
import {testRuntimeBase} from './test-runtime-base.mjs';
import path from 'node:path';
import {privateSyncDirectory,privateCollectorDirectory} from './peer-directory.mjs';
import {writeRepairConsent} from './peer-repair-consent.mjs';
import {readPairing,readPendingPairing,initializePairing,activatePendingPairing} from './peer-pairing.mjs';
import {setupStatus,setupPairing,complementaryWindowsPairing} from './peer-setup.mjs';
import {ensureWindowsPairing} from './peer-setup-endpoint.mjs';
import {preparePeerCollection} from './peer-collection.mjs';
import {createPeerPayload} from './peer-payload.mjs';
import {publishLocalPayload,createPeerRecord,acceptPeerState,readPeerState} from './peer-store.mjs';
import {readQuotaState,updateQuotaState,setQuotaSharing} from './quota-store.mjs';
import {initializeDeviceIdentity} from './peer-device-identity.mjs';
import {saveConfirmedPeerTrust} from './peer-tls-trust.mjs';
import {prepareHostTLSSetup,readHostTLSSetup,recordHostTLSAcknowledgement} from './peer-tls-host.mjs';
import {setupConfigurationDigest,legacySetupConfigurationDigest} from './peer-tls-setup-message.mjs';

const runtimeBase=await testRuntimeBase('peer-legacy-shape');
after(()=>rm(runtimeBase,{recursive:true,force:true}));

const now=Date.now(),at=new Date(now).toISOString(),hex=c=>c.repeat(64);
const transport={kind:'ssh-windows',hostAlias:'synthetic-host',remoteNode:'C:/fixture/node.exe',
  remoteScript:'C:/fixture/peer-exchange.mjs',remoteRuntime:'C:/fixture/runtime'};
function oldPair(host='Mac') {
  const side=host=>({pairId:hex('a'),deviceId:hex(host==='Mac'?'b':'c'),comparisonId:hex('d'),host,codexHosts:[host]});
  return {version:1,local:{...side(host),comparisonSalt:hex('e')},peer:side(host==='Mac'?'Windows':'Mac')};
}
function normalized(value) {
  const result=structuredClone(value);
  delete result.local.codexHosts;delete result.peer.codexHosts;
  return result;
}
async function fixture(t) {
  const runtime=await realpath(await mkdtemp(path.join(runtimeBase,'observatory-legacy-shape-')));
  t.after(()=>rm(runtime,{recursive:true,force:true}));
  await privateSyncDirectory(runtime,true);
  return runtime;
}
const write=(runtime,name,value)=>writeFile(path.join(runtime,'private-sync',name),JSON.stringify(value),{mode:0o600});
async function snapshot(runtime) {
  const result={};
  async function visit(directory) {
    for(const entry of await readdir(directory,{withFileTypes:true})) {
      const file=path.join(directory,entry.name);
      if(entry.isDirectory())await visit(file);
      else result[file]={bytes:await readFile(file),mtime:(await stat(file,{bigint:true})).mtimeNs};
    }
  }
  await visit(runtime);return result;
}
async function unchanged(runtime,action) {
  const before=await snapshot(runtime),result=await action();
  const after=await snapshot(runtime);
  for(const [file,saved] of Object.entries(before))assert.deepEqual(after[file],saved,file);
  return result;
}
const payload=config=>createPeerPayload({collectedAt:at,activity:{status:'not-connected'},
  codex:[{host:config.host,status:'not-connected'}],dictation:[{source:'Wispr Flow',status:'not-connected'}]},config);

test('legacy SSH pairings preserve files, revisions and quota sharing without repair',async t=>{
  const mac=await fixture(t),windows=await fixture(t),raw={...oldPair(),transport},safe=normalized(raw);
  await write(mac,'pairing.json',raw);await write(windows,'pairing.json',oldPair('Windows'));
  const local=await publishLocalPayload(mac,payload(raw.local),raw.local,now);
  const peer=createPeerRecord(payload(raw.peer),raw.peer,7,now);
  await acceptPeerState(mac,peer,raw.peer,now);
  const initial=await readQuotaState(mac,now);
  const observed=await updateQuotaState(mac,{revision:initial.revision,scope:hex('f'),
    observation:{status:'ok',checkedAt:at,windows:[{bucket:'codex',window:'primary',remainingPercent:60}]}},now);
  const shared=await setQuotaSharing(mac,{revision:observed.revision,enabled:true,pairingId:raw.local.pairId},now);
  assert.deepEqual(await unchanged(mac,()=>readPairing(mac)),safe);
  assert.equal(await unchanged(mac,()=>readPendingPairing(mac)),null);
  assert.deepEqual(await unchanged(mac,()=>setupStatus(mac,'darwin')),{status:'paired',request:{transport}});
  assert.deepEqual(await unchanged(windows,()=>ensureWindowsPairing(windows,
    {version:1,pairing:complementaryWindowsPairing(safe)},'win32')),{version:1,status:'ready'});
  assert.deepEqual(await unchanged(mac,()=>readPeerState(mac,safe.peer,now)),peer);
  assert.deepEqual(await unchanged(mac,()=>readPeerState(mac,safe.local,now,'local')),local);
  assert.deepEqual((await unchanged(mac,()=>readQuotaState(mac,now))).sharing,shared.sharing);
  const ready=preparePeerCollection(await unchanged(mac,async()=>(await readPairing(mac)).local),'Mac',['Mac']);
  assert.equal(Object.hasOwn(ready.config,'codexHosts'),false);
  await unchanged(mac,()=>setupPairing(mac,{transport},async(_,pair)=>{
    assert.equal(JSON.stringify(pair).includes('codexHosts'),false);
    return unchanged(windows,()=>ensureWindowsPairing(windows,{version:1,pairing:pair},'win32'));
  },'darwin'));
  await unchanged(mac,()=>activatePendingPairing(mac,safe));
  await write(mac,'setup.pending.json',raw);
  assert.deepEqual(await unchanged(mac,()=>readPendingPairing(mac)),safe);
  assert.deepEqual(await unchanged(mac,()=>setupStatus(mac,'darwin')),{status:'pending',request:{transport}});
  const activeFile=path.join(mac,'private-sync/pairing.json'),activeBefore=(await snapshot(mac))[activeFile];
  await setupPairing(mac,{transport},async(_,pair)=>ensureWindowsPairing(windows,{version:1,pairing:pair},'win32'),'darwin');
  assert.deepEqual((await snapshot(mac))[activeFile],activeBefore);
  assert.equal(await readPendingPairing(mac),null);
});

test('legacy repaired SSH pairings preserve files and require matching local consent',async t=>{
  const mac=await fixture(t),windows=await fixture(t),repair={mac:hex('1'),windows:hex('2')};
  for(const [runtime,nonce] of [[mac,repair.mac],[windows,repair.windows]]) {
    await privateCollectorDirectory(runtime,'private-repair',true);
    await writeRepairConsent(runtime,nonce);
  }
  const raw={...oldPair(),transport,repair},remote={...oldPair('Windows'),repair},safe=normalized(raw);
  await write(mac,'pairing.json',raw);await write(windows,'pairing.json',remote);
  assert.deepEqual(await unchanged(mac,()=>readPairing(mac)),safe);
  assert.deepEqual(await unchanged(windows,()=>readPairing(windows)),normalized(remote));
  assert.deepEqual(await unchanged(mac,()=>setupStatus(mac,'darwin')),{status:'paired',request:{transport}});
  const complementary=complementaryWindowsPairing(safe);
  assert.deepEqual(complementary,normalized(remote));
  assert.deepEqual(await unchanged(windows,()=>ensureWindowsPairing(windows,
    {version:1,pairing:complementary},'win32')),{version:1,status:'ready'});
  assert.deepEqual(await unchanged(mac,()=>unchanged(windows,()=>setupPairing(mac,{transport},async(target,pair)=>{
    assert.deepEqual(target,transport);assert.deepEqual(pair,complementary);
    return ensureWindowsPairing(windows,{version:1,pairing:pair},'win32');
  },'darwin'))),{status:'paired'});
  await write(mac,'setup.pending.json',raw);
  assert.deepEqual(await unchanged(mac,()=>readPendingPairing(mac)),safe);
  assert.deepEqual(await unchanged(mac,()=>setupStatus(mac,'darwin')),{status:'pending',request:{transport}});
  await writeRepairConsent(windows,hex('3'));
  await unchanged(windows,()=>assert.rejects(ensureWindowsPairing(windows,
    {version:1,pairing:complementary},'win32'),/Fresh confirmation on both devices required/));
});

test('retired two-slot files are refused and new pairing files omit legacy keys',async t=>{
  const bad=await fixture(t),raw=oldPair('Windows');raw.local.codexHosts=['Windows','Ubuntu'];
  await write(bad,'pairing.json',raw);
  await unchanged(bad,()=>assert.rejects(readPairing(bad)));
  const fresh=await fixture(t),legacy=oldPair();await initializePairing(fresh,legacy);
  const stored=JSON.parse(await readFile(path.join(fresh,'private-sync/pairing.json'),'utf8'));
  assert.deepEqual(stored,normalized(legacy));assert.equal(JSON.stringify(stored).includes('codexHosts'),false);
});

test('legacy TLS offer and receipt remain acknowledged without rewriting files',
  {skip:!['darwin','win32'].includes(process.platform)},async t=>{
    const runtime=await fixture(t),host=process.platform==='darwin'?'Mac':'Windows';
    const openssl=process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'/usr/bin/openssl';
    async function identity(name) {
      const key=path.join(runtime,name+'.key'),cert=path.join(runtime,name+'.pem');
      execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-sha256','-keyout',key,
        '-out',cert,'-days','1','-subj','/CN=Synthetic legacy test'],{stdio:'ignore',timeout:15000});
      return {version:1,key:await readFile(key,'utf8'),cert:await readFile(cert,'utf8')};
    }
    const local=await identity('local'),peer=await identity('peer');
    const fingerprint=value=>new X509Certificate(value.cert).fingerprint256.replaceAll(':','').toLowerCase();
    await initializeDeviceIdentity(runtime,local);
    const raw={...oldPair(host),transport:{kind:'tls',address:'10.0.0.3',port:43128},
      localEndpoint:{kind:'tls',address:'10.0.0.2',port:43128},peerCertificateSha256:fingerprint(peer)};
    await write(runtime,'pairing.json',raw);
    await saveConfirmedPeerTrust(runtime,{pairId:raw.local.pairId,localCertificateSha256:fingerprint(local),
      peerCertificate:peer.cert,peerCertificateSha256:fingerprint(peer)});
    const {comparisonSalt,...remote}=raw.local;
    const offer={version:1,local:{...raw.peer,comparisonSalt},peer:remote,transport:raw.localEndpoint,
      localEndpoint:raw.transport,peerCertificateSha256:fingerprint(local)};
    await write(runtime,'tls-offer.json',offer);
    const ordered=value=>Array.isArray(value)?value.map(ordered):value && typeof value==='object'?
      Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
    const digest=createHash('sha256').update('observatory-setup-v1\n'+JSON.stringify(ordered(offer))).digest('hex');
    assert.equal(legacySetupConfigurationDigest(offer),digest);
    assert.notEqual(setupConfigurationDigest(offer),digest);
    await write(runtime,'tls-acknowledgement.json',{version:1,pairId:raw.local.pairId,deviceId:raw.peer.deviceId,
      peerCertificateSha256:fingerprint(peer),digest});
    assert.deepEqual(await unchanged(runtime,()=>readPairing(runtime)),normalized(raw));
    assert.deepEqual(await unchanged(runtime,()=>readHostTLSSetup(runtime)),{pairing:normalized(offer),acknowledged:true});
    const request={localEndpoint:raw.localEndpoint,peerEndpoint:raw.transport,peerCertificate:peer.cert,peerCertificateSha256:fingerprint(peer)};
    assert.deepEqual(await unchanged(runtime,()=>prepareHostTLSSetup(runtime,request)),normalized(offer));
    await unchanged(runtime,()=>assert.rejects(prepareHostTLSSetup(runtime,{...request,includeUbuntu:false})));
    await unchanged(runtime,()=>assert.rejects(recordHostTLSAcknowledgement(runtime,{peerCertificateSha256:fingerprint(peer),digest})));
    await unchanged(runtime,()=>recordHostTLSAcknowledgement(runtime,{peerCertificateSha256:fingerprint(peer),digest:setupConfigurationDigest(offer)}));
  });
