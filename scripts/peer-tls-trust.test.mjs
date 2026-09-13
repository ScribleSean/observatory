import test from 'node:test';
import assert from 'node:assert/strict';
import {X509Certificate} from 'node:crypto';
import {mkdtemp,realpath,rm,readFile,writeFile,link,readdir,stat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {initializeDeviceIdentity} from './peer-device-identity.mjs';
import {createPairingConfigurations,initializePairing,readPairing} from './peer-pairing.mjs';
import {commitConfirmedTLSPairing} from './peer-tls-setup.mjs';
import {prepareHostTLSSetup,readHostTLSSetup,recordHostTLSAcknowledgement} from './peer-tls-host.mjs';
import {setupConfigurationDigest} from './peer-tls-setup-message.mjs';
import {saveConfirmedPeerTrust,readPeerTrust} from './peer-tls-trust.mjs';
import {revokePairing} from './peer-revocation.mjs';
import {preparePairingRepair} from './peer-repair.mjs';

const openssl=process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'/usr/bin/openssl';
const fingerprint=pem=>new X509Certificate(pem).fingerprint256.replaceAll(':','').toLowerCase();
test('TLS trust is bound to persistent identities and pairing generation',
  {skip:!['darwin','win32'].includes(process.platform) || !existsSync(openssl)},async t=>{
    const root=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-trust-test-')));
    t.after(()=>rm(root,{recursive:true,force:true}));
    async function identity(name) {
      const key=path.join(root,name+'.key'),cert=path.join(root,name+'.pem');
      execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-sha256','-keyout',key,
        '-out',cert,'-days','1','-subj','/CN=Synthetic trust test'],{stdio:'ignore',timeout:15000});
      return {version:1,key:await readFile(key,'utf8'),cert:await readFile(cert,'utf8')};
    }
    const local=await identity('local'),peer=await identity('peer');
    const host=process.platform==='darwin'?'Mac':'Windows';
    async function fixture({initialize=true,tls=false}={}) {
      const runtime=await mkdtemp(path.join(root,'runtime-')),pairing=createPairingConfigurations()[host];
      if(tls)pairing.transport={kind:'tls',address:'100.64.0.2',port:43128};
      await initializeDeviceIdentity(runtime,local);
      if(initialize)await initializePairing(runtime,pairing);
      const claim={pairId:pairing.local.pairId,localCertificateSha256:fingerprint(local.cert),
        peerCertificate:peer.cert,peerCertificateSha256:fingerprint(peer.cert)};
      return {runtime,pairing,claim,file:path.join(runtime,'private-sync','tls-trust.json')};
    }
    await t.test('host persists complementary offer and acknowledgement across a fresh process',async()=>{
      const f=await fixture({initialize:false,tls:true});
      const request={peerCertificate:peer.cert,peerCertificateSha256:fingerprint(peer.cert),includeUbuntu:false,
        localEndpoint:{kind:'tls',address:'10.0.0.2',port:43128},peerEndpoint:f.pairing.transport};
      const offer=await prepareHostTLSSetup(f.runtime,request),localPair=await readPairing(f.runtime);
      assert.equal(offer.local.deviceId,localPair.peer.deviceId);
      assert.equal(offer.peer.deviceId,localPair.local.deviceId);
      assert.equal(offer.local.comparisonSalt,localPair.local.comparisonSalt);
      assert.equal(offer.peerCertificateSha256,fingerprint(local.cert));
      assert.deepEqual(await prepareHostTLSSetup(f.runtime,request),offer);
      assert.deepEqual(await readHostTLSSetup(f.runtime),{pairing:offer,acknowledged:false});
      const ack={peerCertificateSha256:fingerprint(peer.cert),digest:setupConfigurationDigest(offer)};
      await assert.rejects(recordHostTLSAcknowledgement(f.runtime,{...ack,digest:'0'.repeat(64)}));
      await assert.rejects(recordHostTLSAcknowledgement(f.runtime,{...ack,peerCertificateSha256:fingerprint(local.cert)}));
      for(let attempt=0;attempt<2;attempt++)
        assert.deepEqual(await recordHostTLSAcknowledgement(f.runtime,ack),{version:1,status:'acknowledged'});
      const module=new URL('./peer-tls-host.mjs',import.meta.url).href;
      const restarted=execFileSync(process.execPath,['--input-type=module','-e',
        `import {readHostTLSSetup} from ${JSON.stringify(module)}; console.log((await readHostTLSSetup(process.argv[1])).acknowledged);`,
        f.runtime],{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']});
      assert.equal(restarted.trim(),'true');
      await assert.rejects(prepareHostTLSSetup(f.runtime,{...request,localEndpoint:{...request.localEndpoint,port:43129}}));
      assert.deepEqual(await readHostTLSSetup(f.runtime),{pairing:offer,acknowledged:true});
      await revokePairing(f.runtime);await assert.rejects(readHostTLSSetup(f.runtime));
      await assert.rejects(recordHostTLSAcknowledgement(f.runtime,ack));
    });
    await t.test('host resumes a configuration-only save and rejects corrupt acknowledgement',async()=>{
      const f=await fixture({initialize:false,tls:true});
      await initializePairing(f.runtime,{...f.pairing,peerCertificateSha256:fingerprint(peer.cert)});
      const offer=await prepareHostTLSSetup(f.runtime,{peerCertificate:peer.cert,peerCertificateSha256:fingerprint(peer.cert),
        includeUbuntu:false,localEndpoint:{kind:'tls',address:'10.0.0.2',port:43128},peerEndpoint:f.pairing.transport});
      assert.equal(offer.local.pairId,f.pairing.local.pairId);
      const ackFile=path.join(f.runtime,'private-sync','tls-acknowledgement.json');
      await writeFile(ackFile,'null',{mode:0o600});
      await assert.rejects(readHostTLSSetup(f.runtime));
      await assert.rejects(recordHostTLSAcknowledgement(f.runtime,
        {peerCertificateSha256:fingerprint(peer.cert),digest:setupConfigurationDigest(offer)}));
      assert.equal(await readFile(ackFile,'utf8'),'null');
    });
    await t.test('confirmed TLS setup persists and identical retries do not rewrite files',async()=>{
      const f=await fixture({initialize:false,tls:true}),request={pairing:f.pairing,claim:f.claim};
      assert.deepEqual(await commitConfirmedTLSPairing(f.runtime,request),{version:1,status:'local-ready'});
      const before=await readFile(f.file),pairFile=path.join(f.runtime,'private-sync','pairing.json');
      const pairBefore=await readFile(pairFile);
      const unchanged=async file=>{const s=await stat(file,{bigint:true});return {ino:s.ino,mtimeNs:s.mtimeNs};};
      const trustStat=await unchanged(f.file),pairStat=await unchanged(pairFile);
      assert.deepEqual(await commitConfirmedTLSPairing(f.runtime,request),{version:1,status:'local-ready'});
      assert.deepEqual(await readFile(f.file),before);assert.deepEqual(await readFile(pairFile),pairBefore);
      assert.deepEqual(await unchanged(f.file),trustStat);assert.deepEqual(await unchanged(pairFile),pairStat);
      assert.equal(existsSync(path.join(f.runtime,'private-quota')),false);
      const changed={...f.pairing,transport:{...f.pairing.transport,port:43129}};
      await assert.rejects(commitConfirmedTLSPairing(f.runtime,{...request,pairing:changed}));
      assert.deepEqual(await readFile(pairFile),pairBefore);
    });
    await t.test('confirmed TLS setup resumes after configuration write but before trust write',async()=>{
      const f=await fixture({initialize:false,tls:true});
      await initializePairing(f.runtime,{...f.pairing,peerCertificateSha256:f.claim.peerCertificateSha256});
      assert.equal(await readPeerTrust(f.runtime),null);
      const other=await identity('interrupted-other');
      await assert.rejects(commitConfirmedTLSPairing(f.runtime,{pairing:f.pairing,
        claim:{...f.claim,peerCertificate:other.cert,peerCertificateSha256:fingerprint(other.cert)}}));
      assert.equal(await readPeerTrust(f.runtime),null);
      assert.deepEqual(await commitConfirmedTLSPairing(f.runtime,{pairing:f.pairing,claim:f.claim}),
        {version:1,status:'local-ready'});
      assert.ok(await readPeerTrust(f.runtime));
    });
    await t.test('invalid confirmation cannot create pairing and conflicting trust cannot replace it',async()=>{
      const f=await fixture({initialize:false,tls:true}),request={pairing:f.pairing,claim:f.claim};
      await assert.rejects(commitConfirmedTLSPairing(f.runtime,{...request,claim:{...f.claim,peerCertificateSha256:'0'.repeat(64)}}));
      assert.equal(await readPairing(f.runtime),null);assert.equal(existsSync(f.file),false);
      await commitConfirmedTLSPairing(f.runtime,request);
      const before=await readFile(f.file),other=await identity('other');
      await assert.rejects(commitConfirmedTLSPairing(f.runtime,{...request,
        claim:{...f.claim,peerCertificate:other.cert,peerCertificateSha256:fingerprint(other.cert)}}));
      assert.deepEqual(await readFile(f.file),before);
      await revokePairing(f.runtime);
      await assert.rejects(commitConfirmedTLSPairing(f.runtime,request));
    });
    await t.test('explicit trust persists once without changing sharing settings',async()=>{
      const f=await fixture();assert.equal(await readPeerTrust(f.runtime),null);
      const saved=await saveConfirmedPeerTrust(f.runtime,f.claim);
      assert.equal(saved.pairId,f.pairing.local.pairId);
      assert.equal(fingerprint(saved.peerCertificate),f.claim.peerCertificateSha256);
      assert.deepEqual(await readPeerTrust(f.runtime),saved);
      await assert.rejects(saveConfirmedPeerTrust(f.runtime,f.claim));
      assert.deepEqual(await readPeerTrust(f.runtime),saved);
      assert.equal(existsSync(path.join(f.runtime,'private-quota')),false);
    });
    await t.test('mismatched generation or fingerprints cannot create trust',async()=>{
      const f=await fixture();
      for(const change of [{pairId:'00'.repeat(32)},{localCertificateSha256:'00'.repeat(32)},
        {peerCertificateSha256:'00'.repeat(32)},
        {peerCertificate:local.cert,peerCertificateSha256:fingerprint(local.cert)}])
        await assert.rejects(saveConfirmedPeerTrust(f.runtime,{...f.claim,...change}));
      assert.equal(existsSync(f.file),false);
    });
    await t.test('revocation immediately fences saved trust',async()=>{
      const f=await fixture();await saveConfirmedPeerTrust(f.runtime,f.claim);
      await revokePairing(f.runtime);await assert.rejects(readPeerTrust(f.runtime));
      assert.equal(existsSync(f.file),true);
    });
    await t.test('repair retires trust with the disabled generation',async()=>{
      const f=await fixture();await saveConfirmedPeerTrust(f.runtime,f.claim);
      await preparePairingRepair(f.runtime);
      const retired=(await readdir(f.runtime)).find(name=>name.startsWith('private-sync-retired-'));
      assert.ok(retired);assert.ok(existsSync(path.join(f.runtime,retired,'tls-trust.json')));
      await assert.rejects(readPeerTrust(f.runtime));
    });
    await t.test('corrupt and hard-linked trust files are rejected without replacement',async()=>{
      const f=await fixture();await saveConfirmedPeerTrust(f.runtime,f.claim);
      await writeFile(f.file,'{');await assert.rejects(readPeerTrust(f.runtime));
      await assert.rejects(saveConfirmedPeerTrust(f.runtime,f.claim));
      const other=await fixture();await saveConfirmedPeerTrust(other.runtime,other.claim);
      await link(other.file,path.join(root,'trust-link'));await assert.rejects(readPeerTrust(other.runtime));
    });
    await t.test('changing the local identity invalidates existing trust',async()=>{
      const f=await fixture();await saveConfirmedPeerTrust(f.runtime,f.claim);
      await writeFile(path.join(f.runtime,'private-device-identity','identity.json'),JSON.stringify(peer));
      await assert.rejects(readPeerTrust(f.runtime));
    });
    await t.test('changing the saved pairing generation invalidates existing trust',async()=>{
      const f=await fixture();await saveConfirmedPeerTrust(f.runtime,f.claim);
      await writeFile(path.join(f.runtime,'private-sync','pairing.json'),JSON.stringify(createPairingConfigurations()[host]));
      await assert.rejects(readPeerTrust(f.runtime));
    });
    await t.test('concurrent trust saves have one winner and preserve its record',async()=>{
      const f=await fixture();
      const results=await Promise.allSettled([saveConfirmedPeerTrust(f.runtime,f.claim),saveConfirmedPeerTrust(f.runtime,f.claim)]);
      assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
      assert.equal((await readPeerTrust(f.runtime)).pairId,f.claim.pairId);
    });
  });
