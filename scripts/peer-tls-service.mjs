import {realpathSync} from 'node:fs';
import {realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {readPairing} from './peer-pairing.mjs';
import {readPeerTrust} from './peer-tls-trust.mjs';
import {withPeerStateLock} from './peer-lock.mjs';
import {startTrustedSyncListener} from './peer-tls-sync.mjs';
import {serveTLSSetupControl} from './peer-tls-control.mjs';

async function readBinding(runtime) {
  return withPeerStateLock(runtime,async()=>{
    const pairing=await readPairing(runtime);
    // Legacy SSH and incomplete TLS configurations never guess a bind address.
    if(pairing?.transport?.kind!=='tls' || !pairing.localEndpoint)return null;
    const trust=await readPeerTrust(runtime);
    if(!trust)throw Error('Confirmed trust required');
    return {pairing,trust};
  });
}

// Owned by the native app through a private stdin pipe. No identity creation,
// setup operations, public bind, discovery or independent startup registration.
export function createTrustedSyncService(runtime,{read=readBinding,start=startTrustedSyncListener,
  schedule=callback=>setInterval(callback,30000),unschedule=clearInterval}={}) {
  let listener=null,binding=null,pending=null,timer=null,closed=false,status='sync-disabled';
  async function stopListener() {
    const old=listener;listener=null;binding=null;
    if(old)await old.close();
  }
  function reconcile() {
    if(closed)return Promise.resolve({status:'sync-disabled'});
    if(pending)return pending;
    pending=(async()=>{
      try {
        const next=await read(runtime);
        if(closed)return;
        if(next && listener?.isListening() && isDeepStrictEqual(next,binding)) {status='sync-listening';return;}
        await stopListener();
        if(closed)return;
        if(!next){status='sync-disabled';return;}
        const created=await start(runtime,next.pairing.localEndpoint,{expectedPairing:next.pairing});
        listener=created;
        // Check again after binding. Never retain a listener from a stale start.
        if(closed || !isDeepStrictEqual(await read(runtime),next)) {await stopListener();status='sync-disabled';return;}
        listener=created;binding=next;status='sync-listening';
      } catch {await stopListener();status='unavailable';}
    })().then(()=>({status})).finally(()=>{pending=null;});
    return pending;
  }
  async function cancel() {
    if(timer!==null){unschedule(timer);timer=null;}
    closed=true;
    await pending;
    await stopListener();status='sync-disabled';
    return {status};
  }
  return {cancel,reconcile,run:async command=>{
    if(!command || typeof command!=='object' || Object.keys(command).length!==1 || !Object.hasOwn(command,'action'))
      throw Error('Invalid sync control');
    if(command.action==='cancel')return cancel();
    if(command.action!=='status' || closed)throw Error('Invalid sync control');
    if(timer===null)timer=schedule(()=>{void reconcile();});
    return reconcile();
  }};
}

async function main() {
  const args=process.argv.slice(2);
  if(args.length!==2 || args[0]!=='--runtime' || !path.isAbsolute(args[1]) || await realpath(args[1])!==args[1])
    throw Error('Invalid runtime');
  const controller=createTrustedSyncService(args[1]);
  const stop=()=>process.stdin.destroy();
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
  try {
    // Native launch itself is the lifecycle action. No polling commands are
    // required from the parent, so the bounded command-ID space cannot expire.
    await Promise.all([serveTLSSetupControl(args[1],process.stdin,process.stdout,{controller}),
      controller.run({action:'status'})]);
  }
  finally {await controller.cancel();}
}
if(process.argv[1] && process.argv[1]!=='-' && realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url)))
  main().catch(()=>{process.stderr.write('Trusted sync service stopped.\n');process.exitCode=1;});
