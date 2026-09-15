import {openSync,fstatSync,readSync,closeSync,lstatSync,realpathSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {authenticateInstallationReceipt} from './signed-receipt.mjs';
import {verifyInstallation} from './verify-installation.mjs';

// This command comes from the trusted installed runtime, never the candidate.
// Public key and previous build are trusted caller configuration, not feed fields.
export function verifyCandidate(staged,envelopePath,trustedPublicKey,previousBuild) {
  if(typeof envelopePath!=='string' || !path.isAbsolute(envelopePath) ||
    path.resolve(envelopePath)!==realpathSync(envelopePath))throw Error('Canonical receipt path required');
  for(let current=envelopePath;;current=path.dirname(current)) {
    if(lstatSync(current).isSymbolicLink())throw Error('Linked receipt path refused');
    if(path.dirname(current)===current)break;
  }
  if(!lstatSync(envelopePath).isFile())throw Error('Regular receipt required');
  const handle=openSync(envelopePath,'r');
  let envelope;
  try {
    const stat=fstatSync(handle);
    if(!stat.isFile() || stat.size<1 || stat.size>8192)throw Error('Invalid receipt file');
    const bytes=Buffer.alloc(8193);
    let length=0,count;
    while(length<bytes.length && (count=readSync(handle,bytes,length,bytes.length-length,null))>0)length+=count;
    if(length>8192)throw Error('Receipt grew beyond size bound');
    envelope=bytes.subarray(0,length);
  } finally { closeSync(handle); }
  const receipt=authenticateInstallationReceipt(envelope,trustedPublicKey,previousBuild);
  const identity=verifyInstallation(staged,receipt);
  return Object.freeze({schema:1,status:'verified',...identity,manifestSha256:receipt.manifestSha256});
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const args=process.argv.slice(2);
    if(args.length!==4 || !/^(0|[1-9][0-9]*)$/.test(args[3]))throw Error('Invalid arguments');
    console.log(JSON.stringify(verifyCandidate(args[0],args[1],args[2],Number(args[3]))));
  } catch {
    console.error('Candidate verification failed. No update was activated.');
    process.exitCode=1;
  }
}
