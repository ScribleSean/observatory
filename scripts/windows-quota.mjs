import {spawn} from 'node:child_process';
import {findCodexExecutable} from './collect-quota.mjs';
import {readAccountSnapshot} from './read-quota.mjs';

// codexPath in the settings file wins over looking for the installed app.
export async function findWindowsQuotaClient({findNative=findCodexExecutable,configured=null}={}) {
  return {executable:configured || await findNative(),prefix:[]};
}

export function readWindowsQuotaSnapshot(client,salt,{spawnProcess=spawn,read=readAccountSnapshot,dailyUsageScope=null}={}) {
  if(!client || !Array.isArray(client.prefix) || client.prefix.length ||
    typeof client.executable!=='string')throw Error('Invalid account client');
  return read(client.executable,salt,{dailyUsageScope,spawnProcess});
}
