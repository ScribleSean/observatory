import test from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import {X509Certificate} from 'node:crypto';
import {mkdtemp,realpath,rm,readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {initializeDeviceIdentity} from './peer-device-identity.mjs';
import {createPairingConfigurations,initializePairing} from './peer-pairing.mjs';
import {saveConfirmedPeerTrust} from './peer-tls-trust.mjs';
import {createPeerPayload} from './peer-payload.mjs';
import {publishLocalPayload,createPeerRecord,readPeerState} from './peer-store.mjs';
import {revokePairing} from './peer-revocation.mjs';
import {startTrustedSyncListener} from './peer-tls-sync.mjs';

const openssl=process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'/usr/bin/openssl';
const fingerprint=pem=>new X509Certificate(pem).fingerprint256.replaceAll(':','').toLowerCase();
test('trusted TLS exchange uses the existing record store and revocation fence',
  {skip:!['darwin','win32'].includes(process.platform) || !existsSync(openssl)},async t=>{
    const root=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-sync-test-')));
    t.after(()=>rm(root,{recursive:true,force:true}));
    async function identity(name) {
      const key=path.join(root,name+'.key'),cert=path.join(root,name+'.pem');
      execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-sha256','-keyout',key,
        '-out',cert,'-days','1','-subj','/CN=Synthetic sync test'],{stdio:'ignore',timeout:15000});
      return {version:1,key:await readFile(key,'utf8'),cert:await readFile(cert,'utf8')};
    }
    const localIdentity=await identity('host'),guest=await identity('guest');
    const pair=createPairingConfigurations()[process.platform==='darwin'?'Mac':'Windows'];
    await initializeDeviceIdentity(root,localIdentity);await initializePairing(root,pair);
    await saveConfirmedPeerTrust(root,{pairId:pair.local.pairId,localCertificateSha256:fingerprint(localIdentity.cert),
      peerCertificate:guest.cert,peerCertificateSha256:fingerprint(guest.cert)});
    const payload=config=>createPeerPayload({collectedAt:new Date().toISOString(),activity:{status:'not-connected'},
      codex:[{host:config.host,status:'not-connected'}],dictation:[{source:'Wispr Flow',status:'not-connected'}]},config);
    const local=await publishLocalPayload(root,payload(pair.local),pair.local);
    const incoming=createPeerRecord(payload(pair.peer),pair.peer,1);
    const createServer=(options,callback)=>{
      const server=tls.createServer(options,callback),listen=server.listen.bind(server);
      server.listen=(binding,ready)=>listen({...binding,host:'127.0.0.1'},ready);return server;
    };
    const listener=await startTrustedSyncListener(root,{address:'10.0.0.2'},{createServer});
    const send=(request,identity=guest,beforeSend=()=>{})=>new Promise((resolve,reject)=>{
      const socket=tls.connect({host:'127.0.0.1',port:listener.port,key:identity.key,cert:identity.cert,
        ca:localIdentity.cert,rejectUnauthorized:true,minVersion:'TLSv1.3',ALPNProtocols:['observatory-sync/1'],
        checkServerIdentity:(_host,cert)=>cert.fingerprint256===new X509Certificate(localIdentity.cert).fingerprint256?undefined:Error('Wrong peer')},
      ()=>{Promise.resolve().then(beforeSend).then(()=>socket.end(JSON.stringify(request))).catch(()=>socket.destroy());});
      const chunks=[];let size=0;
      const deadline=setTimeout(()=>{socket.destroy();reject(Error('Test timeout'));},30000);
      socket.on('data',chunk=>{size+=chunk.length;if(size>17_000_000){socket.destroy();return;}chunks.push(chunk);});
      socket.once('error',()=>{});
      socket.once('close',()=>{clearTimeout(deadline);try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(Error('Exchange rejected'));}});
    });
    try {
      await assert.rejects(send({version:1,record:incoming},localIdentity));
      assert.equal(await readPeerState(root,pair.peer),null);
      await assert.rejects(send({version:1,record:incoming,command:'not-allowed'}));
      assert.equal(await readPeerState(root,pair.peer),null);
      const wrong=structuredClone(incoming);wrong.revision.deviceId='00'.repeat(32);
      await assert.rejects(send({version:1,record:wrong}));
      assert.equal(await readPeerState(root,pair.peer),null);
      assert.deepEqual(await send({version:1,record:incoming}),{version:1,record:local});
      assert.deepEqual(await readPeerState(root,pair.peer),incoming);
      assert.deepEqual(await send({version:1,record:incoming}),{version:1,record:local});
      await assert.rejects(send({version:1,record:incoming},guest,()=>revokePairing(root)));
      await assert.rejects(send({version:1,record:incoming}));
    } finally {await listener.close();}
  });
