import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {readBoundedReceipts} from './bounded-receipts.mjs';

test('isolated receipts retain sanitized metadata and leave original bytes unchanged',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'observatory-bounded-receipts-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'fictional.usage.json');
  const original=JSON.stringify({conversationId:'PRIVATE',requestedModel:'test-model',status:'SUCCESS',
    usage:{input_tokens:12},transcript:'PRIVATE'});
  await writeFile(file,original);
  const result=await readBoundedReceipts(dir);
  assert.equal(result.source.status,'ok');assert.equal(result.agents[0].input,12);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  assert.equal(await readFile(file,'utf8'),original);
});

test('stalled optional worker is killed and resolves unavailable without blocking other work',async()=>{
  let child;
  const started=Date.now();
  const result=await readBoundedReceipts(tmpdir(),{timeoutMs:100,
    spawnProcess:()=>child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
      {stdio:['pipe','pipe','ignore']})});
  assert.equal(result.source.status,'unavailable');assert.deepEqual(result.agents,[]);
  assert.ok(Date.now()-started<3000);assert.ok(child.killed);
  await new Promise(resolve=>child.exitCode!==null || child.signalCode!==null?resolve():child.once('close',resolve));
  assert.ok(child.signalCode || child.exitCode!==null);
});

test('spawn errors and malformed worker output fail without exposing error text',async()=>{
  const failure=await readBoundedReceipts(tmpdir(),{spawnProcess:()=>{throw Error('PRIVATE');}});
  assert.equal(failure.source.status,'unavailable');
  const malformed=await readBoundedReceipts(tmpdir(),{spawnProcess:()=>spawn(process.execPath,
    ['-e',"process.stdin.resume();process.stdin.on('end',()=>process.stdout.write('PRIVATE'))"],{stdio:['pipe','pipe','ignore']})});
  assert.equal(malformed.source.status,'unavailable');assert.ok(!JSON.stringify(malformed).includes('PRIVATE'));
  assert.throws(()=>readBoundedReceipts('relative'));
});
