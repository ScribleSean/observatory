import {realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readPairing} from './peer-pairing.mjs';
import {withPeerStateLock} from './peer-lock.mjs';
import {readProviderTokenState,setProviderTokenSharing,disableProviderTokenSharing,recentProviderSource} from './provider-token-store.mjs';
import {exactProviderFields,providerClock} from './provider-token-peer.mjs';

const token=(state,pair)=>createHash('sha256').update(JSON.stringify(['provider-token-sharing-v1',state.salt,state.revision,pair.local.pairId])).digest('hex');
export async function providerTokenSharingControl(runtime,request={action:'status'},now=Date.now()) {
  if(!providerClock(now) || !['status','enable','disable'].includes(request?.action) ||
    !exactProviderFields(request,request.action==='enable'?['action','token']:['action']) ||
    (request.action==='enable' && (typeof request.token!=='string' || !/^[a-f0-9]{64}$/.test(request.token))))throw Error('Invalid provider sharing request');
  return withPeerStateLock(runtime,async()=>{
    if(request.action==='disable')await disableProviderTokenSharing(runtime,now);
    let pair;
    try {pair=await readPairing(runtime);}catch {pair=null;}
    let state=pair?await readProviderTokenState(runtime,now):null;
    if(request.action==='enable') {
      if(!pair || !state || !recentProviderSource(state.source,now) || request.token!==token(state,pair))throw Error('Provider sharing confirmation expired');
      state=await setProviderTokenSharing(runtime,{revision:state.revision,enabled:true},now);
    }
    const canEnable=Boolean(pair && recentProviderSource(state?.source,now));
    return {version:1,enabled:Boolean(pair && state?.generation),canEnable,
      reason:!pair?'pairing-unavailable':canEnable?'ready':'source-unavailable',token:canEnable?token(state,pair):null};
  });
}

async function main() {
  const args=process.argv.slice(2);
  if(args.length!==2 || args[0]!=='--runtime' || !path.isAbsolute(args[1]))throw Error('Invalid runtime');
  const chunks=[];let bytes=0;
  const timeout=setTimeout(()=>process.exit(1),10000);
  try {
    for await(const chunk of process.stdin) {bytes+=chunk.length;if(bytes>1024)throw Error('Provider settings request too large');chunks.push(chunk);}
    const request=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
    process.stdout.write(JSON.stringify(await providerTokenSharingControl(args[1],request))+'\n');
  } finally {clearTimeout(timeout);}
}
if(process.argv[1] && process.argv[1]!=='-' && realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url)))main().catch(()=>{
  process.stderr.write('Provider sharing settings could not be verified. Refresh settings before retrying.\n');process.exitCode=1;
});
