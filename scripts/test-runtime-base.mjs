import {mkdir,mkdtemp,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// macOS and other non-Windows platforms use the repository folder because the macOS
// private-path check compares every ancestor's metadata before and after.
// Windows keeps the temp folder because CI places it on the account volume and
// the Windows check does not compare timestamps.
export async function testRuntimeBase(name) {
  const runtimeRoot=process.platform==='win32'?tmpdir():fileURLToPath(new URL('../.test-runtime/',import.meta.url));
  if(process.platform!=='win32')await mkdir(runtimeRoot,{recursive:true,mode:0o700});
  return realpath(await mkdtemp(path.join(runtimeRoot,`${name}-`)));
}
