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
import {exchangePeerRequest} from './peer-exchange.mjs';
import {startTrustedSyncListener} from './peer-tls-sync.mjs';
import {tlsProviderTokenRequest} from './peer-tls-outbound.mjs';
import {cleanClaudeTokenSource} from './provider-token-sources.mjs';
import {updateProviderTokenSource,readProviderTokenState,disableProviderTokenSharing} from './provider-token-store.mjs';
import {providerTokenSharingControl} from './provider-token-sharing-control.mjs';
import {syncProviderTokens} from './provider-token-sync.mjs';

test('provider channel uses pinned TLS and fences disable after handshake',
  {skip:!['darwin','win32'].includes(process.platform),timeout:process.platform==='win32'?300000:120000},async t=>{
  const root=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-provider-tls-')));
  let listener,trusted;
  const sockets=new Set();
  try {
    const openssl=process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'/usr/bin/openssl';
    const identities={};
    for(const host of ['Mac','Windows']) {
      const key=path.join(root,host+'.key'),cert=path.join(root,host+'.pem');
      execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-sha256','-keyout',key,'-out',cert,
        '-days','1','-subj','/CN=Synthetic provider test'],{stdio:'ignore',timeout:15000});
      identities[host]={version:1,key:await readFile(key,'utf8'),cert:await readFile(cert,'utf8')};
    }
    const pairs=createPairingConfigurations(),runtimes={},requests=[];
    const localHost=process.platform==='darwin'?'Mac':'Windows',remoteHost=localHost==='Mac'?'Windows':'Mac';
    const hash=cert=>new X509Certificate(cert).fingerprint256.replaceAll(':','').toLowerCase();
    for(const host of ['Mac','Windows'])runtimes[host]=await mkdtemp(path.join(root,host));
    const own=identities[localHost],peer=identities[remoteHost];
    await initializePairing(runtimes[remoteHost],pairs[remoteHost]);
    listener=tls.createServer({key:peer.key,cert:peer.cert,ca:own.cert,requestCert:true,rejectUnauthorized:true,
      minVersion:'TLSv1.3',ALPNProtocols:['observatory-sync/1'],allowHalfOpen:true},socket=>{
      socket.on('error',()=>{});const chunks=[];socket.on('data',chunk=>chunks.push(chunk));
      socket.once('end',()=>{void (async()=>{
        if(!chunks.length)return socket.destroy();
        const message=JSON.parse(Buffer.concat(chunks).toString('utf8'));requests.push(message);
        socket.end(JSON.stringify(await exchangePeerRequest(runtimes[remoteHost],message)));
      })().catch(()=>socket.destroy());});
    });
    listener.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
    listener.on('tlsClientError',()=>{});
    await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
    pairs[localHost].transport={kind:'tls',address:'10.0.0.2',port:listener.address().port};
    await initializeDeviceIdentity(runtimes[localHost],own);
    await initializePairing(runtimes[localHost],pairs[localHost]);
    await saveConfirmedPeerTrust(runtimes[localHost],{pairId:pairs[localHost].local.pairId,localCertificateSha256:hash(own.cert),
      peerCertificate:peer.cert,peerCertificateSha256:hash(peer.cert)});
    for(const host of ['Mac','Windows']) {
      const counts={inputTokens:1,cacheReadTokens:2,cacheCreationTokens:3,outputTokens:4,totalTokens:10,requestCount:1};
      const source=cleanClaudeTokenSource({provider:'claude-code',status:'ok',days:[{date:'2026-09-25',...counts,models:[{model:'claude-sonnet-4',...counts}]}]},host);
      await updateProviderTokenSource(runtimes[host],source);
      const status=await providerTokenSharingControl(runtimes[host]);
      await providerTokenSharingControl(runtimes[host],{action:'enable',token:status.token});
    }
    const connect=options=>tls.connect({...options,host:'127.0.0.1'});
    const request=(transport,input)=>tlsProviderTokenRequest(runtimes[localHost],transport,input,{connect});
    const result=await syncProviderTokens(runtimes[localHost],{request});
    assert.equal(result.status,'ok');assert.equal(result.peer.host,remoteHost);assert.equal(result.peer.days[0].totalTokens,10);
    assert.equal((await readProviderTokenState(runtimes[remoteHost])).remote.record.payload.source.host,localHost);
    assert.deepEqual(Object.keys(requests[0]).sort(),['channel','request','version']);
    assert.equal(requests[0].channel,'provider-tokens');assert.equal(requests[0].request.action,'status');
    assert.equal(Object.hasOwn(requests[0].request,'record'),false);assert.equal(requests[1].request.action,'exchange');
    const createServer=(options,handle)=>{
      const server=tls.createServer(options,handle),listen=server.listen.bind(server);
      server.listen=(binding,ready)=>listen({...binding,host:'127.0.0.1'},ready);return server;
    };
    trusted=await startTrustedSyncListener(runtimes[localHost],{address:'10.0.0.2'},{createServer});
    const incoming={version:1,channel:'provider-tokens',request:{version:1,action:'exchange',pairId:pairs[localHost].peer.pairId,
      deviceId:pairs[localHost].peer.deviceId,record:(await readProviderTokenState(runtimes[remoteHost])).local}};
    const accepted=await new Promise((resolve,reject)=>{
      const chunks=[],socket=tls.connect({host:'127.0.0.1',port:trusted.port,key:peer.key,cert:peer.cert,ca:own.cert,
        rejectUnauthorized:true,minVersion:'TLSv1.3',ALPNProtocols:['observatory-sync/1'],
        checkServerIdentity:(_host,cert)=>cert.fingerprint256===new X509Certificate(own.cert).fingerprint256?undefined:Error('Wrong peer')},
      ()=>socket.end(JSON.stringify(incoming)));
      const deadline=setTimeout(()=>{socket.destroy();reject(Error('Fixture timeout'));},10000);
      socket.on('data',chunk=>chunks.push(chunk));socket.once('error',reject);
      socket.once('close',()=>{clearTimeout(deadline);try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch(error){reject(error);}});
    });
    assert.equal(accepted.status,'ready');assert.equal(accepted.record.payload.source.host,localHost);
    let dialed=false;
    const invalid=structuredClone(requests[1].request);invalid.record.private='must-not-send';
    await assert.rejects(tlsProviderTokenRequest(runtimes[localHost],pairs[localHost].transport,invalid,{connect:()=>{dialed=true;throw Error('Unexpected dial');}}));
    assert.equal(dialed,false);
    const before=requests.length;
    const guardedConnect=options=>{
      const socket=connect(options),once=socket.once.bind(socket);
      socket.once=(event,callback)=>event==='secureConnect'?
        once(event,()=>{void disableProviderTokenSharing(runtimes[localHost]).then(()=>callback()).catch(()=>socket.destroy());}):once(event,callback);
      return socket;
    };
    await assert.rejects(tlsProviderTokenRequest(runtimes[localHost],pairs[localHost].transport,requests[0].request,{connect:guardedConnect}));
    assert.equal(requests.length,before);
    assert.equal((await syncProviderTokens(runtimes[localHost],{request})).status,'disabled');
  } finally {await trusted?.close();for(const socket of sockets)socket.destroy();if(listener)await new Promise(resolve=>listener.close(resolve));await rm(root,{recursive:true,force:true});}
});
