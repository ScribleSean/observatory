import test from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import {X509Certificate} from 'node:crypto';
import {mkdtemp,realpath,rm,readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createTrustedSyncService} from './peer-tls-service.mjs';
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
import {tlsPeerExchange} from './peer-tls-outbound.mjs';
import {finalizePeerCollection} from './peer-finalize.mjs';

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
    let bound=false;
    await assert.rejects(startTrustedSyncListener(root,{address:'10.0.0.2',port:43128},
      {expectedPairing:{...pair,localEndpoint:{kind:'tls',address:'10.0.0.2',port:43128}},
        createServer:()=>{bound=true;throw Error('Must not bind');}}));
    assert.equal(bound,false);
    await t.test('service reads actual saved bindings and closes a revoked listener',async()=>{
      const runtime=await mkdtemp(path.join(root,'service-'));
      const configured={...pair,transport:{kind:'tls',address:'10.0.0.3',port:43128},
        localEndpoint:{kind:'tls',address:'10.0.0.2',port:43128}};
      await initializeDeviceIdentity(runtime,localIdentity);await initializePairing(runtime,configured);
      await saveConfirmedPeerTrust(runtime,{pairId:pair.local.pairId,localCertificateSha256:fingerprint(localIdentity.cert),
        peerCertificate:guest.cert,peerCertificateSha256:fingerprint(guest.cert)});
      let started=0,active;
      const service=createTrustedSyncService(runtime,{start:async(location,endpoint,options)=>{
        started++;
        active=await startTrustedSyncListener(location,endpoint,{...options,createServer:(settings,callback)=>{
          const server=tls.createServer(settings,callback),listen=server.listen.bind(server);
          server.listen=(binding,ready)=>listen({...binding,host:'127.0.0.1',port:0},ready);return server;
        }});
        return active;
      }});
      try {
        assert.deepEqual(await service.run({action:'status'}),{status:'sync-listening'});
        assert.deepEqual(await service.reconcile(),{status:'sync-listening'});
        assert.equal(started,1);assert.equal(active.isListening(),true);
        await revokePairing(runtime);
        assert.deepEqual(await service.reconcile(),{status:'unavailable'});
        assert.equal(active.isListening(),false);
      } finally {await service.cancel();}
    });
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
    await t.test('collector outbound TLS sends only its saved local record and merges the validated response',async()=>{
      const runtime=await mkdtemp(path.join(root,'outbound-')),connections=new Set();
      let responseRecord,captured,early=false;
      const remote=tls.createServer({key:guest.key,cert:guest.cert,ca:localIdentity.cert,
        requestCert:true,rejectUnauthorized:true,minVersion:'TLSv1.3',ALPNProtocols:['observatory-sync/1'],allowHalfOpen:true},socket=>{
        if(early){socket.on('error',()=>{});socket.end(JSON.stringify({version:1,record:responseRecord}));return;}
        const chunks=[];socket.on('error',()=>{});socket.on('data',chunk=>chunks.push(chunk));
        socket.once('end',()=>{
          captured=JSON.parse(Buffer.concat(chunks).toString('utf8'));
          socket.end(JSON.stringify({version:1,record:responseRecord}));
        });
      });
      remote.on('tlsClientError',()=>{});
      remote.on('connection',socket=>{connections.add(socket);socket.once('close',()=>connections.delete(socket));});
      await new Promise(resolve=>remote.listen(0,'127.0.0.1',resolve));
      try {
        const pairing={...createPairingConfigurations()[pair.local.host],
          transport:{kind:'tls',address:'10.0.0.2',port:remote.address().port}};
        await initializeDeviceIdentity(runtime,localIdentity);await initializePairing(runtime,pairing);
        await saveConfirmedPeerTrust(runtime,{pairId:pairing.local.pairId,localCertificateSha256:fingerprint(localIdentity.cert),
          peerCertificate:guest.cert,peerCertificateSha256:fingerprint(guest.cert)});
        responseRecord=createPeerRecord(payload(pairing.peer),pairing.peer,1);
        const exchangeTLS=(location,transport,record)=>tlsPeerExchange(location,transport,record,
          {connect:options=>tls.connect({...options,host:'127.0.0.1'})});
        const result=await finalizePeerCollection(runtime,{data:[],peer:{status:'ready',payload:payload(pairing.local)}},
          pairing,[],Date.now(),{exchangeTLS});
        assert.equal(result.peer.status,'merged');assert.equal(result.peer.transport,'ok');
        assert.deepEqual(captured,{version:1,record:await readPeerState(runtime,pairing.local,Date.now(),'local')});
        assert.deepEqual(await readPeerState(runtime,pairing.peer),responseRecord);
        assert.equal(JSON.stringify(captured).includes(pairing.local.comparisonSalt),false);
        let dialed=false;
        await assert.rejects(tlsPeerExchange(runtime,pairing.transport,{not:'saved'},
          {connect:()=>{dialed=true;throw Error('unexpected');}}));
        assert.equal(dialed,false);
        early=true;
        await assert.rejects(exchangeTLS(runtime,pairing.transport,await readPeerState(runtime,pairing.local,Date.now(),'local')));
        early=false;
        const fallback=await finalizePeerCollection(runtime,{data:[{localFixture:true}],peer:{status:'ready',payload:payload(pairing.local)}},
          pairing,[],Date.now(),{exchangeTLS:async()=>{throw Error('offline');}});
        assert.equal(fallback.peer.transport,'unavailable');
        assert.equal(fallback.peer.status,'merged');
      } finally {
        for(const socket of connections)socket.destroy();
        await new Promise(resolve=>remote.close(resolve));
      }
    });
  });
