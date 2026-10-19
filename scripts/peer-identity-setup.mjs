import {lstat,readdir,open,rename} from 'node:fs/promises';
import {constants} from 'node:fs';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {readDeviceIdentity,initializeDeviceIdentity} from './peer-device-identity.mjs';
import {withPeerStateLock} from './peer-lock.mjs';

async function assertNewDevice(runtime) {
  try {await lstat(path.join(runtime,'private-sync'));}
  catch(error) {if(error.code==='ENOENT')return;throw error;}
  throw Error('Existing pairing requires explicit identity recovery');
}

async function repairableIdentity(runtime) {
  try {
    await assertNewDevice(runtime);
    const directory=path.join(runtime,'private-device-identity'),info=await lstat(directory);
    if(!info.isDirectory() || info.isSymbolicLink())return false;
    const entries=await readdir(directory);
    if(entries.length===0)return true;
    if(entries.length!==1 || entries[0]!=='identity.json')return false;
    const name=path.join(directory,'identity.json'),before=await lstat(name);
    if(!before.isFile() || before.isSymbolicLink() || before.nlink!==1 || before.size>32768)return false;
    const file=await open(name,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
    try {
      const opened=await file.stat();
      if(opened.dev!==before.dev || opened.ino!==before.ino || opened.size!==before.size)return false;
      const bytes=Buffer.alloc(32769);
      try {
        const {bytesRead}=await file.read(bytes,0,bytes.length,0),after=await file.stat();
        if(bytesRead!==before.size || after.size!==before.size || after.mtimeMs!==before.mtimeMs)return false;
        // Only what an interrupted write can leave: no bytes, or bytes that are not
        // complete UTF-8 JSON. A parseable identity that fails validation, such as
        // an expired certificate or a newer format, still needs explicit recovery.
        try {JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,bytesRead)));}
        catch {return true;}
        return false;
      } finally {bytes.fill(0);}
    } finally {await file.close();}
  } catch {return false;}
}

// Read-only status. Missing identity for existing pairing is not first launch.
export async function deviceIdentitySetupStatus(runtime) {
  try {
    if(await readDeviceIdentity(runtime))return {status:'identity-ready'};
    await assertNewDevice(runtime);
    return {status:'identity-required'};
  } catch {return {status:await repairableIdentity(runtime)?'identity-required':'identity-recovery-required'};}
}

// Explicit setup only. A saved identity is reused, never replaced. The caller
// must disclose that this is a restricted plaintext file, not an OS key vault.
export async function prepareDeviceIdentity(runtime,{storage,generate,signal}) {
  if(storage!=='restricted-file' || typeof generate!=='function' || signal?.aborted)
    throw Error('Explicit identity storage consent required');
  return withPeerStateLock(runtime,async()=>{
    if(signal?.aborted)throw Error('Identity setup cancelled');
    try {if(await readDeviceIdentity(runtime))return {status:'identity-ready'};}
    catch(error) {
      if(!await repairableIdentity(runtime))throw error;
      const damaged=path.join(runtime,'private-device-identity-damaged-'+randomBytes(16).toString('hex'));
      await rename(path.join(runtime,'private-device-identity'),damaged);
    }
    await assertNewDevice(runtime);
    const identity=await generate();
    if(signal?.aborted)throw Error('Identity setup cancelled');
    await initializeDeviceIdentity(runtime,identity);
    return {status:'identity-ready'};
  });
}
