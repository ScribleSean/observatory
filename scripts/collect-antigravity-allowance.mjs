import {access,lstat,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import {collectAntigravityAllowance} from './antigravity-allowance.mjs';

// Resolve only the installed CLI name. PATH entries are paths, never commands.
export async function findAntigravityExecutable({platform=process.platform,home=homedir(),searchPath=process.env.PATH || ''}={}) {
  if(platform!=='darwin' || !path.isAbsolute(home) || typeof searchPath!=='string' || searchPath.length>16384)return null;
  const directories=[path.join(home,'.local/bin'),'/opt/homebrew/bin','/usr/local/bin',...searchPath.split(':')]
    .filter(directory=>path.isAbsolute(directory) && directory.length<=4096 && !['\0','\r','\n'].some(c=>directory.includes(c)));
  for(const directory of [...new Set(directories)].slice(0,32)) {
    try {
      const file=await realpath(path.join(directory,'agy'));
      if(!(await lstat(file)).isFile())continue;
      await access(file,constants.X_OK);
      return file;
    } catch {}
  }
  return null;
}

export async function collectConfiguredAntigravityAllowance({enabled=false,host,isEnabled=async()=>enabled,
  resolveExecutable=findAntigravityExecutable,read=collectAntigravityAllowance,clock=Date.now}={}) {
  if(typeof enabled!=='boolean' || !['Mac','Windows'].includes(host))throw Error('Invalid Antigravity source configuration');
  const status=value=>({provider:'antigravity',host,status:value,checkedAt:new Date(clock()).toISOString(),
    scope:'Provider-reported allowance',windows:[]});
  if(!enabled)return status('not-connected');
  let source;
  try {
    if(await isEnabled()!==true)return status('not-connected');
    if(host==='Windows')return status('unsupported');
    const executable=await resolveExecutable();
    if(await isEnabled()!==true)return status('not-connected');
    source=executable?await read({executable,host,checkedAt:new Date(clock()).toISOString()}):status('unavailable');
  } catch {source=status('unavailable');}
  // A switch turned off during this read must not publish a new observation.
  try {if(await isEnabled()!==true)return status('not-connected');}
  catch {return status('unavailable');}
  return source;
}

// Attach after all core, account and workflow merging. This owner-local source
// never enters Codex quota history, token totals, or a peer payload.
export function attachProviderAllowances(result,sources) {
  if(!result?.data || !result?.status || !Array.isArray(sources))throw Error('Invalid provider allowance attachment');
  result.data.providerAllowances=sources;
  const configured=sources.filter(source=>source.status!=='not-connected');
  result.status.sourcesConfigured+=configured.length;
  result.status.sourcesRead+=configured.filter(source=>source.status==='ok').length;
  result.status.state=result.status.sourcesConfigured>0 && result.status.sourcesConfigured===result.status.sourcesRead?'ok':'partial';
  return result;
}
