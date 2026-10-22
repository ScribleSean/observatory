import {mkdir,mkdtemp,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Windows keeps the temp folder because CI places it on the account volume
export async function testRuntimeBase(name) {
  if(typeof name!=='string'||!/^[a-z0-9-]+$/.test(name))throw new Error('Invalid test runtime name');
  const runtimeRoot=process.platform==='win32'?tmpdir():path.join(fileURLToPath(new URL('../.test-runtime/',import.meta.url)),name);
  if(process.platform!=='win32')await mkdir(runtimeRoot,{recursive:true,mode:0o700});
  return realpath(await mkdtemp(path.join(runtimeRoot,process.platform==='win32'?`${name}-`:'run-')));
}
