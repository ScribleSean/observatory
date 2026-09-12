import {lstat} from 'node:fs/promises';
import path from 'node:path';
import {readPairing} from './peer-pairing.mjs';
import {withPeerStateLock} from './peer-lock.mjs';
import {readQuotaState,publishQuotaState,acceptQuotaReply} from './quota-store.mjs';
import {createSharedQuota} from './quota-peer.mjs';
import {sshQuotaRequest} from './peer-transport.mjs';

export function projectPeerQuota(state,pair,now=Date.now()) {
  const remote=state?.remote;
  if(!state?.sharing.enabled || state.sharing.pairingId!==pair?.local.pairId || !remote ||
    remote.pairingId!==pair.local.pairId || remote.host!==pair.peer.host)return null;
  const payload=remote.record.payload;
  const fresh=Number.isFinite(Date.parse(payload.checkedAt)) && now-Date.parse(payload.checkedAt)>=0 &&
    now-Date.parse(payload.checkedAt)<=600000 && now-remote.receivedAt>=0 && now-remote.receivedAt<=600000;
  return {host:remote.host,provider:payload.provider,status:fresh?payload.status:'stale',checkedAt:payload.checkedAt,
    receivedAt:new Date(remote.receivedAt).toISOString(),history:payload.history,windows:payload.history.at(-1)?.windows??[],
    accountUsageCheckedAt:payload.dailyCheckedAt,dailyUsageBuckets:payload.dailyUsageBuckets};
}

// No caller may supply pairing identity or enable sharing implicitly. All
// decisions come from owner-local state and the active authenticated pairing.
export async function syncQuota(runtime,{request=sshQuotaRequest,clock=Date.now}={}) {
  try {await lstat(path.join(runtime,'private-quota'));}
  catch(error) {if(error.code==='ENOENT')return {status:'disabled',peer:null};throw error;}
  return withPeerStateLock(runtime,async()=>{
    const pair=await readPairing(runtime);
    let state=await readQuotaState(runtime,clock());
    if(!pair || !state.sharing.enabled || state.sharing.pairingId!==pair.local.pairId)return {status:'disabled',peer:null};
    if(pair.local.host!=='Mac' || !pair.transport)return {status:'passive',peer:projectPeerQuota(state,pair,clock())};
    const identity={version:1,pairId:pair.local.pairId,deviceId:pair.local.deviceId};
    try {
      const ready=await request(pair.transport,{...identity,action:'status'});
      // Re-read after awaiting the peer because collection can revoke consent.
      state=await readQuotaState(runtime,clock());
      if(!state.sharing.enabled || state.sharing.pairingId!==pair.local.pairId)return {status:'disabled',peer:null};
      if(ready.status==='disabled') {
        await acceptQuotaReply(runtime,{revision:state.revision,pairingId:pair.local.pairId,host:pair.peer.host,record:null},clock());
        return {status:'peer-disabled',peer:null};
      }
      if(ready.status!=='ready' || ready.record!==null)throw Error('Invalid readiness');
      const history=state.history;
      const payload=createSharedQuota({status:history.status,checkedAt:history.asOf,history:history.samples,
        accountUsageCheckedAt:history.dailyAsOf,dailyUsageBuckets:history.dailyUsageBuckets},
        {enabled:true,host:pair.local.host,generation:state.sharing.generation,now:clock()});
      const outgoing=await publishQuotaState(runtime,{revision:state.revision,pairingId:pair.local.pairId,host:pair.local.host,payload},clock());
      const response=await request(pair.transport,{...identity,action:'exchange',record:outgoing});
      if(!['ready','disabled'].includes(response.status))throw Error('Invalid exchange');
      await acceptQuotaReply(runtime,{revision:outgoing.sequence,pairingId:pair.local.pairId,host:pair.peer.host,
        record:response.status==='disabled'?null:response.record},clock());
      state=await readQuotaState(runtime,clock());
      return {status:response.status==='ready'?'ok':'peer-disabled',peer:projectPeerQuota(state,pair,clock())};
    } catch {
      state=await readQuotaState(runtime,clock());
      return {status:'unavailable',peer:projectPeerQuota(state,pair,clock())};
    }
  });
}

export async function attachQuotaSync(runtime,result,{enabled=false,...options}={}) {
  result.data.peerQuota=null;
  if(enabled!==true || !['ok','stale'].includes(result.data.quota?.status))return result;
  try {
    const synced=await syncQuota(runtime,options);
    result.data.peerQuota=synced.peer;
    result.quotaSync={status:synced.status};
  } catch {result.quotaSync={status:'unavailable'};}
  return result;
}
