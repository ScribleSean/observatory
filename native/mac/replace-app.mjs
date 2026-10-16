import {appNames} from '../app-names.mjs';
import {execFileSync} from 'node:child_process';
import {readFileSync,realpathSync,lstatSync,openSync,closeSync,unlinkSync,writeFileSync,fsyncSync,mkdtempSync,renameSync} from 'node:fs';
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
  const renameMode=path.basename(installed)===appNames.legacy.macBundle;
  const target=path.join(path.dirname(installed),appNames.visible.macBundle);
  const assertTargetMissing=()=>{
    try {lstatSync(target);}catch(error){if(error.code==='ENOENT')return;throw error;}
    throw Error('The new app bundle already exists.');
  };
  if(renameMode)assertTargetMissing();
  if((!renameMode && path.basename(installed)!==appNames.visible.macBundle) || installed===staged || path.dirname(installed)!==path.dirname(staged))
    throw Error('Stage the candidate beside the installed app');
  for(const receipt of [previousManifest,candidateManifest]) {
    if(receipt?.schema!==1 || receipt.platform!=='macos-arm64' || !Array.isArray(receipt.files))
      throw Error('Independent Mac package receipts are required');
  }
  const assertStopped=()=>{
    const output=runningProcesses();
    if(typeof output!=='string' || output.length>8*1024*1024)throw Error('Cannot verify application shutdown');
    if(output.split('\n').some(line=>line.trim().endsWith(`/${appNames.internal.macExecutable}`)))
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
    if(renameMode) {
      const previousIdentity=verify(installed,'previous'),candidateIdentity=verify(staged,'candidate');
      for(const identity of [previousIdentity,candidateIdentity]) {
        if(!/^[a-f0-9]{40}$/.test(identity.sourceRevision) || !Number.isSafeInteger(identity.buildNumber) || identity.buildNumber<1)
          throw Error('Verified payload identity is required');
      }
      if(candidateIdentity.buildNumber<=previousIdentity.buildNumber)throw Error('Payload build must advance');
      assertStopped();assertTargetMissing();
      const recovery=mkdtempSync(path.join(path.dirname(installed),'.observatory-update-'));
      prepareRecovery(recovery);
      const previous=path.join(recovery,'previous');
      const journal=openSync(path.join(recovery,'transaction.jsonl'),'wx',0o600);
      const record=state=>{writeFileSync(journal,JSON.stringify({state})+'\n');fsyncSync(journal);};
      let retained=false,promoted=false;
      try {
        record('prepared');
        renameSync(installed,previous);retained=true;
        record('previous-retained');
        assertTargetMissing();
        renameSync(staged,target);promoted=true;
        record('candidate-promoted');
        const activated=verify(target,'candidate');
        if(activated.sourceRevision!==candidateIdentity.sourceRevision || activated.buildNumber!==candidateIdentity.buildNumber)
          throw Error('Promoted payload identity changed');
        record('payload-verified');
        return {state:'renamed',installed:target,recovery,sourceRevision:candidateIdentity.sourceRevision};
      } catch(error) {
        try {
          if(retained && !promoted) {renameSync(previous,installed);record('previous-restored');}
          else record('recovery-required');
        } catch(rollbackError) {
          error.rollbackError=rollbackError;
          try{record('recovery-required');}catch{}
        }
        error.recovery=recovery;
        throw error;
      } finally {closeSync(journal);}
    }
    return replacePayload({installed,staged,verify,prepareRecovery});
  } finally {
    closeSync(handle);
    unlinkSync(lock);
  }
}
