import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {validatePairing,readPairing,initializePairing} from './peer-pairing.mjs';
import {withPeerStateLock} from './peer-lock.mjs';
import {readRepairConsent} from './peer-repair-consent.mjs';

export const ensureWindowsPairing=(runtime,request,platform=process.platform)=>
  withPeerStateLock(runtime,()=>ensureWindowsPairingLocked(runtime,request,platform));
async function ensureWindowsPairingLocked(runtime,request,platform) {
  if(platform!=='win32' || !request || typeof request!=='object' || Array.isArray(request) ||
    Object.keys(request).length!==2 || request.version!==1 || !Object.hasOwn(request,'pairing'))
    throw Error('Invalid Windows setup request');
  const desired=validatePairing(request.pairing);
  if(desired.local.host!=='Windows' || desired.transport)throw Error('Windows pairing required');
  const consent=await readRepairConsent(runtime);
  if((consent || desired.repair) && (!consent || !desired.repair?.mac || desired.repair?.windows!==consent))
    throw Error('Fresh confirmation on both devices required');
  let existing=await readPairing(runtime);
  if(!existing) {
    try {await initializePairing(runtime,desired);}
    catch(error) {
      existing=await readPairing(runtime);
      if(!existing)throw error;
    }
    existing=await readPairing(runtime);
  }
  if(!isDeepStrictEqual(existing,desired))throw Error('Existing pairing does not match setup');
  return {version:1,status:'ready'};
}

export const windowsRepairReadiness=(runtime,platform=process.platform)=>withPeerStateLock(runtime,async()=>{
  if(platform!=='win32' || await readPairing(runtime))throw Error('Local repair preparation required');
  const nonce=await readRepairConsent(runtime);
  if(!nonce)throw Error('Local repair confirmation unavailable');
  return {version:1,status:'repair-ready',nonce};
});

async function main(runtime) {
  const timer=setTimeout(()=>{process.stderr.write('Private setup input timeout\n');process.exit(1);},30000);
  const chunks=[];let size=0;
  try {
    for await(const chunk of process.stdin) {size+=chunk.length;if(size>8192)throw Error('Setup input limit');chunks.push(chunk);}
    const request=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
    const response=request && !Array.isArray(request) && Object.keys(request).length===2 &&
      request.version===1 && request.action==='repair-readiness'?
      await windowsRepairReadiness(runtime):await ensureWindowsPairing(runtime,request);
    process.stdout.write(JSON.stringify(response));
  } finally {clearTimeout(timer);}
}
if(process.argv[1] && process.argv[1]!=='-' && realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url)))
  main(process.argv[2]).catch(()=>{process.stderr.write('Private pairing setup unavailable\n');process.exitCode=1;});
