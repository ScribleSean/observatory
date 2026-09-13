import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {findCodexExecutable} from './collect-quota.mjs';
import {readAccountSnapshot} from './read-quota.mjs';

const execute=promisify(execFile);
const validDistribution=value=>typeof value==='string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);

// WSL is an explicit source choice, never an automatic authentication fallback.
// Discovery reads paths only. The selected Codex client owns its credentials.
export async function findWindowsQuotaClient(distribution=null,{run=execute,findNative=findCodexExecutable,systemRoot=process.env.SystemRoot || 'C:/Windows'}={}) {
  if(distribution===null)return {executable:await findNative(),prefix:[]};
  if(!validDistribution(distribution))throw Error('Invalid quota WSL distribution');
  const executable=path.win32.join(systemRoot,'System32','wsl.exe');
  const prefix=['--distribution',distribution,'--exec'];
  const options={windowsHide:true,timeout:10000,maxBuffer:4096};
  const home=(await run(executable,[...prefix,'/usr/bin/printenv','HOME'],options)).stdout.trim();
  if(!/^\/home\/[A-Za-z0-9_.-]+$/.test(home))throw Error('Unsupported quota WSL home');
  for(const candidate of [home+'/.local/bin/codex','/usr/local/bin/codex','/usr/bin/codex']) {
    try {await run(executable,[...prefix,'/usr/bin/test','-x',candidate],options);}
    catch {continue;}
    // A Linux-side deadline also bounds the child if its Windows wrapper exits.
    return {executable,prefix:[...prefix,'/usr/bin/timeout','--kill-after=2s','20s',candidate]};
  }
  throw Error('Selected WSL Codex client unavailable');
}

export function readWindowsQuotaSnapshot(client,salt,{spawnProcess=spawn,read=readAccountSnapshot,dailyUsageScope=null}={}) {
  return read(client.executable,salt,{dailyUsageScope,spawnProcess:(executable,args,options)=>
    spawnProcess(executable,[...client.prefix,...args],options)});
}
