import {lstat} from 'node:fs/promises';
import path from 'node:path';
import {readPairing} from './peer-pairing.mjs';
import {withPeerStateLock} from './peer-lock.mjs';
import {readQuotaState,publishQuotaState,acceptQuotaReply} from './quota-store.mjs';
import {createSharedQuota} from './quota-peer.mjs';
import {sshQuotaRequest} from './peer-transport.mjs';
import {quotaPace} from './quota-pace.mjs';
import {isDeepStrictEqual} from 'node:util';
import {tlsQuotaRequest} from './peer-tls-outbound.mjs';

export function projectPeerQuota(state,pair,now=Date.now()) {
  const remote=state?.remote;
  if(!state?.sharing.enabled || state.sharing.pairingId!==pair?.local.pairId || !remote ||
    remote.pairingId!==pair.local.pairId || remote.host!==pair.peer.host)return null;
  const payload=remote.record.payload;
  const fresh=Number.isFinite(Date.parse(payload.checkedAt)) && now-Date.parse(payload.checkedAt)>=0 &&
    now-Date.parse(payload.checkedAt)<=600000 && now-remote.receivedAt>=0 && now-remote.receivedAt<=600000;
  const projected = {host:remote.host,provider:payload.provider,status:fresh?payload.status:'stale',checkedAt:payload.checkedAt,
    receivedAt:new Date(remote.receivedAt).toISOString(),history:payload.history,windows:payload.history.at(-1)?.windows??[],
    accountUsageCheckedAt:payload.dailyCheckedAt,dailyUsageBuckets:payload.dailyUsageBuckets};
  return {...projected,pace:quotaPace(projected,now)};
}

// No caller may supply pairing identity or enable sharing implicitly. All
// decisions come from owner-local state and the active authenticated pairing.
export async function syncQuota(runtime,{request,clock=Date.now}={}) {
  try {await lstat(path.join(runtime,'private-quota'));}
  catch(error) {if(error.code==='ENOENT')return {status:'disabled',peer:null};throw error;}
  const initial=await withPeerStateLock(runtime,async()=>{
    const pair=await readPairing(runtime);
    const state=await readQuotaState(runtime,clock());
    return {pair,state};
  });
  const {pair,state:original}=initial;
  if(!pair || !original.sharing.enabled || original.sharing.pairingId!==pair.local.pairId)return {status:'disabled',peer:null};
  if(!pair.transport || (pair.transport.kind!=='tls' && pair.local.host!=='Mac'))
    return {status:'passive',peer:projectPeerQuota(original,pair,clock())};
  const send=request??(pair.transport.kind==='tls'?(transport,input)=>tlsQuotaRequest(runtime,transport,input):sshQuotaRequest);
  const identity={version:1,pairId:pair.local.pairId,deviceId:pair.local.deviceId};
  const current=async()=>{
    if(!isDeepStrictEqual(await readPairing(runtime),pair))throw Error('Pairing superseded');
    const state=await readQuotaState(runtime,clock());
    return isDeepStrictEqual(state.sharing,original.sharing)?state:null;
  };
  try {
    // Never hold a local pairing lock across network waits. Both peers can send.
    const ready=await send(pair.transport,{...identity,action:'status'});
    const prepared=await withPeerStateLock(runtime,async()=>{
      const state=await current();
      if(!state)return {result:{status:'disabled',peer:null}};
      if(ready.status==='disabled') {
        await acceptQuotaReply(runtime,{revision:state.revision,pairingId:pair.local.pairId,host:pair.peer.host,record:null},clock());
        return {result:{status:'peer-disabled',peer:null}};
      }
      if(ready.status!=='ready' || ready.record!==null)throw Error('Invalid readiness');
      const history=state.history;
      const payload=createSharedQuota({status:history.status,checkedAt:history.asOf,history:history.samples,
        accountUsageCheckedAt:history.dailyAsOf,dailyUsageBuckets:history.dailyUsageBuckets},
        {enabled:true,host:pair.local.host,generation:state.sharing.generation,now:clock()});
      return {outgoing:await publishQuotaState(runtime,{revision:state.revision,pairingId:pair.local.pairId,host:pair.local.host,payload},clock())};
    });
    if(prepared.result)return prepared.result;
    const response=await send(pair.transport,{...identity,action:'exchange',record:prepared.outgoing});
    return await withPeerStateLock(runtime,async()=>{
      const state=await current();
      if(!state)return {status:'disabled',peer:null};
      if(!['ready','disabled'].includes(response.status))throw Error('Invalid exchange');
      // Inbound exchanges may advance the revision without changing consent.
      // Accept only against the just-read revision and the same sharing epoch.
      await acceptQuotaReply(runtime,{revision:state.revision,pairingId:pair.local.pairId,host:pair.peer.host,
        record:response.status==='disabled'?null:response.record},clock());
      return {status:response.status==='ready'?'ok':'peer-disabled',peer:projectPeerQuota(await readQuotaState(runtime,clock()),pair,clock())};
    });
  } catch {
    try {return await withPeerStateLock(runtime,async()=>{
      const state=await current();
      return state?{status:'unavailable',peer:projectPeerQuota(state,pair,clock())}:{status:'disabled',peer:null};
    });} catch {return {status:'unavailable',peer:null};}
  }
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
