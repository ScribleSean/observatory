import {lstat,mkdir} from 'node:fs/promises';
import path from 'node:path';

// A plain folder inside the data folder. Normal home-folder permissions protect it.
export async function privateFolder(dataFolder,...parts) {
  const folder=path.join(dataFolder,...parts);
  await mkdir(folder,{recursive:true,mode:0o700});
  const info=await lstat(folder);
  if(!info.isDirectory() || info.isSymbolicLink())throw Error(`Unsafe folder ${folder}`);
  return folder;
}
