import {constants} from 'node:fs';
import {lstat,realpath,mkdir,access} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {windowsPowerShellEnvironment} from './windows-powershell.mjs';

const execute=promisify(execFile);
async function windowsPermissions(directory,initialize=false,ancestor=false) {
  const executable=path.join(process.env.SystemRoot || 'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  const script=fileURLToPath(new URL('./private-sync-acl.ps1',import.meta.url));
  for(let attempt=0;attempt<2;attempt++) {
    try {
      const {stdout}=await execute(executable,['-NoProfile','-NonInteractive','-File',script,'-Directory',directory,
        ...(ancestor?['-Ancestor']:[]),...(initialize && attempt===0?['-Initialize']:[])],
      {windowsHide:true,timeout:15000,maxBuffer:4096,env:windowsPowerShellEnvironment()});
      if(stdout.trim()!=='private-sync-acl: ok')throw Error('Invalid verification result');
      return;
    } catch(error) {
      // A transient child can disappear between enumeration and Get-Acl.
      // Retry the entire inspection once, including the root and every child.
      if(attempt===0 && error.code===2)continue;
      throw Error('Private sync access-control verification failed');
    }
  }
}

async function macPermissions(directory,privateLeaf) {
  try {
    // CollectorConfiguration.swift and run-collector.py pass the selected
    // runtime. Direct native JS helpers use Collector/scripts beside Runtime.
    // Never discover a different interpreter from PATH or install a dependency.
    const python=process.env.OBSERVATORY_PYTHON ?? fileURLToPath(new URL('../../Runtime/python/bin/python3',import.meta.url));
    if(typeof python!=='string' || !path.isAbsolute(python) || /[\r\n]/.test(python) || python.includes('\0'))throw Error('Invalid Python runtime');
    await access(python,constants.X_OK);
    const script=fileURLToPath(new URL('./private-path-acl.py',import.meta.url));
    const {stdout}=await execute(python,['-I','-B',script,privateLeaf?'--private':'--ancestor',directory],
      {timeout:15000,maxBuffer:4096});
    if(!/^private-path-acl: ok\n?$/.test(stdout))throw Error('Invalid verification result');
  } catch {throw Error('Private path access-control verification failed');}
}

async function directoryChain(directory) {
  if(typeof directory!=='string' || !path.isAbsolute(directory) || path.resolve(directory)!==await realpath(directory))
    throw Error('Use a canonical private runtime directory');
  const chain=[];
  for(let current=directory;;current=path.dirname(current)) {
    const info=await lstat(current);
    if(!info.isDirectory() || info.isSymbolicLink())throw Error('Invalid runtime directory');
    chain.push({file:current,info});
    if(path.dirname(current)===current)break;
  }
  return chain;
}

async function verifiedDirectory(directory,privateLeaf) {
  const before=await directoryChain(directory),leaf=before[0].info;
  if(privateLeaf && process.platform!=='win32' && (leaf.uid!==process.getuid() || (leaf.mode&0o077)))
    throw Error('Unsafe private sync directory');
  if(process.platform==='win32')await windowsPermissions(directory,false,!privateLeaf);
  else if(process.platform==='darwin')await macPermissions(directory,privateLeaf);
  else throw Error('Native private-directory verification required');
  const after=await directoryChain(directory);
  if(after.length!==before.length || before.some(({file,info},index)=>{
    const current=after[index];
    return current.file!==file || current.info.dev!==info.dev || current.info.ino!==info.ino ||
      current.info.uid!==info.uid || current.info.mode!==info.mode;
  }))throw Error('Private directory ancestry changed during verification');
  return leaf;
}

// These checks exclude replacement by other local accounts, not compromise of
// the process account or OS administrators. Neither validator repairs ACLs.
export const trustedDirectoryAncestry=directory=>verifiedDirectory(directory,false);
export const verifyPrivateDirectory=directory=>verifiedDirectory(directory,true);

export async function privateCollectorDirectory(runtime,name,create=false) {
  if(!['private-sync','private-codex','private-repair','private-quota','private-device-identity'].includes(name) &&
    !/^private-sync-retired-[a-f0-9]{64}$/.test(name))throw Error('Invalid private directory purpose');
  await directoryChain(runtime);
  const directory=path.join(runtime,name);
  let info;
  try {info=await lstat(directory);}catch(error){if(error.code!=='ENOENT' || !create)throw error;}
  if(!info) {
    await trustedDirectoryAncestry(runtime);
    if(process.platform==='win32')await windowsPermissions(directory,true);
    else await mkdir(directory,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  }
  await verifyPrivateDirectory(directory);
  return directory;
}

export const privateSyncDirectory=(runtime,create=false)=>privateCollectorDirectory(runtime,'private-sync',create);
