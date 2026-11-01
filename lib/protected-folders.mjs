import path from 'node:path';
import {homedir} from 'node:os';

// Folders macOS guards with a privacy prompt ("would like to access files in your
// Documents folder"). Observatory never needs them, so it never looks inside them.
export const PROTECTED_IN_HOME=Object.freeze(['Documents','Desktop','Downloads','Pictures','Movies','Music',
  'Library/Mobile Documents','Library/CloudStorage']);

export function isProtectedFolder(folder,home=homedir(),platform=process.platform) {
  // Only macOS guards these folders. Elsewhere a repository in Documents is named as usual.
  if(platform!=='darwin' || typeof folder!=='string' || !path.posix.isAbsolute(folder))return false;
  const resolved=path.posix.resolve(folder).toLowerCase();
  const inside=root=>resolved===root || resolved.startsWith(root.endsWith('/')?root:root+'/');
  if(inside('/volumes'))return true;
  if(typeof home!=='string' || !home)return false;
  const base=path.posix.resolve(home).toLowerCase();
  return PROTECTED_IN_HOME.some(name=>inside(path.posix.join(base,name.toLowerCase())));
}
