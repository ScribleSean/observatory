import {readFile,readdir,lstat} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {demoData} from './demo.mjs';
const root=path.resolve('dist/client');
assert.ok((await readFile(path.join(root,'index.html'),'utf8')).includes('Observatory'),'Rendered entry page required');
assert.deepEqual(JSON.parse(await readFile(path.join(root,'local/usage.json'),'utf8')),demoData());
assert.deepEqual(await readdir(path.join(root,'local')),['usage.json']);
async function check(dir) {
  for(const name of await readdir(dir)) {
    const file=path.join(dir,name),s=await lstat(file);
    assert.ok(!s.isSymbolicLink(),'No symlinks in demo output');
    assert.ok(!['local.config.json','.env','.git','.codex'].includes(name),'Private file excluded');
    if(s.isDirectory()) await check(file);
  }
}
await check(root);
console.log('Synthetic-only output verified against deterministic fixture.');
