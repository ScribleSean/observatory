import {isDeepStrictEqual} from 'node:util';
import {validatePairing,readPairing,initializePairing} from './peer-pairing.mjs';
import {readPeerTrust,saveConfirmedPeerTrust,validateConfirmedPeerTrust} from './peer-tls-trust.mjs';
import {withPeerStateLock} from './peer-lock.mjs';

// Local confirmation controller only. The pairing must come from the pinned
// setup exchange, with the peer certificate taken from that TLS connection.
// This function does not establish user consent or acknowledge the other host.
export const commitConfirmedTLSPairing=(runtime,{pairing,claim})=>withPeerStateLock(runtime,async()=>{
  let safe=validatePairing(pairing);
  if(safe.transport?.kind!=='tls')throw Error('Explicit TLS setup transport required');
  const expectedTrust=await validateConfirmedPeerTrust(runtime,safe,claim);
  // Persist the confirmed certificate pin with the first configuration write.
  // Even a restart before trust persistence cannot substitute another peer.
  safe=validatePairing({...safe,peerCertificateSha256:claim.peerCertificateSha256});
  const existing=await readPairing(runtime);
  if(existing && !isDeepStrictEqual(existing,safe))throw Error('A different pairing already exists');
  // Exclusive initialization refuses pending SSH setup and orphaned private
  // state. A restart after this write may resume only this exact generation.
  if(!existing)await initializePairing(runtime,safe);
  const trust=await readPeerTrust(runtime);
  if(trust && !isDeepStrictEqual(trust,expectedTrust))throw Error('A different peer is already trusted');
  if(!trust)await saveConfirmedPeerTrust(runtime,claim);
  if(!isDeepStrictEqual(await readPairing(runtime),safe) ||
    !isDeepStrictEqual(await readPeerTrust(runtime),expectedTrust))throw Error('Local pairing could not be verified');
  // Do not call this paired. The protocol still needs the other device's ack.
  return {version:1,status:'local-ready'};
});
