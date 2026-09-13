import {createHash,X509Certificate} from 'node:crypto';
import {lstat,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {readPairing} from './peer-pairing.mjs';
import {readDeviceIdentity} from './peer-device-identity.mjs';
import {privateSyncDirectory} from './peer-directory.mjs';
import {withPeerStateLock} from './peer-lock.mjs';

const limit=20000,filename='tls-trust.json';
const fail=()=>Error('Confirmed peer trust unavailable');
const hash=cert=>createHash('sha256').update(cert.raw).digest('hex');
const fields=['version','pairId','localDeviceId','peerDeviceId','localCertificateSha256','peerCertificate'];

async function context(runtime) {
  const pairing=await readPairing(runtime),identity=await readDeviceIdentity(runtime);
  if(!pairing || !identity || (pairing.transport && pairing.transport.kind!=='tls') ||
    pairing.local.host!==(process.platform==='darwin'?'Mac':process.platform==='win32'?'Windows':null))throw fail();
  return {pairing,localFingerprint:hash(new X509Certificate(identity.cert))};
}
function validate(value,{pairing,localFingerprint}) {
  if(!value || Object.keys(value).length!==fields.length || fields.some(key=>!Object.hasOwn(value,key)) ||
    value.version!==1 || value.pairId!==pairing.local.pairId ||
    value.localDeviceId!==pairing.local.deviceId || value.peerDeviceId!==pairing.peer.deviceId ||
    value.localCertificateSha256!==localFingerprint ||
    typeof value.peerCertificate!=='string' || value.peerCertificate.length>16384)throw fail();
  const cert=new X509Certificate(value.peerCertificate),now=Date.now(),key=cert.publicKey;
  const details=key.asymmetricKeyDetails;
  if(hash(cert)===localFingerprint || !cert.checkIssued(cert) || !cert.verify(key) ||
    !(Date.parse(cert.validFrom)<=now && now<Date.parse(cert.validTo)) ||
    !(key.asymmetricKeyType==='rsa' && details.modulusLength>=2048 && details.modulusLength<=8192 ||
      key.asymmetricKeyType==='ec' && ['prime256v1','secp384r1'].includes(details.namedCurve)))throw fail();
  return {...value,peerCertificate:cert.toString()};
}

// Trust shares the pairing directory, so existing revocation fences it and
// explicit repair retires it with the old generation. It grants no data scope.
export const readPeerTrust=runtime=>withPeerStateLock(runtime,async()=>{
  const current=await context(runtime),directory=await privateSyncDirectory(runtime);
  const name=path.join(directory,filename);
  let before;
  try {before=await lstat(name);}catch(error){if(error.code==='ENOENT')return null;throw fail();}
  if(!before.isFile() || before.isSymbolicLink() || before.nlink!==1 || before.size>limit ||
    (process.platform!=='win32' && (before.mode&0o077)))throw fail();
  const file=await open(name,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try {
    const opened=await file.stat();
    if(opened.dev!==before.dev || opened.ino!==before.ino || opened.size!==before.size)throw fail();
    const bytes=Buffer.alloc(limit+1),{bytesRead}=await file.read(bytes,0,bytes.length,0),after=await file.stat();
    if(bytesRead!==before.size || after.size!==before.size || after.mtimeMs!==before.mtimeMs)throw fail();
    return validate(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,bytesRead))),current);
  } catch {throw fail();}finally{await file.close();}
});

// Only the local confirmation handler may supply this verified claim binding.
// Requires an already saved complementary pairing, never converts SSH in place.
export const saveConfirmedPeerTrust=(runtime,claim)=>withPeerStateLock(runtime,async()=>{
  const current=await context(runtime);
  if(!claim || Object.keys(claim).length!==4 || claim.pairId!==current.pairing.local.pairId ||
    claim.localCertificateSha256!==current.localFingerprint ||
    typeof claim.peerCertificate!=='string' || claim.peerCertificate.length>16384)throw fail();
  const peer=new X509Certificate(claim.peerCertificate);
  if(hash(peer)!==claim.peerCertificateSha256)throw fail();
  const safe=validate({version:1,pairId:claim.pairId,localDeviceId:current.pairing.local.deviceId,
    peerDeviceId:current.pairing.peer.deviceId,localCertificateSha256:current.localFingerprint,
    peerCertificate:peer.toString()},current);
  const directory=await privateSyncDirectory(runtime),bytes=JSON.stringify(safe);
  if(Buffer.byteLength(bytes)>limit)throw fail();
  const file=await open(path.join(directory,filename),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);
  try {await file.writeFile(bytes);await file.sync();}finally{await file.close();}
  await privateSyncDirectory(runtime);
  return readPeerTrust(runtime);
});
