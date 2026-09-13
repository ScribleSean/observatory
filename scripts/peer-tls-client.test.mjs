import test from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import {X509Certificate,createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {createInvitation} from './peer-invitation.mjs';
import {requestPeerClaim} from './peer-tls-client.mjs';

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
});
