import {mkdir,mkdtemp,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// macOS and other non-Windows platforms use the repository folder because the macOS
// private-path check compares every ancestor's metadata before and after.
// Each test file has its own stable folder so other test files starting or
// finishing do not change the ancestors of its runtimes.
// Windows keeps the temp folder because CI places it on the account volume and
// the Windows check does not compare timestamps.
export async function testRuntimeBase(name) {
  if(typeof name!=='string'||!/^[a-z0-9-]+$/.test(name))throw new Error('Invalid test runtime name');
  const runtimeRoot=process.platform==='win32'?tmpdir():path.join(fileURLToPath(new URL('../.test-runtime/',import.meta.url)),name);
  if(process.platform!=='win32')await mkdir(runtimeRoot,{recursive:true,mode:0o700});
  return realpath(await mkdtemp(path.join(runtimeRoot,process.platform==='win32'?`${name}-`:'run-')));
}
