import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {packageRoot,licenseText} from '../native/web-licenses.mjs';

test('bundled package attribution handles Windows, nested packages and virtual module wrappers',()=>{
  assert.equal(packageRoot('C:\\build\\node_modules\\react\\index.js'),'C:/build/node_modules/react');
  assert.equal(packageRoot('\0C:/build/node_modules/outer/node_modules/@scope/pkg/index.js?commonjs'),'C:/build/node_modules/outer/node_modules/@scope/pkg');
  assert.equal(packageRoot('/build/app/viewer/dashboard.tsx'),null);
});
test('notices include license text without leaking build-machine paths',()=>{
  const temp=mkdtempSync(path.join(tmpdir(),'observatory-license-test-'));
  try {
    const root=path.join(temp,'PRIVATE-BUILD-PATH');mkdirSync(root);
    writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'synthetic',version:'1.0.0',license:'MIT'}));
    assert.throws(()=>licenseText([root]),/No license text/);
    writeFileSync(path.join(root,'LICENSE'),'Synthetic permission notice.');
    const text=licenseText([root]);
    assert.match(text,/synthetic@1.0.0/);assert.match(text,/Synthetic permission notice/);
    assert.ok(!text.includes('PRIVATE-BUILD-PATH'));
  } finally {rmSync(temp,{recursive:true,force:true});}
});
