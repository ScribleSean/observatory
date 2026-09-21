import test from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import {X509Certificate} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtemp,realpath,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {initializeDeviceIdentity} from './peer-device-identity.mjs';
import {createPairingConfigurations,initializePairing} from './peer-pairing.mjs';
import {saveConfirmedPeerTrust} from './peer-tls-trust.mjs';
import {tlsQuotaRequest} from './peer-tls-outbound.mjs';
import {syncQuota} from './quota-sync.mjs';
import {exchangeQuota} from './quota-exchange.mjs';
import {readQuotaState,updateQuotaState,setQuotaSharing,revokeQuotaSharing} from './quota-store.mjs';

// Windows verifies private-directory ACLs through PowerShell for each state access.
// Allow the sequential fixture to finish without changing individual I/O deadlines.
test('pinned TLS allowance exchange sends only consented sanitized readings',
  {skip:!['darwin','win32'].includes(process.platform),timeout:process.platform==='win32'?300000:120000},async t=>{
  const root=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-quota-tls-')));
  const sockets=new Set();let server;
  try {
    const openssl=process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'/usr/bin/openssl';
    async function identity(name) {
      const key=path.join(root,name+'.key'),cert=path.join(root,name+'.pem');
      execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-sha256','-keyout',key,'-out',cert,
        '-days','1','-subj','/CN=Synthetic allowance test'],{stdio:'ignore',timeout:15000});
      return {version:1,key:await readFile(key,'utf8'),cert:await readFile(cert,'utf8')};
    }
    const own=await identity('own'),peer=await identity('peer');
    const local=await mkdtemp(path.join(root,'local-')),remote=await mkdtemp(path.join(root,'remote-'));
    const host=process.platform==='darwin'?'Mac':'Windows',other=host==='Mac'?'Windows':'Mac';
    const pairs=createPairingConfigurations(),pair=pairs[host];
    const requests=[];
    server=tls.createServer({key:peer.key,cert:peer.cert,ca:own.cert,requestCert:true,rejectUnauthorized:true,
      minVersion:'TLSv1.3',ALPNProtocols:['observatory-sync/1'],allowHalfOpen:true},socket=>{
      socket.on('error',()=>{});
      const chunks=[];let size=0;
      socket.on('data',chunk=>{size+=chunk.length;if(size>1_100_000)socket.destroy();else chunks.push(chunk);});
      socket.once('end',()=>{void (async()=>{
        const message=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        assert.equal(message.version,1);assert.equal(message.channel,'quota');
        assert.deepEqual(Object.keys(message).sort(),['channel','request','version']);
        requests.push(message.request);
        socket.end(JSON.stringify(await exchangeQuota(remote,message.request)));
      })().catch(()=>socket.destroy());});
    });
    server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
    server.on('tlsClientError',()=>{});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    pair.transport={kind:'tls',address:'10.0.0.2',port:server.address().port};
    await initializeDeviceIdentity(local,own);await initializePairing(local,pair);await initializePairing(remote,pairs[other]);
    const hash=pem=>new X509Certificate(pem).fingerprint256.replaceAll(':','').toLowerCase();
    await saveConfirmedPeerTrust(local,{pairId:pair.local.pairId,localCertificateSha256:hash(own.cert),
      peerCertificate:peer.cert,peerCertificateSha256:hash(peer.cert)});
    for(const [runtime,scope,remaining] of [[local,'a'.repeat(64),40],[remote,'b'.repeat(64),70]]) {
      const before=await readQuotaState(runtime),now=Date.now();
      const updated=await updateQuotaState(runtime,{revision:before.revision,scope,
        observation:{status:'ok',checkedAt:new Date(now).toISOString(),windows:[{bucket:'codex',window:'primary',remainingPercent:remaining}]}},now);
      await setQuotaSharing(runtime,{revision:updated.revision,enabled:true,pairingId:pair.local.pairId});
    }
    const connect=options=>tls.connect({...options,host:'127.0.0.1'});
    const request=(transport,input)=>tlsQuotaRequest(local,transport,input,{connect});
    await t.test('readiness precedes readings and both source values persist separately',async()=>{
      const result=await syncQuota(local,{request});assert.equal(result.status,'ok');
      assert.equal(result.peer.windows[0].remainingPercent,70);
      assert.equal((await readQuotaState(remote)).remote.record.payload.history[0].windows[0].remainingPercent,40);
      assert.deepEqual(Object.keys(requests[0]).sort(),['action','deviceId','pairId','version']);
      assert.equal(requests[0].action,'status');assert.equal(requests[1].action,'exchange');
      assert.equal(JSON.stringify(requests).includes('a'.repeat(64)),false);
      assert.equal(JSON.stringify(requests).includes('b'.repeat(64)),false);
    });
    await t.test('unexpected record fields cannot trigger a connection',async()=>{
      let dialed=false;
      const invalid=structuredClone(requests[1]);invalid.record.privateKey='must-not-send';
      await assert.rejects(tlsQuotaRequest(local,pair.transport,invalid,{connect:()=>{dialed=true;throw Error('Unexpected dial');}}));
      assert.equal(dialed,false);
    });
    await t.test('local consent is rechecked after TLS handshake before application bytes',async()=>{
      const before=requests.length;
      const guardedConnect=options=>{
        const socket=connect(options),once=socket.once.bind(socket);
        socket.once=(event,callback)=>event==='secureConnect'?
          once(event,()=>{void revokeQuotaSharing(local).then(()=>callback()).catch(()=>socket.destroy());}):once(event,callback);
        return socket;
      };
      await assert.rejects(tlsQuotaRequest(local,pair.transport,{version:1,action:'status',pairId:pair.local.pairId,deviceId:pair.local.deviceId},
        {connect:guardedConnect}));
      assert.equal(requests.length,before);
      assert.equal((await syncQuota(local,{request})).status,'disabled');
    });
    await t.test('remote disable returns no readings and clears the cached peer projection',async()=>{
      const state=await readQuotaState(local);
      await setQuotaSharing(local,{revision:state.revision,enabled:true,pairingId:pair.local.pairId});
      await revokeQuotaSharing(remote);const before=requests.length;
      const result=await syncQuota(local,{request});
      assert.equal(result.status,'peer-disabled');assert.equal(result.peer,null);
      assert.equal(requests.length,before+1);assert.equal(requests.at(-1).action,'status');
    });
  } finally {
    for(const socket of sockets)socket.destroy();
    if(server)await new Promise(resolve=>server.close(resolve));
    await rm(root,{recursive:true,force:true});
  }
});
