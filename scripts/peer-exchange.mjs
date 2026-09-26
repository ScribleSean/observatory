import {fileURLToPath} from 'node:url';
import {readPairing} from './peer-pairing.mjs';
import {readPeerState,acceptPeerState} from './peer-store.mjs';
import {assertPairingActive} from './peer-revocation.mjs';
import {withPeerStateLock} from './peer-lock.mjs';
import {exchangeProviderTokens} from './provider-token-exchange.mjs';

// This is a local stdin/stdout endpoint for an authenticated SSH session, not a
// network listener. Its caller must authenticate the remote host and account.
export const exchangePeerRecord=(runtime,request,now=Date.now())=>
  withPeerStateLock(runtime,()=>exchangePeerRecordLocked(runtime,request,now));
async function exchangePeerRecordLocked(runtime,request,now) {
  if(!request || typeof request!=='object' || Array.isArray(request) || request.version!==1 ||
    Object.keys(request).length!==2 || !Object.hasOwn(request,'record'))throw Error('Invalid exchange request');
  const pairing=await readPairing(runtime);
  const host=process.platform==='darwin'?'Mac':process.platform==='win32'?'Windows':null;
  if(!pairing || pairing.local.host!==host)throw Error('Local pairing unavailable');
  const local=await readPeerState(runtime,pairing.local,now,'local');
  if(!local)throw Error('Local snapshot unavailable');
  await acceptPeerState(runtime,request.record,pairing.peer,now);
  await assertPairingActive(runtime);
  return {version:1,record:local};
}

// Provider readings use an independently versioned optional channel. Keep the
// core record request exactly as it was so an updated caller and an older peer
// can still exchange activity snapshots without interpreting provider data.
export function exchangePeerRequest(runtime,message,now=Date.now()) {
  if(message && typeof message==='object' && !Array.isArray(message) && message.version===1 &&
    message.channel==='provider-tokens' && Object.keys(message).length===3 &&
    ['version','channel','request'].every(key=>Object.hasOwn(message,key)))
    return exchangeProviderTokens(runtime,message.request,now);
  return exchangePeerRecord(runtime,message,now);
}

async function main(runtime) {
  const chunks=[];let size=0;
  const timer=setTimeout(()=>{process.stderr.write('Peer exchange input timeout\n');process.exit(1);},30000);
  try {
    for await(const chunk of process.stdin) {
      size+=chunk.length;if(size>17_000_000)throw Error('Exchange input limit');chunks.push(chunk);
    }
    const text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
    const response=await exchangePeerRequest(runtime,JSON.parse(text));
    process.stdout.write(JSON.stringify(response));
  } finally {clearTimeout(timer);}
}

if(process.argv[1]===fileURLToPath(import.meta.url))main(process.argv[2])
  .catch(()=>{process.stderr.write('Private peer exchange unavailable\n');process.exitCode=1;});
