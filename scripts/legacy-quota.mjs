import {lstat,readFile} from 'node:fs/promises';
import path from 'node:path';
import {collectQuota} from './collect-quota.mjs';

async function selection(runtime) {
  const file=path.join(runtime,'local.config.json');
  const stat=await lstat(file);
  if(!stat.isFile() || stat.isSymbolicLink() || stat.size>65536)throw Error('Invalid legacy source configuration');
  const config=JSON.parse(await readFile(file,'utf8'));
  if(!config || typeof config!=='object' || Array.isArray(config))throw Error('Invalid legacy source configuration');
  const executable=config.codexExecutable;
  if(executable===undefined || executable===null || executable==='')return null;
  if(typeof executable!=='string' || !path.isAbsolute(executable) || /[\r\n\0]/.test(executable))
    throw Error('Invalid configured account client');
  return executable;
}

// Preserve the legacy installation's explicit client choice. No discovery,
// account fallback, new source opt-in or credential copying during migration.
export async function collectLegacyQuota(runtime,{clock,readSnapshot,isEnabled=async()=>true}={}) {
  const executable=await selection(runtime);
  return collectQuota(runtime,{
    enabled:executable!==null,
    resolveExecutable:async()=>executable,
    isEnabled:async()=>await isEnabled()===true && await selection(runtime)===executable,
    ...(clock?{clock}:{}),...(readSnapshot?{readSnapshot}:{})
  });
}

// Native migration keeps the explicitly selected legacy client. Only a fresh
// installation without legacy configuration may discover an installed client.
export async function collectConfiguredMacQuota(runtime,{enabled=false,...options}={}) {
  if(typeof enabled!=='boolean')throw Error('Explicit quota setting required');
  if(!enabled)return collectQuota(runtime,{...options,enabled:false});
  try {await lstat(path.join(runtime,'local.config.json'));}
  catch(error) {
    if(error.code!=='ENOENT')throw error;
    return collectQuota(runtime,{...options,enabled:true});
  }
  return collectLegacyQuota(runtime,options);
}
