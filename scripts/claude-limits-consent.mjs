#!/usr/bin/env node
// Gives or clears Claude Code limits consent without changing Claude Code's
// settings. With consent, each collection runs the usage command.
import {lstat,unlink} from 'node:fs/promises';
import path from 'node:path';
import {CLAUDE_LIMITS_FOLDER,CLAUDE_LIMITS_CONSENT_FILE,claudeLimitsConsent,ensureClaudeLimitsFolder,writeJsonAtomic} from './claude-limits.mjs';

function requireRuntime(runtime) {
  if(typeof runtime!=='string' || !path.isAbsolute(runtime))throw Error('Absolute runtime required');
}

export async function limitsConsentStatus({runtime}) {
  return claudeLimitsConsent(runtime);
}

export async function setLimitsConsent({runtime,consent,now=new Date()}) {
  if(consent!==true)throw Error('Limits need explicit consent');
  requireRuntime(runtime);
  const givenAt=now.toISOString();
  const folder=await ensureClaudeLimitsFolder(runtime);
  await writeJsonAtomic(path.join(folder,CLAUDE_LIMITS_CONSENT_FILE),{consent:true,givenAt});
  return limitsConsentStatus({runtime});
}

export async function clearLimitsConsent({runtime}) {
  requireRuntime(runtime);
  const folder=path.join(runtime,CLAUDE_LIMITS_FOLDER),file=path.join(folder,CLAUDE_LIMITS_CONSENT_FILE);
  try {
    // A linked folder or marker is refused before anything is removed.
    const parent=await lstat(folder);
    if(!parent.isDirectory() || parent.isSymbolicLink())throw Error('Claude limits folder is not a plain folder');
    const info=await lstat(file);
    if(!info.isFile() || info.isSymbolicLink())throw Error('Consent marker is not a plain file');
    await unlink(file);
  } catch(error) {if(error.code!=='ENOENT')throw error;}
  return limitsConsentStatus({runtime});
}

if(process.argv[1] && path.basename(process.argv[1])==='claude-limits-consent.mjs') {
  const [action,...rest]=process.argv.slice(2);
  let runtime=process.env.OBSERVATORY_RUNTIME ?? '',consent=false,valid=true;
  for(let index=0;index<rest.length;index++) {
    if(rest[index]==='--consent')consent=true;
    else if(rest[index]==='--runtime' && rest[index+1] && !rest[index+1].startsWith('--'))runtime=rest[++index];
    else valid=false;
  }
  const run=action==='set'?setLimitsConsent:action==='clear'?clearLimitsConsent:action==='status'?limitsConsentStatus:null;
  if(!valid || !run || !path.isAbsolute(runtime) || (action==='set' && !consent)) {
    console.error('Usage: claude-limits-consent.mjs set|clear|status --runtime <absolute folder> [--consent]');
    process.exitCode=2;
  } else run({runtime,consent}).then(result=>console.log(JSON.stringify(result))).catch(error=>{
    console.error(error.code?'Could not update limits consent':error.message);
    process.exitCode=1;
  });
}
