import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,symlink,link,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {readDeviceName,attachDeviceName} from './device-name.mjs';

async function fixture(t) {
  const runtime=await mkdtemp(path.join(tmpdir(),'device-name-'));
  t.after(()=>rm(runtime,{recursive:true,force:true}));return runtime;
}
test('device names accept trimmed Unicode whitespace and count UTF-16 units',async t=>{
  const runtime=await fixture(t);
  for(const name of ['Desk','x'.repeat(32),'😀'.repeat(16)]) {
    await writeFile(path.join(runtime,'device.json'),JSON.stringify({name:'\u0085\u00a0\u2028\u2029\u3000'+name+'\u0085\u00a0\u2028\u2029\u3000'}));
    assert.equal(await readDeviceName(runtime),name);
  }
});
test('missing and invalid device names are refused',async t=>{
  const runtime=await fixture(t);
  assert.equal(await readDeviceName(runtime),null);
  for(const name of ['\uFEFFDesk','', '\u0085\u00a0\u2028\u2029\u3000','x'.repeat(33),'😀'.repeat(32),'a\nb','a\u2028b','a\u2029b','a\u200bb','a\ud800b','a\udc00b','a/b','a\\b','a:b',42]) {
    await writeFile(path.join(runtime,'device.json'),JSON.stringify({name}));
    assert.equal(await readDeviceName(runtime),null);
  }
  for(const text of [' '.repeat(1025),'bad','null','[]','"Desk"','{}','{"name":"Desk","extra":true}']) {
    await writeFile(path.join(runtime,'device.json'),text);assert.equal(await readDeviceName(runtime),null);
  }
});
test('non-regular device files are refused',async t=>{
  const runtime=await fixture(t);await mkdir(path.join(runtime,'device.json'));
  assert.equal(await readDeviceName(runtime),null);
});
test('linked device files are refused',{skip:process.platform==='win32'},async t=>{
  const runtime=await fixture(t);await writeFile(path.join(runtime,'target.json'),'{"name":"Desk"}');
  await symlink(path.join(runtime,'target.json'),path.join(runtime,'device.json'));
  assert.equal(await readDeviceName(runtime),null);
});
test('hard-linked device files are refused',async t=>{
  const runtime=await fixture(t);await writeFile(path.join(runtime,'target.json'),'{"name":"Desk"}');
  await link(path.join(runtime,'target.json'),path.join(runtime,'device.json'));
  assert.equal(await readDeviceName(runtime),null);
});
test('attachment keeps only a valid own-host key or leaves names absent',()=>{
  const data={deviceNames:{Windows:'Old'}};
  for(const host of ['Mac','Windows']) {attachDeviceName(data,host,'Desk');assert.deepEqual(data.deviceNames,{[host]:'Desk'});}
  for(const [host,name] of [['Mac',null],['Other','Desk']]) {attachDeviceName(data,host,name);assert.equal(Object.hasOwn(data,'deviceNames'),false);}
});
