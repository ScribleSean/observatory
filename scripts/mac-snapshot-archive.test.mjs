import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,writeFile,readFile,mkdir,lstat,symlink,readdir,rm,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {archiveMacSnapshot} from './mac-snapshot-archive.mjs';
const options={skip:process.platform!=='darwin'};
async function fixture(t) {
  const root=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-snapshot-archive-')));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const archive=path.join(root,'archives'),file=path.join(root,'usage.json');
  await mkdir(archive,{mode:0o700});
  const bytes=JSON.stringify({schema:2,collectedAt:'2026-09-01T12:00:00.000Z',tokens:[{host:'Mac',totalTokens:42}]});
  await writeFile(file,bytes);
  return {root,archive,file,bytes};
}
test('archive preserves exact bytes, original timestamp and owner-only permissions',options,async t=>{
  const f=await fixture(t),result=await archiveMacSnapshot(f.file,f.archive);
  assert.equal(await readFile(result.file,'utf8'),f.bytes);
  assert.equal(await readFile(f.file,'utf8'),f.bytes);
  assert.equal(result.collectedAt,'2026-09-01T12:00:00.000Z');
  assert.equal((await lstat(result.file)).mode&0o777,0o600);
  assert.equal((await lstat(path.dirname(result.file))).mode&0o777,0o700);
  const receipt=JSON.parse(await readFile(path.join(path.dirname(result.file),'receipt.json')));
  assert.equal(receipt.sha256,result.sha256);
  assert.equal(receipt.bytes,Buffer.byteLength(f.bytes));
  assert.equal(JSON.parse(await readFile(result.file)).tokens[0].totalTokens,42);
});
test('repeated preparation creates distinct archives without overwriting earlier data',options,async t=>{
  const f=await fixture(t),first=await archiveMacSnapshot(f.file,f.archive);
  const next=await archiveMacSnapshot(f.file,f.archive);
  assert.notEqual(first.file,next.file);assert.equal(first.sha256,next.sha256);
  assert.equal((await readdir(f.archive)).length,2);
});
test('linked snapshot and linked archive root are refused',options,async t=>{
  const f=await fixture(t),link=path.join(f.root,'linked.json'),linkedRoot=path.join(f.root,'linked-root');
  await symlink(f.file,link);await symlink(f.archive,linkedRoot);
  await assert.rejects(archiveMacSnapshot(link,f.archive));
  await assert.rejects(archiveMacSnapshot(f.file,linkedRoot));
  assert.deepEqual(await readdir(f.archive),[]);
});
test('broad archive permissions are refused without rewriting them',options,async t=>{
  const f=await fixture(t);await chmod(f.archive,0o755);
  await assert.rejects(archiveMacSnapshot(f.file,f.archive));
  assert.equal((await lstat(f.archive)).mode&0o777,0o755);
});
test('invalid, oversized and non-file inputs leave no archive',options,async t=>{
  const f=await fixture(t);
  for(const value of ['{}','{"schema":2,"collectedAt":"invalid"}',Buffer.alloc(16_000_001)]) {
    await writeFile(f.file,value);await assert.rejects(archiveMacSnapshot(f.file,f.archive));
  }
  await assert.rejects(archiveMacSnapshot(f.root,f.archive));
  assert.deepEqual(await readdir(f.archive),[]);
});
