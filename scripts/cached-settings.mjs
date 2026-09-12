import {readFile} from 'node:fs/promises';
import {privateCollectorDirectory} from './peer-directory.mjs';

// Use the same bounded, sanitized cache as the standalone Mac collector.
// Only the local reader receives the private directory, never a remote host.
export async function cachedSettingsScript(runtime, script) {
  const cache=await privateCollectorDirectory(runtime,'private-codex',true);
  const implementation=await readFile(new URL('./read-settings-cache.py',import.meta.url),'utf8');
  return `CACHE_DIRECTORY = ${JSON.stringify(cache)}\n`+implementation+'\n'+script;
}
