import {execFileSync} from 'node:child_process';
import {readFileSync,realpathSync,lstatSync,openSync,closeSync,unlinkSync,writeFileSync,fsyncSync} from 'node:fs';
import path from 'node:path';
import {replacePayload} from '../windows/replace-payload.mjs';
import {verifyMacPackage} from './inspect-package.mjs';

const signature=folder=>execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',folder],
  {stdio:'pipe',timeout:30000});
const processes=()=>execFileSync('/bin/ps',['-axo','comm='],{encoding:'utf8',timeout:10000});

// Trusted local installer entry point, not a downloaded update endpoint. Receipts
// must be authenticated independently. Never derive them from untrusted input.
// The caller first stages a sibling bundle and requests normal application quit.
// This function never launches a bundle or accesses the collection runtime.
export function replaceMacApp({installed,staged,previousManifest,candidateManifest,
  verifySignature=signature,runningProcesses=processes}) {
  if(process.platform!=='darwin')throw Error('Mac app replacement requires macOS');
  if(typeof verifySignature!=='function' || typeof runningProcesses!=='function')throw Error('Mac verification is required');
  for(const folder of [installed,staged]) {
    if(typeof folder!=='string' || !path.isAbsolute(folder) || path.resolve(folder)!==realpathSync(folder) ||
      !lstatSync(folder).isDirectory() || lstatSync(folder).isSymbolicLink())throw Error('Canonical app directories are required');
  }
  if(path.basename(installed)!=='Workspace Observatory.app' || installed===staged || path.dirname(installed)!==path.dirname(staged))
    throw Error('Stage the candidate beside the installed app');
  for(const receipt of [previousManifest,candidateManifest]) {
    if(receipt?.schema!==1 || receipt.platform!=='macos-arm64' || !Array.isArray(receipt.files))
      throw Error('Independent Mac package receipts are required');
  }
  const assertStopped=()=>{
    const output=runningProcesses();
    if(typeof output!=='string' || output.length>8*1024*1024)throw Error('Cannot verify application shutdown');
    if(output.split('\n').some(line=>line.trim().endsWith('/WorkspaceObservatory')))
      throw Error('Quit all Observatory app copies before replacement');
  };
  assertStopped();
  const lock=path.join(path.dirname(installed),'.observatory-install.lock');
  const handle=openSync(lock,'wx',0o600);
  try {
    const verify=(folder,kind)=>{
      assertStopped();
      const receipt=kind==='previous'?previousManifest:candidateManifest;
      verifyMacPackage(folder,receipt,{allowRelocatedBundle:true});
      verifySignature(folder);
      const info=JSON.parse(readFileSync(path.join(folder,'Contents/Resources/build-info.json'),'utf8'));
      return {sourceRevision:info.sourceRevision,buildNumber:info.buildNumber};
    };
    const prepareRecovery=recovery=>{
      for(const [name,receipt] of [['previous-manifest.json',previousManifest],['candidate-manifest.json',candidateManifest]]) {
        const descriptor=openSync(path.join(recovery,name),'wx',0o600);
        try {
          writeFileSync(descriptor,JSON.stringify(receipt)+'\n');
          fsyncSync(descriptor);
        } finally { closeSync(descriptor); }
      }
    };
    return replacePayload({installed,staged,verify,prepareRecovery});
  } finally {
    closeSync(handle);
    unlinkSync(lock);
  }
}
