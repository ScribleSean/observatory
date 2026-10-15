import {X509Certificate} from 'node:crypto';
import {validateInvitation} from './peer-invitation.mjs';
import {readDeviceIdentity} from './peer-device-identity.mjs';
import {discoverPeerCertificate,requestPeerSetup,acknowledgePeerSetup} from './peer-tls-client.mjs';
import {commitConfirmedTLSPairing} from './peer-tls-setup.mjs';

export async function receiveConfirmedTLSPairing(runtime,invitation,options={}) {
  const host=process.platform==='darwin'?'Mac':process.platform==='win32'?'Windows':null;
  if(!host)throw Error('Native host required');
  const safe=validateInvitation(invitation),identity=await readDeviceIdentity(runtime);
  if(!identity)throw Error('Saved local identity required');
  const certificate=await discoverPeerCertificate(safe,options);
  const response=await requestPeerSetup(safe,certificate,identity,{host},options);
  if(response.status==='awaiting-confirmation')return response;
  const claim={pairId:response.pairing.local.pairId,
    localCertificateSha256:new X509Certificate(identity.cert).fingerprint256.replaceAll(':','').toLowerCase(),
    peerCertificate:certificate,peerCertificateSha256:safe.certificateSha256};
  if(options.signal?.aborted)throw Error('Pairing confirmation cancelled');
  await commitConfirmedTLSPairing(runtime,{pairing:response.pairing,claim});
  try {
    await acknowledgePeerSetup(safe,certificate,identity,response.pairing,options);
    return {status:'acknowledged'};
  } catch {return {status:'local-ready'};}
}
