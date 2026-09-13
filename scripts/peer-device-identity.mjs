import {createPrivateKey,createPublicKey,X509Certificate} from 'node:crypto';
import {open,lstat,readdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {privateCollectorDirectory} from './peer-directory.mjs';
import {withPeerStateLock} from './peer-lock.mjs';

const limit=32768;
const unavailable=()=>Error('Device identity unavailable. Explicit recovery is required.');
export function validateDeviceIdentity(value) {
  try {
    if(!value || Object.keys(value).length!==3 || value.version!==1 ||
      typeof value.key!=='string' || value.key.length>16384 ||
      typeof value.cert!=='string' || value.cert.length>16384)throw unavailable();
    const cert=new X509Certificate(value.cert),privateKey=createPrivateKey(value.key);
    const actual=createPublicKey(privateKey).export({type:'spki',format:'der'});
    const expected=cert.publicKey.export({type:'spki',format:'der'});
    const now=Date.now(),type=privateKey.asymmetricKeyType,details=privateKey.asymmetricKeyDetails;
    if(!actual.equals(expected) || !cert.checkIssued(cert) || !cert.verify(cert.publicKey) ||
      !(Date.parse(cert.validFrom)<=now && now<Date.parse(cert.validTo)) ||
      !(type==='rsa' && details.modulusLength>=2048 && details.modulusLength<=8192 ||
        type==='ec' && ['prime256v1','secp384r1'].includes(details.namedCurve)))throw unavailable();
    // Normalize to one certificate and an unencrypted key for Node TLS. This
    // storage layer relies on filesystem access controls, not at-rest encryption.
    return {version:1,key:privateKey.export({type:'pkcs8',format:'pem'}).toString(),cert:cert.toString()};
  } catch {throw unavailable();}
}

export async function readDeviceIdentity(runtime) {
  let directory;
  try {directory=await privateCollectorDirectory(runtime,'private-device-identity');}
  catch(error){if(error.code==='ENOENT')return null;throw unavailable();}
  const entries=await readdir(directory);
  if(entries.length!==1 || entries[0]!=='identity.json')throw unavailable();
  const name=path.join(directory,'identity.json');
  const before=await lstat(name);
  if(!before.isFile() || before.isSymbolicLink() || before.nlink!==1 || before.size>limit ||
    (process.platform!=='win32' && (before.mode&0o077)))throw unavailable();
  const file=await open(name,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try {
    const opened=await file.stat();
    if(opened.dev!==before.dev || opened.ino!==before.ino || opened.size!==before.size)throw unavailable();
    const bytes=Buffer.alloc(limit+1),{bytesRead}=await file.read(bytes,0,bytes.length,0);
    const after=await file.stat();
    if(bytesRead!==before.size || after.size!==before.size || after.mtimeMs!==before.mtimeMs)throw unavailable();
    try {return validateDeviceIdentity(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,bytesRead))));}
    finally {bytes.fill(0);}
  } catch {throw unavailable();}
  finally {await file.close();}
}

// Called only by explicit first-device setup with a newly generated identity.
// No replacement, auto-generation, repair or existing pairing mutation occurs.
export const initializeDeviceIdentity=(runtime,value)=>withPeerStateLock(runtime,async()=>{
  const safe=validateDeviceIdentity(value),bytes=JSON.stringify(safe);
  if(Buffer.byteLength(bytes)>limit)throw unavailable();
  try {
    await lstat(path.join(runtime,'private-device-identity'));
    throw unavailable();
  } catch(error) {if(error.code!=='ENOENT')throw unavailable();}
  const directory=await privateCollectorDirectory(runtime,'private-device-identity',true);
  if((await readdir(directory)).length)throw unavailable();
  const file=await open(path.join(directory,'identity.json'),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);
  try {await file.writeFile(bytes);await file.sync();}finally{await file.close();}
  await privateCollectorDirectory(runtime,'private-device-identity');
  return readDeviceIdentity(runtime);
});
