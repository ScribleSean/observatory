import {isDeepStrictEqual} from 'node:util';
import {validatePairing,readPairing,initializePairing} from './peer-pairing.mjs';
import {readPeerTrust,saveConfirmedPeerTrust,validateConfirmedPeerTrust} from './peer-tls-trust.mjs';
import {withPeerStateLock} from './peer-lock.mjs';

export const commitConfirmedTLSPairing=(runtime,{pairing,claim})=>withPeerStateLock(runtime,async()=>{
  let safe=validatePairing(pairing);
  if(safe.transport?.kind!=='tls')throw Error('Explicit TLS setup transport required');
  const expectedTrust=await validateConfirmedPeerTrust(runtime,safe,claim);
  safe=validatePairing({...safe,peerCertificateSha256:claim.peerCertificateSha256});
  const existing=await readPairing(runtime);
  if(existing && !isDeepStrictEqual(existing,safe))throw Error('A different pairing already exists');
  if(!existing)await initializePairing(runtime,safe);
  const trust=await readPeerTrust(runtime);
  if(trust && !isDeepStrictEqual(trust,expectedTrust))throw Error('A different peer is already trusted');
  if(!trust)await saveConfirmedPeerTrust(runtime,claim);
  if(!isDeepStrictEqual(await readPairing(runtime),safe) ||
    !isDeepStrictEqual(await readPeerTrust(runtime),expectedTrust))throw Error('Local pairing could not be verified');
  return {version:1,status:'local-ready'};
});
