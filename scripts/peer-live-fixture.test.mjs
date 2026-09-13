// Opt-in two-device fixture. Never included in an installed collector bundle.
import {mkdtemp,realpath,readFile,rm,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawn} from 'node:child_process';
import net from 'node:net';
import {X509Certificate} from 'node:crypto';
import {isPairingAddress,encodeInvitation,decodeInvitation} from './peer-invitation.mjs';
import {initializeDeviceIdentity,readDeviceIdentity} from './peer-device-identity.mjs';
import {startHostTLSSetup,readHostTLSSetup} from './peer-tls-host.mjs';
import {claimFromInvitation} from './peer-tls-client.mjs';
import {receiveConfirmedTLSPairing} from './peer-tls-join.mjs';
import {readPairing} from './peer-pairing.mjs';
import {createPeerPayload} from './peer-payload.mjs';
import {publishLocalPayload} from './peer-store.mjs';
import {finalizePeerCollection} from './peer-finalize.mjs';
import {revokePairing} from './peer-revocation.mjs';
import {readQuotaState,updateQuotaState,setQuotaSharing,revokeQuotaSharing} from './quota-store.mjs';
import {syncQuota} from './quota-sync.mjs';

// Only called with the fixture's owned temporary runtime. No provider is read.
export async function runSyntheticQuotaAction(runtime,action,{request}={}) {
  async function summary() {
    try {await lstat(path.join(runtime,'private-quota'));}
    catch(error) {
      if(error.code==='ENOENT')return {sharing:false,localRemaining:null,peerRemaining:null,peerSamples:0};
      throw error;
    }
    const state=await readQuotaState(runtime),samples=state.remote?.record.payload.history??[];
    return {sharing:state.sharing.enabled,
      localRemaining:state.history?.samples.at(-1)?.windows[0]?.remainingPercent??null,
      peerRemaining:samples.at(-1)?.windows[0]?.remainingPercent??null,peerSamples:samples.length};
  }
  switch(action) {
    case 'quota-enable': {
      const pair=await readPairing(runtime);
      if(!pair)throw Error('Fixture must be paired');
      const before=await readQuotaState(runtime),now=Date.now(),mac=pair.local.host==='Mac';
      const updated=await updateQuotaState(runtime,{revision:before.revision,scope:(mac?'a':'b').repeat(64),
        observation:{status:'ok',checkedAt:new Date(now).toISOString(),
          windows:[{bucket:'codex',window:'primary',remainingPercent:mac?40:70}]}},now);
      await setQuotaSharing(runtime,{revision:updated.revision,enabled:true,pairingId:pair.local.pairId});
      return summary();
    }
    case 'quota-status': return summary();
    case 'quota-disable':
      if((await summary()).sharing)await revokeQuotaSharing(runtime);
      return summary();
    case 'quota-exchange': {
      const result=await syncQuota(runtime,{request});
      return {status:result.status,...await summary()};
    }
    default: throw Error('Unknown synthetic quota action');
  }
}

