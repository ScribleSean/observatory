import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import {X509Certificate} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdtemp,realpath,readFile,readdir,rm} from 'node:fs/promises';
import {testRuntimeBase} from './test-runtime-base.mjs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {initializeDeviceIdentity} from './peer-device-identity.mjs';
import {createPairingConfigurations,initializePairing,readPairing} from './peer-pairing.mjs';
import {preparePairingRepair} from './peer-repair.mjs';
import {readRepairConsent} from './peer-repair-consent.mjs';
import {startHostTLSSetup,readHostTLSSetup,prepareHostTLSSetup,recordHostTLSAcknowledgement} from './peer-tls-host.mjs';
import {startPairingListener} from './peer-tls-listener.mjs';
import {requestPeerClaim,claimFromInvitation,requestPeerSetup} from './peer-tls-client.mjs';
import {setupConfigurationDigest} from './peer-tls-setup-message.mjs';
import {receiveConfirmedTLSPairing} from './peer-tls-join.mjs';

const runtimeBase=await testRuntimeBase('peer-tls-repair');
after(()=>rm(runtimeBase,{recursive:true,force:true}));

const openssl=process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'/usr/bin/openssl';
const host=process.platform==='darwin'?'Mac':'Windows',peer=host==='Mac'?'Windows':'Mac';
const localKey=host==='Mac'?'mac':'windows',peerKey=host==='Mac'?'windows':'mac';
const connect=options=>tls.connect({...options,host:'127.0.0.1'});
const createServer=(options,callback)=>{
  const server=tls.createServer(options,callback),listen=server.listen.bind(server);
  server.listen=(binding,ready)=>listen({...binding,host:'127.0.0.1'},ready);
  return server;
};
const endpoints={localEndpoint:{kind:'tls',address:'10.0.0.2',port:43128},
  peerEndpoint:{kind:'tls',address:'10.0.0.3',port:43128}};

