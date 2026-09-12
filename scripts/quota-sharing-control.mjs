import {lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readPairing} from './peer-pairing.mjs';
import {withPeerStateLock} from './peer-lock.mjs';
import {readQuotaState,setQuotaSharing,revokeQuotaSharing} from './quota-store.mjs';

const empty=()=>({version:1,enabled:false,canEnable:false,reason:'account-unavailable',token:null});
const recent=(state,now)=>state?.history?.latestReadStatus==='ok' &&
  ['ok','stale'].includes(state.history.status) && Number.isFinite(Date.parse(state.history.asOf)) &&
  now-Date.parse(state.history.asOf)>=0 && now-Date.parse(state.history.asOf)<=600000;
const token=(state,pair)=>createHash('sha256').update(JSON.stringify([state.salt,state.revision,pair.local.pairId])).digest('hex');

// A narrow local interface for native settings. Pairing/account identifiers and
// quota readings are never returned. The token fences stale confirmation views.
export async function quotaSharingControl(runtime,request={action:'status'},now=Date.now()) {
  if(!request || !['status','enable','disable'].includes(request.action) ||
    Object.keys(request).some(key=>!['action','token'].includes(key)) ||
    (request.action==='enable' ? typeof request.token!=='string' || !/^[a-f0-9]{64}$/.test(request.token) : Object.hasOwn(request,'token')) ||
    !Number.isSafeInteger(now) || now<0)throw Error('Invalid sharing settings request');
  return withPeerStateLock(runtime,async()=>{
    // Disabling must remain available even if the pairing file is corrupt.
    if(request.action==='disable')await revokeQuotaSharing(runtime,now);
    let pair;
    try {pair=await readPairing(runtime);}catch {pair=null;}
    let state;
    try {await lstat(path.join(runtime,'private-quota'));}
    catch(error) {
      if(error.code!=='ENOENT')throw error;
      if(request.action==='enable')throw Error('Read the account before sharing');
      return {...empty(),reason:pair?'account-unavailable':'pairing-unavailable'};
    }
    state=await readQuotaState(runtime,now);
    if(request.action==='enable') {
      if(!pair || !recent(state,now) || request.token!==token(state,pair))throw Error('Sharing confirmation expired');
      state=await setQuotaSharing(runtime,{revision:state.revision,enabled:true,pairingId:pair.local.pairId},now);
    }
    const enabled=Boolean(pair && state.sharing.enabled && state.sharing.pairingId===pair.local.pairId);
    const canEnable=Boolean(pair && recent(state,now));
    return {version:1,enabled,canEnable,reason:!pair?'pairing-unavailable':canEnable?'ready':'account-unavailable',
      token:canEnable?token(state,pair):null};
  });
}

async function main() {
  const args=process.argv.slice(2);
  if(args.length!==2 || args[0]!=='--runtime' || !path.isAbsolute(args[1]))throw Error('Invalid runtime');
  const chunks=[];let bytes=0;
  const timeout=setTimeout(()=>process.exit(1),10000);
  try {
    for await(const chunk of process.stdin) {
      bytes+=chunk.length;if(bytes>1024)throw Error('Settings request too large');chunks.push(chunk);
    }
    const request=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
    process.stdout.write(JSON.stringify(await quotaSharingControl(args[1],request))+'\n');
  } finally {clearTimeout(timeout);}
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(()=>{
  process.stderr.write('Allowance sharing settings could not be verified. Refresh settings before retrying.\n');process.exitCode=1;
});
