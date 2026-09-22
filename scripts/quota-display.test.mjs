import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cleanPeerQuotaForDisplay} from './quota-display.mjs';

const now=Date.parse('2026-09-08T20:00:00.000Z');
const sample={checkedAt:'2026-09-08T19:55:00.000Z',windows:[{bucket:'codex',window:'primary',remainingPercent:43,durationMinutes:300,resetsAt:'2026-09-09T00:00:00.000Z'}]};
test('peer allowance display keeps a separate valid reading',()=>{
  const peer=cleanPeerQuotaForDisplay({host:'Windows',status:'stale',checkedAt:sample.checkedAt,receivedAt:'2026-09-08T19:56:00.000Z',windows:sample.windows,history:[sample]},now);
  assert.equal(peer.windows[0].remainingPercent,43);
  assert.equal(peer.history.length,1);
  assert.equal(peer.receivedAt,'2026-09-08T19:56:00.000Z');
});
test('peer allowance display gives absent readings an empty safe state',()=>{
  const peer=cleanPeerQuotaForDisplay({host:'Mac',status:'unavailable',history:[],windows:[]},now);
  assert.deepEqual(peer.windows,[]);
  assert.deepEqual(peer.history,[]);
  assert.equal(peer.receivedAt,null);
});
test('peer allowance display rejects unsafe shapes and drops invalid observations',()=>{
  assert.equal(cleanPeerQuotaForDisplay({host:'Windows',status:'stale',windows:{}},now),null);
  assert.equal(cleanPeerQuotaForDisplay({host:'Linux',status:'stale',windows:[]},now),null);
  const peer=cleanPeerQuotaForDisplay({host:'Windows',status:'stale',windows:[{bucket:'codex',window:'primary',remainingPercent:101}],history:[{checkedAt:'invalid',windows:sample.windows}]},now);
  assert.deepEqual(peer.windows,[]);
  assert.deepEqual(peer.history,[]);
});
