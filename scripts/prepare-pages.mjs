import './check-demo-build.mjs';
import {mkdir,cp,readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const source=path.resolve('dist/client'),target=path.resolve('dist/pages');
// GitHub Pages supplies the repository URL prefix. Strip only that disk prefix.
await mkdir(target);
for(const name of ['index.html','index.rsc','404.html','favicon.svg','local']) {
  await cp(path.join(source,name),path.join(target,name),{recursive:true,errorOnExist:true,force:false});
}
await cp(path.join(source,'observatory/_next'),path.join(target,'_next'),{recursive:true,errorOnExist:true,force:false});
const html=await readFile(path.join(target,'index.html'),'utf8');
assert.ok(!html.includes('src="[object Object]"'),'Image imports must resolve to URL strings');
for(const match of html.matchAll(/(?:src|href)="(\/observatory\/[^"?#]+)"/g)) {
  assert.ok((await stat(path.join(target,match[1].slice('/observatory/'.length)))).isFile());
}
console.log('GitHub Pages package includes only verified synthetic data and required static assets.');
