import test from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import {X509Certificate,createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync,existsSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {createInvitation} from './peer-invitation.mjs';
import {requestPeerClaim,claimFromInvitation,discoverPeerCertificate,requestPeerSetup,acknowledgePeerSetup} from './peer-tls-client.mjs';
import {createPairingConfigurations,readPairing} from './peer-pairing.mjs';
import {receiveConfirmedTLSPairing} from './peer-tls-join.mjs';
import {initializeDeviceIdentity} from './peer-device-identity.mjs';
import {readPeerTrust} from './peer-tls-trust.mjs';
import {setupConfigurationDigest} from './peer-tls-setup-message.mjs';
import {startHostTLSSetup,readHostTLSSetup} from './peer-tls-host.mjs';
import {startPairingListener} from './peer-tls-listener.mjs';
import {generateMacDeviceIdentity} from './generate-mac-device-identity.mjs';

const openssl=process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'/usr/bin/openssl';

test('real TLS pins certificates before sending invitation bytes',{skip:!existsSync(openssl)},async t=>{
  const root=mkdtempSync(path.join(tmpdir(),'observatory-test-tls-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const makeIdentity=name=>{
    const key=path.join(root,name+'.key'),cert=path.join(root,name+'.pem');
    execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-sha256',
      '-keyout',key,'-out',cert,'-days','1','-subj','/CN=Observatory synthetic test'],
    {stdio:'ignore',timeout:15000});
    return {key:readFileSync(key,'utf8'),cert:readFileSync(cert,'utf8')};
  };
  const serverIdentity=makeIdentity('server'),clientIdentity=makeIdentity('client');
  const pin=createHash('sha256').update(new X509Certificate(serverIdentity.cert).raw).digest('hex');
  let received='',connections=0,mode='normal';
  const sockets=new Set();
  const server=tls.createServer({...serverIdentity,ca:clientIdentity.cert,requestCert:true,
    rejectUnauthorized:true,minVersion:'TLSv1.3',ALPNProtocols:['observatory-pair/1'],allowHalfOpen:true},socket=>{
    connections++;sockets.add(socket);socket.on('close',()=>sockets.delete(socket));
    socket.on('error',()=>{});
    socket.on('data',chunk=>{received+=chunk.toString();});
    socket.on('end',()=>{
      if(mode==='hang')return;
      socket.end(mode==='oversize'?'x'.repeat(9000):JSON.stringify({version:1,status:'awaiting-confirmation'}));
    });
  });
  server.on('connection',socket=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));
  });
  server.on('tlsClientError',()=>{});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));});
  const invitation=createInvitation({address:'10.0.0.2',port:server.address().port,certificateSha256:pin});
  // Only tests redirect the numeric destination to an ephemeral loopback server.
  const connect=options=>tls.connect({...options,host:'127.0.0.1'});
  await t.test('mutual TLS success sends only the claim and returns no remote details',async()=>{
    assert.deepEqual(await requestPeerClaim(invitation,serverIdentity.cert,clientIdentity,{connect}),
      {status:'awaiting-confirmation'});
    assert.deepEqual(JSON.parse(received),{version:1,action:'claim',secret:invitation.secret});
  });
  await t.test('untrusted discovery certificate is rejected before dialing',async()=>{
    let dialed=false;
    await assert.rejects(requestPeerClaim(invitation,clientIdentity.cert,clientIdentity,
      {connect:()=>{dialed=true;throw Error('unexpected');}}));
    assert.equal(dialed,false);
  });
  await t.test('actual server certificate mismatch sends no secret',async()=>{
    received='';const previous=connections;
    const wrong={...invitation,certificateSha256:createHash('sha256').update(new X509Certificate(clientIdentity.cert).raw).digest('hex')};
    await assert.rejects(requestPeerClaim(wrong,clientIdentity.cert,clientIdentity,{connect}));
    assert.equal(received,'');assert.equal(connections,previous);
  });
  await t.test('oversized responses fail with a generic error',async()=>{
    mode='oversize';
    await assert.rejects(requestPeerClaim(invitation,serverIdentity.cert,clientIdentity,{connect}),
      {message:'Authenticated pairing connection unavailable'});
  });
  await t.test('wrong client identity cannot submit a claim',async()=>{
    received='';
    await assert.rejects(requestPeerClaim(invitation,serverIdentity.cert,serverIdentity,{connect}));
    assert.equal(received,'');
  });
  await t.test('missing protocol agreement sends no secret',async()=>{
    received='';
    await assert.rejects(requestPeerClaim(invitation,serverIdentity.cert,clientIdentity,
      {connect:options=>tls.connect({...options,host:'127.0.0.1',ALPNProtocols:[]})}));
    assert.equal(received,'');
  });
  await t.test('stalled replies hit an absolute deadline',async()=>{
    mode='hang';
    await assert.rejects(requestPeerClaim(invitation,serverIdentity.cert,clientIdentity,{connect,timeoutMs:150}),
      {message:'Authenticated pairing connection unavailable'});
  });
  const createServer=(options,callback)=>{
    const listener=tls.createServer(options,callback),listen=listener.listen.bind(listener);
    listener.listen=(binding,ready)=>listen({...binding,host:'127.0.0.1'},ready);
    return listener;
  };
  await t.test('host controller persists its offer and actual TLS acknowledgement',
    {skip:!['darwin','win32'].includes(process.platform)},async()=>{
      const runtime=realpathSync(mkdtempSync(path.join(root,'hosting-')));
      await initializeDeviceIdentity(runtime,{version:1,...serverIdentity});
      const listener=await startHostTLSSetup(runtime,{address:'10.0.0.2'},{createServer});
      try {
        await requestPeerClaim(listener.invitation,serverIdentity.cert,clientIdentity,{connect});
        const input={includeUbuntu:false,localEndpoint:{kind:'tls',address:'10.0.0.2',port:43128},
          peerEndpoint:{kind:'tls',address:'10.0.0.3',port:43128}};
        await assert.rejects(listener.confirm('0'.repeat(64),input));assert.equal(await readPairing(runtime),null);
        await listener.confirm(listener.pending().claimId,input);
        const expected={host:process.platform==='darwin'?'Windows':'Mac',includeUbuntu:false};
        const response=await requestPeerSetup(listener.invitation,serverIdentity.cert,clientIdentity,expected,{connect});
        assert.deepEqual(await readHostTLSSetup(runtime),{pairing:response.pairing,acknowledged:false});
        assert.deepEqual(await acknowledgePeerSetup(listener.invitation,serverIdentity.cert,clientIdentity,response.pairing,{connect}),
          {status:'acknowledged'});
        assert.equal((await readHostTLSSetup(runtime)).acknowledged,true);
        assert.equal(listener.status(),'acknowledged');
      } finally {await listener.cancel();}
    });
  await t.test('joining controller commits before acknowledgement and resumes a lost acknowledgement',
    {skip:!['darwin','win32'].includes(process.platform)},async()=>{
      const runtime=realpathSync(mkdtempSync(path.join(root,'joining-')));
      await initializeDeviceIdentity(runtime,{version:1,...clientIdentity});
      const listener=await startPairingListener({address:'10.0.0.2',identity:serverIdentity},{createServer});
      try {
        await requestPeerClaim(listener.invitation,serverIdentity.cert,clientIdentity,{connect});
        const receive=options=>receiveConfirmedTLSPairing(runtime,listener.invitation,{includeUbuntu:false},options);
        assert.deepEqual(await receive({connect}),{status:'awaiting-confirmation'});
        assert.equal(await readPairing(runtime),null);
        const pair=createPairingConfigurations()[process.platform==='darwin'?'Mac':'Windows'];
        pair.transport={kind:'tls',address:'10.0.0.2',port:43128};pair.peerCertificateSha256=pin;
        listener.confirmSetup(listener.pending().claimId,pair);
        let connections=0;
        assert.deepEqual(await receive({connect:options=>{
          connections++;
          if(connections===3)throw Error('Synthetic acknowledgement connection lost');
          return connect(options);
        }}),{status:'local-ready'});
        assert.equal(connections,3);
        assert.deepEqual(await readPairing(runtime),pair);assert.ok(await readPeerTrust(runtime));
        assert.equal(listener.status(),'configuration-ready');
        assert.deepEqual(await receive({connect}),{status:'acknowledged'});
        assert.equal(listener.status(),'acknowledged');
        assert.deepEqual(await readPairing(runtime),pair);
      } finally {await listener.cancel();}
    });
  await t.test('confirmed configuration reaches only the claimed device with exact source scope and repeatable acknowledgement',async()=>{
    let saves=0,allowSave=false;
    const listener=await startPairingListener({address:'10.0.0.2',identity:serverIdentity},{createServer,
      onAcknowledged:async value=>{
        assert.equal(value.peerCertificateSha256,new X509Certificate(clientIdentity.cert).fingerprint256.replaceAll(':','').toLowerCase());
        saves++;
        if(!allowSave)throw Error('Synthetic persistence failure');
        return {version:1,status:'acknowledged'};
      }});
    const expected={host:'Windows',includeUbuntu:false};
    const get=(identity=clientIdentity,scope=expected)=>requestPeerSetup(listener.invitation,serverIdentity.cert,identity,scope,{connect});
    try {
      await assert.rejects(get());
      await requestPeerClaim(listener.invitation,serverIdentity.cert,clientIdentity,{connect});
      assert.deepEqual(await get(),{status:'awaiting-confirmation'});
      const pair=createPairingConfigurations().Windows;
      pair.transport={kind:'tls',address:'10.0.0.2',port:43128};pair.peerCertificateSha256=pin;
      const reverse=value=>Object.fromEntries(Object.entries(value).reverse());
      assert.equal(setupConfigurationDigest(pair),setupConfigurationDigest(reverse({...pair,
        local:reverse(pair.local),peer:reverse(pair.peer),transport:reverse(pair.transport)})));
      await assert.rejects(acknowledgePeerSetup(listener.invitation,serverIdentity.cert,clientIdentity,pair,{connect}));
      const claim=listener.pending();
      assert.throws(()=>listener.confirmSetup(claim.claimId,{...pair,peerCertificateSha256:'0'.repeat(64)}));
      assert.equal(listener.status(),'confirming');
      listener.confirmSetup(claim.claimId,pair);
      assert.equal(listener.status(),'configuration-ready');assert.equal(listener.pending(),null);
      assert.throws(()=>listener.confirmSetup(claim.claimId,pair));
      await assert.rejects(get(serverIdentity));
      await assert.rejects(get(clientIdentity,{host:'Windows',includeUbuntu:true}));
      await assert.rejects(get(clientIdentity,{host:'Mac',includeUbuntu:false}));
      assert.deepEqual(await get(),{status:'configuration',pairing:pair});
      const changed={...pair,transport:{...pair.transport,port:43129}};
      await assert.rejects(acknowledgePeerSetup(listener.invitation,serverIdentity.cert,clientIdentity,changed,{connect}));
      assert.equal(listener.status(),'configuration-ready');
      assert.equal(saves,0);
      await assert.rejects(acknowledgePeerSetup(listener.invitation,serverIdentity.cert,clientIdentity,pair,{connect}));
      assert.equal(listener.status(),'configuration-ready');assert.equal(saves,1);allowSave=true;
      for(let attempt=0;attempt<2;attempt++)
        assert.deepEqual(await acknowledgePeerSetup(listener.invitation,serverIdentity.cert,clientIdentity,pair,{connect}),
          {status:'acknowledged'});
      assert.equal(listener.status(),'acknowledged');
      assert.deepEqual(await get(),{status:'configuration',pairing:pair});
      await listener.cancel();
      assert.equal(listener.status(),'inactive');await assert.rejects(get());
    } finally {await listener.cancel();}
  });
  await t.test('real first-pair listener accepts an unknown device only with invitation and local confirmation',async()=>{
    const listener=await startPairingListener({address:'10.0.0.2',identity:serverIdentity},{createServer});
    try {
      assert.equal(listener.pending(),null);
      await assert.rejects(requestPeerClaim({...listener.invitation,secret:'00'.repeat(32)},
        serverIdentity.cert,clientIdentity,{connect}));
      assert.equal(listener.status(),'waiting');
      assert.deepEqual(await requestPeerClaim(listener.invitation,serverIdentity.cert,clientIdentity,{connect}),
        {status:'awaiting-confirmation'});
      const claim=listener.pending();
      assert.equal(claim.peerCertificateSha256,createHash('sha256').update(new X509Certificate(clientIdentity.cert).raw).digest('hex'));
      await assert.rejects(requestPeerClaim(listener.invitation,serverIdentity.cert,clientIdentity,{connect}));
      assert.equal(listener.status(),'confirming');
      assert.deepEqual(await listener.confirm(claim.claimId),{peerCertificateSha256:claim.peerCertificateSha256});
      assert.equal(listener.status(),'inactive');
      await assert.rejects(listener.confirm(claim.claimId));
    } finally {await listener.cancel();}
  });
  await t.test('listener cancellation invalidates a pending real TLS claim',async()=>{
    const listener=await startPairingListener({address:'10.0.0.2',identity:serverIdentity},{createServer});
    try {
      await requestPeerClaim(listener.invitation,serverIdentity.cert,clientIdentity,{connect});
      const claim=listener.pending();
      await listener.cancel();
      await assert.rejects(listener.confirm(claim.claimId));
      assert.equal(listener.pending(),null);
    } finally {await listener.cancel();}
  });
  await t.test('public bind addresses are rejected before creating a server',async()=>{
    let created=false;
    await assert.rejects(startPairingListener({address:'0.0.0.0',identity:serverIdentity},
      {createServer:()=>{created=true;throw Error('unexpected');}}));
    assert.equal(created,false);
  });
  await t.test('invitation-only connection discovers the pinned certificate without disclosing client identity',async()=>{
    const listener=await startPairingListener({address:'10.0.0.2',identity:serverIdentity},{createServer});
    const calls=[];
    try {
      const result=await claimFromInvitation(listener.invitation,clientIdentity,{connect:options=>{
        calls.push({hasKey:Object.hasOwn(options,'key'),hasCert:Object.hasOwn(options,'cert'),
          rejectUnauthorized:options.rejectUnauthorized});
        return connect(options);
      }});
      assert.deepEqual(result,{status:'awaiting-confirmation'});
      assert.deepEqual(calls,[{hasKey:false,hasCert:false,rejectUnauthorized:false},
        {hasKey:true,hasCert:true,rejectUnauthorized:true}]);
      await listener.confirm(listener.pending().claimId);
    } finally {await listener.cancel();}
  });
  await t.test('wrong invitation pin cannot progress from discovery to a claim',async()=>{
    const listener=await startPairingListener({address:'10.0.0.2',identity:serverIdentity},{createServer});
    let calls=0;
    try {
      await assert.rejects(claimFromInvitation({...listener.invitation,certificateSha256:'00'.repeat(32)},
        clientIdentity,{connect:options=>{calls++;return connect(options);}}));
      assert.equal(calls,1);assert.equal(listener.pending(),null);assert.equal(listener.status(),'waiting');
    } finally {await listener.cancel();}
  });
  await t.test('cancellation refuses pre-aborted discovery and stops an in-flight bootstrap',async()=>{
    const controller=new AbortController();controller.abort();
    let calls=0;
    await assert.rejects(discoverPeerCertificate(invitation,{signal:controller.signal,
      connect:()=>{calls++;throw Error('unexpected');}}));
    assert.equal(calls,0);
    const active=new AbortController();
    const pending=discoverPeerCertificate(invitation,{signal:active.signal,connect});
    active.abort();await assert.rejects(pending);
  });
  await t.test('Mac-generated identities work through the real first-pair TLS flow',
    {skip:process.platform!=='darwin'},async()=>{
      const host=await generateMacDeviceIdentity(),guest=await generateMacDeviceIdentity();
      const listener=await startPairingListener({address:'10.0.0.2',identity:host},{createServer});
      try {
        await requestPeerClaim(listener.invitation,host.cert,guest,{connect});
        const claim=listener.pending();
        assert.equal(claim.peerCertificateSha256,new X509Certificate(guest.cert).fingerprint256.replaceAll(':','').toLowerCase());
        await listener.confirm(claim.claimId);
      } finally {await listener.cancel();}
    });
  await t.test('listener refuses missing client certificate and oversized or extra request fields',async()=>{
    const listener=await startPairingListener({address:'10.0.0.2',identity:serverIdentity},{createServer});
    const send=(body,withIdentity=true)=>new Promise((resolve,reject)=>{
      let received='';
      const socket=tls.connect({host:'127.0.0.1',port:listener.invitation.port,
        ca:serverIdentity.cert,rejectUnauthorized:true,minVersion:'TLSv1.3',
        ALPNProtocols:['observatory-pair/1'],checkServerIdentity:()=>undefined,
        ...(withIdentity?clientIdentity:{})},()=>socket.end(body));
      const timer=setTimeout(()=>{socket.destroy();reject(Error('Test connection timeout'));},2000);
      socket.on('data',chunk=>{received+=chunk.toString();});
      socket.on('error',()=>{});
      socket.once('close',()=>{clearTimeout(timer);resolve(received);});
    });
    try {
      const body={version:1,action:'claim',secret:listener.invitation.secret};
      assert.equal(await send(JSON.stringify(body),false),'');
      assert.equal(await send('x'.repeat(2048)),'');
      assert.equal(await send(JSON.stringify({...body,peerCertificateSha256:pin})),'');
      assert.equal(listener.status(),'waiting');
      assert.equal(listener.pending(),null);
    } finally {await listener.cancel();}
  });
});
