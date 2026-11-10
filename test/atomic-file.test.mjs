import test from 'node:test';
import assert from 'node:assert/strict';
import fsp,{readdir,readFile,stat} from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import path from 'node:path';
import {writeAtomic} from '../lib/atomic-file.mjs';
import {withFolder} from './helpers.mjs';

// Replace fs/promises.rename for one test; `fake(realRename,calls,...args)` decides the result.
async function withRename(fake,run) {
  const real=fsp.rename;
  const calls=[];
  fsp.rename=(...args)=>{calls.push(args);return fake(real,calls.length,...args);};
  syncBuiltinESMExports();
  try {return await run(calls);}
  finally {fsp.rename=real;syncBuiltinESMExports();}
}

// Run without real backoff waits, and report the delays asked for.
async function withFastTimers(run) {
  const real=globalThis.setTimeout;
  const delays=[];
  globalThis.setTimeout=(fn,ms,...rest)=>{delays.push(ms);return real(fn,0,...rest);};
  try {return await run(delays);}
  finally {globalThis.setTimeout=real;}
}

const busy=code=>Object.assign(new Error(code),{code});

test('writes the text and leaves no temp file on success',()=>withFolder(async folder=>{
  const file=path.join(folder,'data.json');
  await writeAtomic(file,'hello');
  assert.equal(await readFile(file,'utf8'),'hello');
  assert.deepEqual(await readdir(folder),['data.json']);
}));

test('the written file has mode 0600',{skip:process.platform==='win32'},()=>withFolder(async folder=>{
  const file=path.join(folder,'data.json');
  await writeAtomic(file,'secret');
  assert.equal((await stat(file)).mode&0o777,0o600);
}));

test('retries the rename while the target is busy, then succeeds',()=>withFolder(async folder=>{
  const file=path.join(folder,'data.json');
  for(const code of ['EPERM','EACCES','EBUSY']) {
    await withFastTimers(delays=>withRename((real,n,...args)=>n<=2?Promise.reject(busy(code)):real(...args),async calls=>{
      await writeAtomic(file,code);
      assert.equal(calls.length,3);
      assert.deepEqual(delays,[50,100]);
    }));
    assert.equal(await readFile(file,'utf8'),code);
    assert.deepEqual(await readdir(folder),['data.json']);
  }
}));

test('gives up after the retry limit, with backoff capped, and removes the temp file',()=>withFolder(async folder=>{
  const file=path.join(folder,'data.json');
  await withFastTimers(delays=>withRename(()=>Promise.reject(busy('EBUSY')),async calls=>{
    await assert.rejects(writeAtomic(file,'x'),{code:'EBUSY'});
    assert.equal(calls.length,9);
    assert.deepEqual(delays,[50,100,200,400,800,1600,1600,1600]);
  }));
  assert.deepEqual(await readdir(folder),[]);
}));

test('does not retry other errors and removes the temp file',()=>withFolder(async folder=>{
  const file=path.join(folder,'data.json');
  await withRename(()=>Promise.reject(busy('EXDEV')),async calls=>{
    await assert.rejects(writeAtomic(file,'x'),{code:'EXDEV'});
    assert.equal(calls.length,1);
  });
  assert.deepEqual(await readdir(folder),[]);
}));

test('a failed write keeps the old file and leaves no temp file',()=>withFolder(async folder=>{
  const file=path.join(folder,'data.json');
  await writeAtomic(file,'old');
  await withRename(()=>Promise.reject(busy('EXDEV')),()=>assert.rejects(writeAtomic(file,'new')));
  assert.equal(await readFile(file,'utf8'),'old');
  assert.deepEqual(await readdir(folder),['data.json']);
}));
