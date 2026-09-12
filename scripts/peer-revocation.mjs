import {lstat,open} from 'node:fs/promises';
import {constants,realpathSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {privateSyncDirectory} from './peer-directory.mjs';
import {withPeerStateLock} from './peer-lock.mjs';
import {revokeQuotaSharing} from './quota-store.mjs';

const marker='revoked';

// Any entry at this name disables pairing, including an incomplete write or
// an unsafe entry. Never follow it and never silently remove it to reconnect.
export async function assertPeerNotRevoked(directory) {
  try {await lstat(path.join(directory,marker));}
  catch(error) {if(error.code==='ENOENT')return;throw error;}
  throw Error('Private pairing revoked');
}

export async function assertPairingActive(runtime) {
  await assertPeerNotRevoked(await privateSyncDirectory(runtime));
}

// Local disable only. Stop collectors/exchanges on both devices first when an
// immediate cutoff is needed. Bytes already sent cannot be recalled.
export const revokePairing=runtime=>withPeerStateLock(runtime,()=>revokePairingLocked(runtime));
async function revokePairingLocked(runtime) {
  const directory=await privateSyncDirectory(runtime,true);
  const name=path.join(directory,marker);
  let file;
  try {file=await open(name,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);}
  catch(error) {
    if(error.code!=='EEXIST')throw error;
    const info=await lstat(name);
    if(!info.isFile() || info.isSymbolicLink() || info.nlink!==1 ||
      (process.platform!=='win32' && (info.mode&0o077)))throw Error('Unsafe revocation marker');
  }
  if(file) {
    try {await file.writeFile('Private pairing disabled locally.\n');await file.sync();}
    finally {await file.close();}
  }
  await privateSyncDirectory(runtime);
  if(process.platform!=='win32') {
    const parent=await open(directory,constants.O_RDONLY);
    try {await parent.sync();}finally{await parent.close();}
  }
  // Write the pairing fence first. If quota storage needs repair, transfers
  // remain disabled and the caller reports incomplete cleanup, not success.
  await revokeQuotaSharing(runtime);
  return {status:'revoked'};
}

if(process.argv[1] && process.argv[1]!=='-' && realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))) {
  const args=process.argv.slice(2);
  if(args.length!==3 || args[0]!=='--runtime' || args[2]!=='--revoke') {
    process.stderr.write('Usage: node peer-revocation.mjs --runtime ABSOLUTE_RUNTIME --revoke\n');
    process.exitCode=1;
  } else revokePairing(args[1]).then(()=>{
    process.stdout.write('Private pairing disabled locally. Cached data retained. In-flight exchanges may complete. Revoke the other device separately.\n');
  }).catch(()=>{process.stderr.write('Private pairing revocation could not be verified\n');process.exitCode=1;});
}
