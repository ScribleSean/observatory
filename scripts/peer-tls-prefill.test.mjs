import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import {EventEmitter,once} from 'node:events';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createTLSSetupController,checkSyncPort} from './peer-tls-control.mjs';
import {startPairingListener,pairingPeerAddress} from './peer-tls-listener.mjs';
import {requestPeerClaim} from './peer-tls-client.mjs';
import {createInvitation,encodeInvitation,defaultSyncPort} from './peer-invitation.mjs';

const invite=()=>createInvitation({address:'10.0.0.2',port:43128,certificateSha256:'a'.repeat(64)});
const absent=async()=>({ipv4:null,ipv6:null});

test('claim address normalization accepts only pairing addresses',()=>{
  for(const [input,expected] of [
    ['::ffff:100.101.102.103','100.101.102.103'],['::FFFF:10.0.0.2','10.0.0.2'],
    ['fd7a:115c:a1e0::5','fd7a:115c:a1e0::5'],['8.8.8.8',null],['fe80::1%en0',null],
    ['127.0.0.1',null],['::ffff:127.0.0.1',null],['::ffff:010.0.0.2',null],
    ['::ffff:fd7a:115c:a1e0::5',null],[undefined,null],[null,null],
  ])assert.equal(pairingPeerAddress(input),expected);
});

test('real TLS loopback claim keeps an unknown address local',{skip:!existsSync('/usr/bin/openssl')},async t=>{
  const root=mkdtempSync(path.join(tmpdir(),'observatory-prefill-test-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const identity=name=>{
    const key=path.join(root,name+'.key'),cert=path.join(root,name+'.pem');
    execFileSync('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-sha256',
      '-keyout',key,'-out',cert,'-days','1','-subj','/CN=Observatory synthetic test'],
    {stdio:'ignore',timeout:15000});
    return {key:readFileSync(key,'utf8'),cert:readFileSync(cert,'utf8')};
  };
  const host=identity('host'),peer=identity('peer');
  const createServer=(options,callback)=>{
    const server=tls.createServer(options,callback),listen=server.listen.bind(server);
    server.listen=(binding,ready)=>listen({...binding,host:'127.0.0.1'},ready);
    return server;
  };
  const listener=await startPairingListener({address:'10.0.0.2',identity:host},{createServer});
  t.after(()=>listener.cancel());
  assert.equal(listener.pending(),null);
  let reply='';
  const connect=options=>{
    const socket=tls.connect({...options,host:'127.0.0.1'});
    socket.on('data',bytes=>{reply+=bytes.toString();});
    return socket;
  };
  assert.deepEqual(await requestPeerClaim(listener.invitation,host.cert,peer,{connect}),{status:'awaiting-confirmation'});
  assert.equal(listener.pending().peerAddress,null);
  assert.deepEqual(JSON.parse(reply),{version:1,status:'awaiting-confirmation'});
});

test('pending peer stays responsive and existing replies retain exact keys',async()=>{
  let pending=null,finish,checks=0;
  const host={invitation:invite(),pending:()=>pending,status:()=>pending?'confirming':'hosting',
    cancel:async()=>{},confirm:()=>new Promise(resolve=>{finish=resolve;})};
  const controller=createTLSSetupController('/fixture',{startHost:async()=>host,selfAddresses:absent,
    checkPort:async()=>{checks++;return true;}});
  assert.deepEqual(await controller.run({action:'pending-peer'}),{status:'idle',peerAddress:null});
  const started=await controller.run({action:'host-start',address:'10.0.0.2',port:0});
  assert.deepEqual(Object.keys(started).sort(),['invitation','status']);assert.equal(checks,0);
  assert.deepEqual(await controller.run({action:'pending-peer'}),{status:'hosting',peerAddress:null});
  pending={claimId:'private-handle',peerCertificateSha256:'b'.repeat(64),peerAddress:'100.101.102.103'};
  assert.deepEqual(await controller.run({action:'pending-peer'}),{status:'confirming',peerAddress:pending.peerAddress});
  assert.deepEqual(await controller.run({action:'status'}),{status:'confirming',peerCertificateSha256:'b'.repeat(64)});
  const confirming=controller.run({action:'host-confirm',peerCertificateSha256:'b'.repeat(64),localEndpoint:{},peerEndpoint:{}});
  assert.deepEqual(await controller.run({action:'pending-peer'}),{status:'working',peerAddress:pending.peerAddress});
  assert.deepEqual(await controller.run({action:'status'}),{status:'working',peerCertificateSha256:'b'.repeat(64)});
  finish();await confirming;
  await controller.run({action:'cancel'});
  assert.deepEqual(await controller.run({action:'pending-peer'}),{status:'idle',peerAddress:null});
});

