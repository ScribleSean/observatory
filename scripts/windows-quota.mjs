import {spawn} from 'node:child_process';
import path from 'node:path';
import {findCodexExecutable} from './collect-quota.mjs';
import {readAccountSnapshot} from './read-quota.mjs';

// Keep the legacy argument to fail closed, never switch an existing account to
// native Windows merely because its selected WSL client has been retired.
export async function findWindowsQuotaClient(distribution=null,{findNative=findCodexExecutable}={}) {
  if(distribution!==null)throw Error('WSL account source retired. Select native Windows explicitly.');
  return {executable:await findNative(),prefix:[]};
}

export function readWindowsQuotaSnapshot(client,salt,{spawnProcess=spawn,read=readAccountSnapshot,dailyUsageScope=null}={}) {
  if(!client || !Array.isArray(client.prefix) || client.prefix.length ||
    typeof client.executable!=='string' || /^wsl(?:\.exe)?$/i.test(path.win32.basename(client.executable)))
    throw Error('WSL account source retired');
  return read(client.executable,salt,{dailyUsageScope,spawnProcess});
}
