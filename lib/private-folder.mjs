import {lstat,mkdir} from 'node:fs/promises';
import path from 'node:path';

export function assertPrivateOwner(info,target,platform=process.platform) {
  if(platform==='win32' || typeof process.getuid!=='function')return;
  if(info.uid!==process.getuid())throw Error(`Unsafe ${target}: not owned by the current user. Fix with: chown "$USER" "${target}"`);
  if((info.mode & 0o077)!==0)throw Error(`Unsafe ${target}: group or others have access. Fix with: chmod ${info.isDirectory()?'700':'600'} "${target}"`);
}

export async function privateFolder(dataFolder,...parts) {
  const folder=path.join(dataFolder,...parts);
  await mkdir(folder,{recursive:true,mode:0o700});
  const info=await lstat(folder);
  if(!info.isDirectory() || info.isSymbolicLink())throw Error(`Unsafe folder ${folder}`);
  assertPrivateOwner(info,folder);
  return folder;
}
