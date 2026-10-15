import {createHash} from 'node:crypto';
import {validatePairing} from './peer-pairing.mjs';

const ordered=value=>Array.isArray(value)?value.map(ordered):value && typeof value==='object'?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;

export function setupConfigurationDigest(pairing) {
  const safe=validatePairing(pairing);
  if(safe.transport?.kind!=='tls' || !safe.peerCertificateSha256)throw Error('Bound TLS configuration required');
  return createHash('sha256').update('observatory-setup-v1\n'+JSON.stringify(ordered(safe))).digest('hex');
}

export function legacySetupConfigurationDigest(pairing) {
  const safe=validatePairing(pairing);
  if(safe.transport?.kind!=='tls' || !safe.peerCertificateSha256)throw Error('Bound TLS configuration required');
  safe.local.codexHosts=[safe.local.host];
  safe.peer.codexHosts=[safe.peer.host];
  return createHash('sha256').update('observatory-setup-v1\n'+JSON.stringify(ordered(safe))).digest('hex');
}
