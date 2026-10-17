import {X509Certificate} from 'node:crypto';
import {validateInvitation} from './peer-invitation.mjs';
import {readDeviceIdentity} from './peer-device-identity.mjs';
import {discoverPeerCertificate,requestPeerSetup,acknowledgePeerSetup,acknowledgementTimeoutMs} from './peer-tls-client.mjs';
import {commitConfirmedTLSPairing} from './peer-tls-setup.mjs';

export const joinBudgetMs=40000;

// Explicit joining-controller action after invitation claim and local approval.
// No generated keys, implicit source selection, background polling or listener.
export async function receiveConfirmedTLSPairing(runtime,invitation,options={}) {
  const now=options.now??performance.now.bind(performance),started=now();
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
  // A lost acknowledgement must leave the saved binding intact for an explicit
  // identical retry. It is not grounds for re-pairing or announcing success.
  try {
    // The budget keeps this step inside the native 45-second command timeout.
    const remaining=Math.floor(joinBudgetMs-(now()-started));
    if(remaining<1)return {status:'local-ready'};
    await acknowledgePeerSetup(safe,certificate,identity,response.pairing,
      {...options,timeoutMs:Math.min(options.timeoutMs??acknowledgementTimeoutMs,remaining)});
    return {status:'acknowledged'};
  } catch {return {status:'local-ready'};}
}
