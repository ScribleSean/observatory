import {constants} from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
import {lstat,open} from 'node:fs/promises';
import path from 'node:path';

export const hostCommitFile='tls-host-commit.json';
export async function hostCommitUnfinished(runtime) {
  try {await lstat(path.join(runtime,'private-sync',hostCommitFile));return true;}
  catch(error) {return error.code!=='ENOENT';}
}

const fail=()=>Error('Confirmed host setup unavailable');
const commitNames=['pairing.json','tls-trust.json','tls-offer.json'];
async function readStored(directory,name,bound=4096) {
  const filename=path.join(directory,name);
  let before;
  try {before=await lstat(filename);}catch(error){if(error.code==='ENOENT')return null;throw error;}
  if(!before.isFile() || before.isSymbolicLink() || before.nlink!==1 || before.size>bound ||
    (process.platform!=='win32' && (before.mode&0o077)))throw fail();
  const file=await open(filename,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try {
    const opened=await file.stat();
    if(opened.dev!==before.dev || opened.ino!==before.ino || opened.size!==before.size)throw fail();
    const bytes=Buffer.alloc(bound+1),{bytesRead}=await file.read(bytes,0,bytes.length,0),after=await file.stat();
    if(bytesRead!==before.size || after.size!==before.size || after.mtimeMs!==before.mtimeMs)throw fail();
    try {
      const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,bytesRead)));
      if(!value || typeof value!=='object' || Array.isArray(value))throw fail();
      return value;
    }
    catch {throw fail();}
  } finally {await file.close();}
}

const exact=(value,keys)=>value && typeof value==='object' && !Array.isArray(value) &&
  Object.keys(value).length===keys.length && keys.every(key=>Object.hasOwn(value,key));
export async function readHostCommit(directory) {
  const value=await readStored(directory,hostCommitFile,4096);
  if(value===null)return null;
  if(!exact(value,['version','pairId','localCertificateSha256','peerCertificateSha256','directoryCreated','created','files']) ||
    value.version!==1 || !['pairId','localCertificateSha256','peerCertificateSha256'].every(key=>
      typeof value[key]==='string' && /^[a-fA-F0-9]{64}$/.test(value[key])) ||
    typeof value.directoryCreated!=='boolean' || !Array.isArray(value.created) ||
    !isDeepStrictEqual(value.created,commitNames.filter(name=>value.created.includes(name))) ||
    !value.files || typeof value.files!=='object' || Array.isArray(value.files) ||
    !Object.entries(value.files).every(([name,info])=>value.created.includes(name) &&
      exact(info,['dev','ino']) && ['dev','ino'].every(key=>typeof info[key]==='string' && /^[0-9]{1,20}$/.test(info[key]))))throw fail();
  return value;
}
