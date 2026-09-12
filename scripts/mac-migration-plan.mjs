import {constants,realpathSync} from 'node:fs';
import {lstat,open} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const object=value=>value && typeof value==='object' && !Array.isArray(value);
const absolute=value=>typeof value==='string' && path.isAbsolute(value) && !/[\r\n\0]/.test(value);

// This is a source mapping, not authorization or proof that migration is safe.
// Return only switches and fixed review codes, never private paths or hosts.
export function planLegacyMacSources(config,home=homedir()) {
  if(!object(config) || !absolute(home))throw Error('Invalid legacy source configuration');
  const blockers=[];
  if(!absolute(config.macCodexHome) || path.normalize(config.macCodexHome)!==path.join(home,'.codex'))
    blockers.push('custom-or-missing-mac-codex-home');
  for(const key of ['codexExecutable','receiptDirectory','localModelResults'])
    if(config[key]!==undefined && config[key]!==null && config[key]!=='' && !absolute(config[key]))
      blockers.push(`invalid-${key}`);
  if(config.dictation!==undefined && (!object(config.dictation) ||
    Object.entries(config.dictation).some(([key,value])=>!['mac','windows'].includes(key) || typeof value!=='boolean')))
    blockers.push('invalid-dictation-selection');
  const remoteHosts=['Windows','Ubuntu'];
  for(const key of ['windowsHost','ubuntuHost'])
    if(typeof config[key]!=='string' || !/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(config[key]))blockers.push(`invalid-${key}`);
  const selected=key=>absolute(config[key]);
  return {version:1,status:blockers.length?'unsupported':'review-required',
    sources:{activity:true,codex:true,wispr:config.dictation?.mac===true,
      quota:selected('codexExecutable'),receipts:selected('receiptDirectory'),benchmarks:selected('localModelResults')},
    remoteHosts,blockers,requiredChecks:['confirmed-peer-and-source-scope','saved-history-archive-and-visibility',
      'native-reader-coverage-comparison','collector-lock-and-rollback'],
    coverageChanges:[]};
}

export async function assessMacMigration(runtime,{home=homedir()}={}) {
  if(!absolute(runtime) || realpathSync(runtime)!==runtime)throw Error('Canonical runtime required');
  // An existing native configuration must never be replaced by this plan.
  try {await lstat(path.join(runtime,'collector.config.json'));return {version:1,status:'native-config-present'};}
  catch(error) {if(error.code!=='ENOENT')throw error;}
  const file=path.join(runtime,'local.config.json'),entry=await lstat(file);
  if(!entry.isFile() || entry.isSymbolicLink() || entry.size>65536)throw Error('Invalid legacy configuration file');
  const handle=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try {
    const before=await handle.stat();
    if(before.dev!==entry.dev || before.ino!==entry.ino || before.size!==entry.size)throw Error('Changing legacy configuration');
    const buffer=Buffer.alloc(before.size+1),{bytesRead}=await handle.read(buffer,0,buffer.length,0);
    const after=await handle.stat(),named=await lstat(file);
    if(bytesRead!==before.size || after.size!==before.size || after.mtimeMs!==before.mtimeMs ||
      named.isSymbolicLink() || named.dev!==before.dev || named.ino!==before.ino)throw Error('Changing legacy configuration');
    return planLegacyMacSources(JSON.parse(buffer.subarray(0,bytesRead).toString('utf8')),home);
  } finally {await handle.close();}
}
async function main() {
  const args=process.argv.slice(2);
  if(process.platform!=='darwin' || args.length!==2 || args[0]!=='--runtime')throw Error('Explicit Mac runtime required');
  console.log(JSON.stringify(await assessMacMigration(args[1])));
}
if(process.argv[1] && process.argv[1]!=='-' && realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url)))
  main().catch(()=>{console.error('Migration assessment unavailable. Existing files were not changed.');process.exitCode=1;});
