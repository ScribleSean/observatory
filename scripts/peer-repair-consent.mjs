import {lstat,open,rename} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {privateCollectorDirectory} from './peer-directory.mjs';

export const validRepairNonce=value=>typeof value==='string' && /^[a-f0-9]{64}$/.test(value);

async function readConsentFile(runtime) {
  let directory;
  try {directory=await privateCollectorDirectory(runtime,'private-repair');}
  catch(error) {if(error.code==='ENOENT')return null;throw error;}
  const filename=path.join(directory,'prepared.json');
  let before;
  try {before=await lstat(filename);}catch(error){if(error.code==='ENOENT')return null;throw error;}
  if(!before.isFile() || before.isSymbolicLink() || before.nlink!==1 || before.size>1024 ||
    (process.platform!=='win32' && (before.mode&0o077)))throw Error('Unsafe repair confirmation');
  const file=await open(filename,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try {
    const info=await file.stat();
    if(info.dev!==before.dev || info.ino!==before.ino || info.size!==before.size)throw Error('Changing repair confirmation');
    const bytes=Buffer.alloc(1025),{bytesRead}=await file.read(bytes,0,bytes.length,0);
    const after=await file.stat();
    if(bytesRead!==before.size || after.size!==before.size || after.mtimeMs!==before.mtimeMs)throw Error('Changing repair confirmation');
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,bytesRead)));
    if(!value || Array.isArray(value) || Object.keys(value).length!==2 || value.version!==1 || !validRepairNonce(value.nonce))
      throw Error('Invalid repair confirmation');
    return value.nonce;
  } finally {await file.close();}
}

export async function readRepairConsent(runtime) {
  const nonce=await readConsentFile(runtime);
  if(!nonce) {
    try {await lstat(path.join(runtime,'private-repair','require-pairing'));}
    catch(error) {if(error.code==='ENOENT')return null;throw error;}
    throw Error('Incomplete local repair confirmation');
  }
  return nonce;
}

export async function writeRepairConsent(runtime,nonce) {
  if(!validRepairNonce(nonce))throw Error('Invalid repair confirmation');
  await readConsentFile(runtime);
  const directory=await privateCollectorDirectory(runtime,'private-repair');
  const pending=path.join(directory,'prepare.pending');
  const file=await open(pending,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);
  try {await file.writeFile(JSON.stringify({version:1,nonce}));await file.sync();}
  finally {await file.close();}
  await rename(pending,path.join(directory,'prepared.json'));
  if(process.platform!=='win32') {
    const parent=await open(directory,constants.O_RDONLY);
    try {await parent.sync();}finally{await parent.close();}
  }
}
