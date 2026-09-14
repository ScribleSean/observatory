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

// Read-only recovery assessment. Caller supplies trusted paths and a verifier
// bound to the previous and candidate receipts. Journal text is not authority.
export function inspectPayloadRecovery({installed,staged,recovery,verify}) {
  if(typeof verify!=='function')throw Error('Payload verification is required');
  for(const value of [installed,staged,recovery]) {
    if(typeof value!=='string' || !path.isAbsolute(value) || path.resolve(value)!==value)
      throw Error('Canonical recovery paths are required');
  }
  const parent=path.dirname(installed);
  unlinkedDirectory(parent);
  unlinkedDirectory(recovery);
  if(installed===staged || installed===recovery || staged===recovery ||
    path.dirname(staged)!==parent || path.dirname(recovery)!==parent ||
    !path.basename(recovery).startsWith('.observatory-update-'))throw Error('Invalid recovery layout');
  const assess=folder=>{
    try { lstatSync(folder); } catch(error) { if(error.code==='ENOENT')return 'missing'; throw error; }
    unlinkedDirectory(folder);
    const matched=[];
    for(const kind of ['previous','candidate']) {
      try {
        const identity=verify(folder,kind);
        if(identity && /^[a-f0-9]{40}$/.test(identity.sourceRevision) &&
          Number.isSafeInteger(identity.buildNumber) && identity.buildNumber>0)matched.push(kind);
      } catch {}
    }
    return matched.length===1?matched[0]:'unverified';
  };
  const payloads={installed:assess(installed),staged:assess(staged),
    previous:assess(path.join(recovery,'previous')),rejected:assess(path.join(recovery,'rejected'))};
  let state='manual-inspection';
  if(payloads.installed==='candidate' && payloads.previous==='previous' &&
    payloads.staged==='missing' && payloads.rejected==='missing')state='candidate-active';
  else if(payloads.installed==='missing' && payloads.previous==='previous' &&
    payloads.staged==='candidate' && payloads.rejected==='missing')state='previous-awaiting-restore';
  else if(payloads.installed==='previous' && payloads.previous==='missing' &&
    ((payloads.staged==='candidate' && payloads.rejected==='missing') ||
     (payloads.staged==='missing' && payloads.rejected==='candidate')))state='previous-active';
  return {state,payloads};
}

// Caller must hold the installer and collector locks and keep the app stopped.
// Restore only the unambiguous gap before candidate promotion. No files are deleted.
export function restoreInterruptedPayload(options) {
  const {installed,recovery,verify}=options;
  if(inspectPayloadRecovery(options).state!=='previous-awaiting-restore')
    throw Error('Interrupted payload requires manual inspection');
  const previous=path.join(recovery,'previous');
  const expected=verify(previous,'previous');
  // Refuse even an empty obstruction. The caller must exclude concurrent writers.
  let absent=false;
  try { lstatSync(installed); } catch(error) { if(error.code==='ENOENT')absent=true; else throw error; }
  if(!absent)throw Error('Installed path appeared during recovery');
  renameSync(previous,installed);
  try {
    const restored=verify(installed,'previous');
    if(restored.sourceRevision!==expected.sourceRevision || restored.buildNumber!==expected.buildNumber)
      throw Error('Restored payload identity changed');
    return {state:'previous-restored',installed,recovery,sourceRevision:restored.sourceRevision};
  } catch(error) {
    // Leave the relocated bytes in place for inspection, never delete or retry them.
    throw Object.assign(new Error('Restored payload verification failed. Manual inspection required.',{cause:error}),
      {installed,recovery});
  }
}

// The updater must run outside the directory being replaced. Before calling,
// hold the installer and collector locks, stop the app, authenticate the staged
// release and capture registration. This primitive changes only payload paths.
// verify must synchronously check full inventories, revisions and ownership.
export function replacePayload({installed,staged,verify,prepareRecovery=()=>{}}) {
  if(typeof verify!=='function')throw Error('Payload verification is required');
  if(typeof prepareRecovery!=='function')throw Error('Recovery preparation must be a function');
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
    // Retain caller-authenticated evidence before moving either payload.
    // Preparation must be synchronous and must throw if persistence fails.
    const preparation=prepareRecovery(recovery);
    if(preparation && typeof preparation.then==='function')throw Error('Recovery preparation must be synchronous');
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
      unlinkedDirectory(installed);
      const restoredIdentity=verify(installed,'previous');
      if(restoredIdentity?.sourceRevision!==oldIdentity.sourceRevision || restoredIdentity?.buildNumber!==oldIdentity.buildNumber)
        throw Error('Restored payload identity changed');
      restored=true;
      record('previous-restored');
    } catch {
      try {record('recovery-required');}catch{}
    }
    throw Object.assign(new Error(restored?'Payload replacement failed. Previous payload restored.':
      'Payload replacement failed. Recovery inspection required.',{cause:error}),{recovery,restored});
  } finally {closeSync(handle);}
}
