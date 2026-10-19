import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import {setTimeout as delay} from 'node:timers/promises';
import {X509Certificate} from 'node:crypto';
import {mkdtemp,realpath,rm,readFile,lstat,rename,writeFile,link} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
import path from 'node:path';
import {testRuntimeBase} from './test-runtime-base.mjs';
import {privateCollectorDirectory} from './peer-directory.mjs';
import {initializeDeviceIdentity} from './peer-device-identity.mjs';
import {createPairingConfigurations,initializePairing} from './peer-pairing.mjs';
import {startHostTLSSetup,recoverHostCommit,prepareHostTLSSetup,recordHostTLSAcknowledgement} from './peer-tls-host.mjs';
import {requestPeerClaim,requestPeerSetup,acknowledgePeerSetup} from './peer-tls-client.mjs';

const base=await testRuntimeBase('peer-tls-host-commit');
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
import {hostCommitUnfinished,hostCommitFile} from './peer-tls-host-commit.mjs';
import {readPairingStatus} from './peer-pairing-status.mjs';
import {createTrustedSyncService} from './peer-tls-service.mjs';
import {saveConfirmedPeerTrust} from './peer-tls-trust.mjs';
import {createTLSSetupController} from './peer-tls-control.mjs';
import {once} from 'node:events';
import {acquireHostCommitLease} from './peer-lock.mjs';
import {setupConfigurationDigest} from './peer-tls-setup-message.mjs';

