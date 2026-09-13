import {X509Certificate} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,open} from 'node:fs/promises';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {createPairingConfigurations,validatePairing,readPairing} from './peer-pairing.mjs';
import {validatePeerTransport} from './peer-transport.mjs';
import {readDeviceIdentity} from './peer-device-identity.mjs';
import {readPeerTrust} from './peer-tls-trust.mjs';
import {commitConfirmedTLSPairing} from './peer-tls-setup.mjs';
import {setupConfigurationDigest} from './peer-tls-setup-message.mjs';
import {privateSyncDirectory} from './peer-directory.mjs';
import {withPeerStateLock} from './peer-lock.mjs';
import {startPairingListener} from './peer-tls-listener.mjs';

const fail=()=>Error('Confirmed host setup unavailable');
const fingerprint=pem=>new X509Certificate(pem).fingerprint256.replaceAll(':','').toLowerCase();
const offerFile='tls-offer.json',ackFile='tls-acknowledgement.json',limit=8192;

async function readStored(directory,name) {
  const filename=path.join(directory,name);
  let before;
  try {before=await lstat(filename);}catch(error){if(error.code==='ENOENT')return null;throw error;}
  if(!before.isFile() || before.isSymbolicLink() || before.nlink!==1 || before.size>limit ||
    (process.platform!=='win32' && (before.mode&0o077)))throw fail();
  const file=await open(filename,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try {
    const opened=await file.stat();
    if(opened.dev!==before.dev || opened.ino!==before.ino || opened.size!==before.size)throw fail();
    const bytes=Buffer.alloc(limit+1),{bytesRead}=await file.read(bytes,0,bytes.length,0),after=await file.stat();
    if(bytesRead!==before.size || after.size!==before.size || after.mtimeMs!==before.mtimeMs)throw fail();
    try {
      const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,bytesRead)));
      if(!value || typeof value!=='object' || Array.isArray(value))throw fail();
      return value;
    }
    catch {throw fail();}
  } finally {await file.close();}
}

async function saveIdentical(directory,name,value) {
  const saved=await readStored(directory,name);
  if(saved!==null) {if(!isDeepStrictEqual(saved,value))throw fail();return;}
  const bytes=JSON.stringify(value);
  if(Buffer.byteLength(bytes)>limit)throw fail();
  const file=await open(path.join(directory,name),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);
  try {await file.writeFile(bytes);await file.sync();}finally{await file.close();}
  if(!isDeepStrictEqual(await readStored(directory,name),value))throw fail();
}

function complementary(pair,transport,localFingerprint) {
  const {comparisonSalt,...peer}=pair.local;
  return validatePairing({version:1,local:{...pair.peer,comparisonSalt},peer,transport,
    localEndpoint:pair.transport,
    peerCertificateSha256:localFingerprint,...(pair.repair?{repair:pair.repair}:{})});
}

// Call only after local confirmation of the certificate from the claimed TLS
// connection. Endpoints and Windows/Ubuntu scope come from explicit setup.
export const prepareHostTLSSetup=(runtime,request)=>withPeerStateLock(runtime,async()=>{
  const host=process.platform==='darwin'?'Mac':process.platform==='win32'?'Windows':null;
  if(!host || !request || typeof request.includeUbuntu!=='boolean')throw fail();
  const localEndpoint=validatePeerTransport(request.localEndpoint),peerEndpoint=validatePeerTransport(request.peerEndpoint);
  if(localEndpoint.kind!=='tls' || peerEndpoint.kind!=='tls')throw fail();
  const identity=await readDeviceIdentity(runtime);
  if(!identity)throw fail();
  const localFingerprint=fingerprint(identity.cert);
  let pair=await readPairing(runtime);
  if(!pair)pair=validatePairing({...createPairingConfigurations(request.includeUbuntu)[host],
    transport:peerEndpoint,localEndpoint,peerCertificateSha256:request.peerCertificateSha256});
  const windows=host==='Windows'?pair.local:pair.peer;
  if(pair.local.host!==host || !isDeepStrictEqual(pair.transport,peerEndpoint) || !isDeepStrictEqual(pair.localEndpoint,localEndpoint) ||
    pair.peerCertificateSha256!==request.peerCertificateSha256 ||
    !isDeepStrictEqual(windows.codexHosts,request.includeUbuntu?['Windows','Ubuntu']:['Windows']))throw fail();
  const claim={pairId:pair.local.pairId,localCertificateSha256:localFingerprint,
    peerCertificate:request.peerCertificate,peerCertificateSha256:request.peerCertificateSha256};
  await commitConfirmedTLSPairing(runtime,{pairing:pair,claim});
  const offer=complementary(pair,localEndpoint,localFingerprint),directory=await privateSyncDirectory(runtime);
  await saveIdentical(directory,offerFile,offer);
  await privateSyncDirectory(runtime);
  return offer;
});

