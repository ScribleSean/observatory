import {lstatSync,realpathSync,mkdtempSync,renameSync,openSync,writeSync,fsyncSync,closeSync} from 'node:fs';
import path from 'node:path';

function unlinkedDirectory(value) {
  if(typeof value!=='string' || !path.isAbsolute(value) || path.resolve(value)!==realpathSync(value))
    throw Error('Canonical payload directories are required');
  for(let current=value;;current=path.dirname(current)) {
    const stat=lstatSync(current);
    if(!stat.isDirectory() || stat.isSymbolicLink())throw Error('Linked payload directory refused');
    if(path.dirname(current)===current)break;
  }
}

// The updater must run outside the directory being replaced. Before calling,
// hold the installer and collector locks, stop the app, authenticate the staged
// release and capture registration. This primitive changes only payload paths.
// verify must synchronously check full inventories, revisions and ownership.
export function replacePayload({installed,staged,verify}) {
  if(typeof verify!=='function')throw Error('Payload verification is required');
  unlinkedDirectory(installed);
  unlinkedDirectory(staged);
  if(installed===staged || path.dirname(installed)!==path.dirname(staged))
    throw Error('Distinct sibling payload directories are required');
  const oldIdentity=verify(installed,'previous');
  const newIdentity=verify(staged,'candidate');
  for(const identity of [oldIdentity,newIdentity]) {
    if(!identity || !/^[a-f0-9]{40}$/.test(identity.sourceRevision) ||
      !Number.isSafeInteger(identity.buildNumber) || identity.buildNumber<1)
      throw Error('Verified payload identity is required');
  }
  if(newIdentity.buildNumber<=oldIdentity.buildNumber)throw Error('Payload build must advance');
  const recovery=mkdtempSync(path.join(path.dirname(installed),'.observatory-update-'));
  const previous=path.join(recovery,'previous');
  const rejected=path.join(recovery,'rejected');
  const journal=path.join(recovery,'transaction.jsonl');
  const handle=openSync(journal,'wx',0o600);
  const record=state=>{
    writeSync(handle,JSON.stringify({state,installed,staged,previous,rejected,
      oldRevision:oldIdentity.sourceRevision,newRevision:newIdentity.sourceRevision})+'\n');
    fsyncSync(handle);
  };
  let movedOld=false,movedNew=false;
  try {
    record('prepared');
    renameSync(installed,previous);
    movedOld=true;
    record('previous-retained');
    renameSync(staged,installed);
    movedNew=true;
    record('candidate-promoted');
    const activated=verify(installed,'candidate');
    if(activated.sourceRevision!==newIdentity.sourceRevision || activated.buildNumber!==newIdentity.buildNumber)
      throw Error('Promoted payload identity changed');
    record('payload-verified');
    return {installed,recovery,previous,journal,sourceRevision:newIdentity.sourceRevision};
  } catch(error) {
    // Never remove a payload, overwrite a backup or retry an uncertain move.
    // An interrupted process leaves the journal and directories for inspection.
    let restored=false;
    try {
      if(movedNew)renameSync(installed,rejected);
      if(movedOld)renameSync(previous,installed);
      restored=true;
      record('previous-restored');
    } catch {
      try {record('recovery-required');}catch{}
    }
    throw Object.assign(new Error(restored?'Payload replacement failed. Previous payload restored.':
      'Payload replacement failed. Recovery inspection required.',{cause:error}),{recovery,restored});
  } finally {closeSync(handle);}
}
