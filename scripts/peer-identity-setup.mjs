import {lstat} from 'node:fs/promises';
import path from 'node:path';
import {readDeviceIdentity,initializeDeviceIdentity} from './peer-device-identity.mjs';
import {withPeerStateLock} from './peer-lock.mjs';

async function assertNewDevice(runtime) {
  try {await lstat(path.join(runtime,'private-sync'));}
  catch(error) {if(error.code==='ENOENT')return;throw error;}
  throw Error('Existing pairing requires explicit identity recovery');
}

// Read-only status. Missing identity for existing pairing is not first launch.
export async function deviceIdentitySetupStatus(runtime) {
  try {
    if(await readDeviceIdentity(runtime))return {status:'identity-ready'};
    await assertNewDevice(runtime);
    return {status:'identity-required'};
  } catch {return {status:'identity-recovery-required'};}
}

// Explicit setup only. A saved identity is reused, never replaced. The caller
// must disclose that this is a restricted plaintext file, not an OS key vault.
export async function prepareDeviceIdentity(runtime,{storage,generate,signal}) {
  if(storage!=='restricted-file' || typeof generate!=='function' || signal?.aborted)
    throw Error('Explicit identity storage consent required');
  return withPeerStateLock(runtime,async()=>{
    if(signal?.aborted)throw Error('Identity setup cancelled');
    if(await readDeviceIdentity(runtime))return {status:'identity-ready'};
    await assertNewDevice(runtime);
    const identity=await generate();
    if(signal?.aborted)throw Error('Identity setup cancelled');
    await initializeDeviceIdentity(runtime,identity);
    return {status:'identity-ready'};
  });
}