test('TLS repair consent',{skip:!existsSync(openssl) || !['darwin','win32'].includes(process.platform)},async t=>{
  const root=await realpath(await mkdtemp(path.join(runtimeBase,'observatory-tls-repair-')));
  t.after(()=>rm(root,{recursive:true,force:true}));
  async function identity(name) {
    const key=path.join(root,name+'.key'),cert=path.join(root,name+'.pem');
    execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-sha256','-keyout',key,
      '-out',cert,'-days','1','-subj','/CN=Observatory synthetic repair'],{stdio:'ignore',timeout:15000});
    return {key:await readFile(key,'utf8'),cert:await readFile(cert,'utf8')};
  }
  const serverIdentity=await identity('server'),clientIdentity=await identity('client');
  async function runtime(identity,repair=false) {
    const runtime=await mkdtemp(path.join(root,'runtime-'));
    await initializeDeviceIdentity(runtime,{version:1,...identity});
    if(repair) {
      await initializePairing(runtime,createPairingConfigurations()[host]);
      await preparePairingRepair(runtime);
    }
    return runtime;
  }
  async function retiredBytes(runtime) {
    const result={};
    for(const name of (await readdir(runtime)).filter(name=>name.startsWith('private-sync-retired-')))
      for(const file of await readdir(path.join(runtime,name)))result[name+'/'+file]=await readFile(path.join(runtime,name,file));
    return result;
  }
  async function noCommit(runtime,listener) {
    assert.equal(await readPairing(runtime),null);
    for(const file of ['pairing.json','tls-trust.json'])assert.equal(existsSync(path.join(runtime,'private-sync',file)),false);
    assert.equal(listener.status(),'configuration-ready');
  }
  for(const [name,hostRepaired,peerRepaired] of [['repair on the host side only',true,false],['repair on both sides',true,true],
    ['repair on the joining side only, unrepaired host',false,true]])await t.test(name,async()=>{
    const local=await runtime(serverIdentity,hostRepaired),nonce=await readRepairConsent(local),before=await retiredBytes(local);
    const peerNonce=peerRepaired?'b'.repeat(64):null,repair={...(nonce?{[localKey]:nonce}:{}),...(peerRepaired?{[peerKey]:peerNonce}:{})};
    const listener=await startHostTLSSetup(local,{address:'10.0.0.2'},{createServer});
    try {
      await requestPeerClaim(listener.invitation,serverIdentity.cert,clientIdentity,{connect,...(peerRepaired?{repairNonce:peerNonce}:{})});
      const pending=listener.pending();assert.equal(pending.peerRepairNonce,peerNonce);
      await listener.confirm(pending.claimId,endpoints);
      const response=await requestPeerSetup(listener.invitation,serverIdentity.cert,clientIdentity,{host:peer},{connect});
      assert.deepEqual((await readPairing(local)).repair,repair);assert.deepEqual(response.pairing.repair,repair);
      const request={...endpoints,peerCertificate:pending.peerCertificate,peerCertificateSha256:pending.peerCertificateSha256,peerRepairNonce:peerNonce};
      assert.deepEqual(await prepareHostTLSSetup(local,request),response.pairing);
      await assert.rejects(prepareHostTLSSetup(local,{...request,peerRepairNonce:'c'.repeat(64)}),{message:'Confirmed host setup unavailable'});
      // Network acknowledgement is covered by scripts/peer-tls-client.test.mjs and is done directly here so a slow private-folder check on Windows cannot outlast the 8 second connection deadlines.
      assert.deepEqual(await recordHostTLSAcknowledgement(local,{
        peerCertificateSha256:new X509Certificate(clientIdentity.cert).fingerprint256.replaceAll(':','').toLowerCase(),
        digest:setupConfigurationDigest(response.pairing)
      }),{version:1,status:'acknowledged'});
      assert.deepEqual(await readHostTLSSetup(local),{pairing:response.pairing,acknowledged:true});
      assert.deepEqual(await retiredBytes(local),before);
    } finally {await listener.cancel();}
  });
  for(const mode of ['repair on the joining side','stale nonce is refused','unrepaired joiner refuses a pairing that names its key'])
    await t.test(mode,async()=>{
      const local=await runtime(clientIdentity,mode!=='unrepaired joiner refuses a pairing that names its key');
      const nonce=await readRepairConsent(local),listener=await startPairingListener({address:'10.0.0.2',identity:serverIdentity},{createServer});
      try {
        await claimFromInvitation(listener.invitation,clientIdentity,{connect,repairNonce:nonce});
        const pair={...createPairingConfigurations()[host],transport:endpoints.localEndpoint,
          peerCertificateSha256:listener.invitation.certificateSha256,repair:{[localKey]:nonce??'a'.repeat(64)}};
        listener.confirmSetup(listener.pending().claimId,pair);
        if(mode==='stale nonce is refused') {
          // A replacement generation is retired again after the claim.
          await initializePairing(local,{...createPairingConfigurations()[host],repair:{[localKey]:nonce}});
          await preparePairingRepair(local);
          assert.notEqual(await readRepairConsent(local),nonce);
        }
        if(mode==='repair on the joining side') {
          assert.deepEqual(await receiveConfirmedTLSPairing(local,listener.invitation,{connect}),{status:'acknowledged'});
          assert.deepEqual(await readPairing(local),pair);
        } else {
          await assert.rejects(receiveConfirmedTLSPairing(local,listener.invitation,{connect}),{message:'Current local repair confirmation required'});
          await noCommit(local,listener);
        }
      } finally {await listener.cancel();}
    });
  await t.test('host refuses equal repair nonces',async()=>{
    const local=await runtime(serverIdentity,true),nonce=await readRepairConsent(local);
    const listener=await startHostTLSSetup(local,{address:'10.0.0.2'},{createServer});
    try {
      await requestPeerClaim(listener.invitation,serverIdentity.cert,clientIdentity,{connect,repairNonce:nonce});
      await assert.rejects(listener.confirm(listener.pending().claimId,endpoints));
      assert.equal(await readPairing(local),null);
      assert.equal(existsSync(path.join(local,'private-sync','tls-trust.json')),false);
    } finally {await listener.cancel();}
  });
  await t.test('listener refuses unknown keys and invalid repair nonces',async()=>{
    const listener=await startPairingListener({address:'10.0.0.2',identity:serverIdentity},{createServer});
    try {
      for(const extra of [{unknown:true},{repair:null},{repair:7},{repair:'A'.repeat(64)},{repair:'a'.repeat(63)},{repair:'g'.repeat(64)}]) {
        const rewrite=options=>{
          const socket=connect(options),end=socket.end.bind(socket);
          socket.end=(body,...args)=>end(JSON.stringify({...JSON.parse(body),...extra})+'\n',...args);
          return socket;
        };
        await assert.rejects(requestPeerClaim(listener.invitation,serverIdentity.cert,clientIdentity,{connect:rewrite}));
        assert.equal(listener.pending(),null);assert.equal(listener.status(),'waiting');
      }
    } finally {await listener.cancel();}
  });
});

test('invalid repair claims fail before any connection',async()=>{
  for(const repairNonce of ['',false,0,{},'A'.repeat(64),'a'.repeat(63)]) {
    let calls=0;
    const options={repairNonce,connect:()=>{calls++;throw Error('Unexpected connection');}};
    await assert.rejects(requestPeerClaim(null,null,null,options),{message:'Authenticated pairing connection unavailable'});
    await assert.rejects(claimFromInvitation(null,null,options),{message:'Authenticated pairing connection unavailable'});
    assert.equal(calls,0);
  }
});
