import {mkdir,mkdtemp,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// macOS and other non-Windows platforms use the repository folder because the macOS
// private-path check compares identity, mode, owner, group and flags on every
// ancestor and watches each folder for attribute changes. It compares every
// field, including times, on the private folder. A private folder in the system
// temp folder sits beside unrelated files and other tests. A stable per-file
// folder keeps runtimes apart.
// Windows keeps the temp folder because CI places it on the account volume and
// the Windows check does not compare timestamps.
export async function testRuntimeBase(name) {
  if(typeof name!=='string'||!/^[a-z0-9-]+$/.test(name))throw new Error('Invalid test runtime name');
  const runtimeRoot=process.platform==='win32'?tmpdir():path.join(fileURLToPath(new URL('../.test-runtime/',import.meta.url)),name);
  if(process.platform!=='win32')await mkdir(runtimeRoot,{recursive:true,mode:0o700});
  return realpath(await mkdtemp(path.join(runtimeRoot,process.platform==='win32'?`${name}-`:'run-')));
}
