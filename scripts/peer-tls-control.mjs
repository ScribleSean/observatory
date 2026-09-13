import {realpathSync} from 'node:fs';
import {realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startHostTLSSetup} from './peer-tls-host.mjs';
import {readDeviceIdentity} from './peer-device-identity.mjs';
import {claimFromInvitation} from './peer-tls-client.mjs';
import {receiveConfirmedTLSPairing} from './peer-tls-join.mjs';
import {encodeInvitation,decodeInvitation} from './peer-invitation.mjs';

const fail=()=>Error('Setup command unavailable');
const exact=(value,keys)=>value && typeof value==='object' && !Array.isArray(value) &&
  Object.keys(value).length===keys.length && keys.every(key=>Object.hasOwn(value,key));

// One controller belongs to one native setup child process. It never returns
// keys, pairing configurations, comparison salts or internal claim handles.
export function createTLSSetupController(runtime,{startHost=startHostTLSSetup,readIdentity=readDeviceIdentity,
  claim=claimFromInvitation,receive=receiveConfirmedTLSPairing}={}) {
  let host=null,invitation=null,joining='idle',epoch=0,busy=null,abort=new AbortController();
  async function cancel() {
    epoch++;busy=null;abort.abort();abort=new AbortController();invitation=null;joining='idle';
    const previous=host;host=null;
    if(previous)await previous.cancel();
    return {status:'cancelled'};
  }
  async function run(request) {
    if(exact(request,['action']) && request.action==='cancel')return cancel();
    if(exact(request,['action']) && request.action==='status') {
      const pending=host?.pending();
      return {status:busy!==null?'working':host?.status()??joining,
        peerCertificateSha256:pending?.peerCertificateSha256??null};
    }
    if(busy!==null)throw fail();
    const token=epoch;busy=token;
    try {
      if(exact(request,['action','address','port']) && request.action==='host-start') {
        if(host || invitation)throw fail();
        const created=await startHost(runtime,{address:request.address,port:request.port});
        if(token!==epoch){await created.cancel();return {status:'cancelled'};}
        host=created;
        return {status:'hosting',invitation:encodeInvitation(host.invitation)};
      }
      if(exact(request,['action','peerCertificateSha256','localEndpoint','peerEndpoint','includeUbuntu']) && request.action==='host-confirm') {
        const pending=host?.pending();
        if(!pending || pending.peerCertificateSha256!==request.peerCertificateSha256)throw fail();
        await host.confirm(pending.claimId,{localEndpoint:request.localEndpoint,
          peerEndpoint:request.peerEndpoint,includeUbuntu:request.includeUbuntu});
        return {status:token===epoch?'configuration-ready':'cancelled'};
      }
      if(exact(request,['action','invitation']) && request.action==='join-claim') {
        if(host || invitation)throw fail();
        const proposed=decodeInvitation(request.invitation),identity=await readIdentity(runtime);
        if(!identity || token!==epoch)throw fail();
        const result=await claim(proposed,identity,{signal:abort.signal});
        if(token!==epoch)return {status:'cancelled'};
        if(result.status!=='awaiting-confirmation')throw fail();
        invitation=proposed;joining=result.status;
        return {status:joining};
      }
      if(exact(request,['action','includeUbuntu']) && request.action==='join-confirm') {
        if(!invitation || host)throw fail();
        const result=await receive(runtime,invitation,{includeUbuntu:request.includeUbuntu},{signal:abort.signal});
        if(token!==epoch)return {status:'cancelled'};
        if(!['awaiting-confirmation','local-ready','acknowledged'].includes(result.status))throw fail();
        joining=result.status;return {status:joining};
      }
      throw fail();
    } finally {if(busy===token)busy=null;}
  }
  return {run,cancel};
}

// Bounded newline-delimited JSON over private parent-child pipes only. Cancel
// remains responsive while an earlier command awaits network or local storage.
export function serveTLSSetupControl(runtime,input,output,{controller=createTLSSetupController(runtime)}={}) {
  return new Promise((resolve,reject)=>{
    let buffer=Buffer.alloc(0),closed=false,count=0;
    const ids=new Set(),pending=new Set();
    const shutdown=async(error)=>{
      if(closed)return;closed=true;
      input.removeListener('data',data);buffer.fill(0);buffer=Buffer.alloc(0);
      try {await controller.cancel();await Promise.allSettled([...pending]);}
      catch {error=fail();}
      if(error)reject(fail());else resolve();
    };
    const emit=(id,result)=>{
      if(closed)return;
      const bytes=JSON.stringify({id,...result})+'\n';
      if(Buffer.byteLength(bytes)>8192 || output.writableLength>32768){void shutdown(fail());return;}
      try {output.write(bytes);}catch {void shutdown(fail());}
    };
    const data=chunk=>{
      buffer=Buffer.concat([buffer,chunk]);
      // Native commands are small. Reject a giant chunk even if it contains
      // multiple frames rather than allocating an unbounded request queue.
      if(buffer.length>16384){void shutdown(fail());return;}
      let newline;
      while(!closed && (newline=buffer.indexOf(10))!==-1) {
        const line=buffer.subarray(0,newline);buffer=buffer.subarray(newline+1);
        let message;
        try {
          message=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(line));
          if(!exact(message,['id','command']) || !Number.isSafeInteger(message.id) || message.id<1 ||
            ids.has(message.id) || ++count>512)throw fail();
          ids.add(message.id);
        } catch {void shutdown(fail());return;}
        const task=Promise.resolve().then(()=>{if(closed)throw fail();return controller.run(message.command);})
          .then(result=>emit(message.id,result),()=>emit(message.id,{status:'unavailable'}));
        pending.add(task);void task.finally(()=>pending.delete(task));
      }
    };
    input.on('data',data);
    input.once('end',()=>{void shutdown(buffer.length?fail():null);});
    input.once('close',()=>{void shutdown(null);});
    input.once('error',()=>{void shutdown(fail());});
    output.once('error',()=>{void shutdown(fail());});
    output.once('close',()=>{void shutdown(null);});
  });
}

async function main() {
  const args=process.argv.slice(2);
  if(args.length!==2 || args[0]!=='--runtime' || !path.isAbsolute(args[1]) ||
    await realpath(args[1])!==args[1])throw fail();
  const controller=createTLSSetupController(args[1]);
  const stop=()=>process.stdin.destroy();
  const expiry=setTimeout(stop,600000);
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
  process.stdin.once('close',()=>{void controller.cancel();});
  try {await serveTLSSetupControl(args[1],process.stdin,process.stdout,{controller});}
  finally {clearTimeout(expiry);await controller.cancel();}
}
if(process.argv[1] && process.argv[1]!=='-' && realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url)))
  main().catch(()=>{process.stderr.write('Pairing setup controller stopped.\n');process.exitCode=1;});
