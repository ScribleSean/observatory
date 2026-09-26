import {isDeepStrictEqual} from 'node:util';
import {readPairing} from './peer-pairing.mjs';
import {withPeerStateLock} from './peer-lock.mjs';
import {sshProviderTokenRequest} from './peer-transport.mjs';
import {tlsProviderTokenRequest} from './peer-tls-outbound.mjs';
import {attachProviderTokenSources,unavailableClaudeTokenSource} from './provider-token-sources.mjs';
import {parseProviderTokenSource,parseProviderTokenReply} from './provider-token-peer.mjs';
import {assertOutgoingProviderTokenRequest} from './provider-token-exchange.mjs';
import {readProviderTokenState,updateProviderTokenSource,acceptProviderTokenReply,providerTokenBinding} from './provider-token-store.mjs';

export function projectPeerProviderTokens(state,pair,now=Date.now()) {
  const remote=state?.remote;
  if(!pair || !state?.generation || remote?.consentGeneration!==state.generation ||
    !isDeepStrictEqual(state.binding,providerTokenBinding(pair)))return null;
  const source=remote.record.payload.source;
  const fresh=now-Date.parse(source.checkedAt)>=0 && now-Date.parse(source.checkedAt)<=600000 &&
    now-remote.receivedAt>=0 && now-remote.receivedAt<=600000;
  return {...source,status:source.status==='ok' && !fresh?'stale':source.status,receivedAt:new Date(remote.receivedAt).toISOString()};
}

export async function syncProviderTokens(runtime,{request,clock=Date.now}={}) {
  const original=await withPeerStateLock(runtime,async()=>({pair:await readPairing(runtime),state:await readProviderTokenState(runtime,clock())}));
  const {pair,state}=original;
  if(!pair || !state?.generation)return {status:'disabled',peer:null};
  if(!pair.transport || (pair.transport.kind!=='tls' && pair.local.host!=='Mac'))
    return {status:'passive',peer:projectPeerProviderTokens(state,pair,clock())};
  const send=request??(pair.transport.kind==='tls'?(transport,input)=>tlsProviderTokenRequest(runtime,transport,input):sshProviderTokenRequest);
  const identity={version:1,pairId:pair.local.pairId,deviceId:pair.local.deviceId};
  const current=async()=>{
    if(!isDeepStrictEqual(await readPairing(runtime),pair))throw Error('Provider pairing superseded');
    const next=await readProviderTokenState(runtime,clock());
    return next?.generation===state.generation?next:null;
  };
  try {
    const probe={...identity,action:'status'};
    await assertOutgoingProviderTokenRequest(runtime,probe);
    const ready=parseProviderTokenReply(await send(pair.transport,probe),probe);
    const prepared=await withPeerStateLock(runtime,async()=>{
      const next=await current();
      if(!next)return {result:{status:'disabled',peer:null}};
      if(ready.status==='disabled') {
        await acceptProviderTokenReply(runtime,null,state.generation,clock());
        return {result:{status:'peer-disabled',peer:null}};
      }
      return {record:next.local};
    });
    if(prepared.result)return prepared.result;
    const outgoing={...identity,action:'exchange',record:prepared.record};
    await assertOutgoingProviderTokenRequest(runtime,outgoing);
    const response=parseProviderTokenReply(await send(pair.transport,outgoing),outgoing);
    return await withPeerStateLock(runtime,async()=>{
      if(!await current())return {status:'disabled',peer:null};
      const next=await acceptProviderTokenReply(runtime,response.record,state.generation,clock());
      return {status:response.status==='ready'?'ok':'peer-disabled',peer:projectPeerProviderTokens(next,pair,clock())};
    });
  } catch {
    try {return await withPeerStateLock(runtime,async()=>{
      const next=await current();
      return next?{status:'unavailable',peer:projectPeerProviderTokens(next,pair,clock())}:{status:'disabled',peer:null};
    });} catch {return {status:'unavailable',peer:null};}
  }
}

// Collectors pass one already sanitized local source. This function never reads
// provider logs or changes core peer records. Failure preserves that local row.
export async function collectProviderTokenSources(runtime,source,options={}) {
  let now,local;
  try {now=(options.clock??Date.now)();local=parseProviderTokenSource(source,source?.host,now);}
  catch {
    // Invalid optional input must not abort a successfully finalized dashboard
    // or copy unchecked provider fields into its public projection.
    return {status:'unavailable',sources:['Mac','Windows'].includes(source?.host)?[unavailableClaudeTokenSource(source.host)]:[]};
  }
  try {
    if(!await readPairing(runtime))return {status:'disabled',sources:[local]};
    await updateProviderTokenSource(runtime,local,now);
    const result=await syncProviderTokens(runtime,options);
    return {status:result.status,sources:[local,...(result.peer?[result.peer]:[])]};
  } catch {return {status:'unavailable',sources:[local]};}
}

// Invoke once, after core finalization and local Claude collection. It replaces
// the provider array and contributes each configured source to health once.
export async function attachProviderTokenSync(runtime,result,source,options={}) {
  const collected=await collectProviderTokenSources(runtime,source,options);
  attachProviderTokenSources(result,collected.sources);
  result.providerTokenSync={status:collected.status};
  return result;
}
