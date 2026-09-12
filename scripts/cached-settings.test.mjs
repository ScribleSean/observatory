import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,readFile,rm,lstat,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {cachedSettingsScript} from './cached-settings.mjs';

test('legacy Mac cache prefix uses a private local directory and retains the reader',async()=>{
  const runtime=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-settings-prefix-')));
  try {
    const reader=await readFile(new URL('./read-settings.py',import.meta.url),'utf8');
    const source=await cachedSettingsScript(runtime,reader);
    assert.ok(source.startsWith(`CACHE_DIRECTORY = ${JSON.stringify(path.join(runtime,'private-codex'))}\n`));
    assert.ok(source.includes('class SettingsCache:'));
    assert.ok(source.endsWith(reader));
    assert.ok(!source.includes('CACHE_SCAN_BUDGET ='));
    if(process.platform!=='win32')assert.equal((await lstat(path.join(runtime,'private-codex'))).mode&0o077,0);
  } finally {await rm(runtime,{recursive:true,force:true});}
});
test('legacy cache refuses a linked cache directory',{skip:process.platform==='win32'},async()=>{
  const runtime=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-settings-link-')));
  try {
    await symlink(runtime,path.join(runtime,'private-codex'));
    await assert.rejects(cachedSettingsScript(runtime,''),/Unsafe private/);
  } finally {await rm(runtime,{recursive:true,force:true});}
});