async function main(address) {
  if(!['darwin','win32'].includes(process.platform) || !isPairingAddress(address))throw Error('Invalid fixture host');
  const runtime=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-live-fixture-')));
  let listener=null,invitation=null,service=null,serviceExit=null,statusId=0,closing=false,validFrom=0;
  let serviceBuffer='',serviceReply=null;
  const key=path.join(runtime,'synthetic.key'),cert=path.join(runtime,'synthetic.pem');
  const openssl=process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'/usr/bin/openssl';
  const endpoint={kind:'tls',address,port:0};
  const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
  async function stopService() {
    if(!service)return;
    service.stdin.end();
    let timer;
    try {
      await Promise.race([serviceExit,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Helper still active')),15000))]);
      service=null;serviceExit=null;
    } finally {clearTimeout(timer);}
  }
  async function cleanup() {
    await listener?.cancel();listener=null;
    await stopService();
    await rm(runtime,{recursive:true,force:true});
  }
  async function serviceStatus() {
    return new Promise((resolve,reject)=>{
      const id=++statusId,timer=setTimeout(()=>{serviceReply=null;reject(Error('Service status timeout'));},45000);
      serviceReply=value=>{clearTimeout(timer);serviceReply=null;value.id===id?resolve(value.status):reject(Error('Wrong service reply'));};
      service.stdin.write(JSON.stringify({id,command:{action:'status'}})+'\n');
    });
  }
  const payload=pair=>createPeerPayload({collectedAt:new Date().toISOString(),activity:{status:'not-connected'},
    codex:[{host:pair.local.host,status:'not-connected'}],dictation:[{source:'Wispr Flow',status:'not-connected'}]},pair.local);
  async function run(command) {
    switch(command.action) {
      case 'endpoint': return {endpoint,validFrom};
      case 'probe': {
        const target=decodeInvitation(command.invitation);
        const tcp=await new Promise(resolve=>{
          const socket=net.connect({host:target.address,port:target.port});
          let done=false;
          const finish=value=>{if(done)return;done=true;clearTimeout(timer);socket.destroy();resolve(value);};
          const timer=setTimeout(()=>finish('timeout'),5000);
          socket.once('connect',()=>finish('connected'));socket.once('error',error=>finish(error.code==='ECONNREFUSED'?'refused':'unavailable'));
        });
        return {tcp};
      }
      case 'host':
        if(listener)throw Error('Already hosting');
        listener=await startHostTLSSetup(runtime,{address});
        return {invitation:encodeInvitation(listener.invitation)};
      case 'join':
        invitation=decodeInvitation(command.invitation);
        return claimFromInvitation(invitation,await readDeviceIdentity(runtime));
      case 'confirm':
        await listener.confirm(listener.pending()?.claimId,{localEndpoint:endpoint,peerEndpoint:command.peerEndpoint,includeUbuntu:false});
        return {status:'configuration-ready'};
      case 'finish': return receiveConfirmedTLSPairing(runtime,invitation,{includeUbuntu:false});
      case 'acknowledged': return {acknowledged:(await readHostTLSSetup(runtime)).acknowledged};
      case 'service':
        if(service)throw Error('Already running');
        service=spawn(process.execPath,[fileURLToPath(new URL('./peer-tls-service.mjs',import.meta.url)),'--runtime',runtime],{stdio:['pipe','pipe','ignore']});
        service.stdin.on('error',()=>{});
        serviceExit=new Promise(resolve=>service.once('exit',()=>resolve()));
        serviceBuffer='';
        service.stdout.on('data',chunk=>{
          serviceBuffer+=chunk.toString('utf8');
          if(serviceBuffer.length>8192){service.stdin.end();return;}
          const newline=serviceBuffer.indexOf('\n');
          if(newline>=0){const raw=serviceBuffer.slice(0,newline);serviceBuffer=serviceBuffer.slice(newline+1);try{serviceReply?.(JSON.parse(raw));}catch{service.stdin.end();}}
        });
        return {status:await serviceStatus()};
      case 'stop-service': await stopService();return {status:'stopped'};
      case 'publish': {
        const pair=await readPairing(runtime),record=await publishLocalPayload(runtime,payload(pair),pair.local);
        return {sequence:record.revision.sequence};
      }
      case 'exchange': {
        const pair=await readPairing(runtime);
        return (await finalizePeerCollection(runtime,{data:[],peer:{status:'ready',payload:payload(pair)}},pair)).peer;
      }
      case 'revoke': await revokePairing(runtime);return {status:'revoked'};
      case 'quota-enable': case 'quota-status': case 'quota-disable': case 'quota-exchange':
        return runSyntheticQuotaAction(runtime,command.action);
      default: throw Error('Unknown fixture action');
    }
  }
  let timer;
  try {
    execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-sha256','-keyout',key,'-out',cert,
      '-days','1','-subj','/CN=Synthetic two device verification'],{stdio:'ignore',timeout:15000});
    const certificate=await readFile(cert,'utf8');validFrom=Date.parse(new X509Certificate(certificate).validFrom);
    await initializeDeviceIdentity(runtime,{version:1,key:await readFile(key,'utf8'),cert:certificate});
    await rm(key);await rm(cert);
    const probe=net.createServer();
    await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen({host:address,port:0,exclusive:true},resolve);});
    endpoint.port=probe.address().port;
    await new Promise(resolve=>probe.close(resolve));
    timer=setTimeout(()=>process.stdin.destroy(),300000);
    let buffer='',pending=Promise.resolve(),count=0;
    const ended=new Promise(resolve=>{process.stdin.once('end',resolve);process.stdin.once('close',resolve);});
    process.stdin.on('data',chunk=>{
      buffer+=chunk.toString('utf8');
      if(buffer.length>8192){process.stdin.destroy();return;}
      let newline;
      while((newline=buffer.indexOf('\n'))>=0) {
        const raw=buffer.slice(0,newline);buffer=buffer.slice(newline+1);
        pending=pending.then(async()=>{
          if(closing)return;
          let request;
          try {
            request=JSON.parse(raw);
            if(++count>64 || !Number.isSafeInteger(request.id) || request.id<1 || typeof request.command?.action!=='string')throw Error('Invalid fixture command');
            send({id:request.id,...await run(request.command)});
          } catch {send({id:request?.id??0,error:'fixture-operation-failed'});}
        });
      }
    });
    send({ready:true});await ended;closing=true;await pending;
  } finally {clearTimeout(timer);await cleanup();}
}
if(process.argv.length===4 && process.argv[2]==='--live-peer')
  main(process.argv[3]).catch(()=>{process.stderr.write('Synthetic peer fixture failed.\n');process.exitCode=1;});