test('host commit recovery', {skip:!['darwin','win32'].includes(process.platform) || !existsSync(openssl)},async t=>{
  async function identity(name) {
    const key=path.join(base,name+'.key'),cert=path.join(base,name+'.pem');
    execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-sha256','-keyout',key,
      '-out',cert,'-days','1','-subj','/CN=Synthetic confirmation test'],{stdio:'ignore',timeout:15000});
    return {version:1,key:await readFile(key,'utf8'),cert:await readFile(cert,'utf8')};
  }
  const local=await identity('local'),peer=await identity('peer');
  const file=(runtime,name)=>path.join(runtime,'private-sync',name);
  const fresh=async()=>{
    const runtime=await realpath(await mkdtemp(path.join(base,'runtime-')));
    await initializeDeviceIdentity(runtime,local);
    return runtime;
  };
  const pair=()=>({...createPairingConfigurations()[process.platform==='darwin'?'Mac':'Windows'],
    transport:input.peerEndpoint,localEndpoint:input.localEndpoint,peerCertificateSha256:fingerprint(peer.cert)});
  const marker=(pair,created=names)=>({version:1,pairId:pair.local.pairId,
    localCertificateSha256:fingerprint(local.cert),peerCertificateSha256:fingerprint(peer.cert),
    directoryCreated:true,created,files:{}});
  const saveMarker=async(runtime,value)=>writeFile(file(runtime,hostCommitFile),JSON.stringify(value),{mode:0o600});
  const confirmed=async(runtime,options={})=>{
    const host=await startHostTLSSetup(runtime,{address:input.localEndpoint.address},{createServer,...options});
    t.after(()=>host.cancel());
    await requestPeerClaim(host.invitation,local.cert,peer,{connect});
    await host.confirm(host.pending().claimId,input);
    assert.equal(existsSync(file(runtime,hostCommitFile+'.next')),false);
    return host;
  };
  await t.test('absent marker creates no folders',async()=>{
    const runtime=await realpath(await mkdtemp(path.join(base,'runtime-')));
    assert.deepEqual(await recoverHostCommit(runtime),{status:'none'});
    for(const name of ['private-sync','private-repair'])assert.equal(existsSync(path.join(runtime,name)),false);
  });
  await t.test('lone next marker recovery and busy lease',async()=>{
    const runtime=await fresh();
    await privateCollectorDirectory(runtime,'private-sync',true);
    const next=file(runtime,hostCommitFile+'.next');
    await writeFile(next,'Synthetic partial marker',{mode:0o600});
    const lease=await acquireHostCommitLease(runtime);
    try {
      assert.deepEqual(await recoverHostCommit(runtime),{status:'pending'});
      assert.ok(existsSync(next));
    } finally {lease.release();}
    assert.deepEqual(await recoverHostCommit(runtime),{status:'rolled-back'});
    assert.equal(existsSync(next),false);
    assert.equal((await readPairingStatus(runtime)).state,'unpaired');
    await initializePairing(runtime,pair());
  });
  await t.test('lone hard linked next marker is preserved',{skip:process.platform==='win32'},async()=>{
    const runtime=await fresh();
    await privateCollectorDirectory(runtime,'private-sync',true);
    const next=file(runtime,hostCommitFile+'.next');
    await writeFile(next,'Synthetic partial marker',{mode:0o600});
    await link(next,path.join(runtime,'retained-next'));
    assert.deepEqual(await recoverHostCommit(runtime),{status:'unavailable'});
    assert.ok(existsSync(next));
  });
  await t.test('listener expiry rolls back configuration without cancellation',async()=>{
    const runtime=await fresh();
    let expire;
    const host=await confirmed(runtime,{setExpiry:callback=>{expire=callback;}});
    assert.equal(host.status(),'configuration-ready');
    expire();
    const deadline=Date.now()+10000;
    while(existsSync(path.join(runtime,'private-sync')) && Date.now()<deadline)await delay(20);
    for(const name of [...names,hostCommitFile,hostCommitFile+'.next'])assert.equal(existsSync(file(runtime,name)),false);
    assert.equal(existsSync(path.join(runtime,'private-sync')),false);
    await host.cancel();
  });
  await t.test('first marker write failure removes next and created folder',async()=>{
    const runtime=await fresh();
    let reached=false;
    const host=await startHostTLSSetup(runtime,{address:input.localEndpoint.address},{createServer,beforeMarker:async()=>{
      reached=true;
      assert.ok(existsSync(file(runtime,hostCommitFile+'.next')));
      throw Error('Synthetic marker write failure');
    }});
    t.after(()=>host.cancel());
    await requestPeerClaim(host.invitation,local.cert,peer,{connect});
    await assert.rejects(host.confirm(host.pending().claimId,input),/unavailable/);
    assert.equal(reached,true);
    assert.equal(existsSync(path.join(runtime,'private-sync')),false);
    await host.cancel();
  });
  for(const mode of ['bound','partial','different pair'])await t.test('first phase '+mode,async()=>{
    const runtime=await fresh(),pairing=pair();
    await privateCollectorDirectory(runtime,'private-sync',true);
    await saveMarker(runtime,marker(pairing));
    await initializePairing(runtime,pairing);
    await saveConfirmedPeerTrust(runtime,{pairId:pairing.local.pairId,localCertificateSha256:fingerprint(local.cert),
      peerCertificate:peer.cert,peerCertificateSha256:fingerprint(peer.cert)});
    if(mode==='partial')await writeFile(file(runtime,'tls-trust.json'),'{"version":1');
    if(mode==='different pair') {
      const trust=JSON.parse(await readFile(file(runtime,'tls-trust.json'),'utf8'));
      trust.pairId='f'.repeat(64);
      await writeFile(file(runtime,'tls-trust.json'),JSON.stringify(trust));
    }
    assert.deepEqual(await recoverHostCommit(runtime),{status:mode==='bound'?'rolled-back':'unavailable'});
    assert.equal(await hostCommitUnfinished(runtime),mode!=='bound');
    assert.equal(existsSync(file(runtime,'tls-trust.json')),mode!=='bound');
    if(mode==='bound')assert.equal(existsSync(path.join(runtime,'private-sync')),false);
  });
  await t.test('lease is busy in this process and releases idempotently',async()=>{
    const runtime=await fresh(),lease=await acquireHostCommitLease(runtime);
    try {assert.equal(await acquireHostCommitLease(runtime),null);}
    finally {lease.release();lease.release();}
    const next=await acquireHostCommitLease(runtime);
    assert.ok(next);next.release();
  });
  await t.test('recovery preserves a replacement by inode',async()=>{
    const runtime=await fresh(),pairing=pair();
    await initializePairing(runtime,pairing);
    await saveConfirmedPeerTrust(runtime,{pairId:pairing.local.pairId,localCertificateSha256:fingerprint(local.cert),
      peerCertificate:peer.cert,peerCertificateSha256:fingerprint(peer.cert)});
    const saved=marker(pairing,['pairing.json','tls-trust.json']);
    for(const name of saved.created) {
      const info=await lstat(file(runtime,name),{bigint:true});
      saved.files[name]={dev:String(info.dev),ino:String(info.ino)};
    }
    await saveMarker(runtime,saved);
    await writeFile(file(runtime,hostCommitFile+'.next'),'Synthetic interrupted next marker',{mode:0o600});
    await rename(file(runtime,'tls-trust.json'),path.join(runtime,'retained-trust.json'));
    await writeFile(file(runtime,'tls-trust.json'),'Synthetic replacement',{mode:0o600});
    assert.deepEqual(await recoverHostCommit(runtime),{status:'rolled-back'});
    assert.equal(await readFile(file(runtime,'tls-trust.json'),'utf8'),'Synthetic replacement');
    assert.equal(existsSync(file(runtime,'pairing.json')),false);
    assert.equal(existsSync(file(runtime,hostCommitFile+'.next')),false);
    assert.equal(await hostCommitUnfinished(runtime),false);
  });
  await t.test('saved acknowledgement completes recovery without removing trust',async()=>{
    const runtime=await fresh();
    const offer=await prepareHostTLSSetup(runtime,{...input,peerCertificate:peer.cert,peerCertificateSha256:fingerprint(peer.cert)});
    const pairing=JSON.parse(await readFile(file(runtime,'pairing.json'),'utf8')),saved=marker(pairing);
    await saveMarker(runtime,saved);
    await recordHostTLSAcknowledgement(runtime,{peerCertificateSha256:fingerprint(peer.cert),digest:setupConfigurationDigest(offer)});
    assert.equal(await hostCommitUnfinished(runtime),false);
    await saveMarker(runtime,saved);
    assert.deepEqual(await recoverHostCommit(runtime),{status:'completed'});
    for(const name of [...names,'tls-acknowledgement.json'])assert.ok(existsSync(file(runtime,name)));
  });
  await t.test('live lease and cancellation after configuration-ready',async()=>{
    const runtime=await fresh(),host=await confirmed(runtime);
    assert.equal(host.status(),'configuration-ready');
    assert.deepEqual(await recoverHostCommit(runtime),{status:'pending'});
    assert.equal(await hostCommitUnfinished(runtime),true);
    for(const name of names)assert.ok(existsSync(file(runtime,name)));
    await host.cancel();
    assert.equal(existsSync(path.join(runtime,'private-sync')),false);
  });
  await t.test('completed acknowledgement and leftover marker',async()=>{
    const runtime=await fresh(),host=await confirmed(runtime);
    const saved=JSON.parse(await readFile(file(runtime,hostCommitFile),'utf8'));
    const response=await requestPeerSetup(host.invitation,local.cert,peer,
      {host:process.platform==='darwin'?'Windows':'Mac'},{connect});
    await acknowledgePeerSetup(host.invitation,local.cert,peer,response.pairing,{connect});
    assert.equal(await hostCommitUnfinished(runtime),false);
    await host.cancel();
    for(const name of [...names,'tls-acknowledgement.json'])assert.ok(existsSync(file(runtime,name)));
    await saveMarker(runtime,saved);
    assert.deepEqual(await recoverHostCommit(runtime),{status:'completed'});
    assert.equal(await hostCommitUnfinished(runtime),false);
    for(const name of [...names,'tls-acknowledgement.json'])assert.ok(existsSync(file(runtime,name)));
  });
  for(const mode of ['during commit','existing pairing','configuration-ready','replacement'])await t.test('killed '+mode,async t=>{
    const runtime=await fresh();
    let retained;
    if(mode==='existing pairing') {
      await initializePairing(runtime,pair());
      retained={bytes:await readFile(file(runtime,'pairing.json')),info:await lstat(file(runtime,'pairing.json'),{bigint:true})};
    }
    const script=path.join(base,'child-'+mode.replaceAll(' ','-')+'.mjs');
    const hostModule=new URL('./peer-tls-host.mjs',import.meta.url).href;
    await writeFile(script,`
import tls from 'node:tls';
import {startHostTLSSetup} from ${JSON.stringify(hostModule)};
const createServer=${createServer.toString()};
const host=await startHostTLSSetup(${JSON.stringify(runtime)},{address:'10.0.0.2'},{
  createServer,${mode==='configuration-ready'?'':'beforePublish:async()=>{console.log("committed");await new Promise(()=>{});},'}
});
console.log(JSON.stringify(host.invitation));
process.stdin.once('data',async()=>{
  await host.confirm(host.pending().claimId,${JSON.stringify(input)});
  console.log('configuration-ready');
});
`,{mode:0o600});
    const child=spawn(process.execPath,[...process.execArgv,script],{stdio:['pipe','pipe','pipe']});
    t.after(()=>{if(child.exitCode===null)child.kill();});
    let output='',error='';
    const lines=[],waiters=[];
    child.stderr.on('data',data=>{error+=data;});
    child.stdout.on('data',data=>{
      output+=data;
      while(output.includes('\n')) {
        const end=output.indexOf('\n'),line=output.slice(0,end);output=output.slice(end+1);
        if(waiters.length)waiters.shift()(line);else lines.push(line);
      }
    });
    let exitError;
    const failed=new Promise((_,reject)=>{
      child.once('error',reject);
      child.once('exit',()=>{exitError=Error('Child exited '+error);reject(exitError);});
    });
    void failed.catch(()=>{});
    const line=()=>Promise.race([
      failed,
      lines.length?Promise.resolve(lines.shift()):new Promise(resolve=>waiters.push(resolve)),
      new Promise((_,reject)=>{const timeout=setTimeout(()=>reject(Error('Child timeout '+error)),30000);timeout.unref();}),
    ]);
    const invitation=JSON.parse(await line());
    await requestPeerClaim(invitation,local.cert,peer,{connect});
    child.stdin.write('confirm\n');
    assert.equal(await line(),mode==='configuration-ready'?'configuration-ready':'committed');
    const exited=once(child,'exit');
    child.kill(process.platform==='win32'?undefined:'SIGKILL');
    await exited;
    assert.ok(existsSync(file(runtime,hostCommitFile)));
    assert.ok(existsSync(file(runtime,'tls-trust.json')));
    assert.equal(await hostCommitUnfinished(runtime),true);
    assert.equal((await readPairingStatus(runtime)).state,'unavailable');
    if(mode==='replacement') {
      await rename(file(runtime,'tls-trust.json'),path.join(runtime,'retained-trust.json'));
      await writeFile(file(runtime,'tls-trust.json'),'Synthetic replacement',{mode:0o600});
    }
    if(['during commit','existing pairing'].includes(mode)) {
      let starts=0;
      const service=createTrustedSyncService(runtime,{start:async()=>{starts++;throw Error('Unexpected start');},writeStatus:async()=>{}});
      await service.reconcile();await service.cancel();
      assert.equal(starts,0);
    } else assert.deepEqual(await recoverHostCommit(runtime),{status:'rolled-back'});
    assert.equal(await hostCommitUnfinished(runtime),false);
    assert.equal(existsSync(file(runtime,'tls-offer.json')),false);
    if(retained) {
      assert.deepEqual(await readFile(file(runtime,'pairing.json')),retained.bytes);
      const info=await lstat(file(runtime,'pairing.json'),{bigint:true});
      assert.equal(info.dev,retained.info.dev);assert.equal(info.ino,retained.info.ino);
      assert.equal(existsSync(file(runtime,'tls-trust.json')),false);
    } else if(mode==='replacement') {
      assert.equal(await readFile(file(runtime,'tls-trust.json'),'utf8'),'Synthetic replacement');
      assert.equal(existsSync(file(runtime,'pairing.json')),false);
    } else assert.equal(existsSync(path.join(runtime,'private-sync')),false);
    assert.deepEqual(await recoverHostCommit(runtime),{status:'none'});
  });
  await t.test('controller recovery gate',async()=>{
    for(const status of ['pending','unavailable']) {
      const controller=createTLSSetupController(base,{recover:async()=>({status})});
      await assert.rejects(controller.run({action:'host-start',address:'10.0.0.2',port:0}),/unavailable/);
      await assert.rejects(controller.run({action:'join-claim',invitation:'synthetic'}),/unavailable/);
    }
    let starts=0;
    const controller=createTLSSetupController(base,{recover:async()=>({status:'none'}),startHost:async()=>{
      starts++;throw Error('Synthetic start reached');
    }});
    await assert.rejects(controller.run({action:'host-start',address:'10.0.0.2',port:0}),/Synthetic start reached/);
    assert.equal(starts,1);
  });
});