test('host defaults keep unknown addresses and port availability distinct',async()=>{
  assert.equal(defaultSyncPort,43128);
  for(const scenario of ['free','busy','absent','ipv6-only','invalid','discovery-error','bind-error']) {
    let checks=0;
    const present=['free','busy','bind-error'].includes(scenario);
    const controller=createTLSSetupController('/fixture',{
      selfAddresses:async()=>{
        if(scenario==='discovery-error')throw Error('Synthetic discovery failure');
        return {ipv4:present?'100.101.102.103':scenario==='invalid'?'8.8.8.8':null,
          ipv6:scenario==='ipv6-only'?'fd7a:115c:a1e0::5':null};
      },
      checkPort:async(address,port)=>{
        checks++;assert.equal(address,'100.101.102.103');assert.equal(port,43128);
        if(scenario==='bind-error')throw Error('Synthetic bind failure');
        return scenario==='free';
      },
    });
    assert.deepEqual(await controller.run({action:'host-defaults'}),{status:'ready',
      address:present?'100.101.102.103':null,port:43128,portAvailable:present?scenario==='free':null});
    assert.equal(checks,present?1:0);
  }
});

test('new actions reject extra keys and defaults refuse hosting or joining',async()=>{
  let discoveries=0;
  const controller=createTLSSetupController('/fixture',{selfAddresses:async()=>{discoveries++;return absent();},
    startHost:async()=>({invitation:invite(),cancel:async()=>{}}),readIdentity:async()=>({}),
    readRepair:async()=>null,claim:async()=>({status:'awaiting-confirmation'})});
  for(const action of ['host-defaults','pending-peer'])await assert.rejects(controller.run({action,extra:true}));
  await controller.run({action:'host-start',address:'10.0.0.2',port:0});
  await assert.rejects(controller.run({action:'host-defaults'}));
  await controller.cancel();
  await controller.run({action:'join-claim',invitation:encodeInvitation(invite())});
  await assert.rejects(controller.run({action:'host-defaults'}));
  assert.deepEqual(await controller.run({action:'pending-peer'}),{status:'awaiting-confirmation',peerAddress:null});
  assert.equal(discoveries,0);await controller.cancel();
});

test('host defaults hold the busy slot and discard cancelled discovery',async()=>{
  let finish,checks=0;
  const controller=createTLSSetupController('/fixture',{
    selfAddresses:()=>new Promise(resolve=>{finish=resolve;}),checkPort:async()=>{checks++;return true;}});
  const operation=controller.run({action:'host-defaults'});
  await assert.rejects(controller.run({action:'host-defaults'}));
  await assert.rejects(controller.run({action:'host-start',address:'10.0.0.2',port:0}));
  assert.deepEqual(await controller.run({action:'pending-peer'}),{status:'working',peerAddress:null});
  await controller.cancel();finish({ipv4:'100.101.102.103'});
  assert.deepEqual(await operation,{status:'cancelled'});assert.equal(checks,0);
});

test('default port check releases free ports and refuses occupied ports',async t=>{
  const server=net.createServer();
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  server.listen({host:'127.0.0.1',port:0,exclusive:true});await once(server,'listening');
  const port=server.address().port;
  assert.equal(await checkSyncPort('127.0.0.1',port),false);
  await new Promise(resolve=>server.close(resolve));
  assert.equal(await checkSyncPort('127.0.0.1',port),true);
  server.listen({host:'127.0.0.1',port,exclusive:true});await once(server,'listening');
  assert.equal(await checkSyncPort('127.0.0.1',port),false);
  assert.equal(await checkSyncPort('127.0.0.1',-1),false);
});

test('port check closes before resolving on success, errors and timeout',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  for(const outcome of ['ready','EADDRINUSE','EACCES','EPERM','throw','timeout']) {
    const server=new EventEmitter();let binding,ready,closed,settled=false;
    server.listen=(options,callback)=>{
      binding=options;ready=callback;
      if(outcome==='throw')throw Error('Synthetic bind failure');
    };
    server.close=callback=>{closed=callback;};
    const mock=t.mock.method(net,'createServer',()=>server);
    const checking=checkSyncPort('127.0.0.1',43128).then(value=>{settled=true;return value;});
    assert.equal(binding.host,'127.0.0.1');assert.equal(binding.port,43128);assert.equal(binding.exclusive,true);
    if(outcome==='ready')ready();
    else if(outcome==='timeout') {
      t.mock.timers.tick(1999);assert.equal(closed,undefined);
      t.mock.timers.tick(1);
    } else if(outcome!=='throw')server.emit('error',Object.assign(Error('Synthetic bind failure'),{code:outcome}));
    await Promise.resolve();assert.equal(settled,false);assert.equal(binding.signal.aborted,true);
    assert.equal(typeof closed,'function');closed();
    assert.equal(await checking,outcome==='ready');
    t.mock.timers.tick(2000);mock.mock.restore();
  }
});
