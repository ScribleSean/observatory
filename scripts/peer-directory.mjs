import {lstat,realpath,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {windowsPowerShellEnvironment} from './windows-powershell.mjs';

const execute=promisify(execFile);
async function windowsPermissions(directory,initialize=false) {
  const executable=path.join(process.env.SystemRoot || 'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  const script=fileURLToPath(new URL('./private-sync-acl.ps1',import.meta.url));
  try {
    const {stdout}=await execute(executable,['-NoProfile','-NonInteractive','-File',script,'-Directory',directory,
      ...(initialize?['-Initialize']:[])],{windowsHide:true,timeout:15000,maxBuffer:4096,env:windowsPowerShellEnvironment()});
    if(stdout.trim()!=='private-sync-acl: ok')throw Error('Invalid verification result');
  } catch {throw Error('Private sync access-control verification failed');}
}

export async function privateCollectorDirectory(runtime,name,create=false) {
  if(!['private-sync','private-codex','private-repair','private-quota','private-device-identity'].includes(name) &&
    !/^private-sync-retired-[a-f0-9]{64}$/.test(name))throw Error('Invalid private directory purpose');
  if(typeof runtime!=='string' || !path.isAbsolute(runtime) || path.resolve(runtime)!==await realpath(runtime))
    throw Error('Use a canonical private runtime directory');
  const root=await lstat(runtime);
  if(!root.isDirectory() || root.isSymbolicLink())throw Error('Invalid runtime directory');
  const directory=path.join(runtime,name);
  let info;
  try {info=await lstat(directory);}catch(error){if(error.code!=='ENOENT' || !create)throw error;}
  if(!info) {
    if(process.platform==='win32')await windowsPermissions(directory,true);
    else await mkdir(directory,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
    info=await lstat(directory);
  }
  if(!info.isDirectory() || info.isSymbolicLink() || (process.platform!=='win32' && (info.mode&0o077)))
    throw Error('Unsafe private sync directory');
  if(process.platform==='win32')await windowsPermissions(directory);
  return directory;
}

export const privateSyncDirectory=(runtime,create=false)=>privateCollectorDirectory(runtime,'private-sync',create);
