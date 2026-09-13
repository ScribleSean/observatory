import test from 'node:test';
import assert from 'node:assert/strict';
import {X509Certificate} from 'node:crypto';
import {mkdtemp,realpath,rm,readFile,writeFile,link,readdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {initializeDeviceIdentity} from './peer-device-identity.mjs';
import {createPairingConfigurations,initializePairing} from './peer-pairing.mjs';
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
    async function fixture() {
      const runtime=await mkdtemp(path.join(root,'runtime-')),pairing=createPairingConfigurations()[host];
      await initializeDeviceIdentity(runtime,local);await initializePairing(runtime,pairing);
      const claim={pairId:pairing.local.pairId,localCertificateSha256:fingerprint(local.cert),
        peerCertificate:peer.cert,peerCertificateSha256:fingerprint(peer.cert)};
      return {runtime,pairing,claim,file:path.join(runtime,'private-sync','tls-trust.json')};
    }
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
