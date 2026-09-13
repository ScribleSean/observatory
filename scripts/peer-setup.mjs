import {realpathSync} from 'node:fs';
import {realpath,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {createPairingConfigurations,validatePairing,readPairing,readPendingPairing,
  preparePendingPairing,activatePendingPairing} from './peer-pairing.mjs';
import {validatePeerTransport,sshPeerSetup,sshPeerRepairReadiness} from './peer-transport.mjs';
import {assertPairingActive} from './peer-revocation.mjs';
import {privateSyncDirectory} from './peer-directory.mjs';
import {withPeerStateLock} from './peer-lock.mjs';
import {readRepairConsent,validRepairNonce} from './peer-repair-consent.mjs';

// A native form may prefill its target, but never receives pairing identities,
// comparison salts, snapshot records or raw error details.
export async function setupStatus(runtime,platform=process.platform) {
  try {
    if(platform!=='darwin' || typeof runtime!=='string' || !path.isAbsolute(runtime) ||
      path.resolve(runtime)!==await realpath(runtime))throw Error('Canonical Mac runtime required');
    await readRepairConsent(runtime);
    const pending=await readPendingPairing(runtime),active=await readPairing(runtime);
    if(pending && active && !isDeepStrictEqual(pending,active))throw Error('Conflicting setup state');
    const pair=pending??active;
    let entries=[];
    try {entries=await readdir(await privateSyncDirectory(runtime));}
    catch(error) {if(error.code!=='ENOENT')throw error;}
    if(!pair) {
      if(entries.length)throw Error('Existing private state needs repair');
      return {status:'unpaired',request:null};
    }
    if(pair.local.host!=='Mac' || !pair.transport ||
      (!active && entries.some(name=>name!=='setup.pending.json')))throw Error('Setup state needs repair');
    return {status:pending?'pending':'paired',request:{transport:validatePeerTransport(pair.transport),
      includeUbuntu:pair.peer.codexHosts.length===2}};
  } catch {return {status:'needs-repair',request:null};}
}

export function complementaryWindowsPairing(mac) {
  const safe=validatePairing(mac);
  if(safe.local.host!=='Mac' || safe.transport?.kind!=='ssh-windows')throw Error('Mac SSH setup pairing required');
  const {comparisonSalt,...peer}=safe.local;
  return validatePairing({version:1,local:{...safe.peer,comparisonSalt},peer,...(safe.repair?{repair:safe.repair}:{})});
}

// Explicit setup only. Normal collectors never call this or create a pairing.
export const setupPairing=(runtime,request,send=sshPeerSetup,platform=process.platform,readiness=sshPeerRepairReadiness)=>
  withPeerStateLock(runtime,()=>setupPairingLocked(runtime,request,send,platform,readiness));
async function setupPairingLocked(runtime,request,send,platform,readiness) {
  if(platform!=='darwin' || !request || typeof request!=='object' || Array.isArray(request) ||
    Object.keys(request).length!==2 || !Object.hasOwn(request,'transport') || typeof request.includeUbuntu!=='boolean')
    throw Error('Explicit Mac setup request required');
  const transport=validatePeerTransport(request.transport);
  if(transport.kind!=='ssh-windows')throw Error('Explicit SSH setup transport required');
  const localConsent=await readRepairConsent(runtime);
  let pending=await readPendingPairing(runtime),active=await readPairing(runtime);
  if(pending && active && !isDeepStrictEqual(pending,active))throw Error('Conflicting setup state');
  let pair=pending??active;
  if(!pair) {
    const desired=createPairingConfigurations(request.includeUbuntu).Mac;
    desired.transport=transport;
    if(localConsent) {
      const peerConsent=await readiness(transport);
      if(!validRepairNonce(peerConsent))throw Error('Windows repair confirmation unavailable');
      desired.repair={mac:localConsent,windows:peerConsent};
    }
    try {pair=await preparePendingPairing(runtime,desired);}
    catch(error) {pair=await readPendingPairing(runtime);if(!pair)throw error;}
  }
  if(localConsent && pair.repair?.mac!==localConsent)throw Error('Current Mac repair confirmation required');
  if(pair.local.host!=='Mac' || !isDeepStrictEqual(pair.transport,transport) ||
    (pair.peer.codexHosts.length===2)!==request.includeUbuntu)throw Error('Retry requires the original setup target and source scope');
  await assertPairingActive(runtime);
  const response=await send(transport,complementaryWindowsPairing(pair));
  if(!isDeepStrictEqual(response,{version:1,status:'ready'}))throw Error('Peer setup was not acknowledged');
  await activatePendingPairing(runtime,pair);
  return {status:'paired'};
}

async function main() {
  const args=process.argv.slice(2);
  if(args.length!==3 || args[0]!=='--runtime' || !['--setup','--status'].includes(args[2]))throw Error('Explicit setup arguments required');
  if(args[2]==='--status') {
    process.stdout.write(JSON.stringify(await setupStatus(args[1]))+'\n');
    return;
  }
  const timer=setTimeout(()=>{process.stderr.write('Private setup input timeout\n');process.exit(1);},30000);
  const chunks=[];let size=0;
  try {
    for await(const chunk of process.stdin) {size+=chunk.length;if(size>8192)throw Error('Setup input limit');chunks.push(chunk);}
  } finally {clearTimeout(timer);}
  const request=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
  const result=await setupPairing(args[1],request);
  process.stdout.write(JSON.stringify(result)+'\n');
}
if(process.argv[1] && process.argv[1]!=='-' && realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url)))
  main().catch(()=>{process.stderr.write('Pairing setup incomplete. Retry the same target; existing private state was not overwritten.\n');process.exitCode=1;});
