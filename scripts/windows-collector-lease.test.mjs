import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {windowsCollectorLease} from './windows-collector-lease.mjs';

test('native owner lease accepts exactly one byte and aborts on EOF or extra input',async()=>{
  for(const ending of ['eof','extra','error']) {
    const input=new PassThrough(),lease=windowsCollectorLease(input);
    input.write(Buffer.from([1]));assert.equal(await lease.ready,true);assert.equal(lease.signal.aborted,false);
    if(ending==='eof')input.end();else if(ending==='extra')input.write(Buffer.from([2]));else input.emit('error',Error('PRIVATE'));
    await new Promise(resolve=>setImmediate(resolve));assert.equal(lease.signal.aborted,true);lease.dispose();assert.equal(input.destroyed,true);
  }
});

test('missing or invalid owner leases fail closed and disposal releases stdin',async()=>{
  for(const bytes of [null,Buffer.from([0]),Buffer.from([1,1])]) {
    const input=new PassThrough(),lease=windowsCollectorLease(input,{timeoutMs:10});
    if(bytes)input.write(bytes);assert.equal(await lease.ready,false);assert.equal(lease.signal.aborted,true);lease.dispose();
  }
  const input=new PassThrough(),lease=windowsCollectorLease(input);input.write(Buffer.from([1]));await lease.ready;lease.dispose();lease.dispose();
  assert.equal(input.destroyed,true);assert.equal(input.listenerCount('data'),0);
});
