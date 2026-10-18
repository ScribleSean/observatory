import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import {X509Certificate} from 'node:crypto';
import {mkdtemp,realpath,rm,readFile,lstat,rename,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {testRuntimeBase} from './test-runtime-base.mjs';
import {initializeDeviceIdentity} from './peer-device-identity.mjs';
import {createPairingConfigurations,initializePairing} from './peer-pairing.mjs';
import {prepareHostTLSSetup,startHostTLSSetup} from './peer-tls-host.mjs';
import {requestPeerClaim,requestPeerSetup} from './peer-tls-client.mjs';
import {invitationLifetimeMs} from './peer-invitation.mjs';

const base=await testRuntimeBase('peer-tls-host-confirm');
after(()=>rm(base,{recursive:true,force:true}));
const openssl=process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'/usr/bin/openssl';
const names=['pairing.json','tls-trust.json','tls-offer.json'];
const fingerprint=pem=>new X509Certificate(pem).fingerprint256.replaceAll(':','').toLowerCase();
const input={localEndpoint:{kind:'tls',address:'10.0.0.2',port:43128},
  peerEndpoint:{kind:'tls',address:'10.0.0.3',port:43128}};
const connect=options=>tls.connect({...options,host:'127.0.0.1'});
const createServer=(options,callback)=>{
  const server=tls.createServer(options,callback),listen=server.listen.bind(server);
  server.listen=(options,callback)=>listen({...options,host:'127.0.0.1'},callback);
  return server;
};
test('host confirmation claims before committing and rolls back refused publication',
  {skip:!['darwin','win32'].includes(process.platform) || !existsSync(openssl)},async t=>{
    async function identity(name) {
      const key=path.join(base,name+'.key'),cert=path.join(base,name+'.pem');
      execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-sha256','-keyout',key,
        '-out',cert,'-days','1','-subj','/CN=Synthetic confirmation test'],{stdio:'ignore',timeout:15000});
      return {version:1,key:await readFile(key,'utf8'),cert:await readFile(cert,'utf8')};
    }
    const local=await identity('local'),peer=await identity('peer');
    for(const mode of ['cancel before','expiry before','cancel during','expiry during','existing pairing',
      'existing all','replacement','hook failure','prepare failure','partial prepare failure','success'])await t.test(mode,async t=>{
      const runtime=await realpath(await mkdtemp(path.join(base,'runtime-')));
      await initializeDeviceIdentity(runtime,local);
      const file=name=>path.join(runtime,'private-sync',name);
      if(['existing pairing','partial prepare failure'].includes(mode))await initializePairing(runtime,{
        ...createPairingConfigurations()[process.platform==='darwin'?'Mac':'Windows'],
        transport:input.peerEndpoint,localEndpoint:input.localEndpoint,peerCertificateSha256:fingerprint(peer.cert)});
      if(mode==='existing all')await prepareHostTLSSetup(runtime,{...input,
        peerCertificate:peer.cert,peerCertificateSha256:fingerprint(peer.cert)});
      if(mode==='partial prepare failure')await writeFile(file('tls-offer.json'),'{}',{mode:0o600});
      const existing=new Map();
      for(const name of names)if(existsSync(file(name)))existing.set(name,{bytes:await readFile(file(name)),info:await lstat(file(name))});
      let tick=0,expire,host;
      host=await startHostTLSSetup(runtime,{address:'10.0.0.2'},{createServer,
        sessionOptions:{monotonic:()=>tick},setExpiry:callback=>{expire=callback;return undefined;},
        beforePublish:async()=>{
          if(mode==='success')return;
          for(const name of names)assert.ok(existsSync(file(name)));
          // The claimed peer keeps hearing awaiting-confirmation while the commit runs.
          assert.deepEqual(await requestPeerSetup(host.invitation,local.cert,peer,
            {host:process.platform==='darwin'?'Windows':'Mac'},{connect}),{status:'awaiting-confirmation'});
          if(mode==='replacement') {
            await rename(file('tls-trust.json'),path.join(runtime,'retained-trust.json'));
            await writeFile(file('tls-trust.json'),'Synthetic replacement',{mode:0o600});
          }
          if(mode==='hook failure')throw Error('Synthetic commit failure');
          if(mode==='expiry during')expire();
          else await host.cancel();
        }});
      t.after(()=>host.cancel());
      await requestPeerClaim(host.invitation,local.cert,peer,{connect});
      const claimId=host.pending().claimId;
      if(mode==='cancel before')await host.cancel();
      if(mode==='expiry before')tick=invitationLifetimeMs;
      if(mode==='success') {
        const result=await host.confirm(claimId,input);
        assert.match(result.digest,/^[a-f0-9]{64}$/);
        assert.equal(host.status(),'configuration-ready');
        const response=await requestPeerSetup(host.invitation,local.cert,peer,
          {host:process.platform==='darwin'?'Windows':'Mac'},{connect});
        assert.equal(response.pairing.peerCertificateSha256,fingerprint(local.cert));
        for(const name of names)assert.ok(existsSync(file(name)));
      } else {
        await assert.rejects(host.confirm(claimId,mode==='prepare failure'?{...input,peerEndpoint:{}}:input));
        for(const name of names) {
          if(existing.has(name)) {
            assert.deepEqual(await readFile(file(name)),existing.get(name).bytes);
            const info=await lstat(file(name));
            assert.equal(info.dev,existing.get(name).info.dev);
            assert.equal(info.ino,existing.get(name).info.ino);
          } else if(mode==='replacement' && name==='tls-trust.json') {
            assert.equal(await readFile(file(name),'utf8'),'Synthetic replacement');
          } else assert.equal(existsSync(file(name)),false);
        }
      }
    });
  });
