import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,readFile,writeFile,chmod} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import path from 'node:path';
import {withPeerStateLock} from './peer-lock.mjs';
import {testRuntimeBase} from './test-runtime-base.mjs';

const runtimeBase=await testRuntimeBase('peer-lock');
after(()=>rm(runtimeBase,{recursive:true,force:true}));
async function fixture(t) {
  const runtime=await realpath(await mkdtemp(path.join(runtimeBase,'observatory-peer-lock-')));
  t.after(()=>rm(runtime,{recursive:true,force:true}));return runtime;
}

test('a pending action keeps the lock across garbage collection',{timeout:120000},async t=>{
  const runtime=await fixture(t);
  const moduleURL=new URL('./peer-lock.mjs',import.meta.url).href;
  const code=`setInterval(()=>{},1000)
    import {withPeerStateLock} from ${JSON.stringify(moduleURL)}
    await withPeerStateLock(process.argv[1],async()=>{
      setTimeout(()=>{
        globalThis.gc()
        setTimeout(()=>{
          globalThis.gc()
          process.stdout.write('ready')
        },100)
      },0)
      await new Promise(()=>{})
    })`;
  const child=spawn(process.execPath,['--expose-gc','--input-type=module','-e',code,runtime],
    {stdio:['ignore','pipe','pipe']});
  const exited=once(child,'exit');
  t.after(async()=>{
    if(child.exitCode===null && child.signalCode===null) {
      child.kill('SIGKILL');
      await exited;
    }
  });
  let stdout='',stderr='';
  child.stderr.on('data',chunk=>{stderr+=chunk;});
  const ready=new Promise(resolve=>{
    child.stdout.on('data',chunk=>{
      stdout+=chunk;
      if(stdout.includes('ready'))resolve();
    });
  });
  let timer;
  try {
    await Promise.race([
      ready,
      exited.then(()=>{throw Error(`Lock owner exited: ${stderr}`);}),
      new Promise((resolve,reject)=>{
        timer=setTimeout(()=>reject(Error('Lock owner did not become ready')),30000);
      }),
    ]);
  } finally {clearTimeout(timer);}
  await assert.rejects(withPeerStateLock(runtime,()=>{}),/locked/);
  assert.equal(child.exitCode,null);
  assert.equal(child.signalCode,null);
  child.kill('SIGKILL');
  await exited;
  await withPeerStateLock(runtime,async()=>{});
});

test('the lock is released after the action settles, including after a failure',async t=>{
  const runtime=await fixture(t);
  await assert.rejects(withPeerStateLock(runtime,()=>{throw Error('synthetic failure');}),
    /synthetic failure/);
  assert.equal(await withPeerStateLock(runtime,async()=>'ok'),'ok');
});

test('concurrent processes wait for the peer lock instead of refusing its folder',
  {skip:process.platform!=='darwin',timeout:120000},async t=>{
  const runtime=await fixture(t);
  await withPeerStateLock(runtime,async()=>{});
  const moduleURL=new URL('./peer-lock.mjs',import.meta.url).href;
  const code=`import {withPeerStateLock} from ${JSON.stringify(moduleURL)}
    import {appendFile} from 'node:fs/promises'
    import {setTimeout as delay} from 'node:timers/promises'
    import path from 'node:path'
    for(let i=0;i<15;i++)await withPeerStateLock(process.argv[1],async()=>{
      await delay(5)
      await appendFile(path.join(process.argv[1],'actions.txt'),process.argv[2]+'\\n')
    })`;
  const children=Array.from({length:6},(_,index)=>{
    const child=spawn(process.execPath,['--input-type=module','-e',code,runtime,String(index)],{stdio:['ignore','ignore','pipe']});
    t.after(()=>{if(child.exitCode===null && child.signalCode===null)child.kill('SIGKILL');});
    let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});
    return once(child,'close').then(([code,signal])=>({code,signal,stderr}));
  });
  const results=await Promise.all(children);
  for(const result of results)assert.equal(result.code,0,JSON.stringify(result));
  assert.equal((await readFile(path.join(runtime,'actions.txt'),'utf8')).trimEnd().split('\n').length,90);
});

test('a folder that stays unsafe is still refused after the retry bound',
  {skip:process.platform!=='darwin'},async t=>{
  const runtime=await fixture(t);
  await withPeerStateLock(runtime,async()=>{});
  const filename=path.join(runtime,'private-repair','group-readable.txt');
  await writeFile(filename,'synthetic',{mode:0o640});
  await chmod(filename,0o640);
  let ran=false;
  const started=performance.now();
  await assert.rejects(withPeerStateLock(runtime,async()=>{ran=true;}),
    /Private path access-control verification failed/);
  const elapsed=performance.now()-started;
  assert.equal(ran,false);
  assert.ok(elapsed>=900,`Refusal took ${elapsed} ms`);
  assert.ok(elapsed<20000,`Refusal took ${elapsed} ms`);
});

test('other refusals are not retried',
  {skip:process.platform!=='darwin'},async t=>{
  const runtime=await fixture(t);
  await withPeerStateLock(runtime,async()=>{});
  const directory=path.join(runtime,'private-repair');
  let ran=false;
  try {
    await chmod(directory,0o750);
    const started=performance.now();
    await assert.rejects(withPeerStateLock(runtime,async()=>{ran=true;}),
      /Unsafe private sync directory/);
    const elapsed=performance.now()-started;
    assert.equal(ran,false);
    assert.ok(elapsed<900,`Refusal took ${elapsed} ms`);
  } finally {await chmod(directory,0o700);}
});
