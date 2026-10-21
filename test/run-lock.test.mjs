import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,readFile,utimes} from 'node:fs/promises';
import path from 'node:path';
import {withRunLock} from '../lib/run-lock.mjs';
import {withFolder} from './helpers.mjs';

test('a held lock makes a second run busy, and the lock is never empty',()=>withFolder(async folder=>{
  const file=path.join(folder,'tick.lock');
  let release;
  const first=withRunLock(file,()=>new Promise(resolve=>{release=resolve;}));
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(JSON.parse(await readFile(file,'utf8')).pid,process.pid);
  assert.deepEqual(await withRunLock(file,()=>'second'),{busy:true});
  release('first');
  assert.deepEqual(await first,{busy:false,value:'first'});
  assert.deepEqual(await withRunLock(file,()=>'third'),{busy:false,value:'third'});
}));

test('a lock left by a process that has gone is taken over',()=>withFolder(async folder=>{
  const file=path.join(folder,'tick.lock');
  await writeFile(file,JSON.stringify({pid:2147483646,startedAt:new Date().toISOString()}));
  assert.deepEqual(await withRunLock(file,()=>'ran'),{busy:false,value:'ran'});
}));

test('a young unreadable lock is left alone, an old one is taken over',()=>withFolder(async folder=>{
  const file=path.join(folder,'tick.lock');
  await writeFile(file,'');
  assert.deepEqual(await withRunLock(file,()=>'ran'),{busy:true});
  const old=new Date(Date.now()-60000);
  await utimes(file,old,old);
  assert.deepEqual(await withRunLock(file,()=>'ran'),{busy:false,value:'ran'});
}));