async function hostState(runtime) {
  const pair=await readPairing(runtime),trust=await readPeerTrust(runtime),directory=await privateSyncDirectory(runtime);
  if(!pair?.peerCertificateSha256 || !pair.localEndpoint || !trust)throw fail();
  const raw=await readStored(directory,offerFile);
  if(!raw)throw fail();
  const offer=validatePairing(raw);
  if(!isDeepStrictEqual(raw,offer) || !isDeepStrictEqual(offer,complementary(pair,pair.localEndpoint,trust.localCertificateSha256)))throw fail();
  const receipt={version:1,pairId:pair.local.pairId,deviceId:pair.peer.deviceId,
    peerCertificateSha256:pair.peerCertificateSha256,digest:setupConfigurationDigest(offer)};
  const ack=await readStored(directory,ackFile);
  if(ack!==null && !isDeepStrictEqual(ack,receipt))throw fail();
  return {directory,offer,receipt,acknowledged:ack!==null};
}

// Returns private configuration only to the local setup controller. A saved
// acknowledgement proves receipt, not that the remote app is currently online.
export const readHostTLSSetup=runtime=>withPeerStateLock(runtime,async()=>{
  const state=await hostState(runtime);
  return {pairing:state.offer,acknowledged:state.acknowledged};
});

// Listener supplies the fingerprint from the actual TLS socket, not JSON.
export const recordHostTLSAcknowledgement=(runtime,{peerCertificateSha256,digest})=>withPeerStateLock(runtime,async()=>{
  const state=await hostState(runtime);
  if(peerCertificateSha256!==state.receipt.peerCertificateSha256 || digest!==state.receipt.digest)throw fail();
  await saveIdentical(state.directory,ackFile,state.receipt);
  await privateSyncDirectory(runtime);
  return {version:1,status:'acknowledged'};
});

// Native host controller entrypoint. Starts only on an explicit setup action.
// Reopening after restart requires a new invitation and local confirmation,
// while the saved offer and acknowledgement remain bound to the same peer.
export async function startHostTLSSetup(runtime,{address,port=0},options={}) {
  const identity=await readDeviceIdentity(runtime);
  if(!identity)throw fail();
  const localFingerprint=fingerprint(identity.cert);
  const listener=await startPairingListener({address,port,identity},{createServer:options.createServer,
    onAcknowledged:ack=>recordHostTLSAcknowledgement(runtime,ack)});
  return {
    invitation:listener.invitation,status:listener.status,pending:listener.pending,cancel:listener.cancel,
    confirm:(claimId,request)=>withPeerStateLock(runtime,async()=>{
      const pending=listener.pending(),current=await readDeviceIdentity(runtime);
      if(!pending || pending.claimId!==claimId || listener.pending()?.claimId!==claimId ||
        !current || fingerprint(current.cert)!==localFingerprint ||
        request?.localEndpoint?.address!==address)throw fail();
      const offer=await prepareHostTLSSetup(runtime,{...request,peerCertificate:pending.peerCertificate,
        peerCertificateSha256:pending.peerCertificateSha256});
      return listener.confirmSetup(claimId,offer);
    }),
  };
}
