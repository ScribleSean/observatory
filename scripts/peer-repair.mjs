import {randomBytes} from 'node:crypto';
import {lstat,readdir,open,rename} from 'node:fs/promises';
import {constants,realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {privateSyncDirectory,privateCollectorDirectory} from './peer-directory.mjs';
import {withPeerStateLock} from './peer-lock.mjs';
import {revokePairing} from './peer-revocation.mjs';
import {readRepairConsent,writeRepairConsent} from './peer-repair-consent.mjs';

export async function preparePairingRepair(runtime) {
  return withPeerStateLock(runtime,async()=>{
    let directory;
    try {directory=await privateSyncDirectory(runtime);}
    catch(error) {if(error.code!=='ENOENT')throw error;}
    const previousConsent=await readRepairConsent(runtime);
    if(!directory && previousConsent)return {status:'unpaired'};
    const entries=directory?await readdir(directory):[];
    if(entries.length>9)throw Error('Private state needs manual inspection');
    for(const name of entries) {
      const info=await lstat(path.join(directory,name));
      if(!info.isFile() || info.isSymbolicLink() || info.nlink!==1 || info.size>64*1024*1024 ||
        (process.platform!=='win32' && (info.mode&0o077)))throw Error('Unsafe private recovery entry');
    }
    const retired=(await readdir(runtime)).filter(name=>/^private-sync-retired-[a-f0-9]{64}$/.test(name));
    if(retired.length>=16)throw Error('Retained pairing limit needs manual review');
    const control=await privateCollectorDirectory(runtime,'private-repair');
    try {
      const file=await open(path.join(control,'require-pairing'),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);
      try {await file.writeFile('Retired generations cannot write replacement state.\n');await file.sync();}
      finally {await file.close();}
    } catch(error) {if(error.code!=='EEXIST')throw error;}
    const nonce=randomBytes(32).toString('hex');
    await writeRepairConsent(runtime,nonce);
    if(!directory)return {status:'unpaired'};
    await revokePairing(runtime);
    const name='private-sync-retired-'+nonce;
    const destination=path.join(runtime,name);
    try {await lstat(destination);throw Error('Retired pairing destination already exists');}
    catch(error) {if(error.code!=='ENOENT')throw error;}
    await rename(directory,destination);
    await privateCollectorDirectory(runtime,name);
    if(process.platform!=='win32') {
      const root=await open(runtime,constants.O_RDONLY);
      try {await root.sync();}finally{await root.close();}
    }
    return {status:'prepared'};
  });
}

async function main() {
  const args=process.argv.slice(2);
  if(args.length!==3 || args[0]!=='--runtime' || args[2]!=='--confirm-local-retirement')
    throw Error('Explicit local repair confirmation required');
  const result=await preparePairingRepair(args[1]);
  process.stdout.write(JSON.stringify(result)+'\n');
}
if(process.argv[1] && process.argv[1]!=='-' && realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url)))
  main().catch(()=>{process.stderr.write('Pairing repair could not be verified. Retained state was not deleted. Inspect this installation before retrying.\n');process.exitCode=1;});
