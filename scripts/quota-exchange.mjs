import {lstat} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {withPeerStateLock} from './peer-lock.mjs';
import {readPairing} from './peer-pairing.mjs';
import {readQuotaState,exchangeQuotaState} from './quota-store.mjs';
import {createSharedQuota} from './quota-peer.mjs';

// Shared handler for the authenticated SSH endpoint and pinned TLS listener.
// Status contains no readings. Establish readiness before sending data.
export const exchangeQuota=(runtime,request,now=Date.now())=>withPeerStateLock(runtime,async()=>{
  const keys=request?.action==='status'?['version','action','pairId','deviceId']:['version','action','pairId','deviceId','record'];
  if(!request || request.version!==1 || !['status','exchange'].includes(request.action) ||
    Object.keys(request).length!==keys.length || Object.keys(request).some(key=>!keys.includes(key)))throw Error('Invalid allowance exchange');
  const pair=await readPairing(runtime);
  if(!pair || request.pairId!==pair.peer.pairId || request.deviceId!==pair.peer.deviceId)throw Error('Unpaired allowance sender');
  try {await lstat(path.join(runtime,'private-quota'));}
  catch(error) {if(error.code==='ENOENT')return {version:1,status:'disabled',record:null};throw error;}
  const state=await readQuotaState(runtime,now);
  if(!state.sharing.enabled || state.sharing.pairingId!==pair.local.pairId)return {version:1,status:'disabled',record:null};
  if(request.action==='status')return {version:1,status:'ready',record:null};
  const history=state.history;
  const payload=createSharedQuota({status:history.status,checkedAt:history.asOf,history:history.samples,
    accountUsageCheckedAt:history.dailyAsOf,dailyUsageBuckets:history.dailyUsageBuckets},
    {enabled:true,host:pair.local.host,generation:state.sharing.generation,now});
  const record=await exchangeQuotaState(runtime,{revision:state.revision,pairingId:pair.local.pairId,host:pair.peer.host,
    record:request.record,outgoing:payload},now);
  return {version:1,status:'ready',record};
});

async function main(runtime) {
  if(!path.isAbsolute(runtime??''))throw Error('Invalid runtime');
  const chunks=[];let bytes=0;
  const timer=setTimeout(()=>process.exit(1),30000);
  try {
    for await(const chunk of process.stdin) {bytes+=chunk.length;if(bytes>1_100_000)throw Error('Allowance input limit');chunks.push(chunk);}
    const request=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
    process.stdout.write(JSON.stringify(await exchangeQuota(runtime,request)));
  } finally {clearTimeout(timer);}
}
if(process.argv[1] && process.argv[1]!=='-' && realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url)))main(process.argv[2]).catch(()=>{
  process.stderr.write('Private allowance exchange unavailable\n');process.exitCode=1;
});
