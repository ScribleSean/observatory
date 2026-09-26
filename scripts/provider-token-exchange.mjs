import {isDeepStrictEqual} from 'node:util';
import {readPairing} from './peer-pairing.mjs';
import {withPeerStateLock} from './peer-lock.mjs';
import {readProviderTokenState,acceptProviderTokenReply} from './provider-token-store.mjs';
import {parseProviderTokenRequest} from './provider-token-peer.mjs';

// The transport has authenticated the saved peer before invoking this handler.
// A readiness probe carries only pairing identities, never provider readings.
export const exchangeProviderTokens=(runtime,request,now=Date.now())=>withPeerStateLock(runtime,async()=>{
  const pair=await readPairing(runtime);
  if(!pair)throw Error('Provider pairing unavailable');
  parseProviderTokenRequest(request,pair.peer);
  const state=await readProviderTokenState(runtime,now);
  if(!state?.generation)return {version:1,status:'disabled',record:null};
  if(request.action==='status')return {version:1,status:'ready',record:null};
  const next=await acceptProviderTokenReply(runtime,request.record,state.generation,now);
  return {version:1,status:'ready',record:next.local};
});

export const assertOutgoingProviderTokenRequest=(runtime,request)=>withPeerStateLock(runtime,async()=>{
  const pair=await readPairing(runtime);
  if(!pair)throw Error('Provider pairing unavailable');
  parseProviderTokenRequest(request,pair.local);
  const state=await readProviderTokenState(runtime);
  if(!state?.generation || (request.action==='exchange' && !isDeepStrictEqual(state.local,request.record)))
    throw Error('Provider sharing superseded');
});
