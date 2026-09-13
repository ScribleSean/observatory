import {createHash} from 'node:crypto';
import {validatePairing} from './peer-pairing.mjs';

const ordered=value=>Array.isArray(value)?value.map(ordered):value && typeof value==='object'?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;

// Hash the normalized configuration, including the certificate binding and
// source scope. This receipt is not authentication without pinned transport.
export function setupConfigurationDigest(pairing) {
  const safe=validatePairing(pairing);
  if(safe.transport?.kind!=='tls' || !safe.peerCertificateSha256)throw Error('Bound TLS configuration required');
  return createHash('sha256').update('observatory-setup-v1\n'+JSON.stringify(ordered(safe))).digest('hex');
}
