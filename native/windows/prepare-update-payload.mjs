import {mkdirSync,cpSync,writeFileSync,lstatSync,realpathSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readReceiptFile} from './verify-candidate.mjs';
import {authenticateInstallationReceipt} from './signed-receipt.mjs';
import {verifyInstallation} from './verify-installation.mjs';

// Release preparation only. The caller supplies a separately trusted public key
// and excludes concurrent writers. No signer, installer or candidate is executed.
export function prepareUpdatePayload(installed,envelopePath,publicKey,previousBuild,output) {
  const envelope=readReceiptFile(envelopePath);
  const receipt=authenticateInstallationReceipt(envelope,publicKey,previousBuild);
  const identity=verifyInstallation(installed,receipt);
  if(typeof output!=='string' || !path.isAbsolute(output) || path.resolve(output)!==output)
    throw Error('Canonical new output directory required');
  const parent=path.dirname(output);
  if(realpathSync(parent)!==parent)throw Error('Canonical output parent required');
  for(let current=parent;;current=path.dirname(current)) {
    const stat=lstatSync(current);
    if(!stat.isDirectory() || stat.isSymbolicLink())throw Error('Unlinked output parent required');
    if(path.dirname(current)===current)break;
  }
  const relative=path.relative(installed,output);
  if(relative==='' || (!path.isAbsolute(relative) && relative!=='..' && !relative.startsWith('..'+path.sep)))
    throw Error('Update output must be outside the installation');
  mkdirSync(output,{mode:0o700});
  try {
    const payload=path.join(output,'payload');
    cpSync(installed,payload,{recursive:true,dereference:false,force:false,errorOnExist:true});
    verifyInstallation(payload,receipt);
    writeFileSync(path.join(output,'installation-envelope.json'),envelope,{flag:'wx',mode:0o600});
    return Object.freeze({prepared:'verified-update-directory',output,...identity});
  } catch(error) {
    throw Object.assign(new Error('Update preparation failed. Output retained for inspection.',{cause:error}),{output});
  }
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const args=process.argv.slice(2);
    if(args.length!==5 || !/^(0|[1-9][0-9]*)$/.test(args[3]))throw Error('Invalid arguments');
    console.log(JSON.stringify(prepareUpdatePayload(args[0],args[1],args[2],Number(args[3]),args[4])));
  } catch {
    console.error('Update payload preparation failed. Nothing installed or published.');
    process.exitCode=1;
  }
}
