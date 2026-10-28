import test from 'node:test';
import assert from 'node:assert/strict';
import {limitRemaining} from '../lib/glance-limits.mjs';
import {combine} from '../lib/combine.mjs';
import {ownSnapshot} from './helpers.mjs';

const now = Date.parse('2026-10-21T17:00:00Z');
test('native limit rules expire each frozen reading at draw time, independent of generatedAt', () => {
  const combined = combine([{host:'Mac',snapshot:ownSnapshot('Mac',now)}],{now});
  const row = combined.glance.limits.find(row => row.remaining !== null && !row.stale);
  assert.ok(row.checkedAt);
  assert.equal(limitRemaining(row,now),row.remaining);
  assert.equal(limitRemaining(row,now+3600000),null);
  const base = {...row,checkedAt:new Date(now).toISOString(),resetsAt:new Date(now+300000).toISOString()};
  assert.equal(limitRemaining(base,now+299999),row.remaining);
  assert.equal(limitRemaining(base,now+300000),null);
  assert.equal(limitRemaining({...base,resetsAt:null},now+599999),row.remaining);
  assert.equal(limitRemaining({...base,resetsAt:null},now+600000),null);
  for (const change of [{checkedAt:null},{checkedAt:'bad'},{checkedAt:new Date(now+1).toISOString()},
    {stale:true},{remaining:-1},{remaining:101},{remaining:null}]) {
    assert.equal(limitRemaining({...base,...change},now),null);
  }
});

test('combined glance rows preserve each window reading and reset for later draws', () => {
  const snapshot = ownSnapshot('Mac',now);
  const checkedAt = new Date(now).toISOString();
  const older = new Date(now-9*60000).toISOString();
  const reset = new Date(now+30000).toISOString();
  snapshot.quota = {status:'ok',checkedAt,windows:[
    {bucket:'codex',window:'primary',remainingPercent:20,checkedAt:older,resetsAt:reset},
    {bucket:'codex',window:'secondary',remainingPercent:70,checkedAt,resetsAt:new Date(now+3600000).toISOString()},
  ]};
  const saved = combine([{host:'Mac',snapshot}],{now});
  const rows = saved.glance.limits.filter(row => row.provider === 'codex');
  assert.equal(rows[0].checkedAt,older);
  assert.equal(rows[0].resetsAt,reset);
  assert.deepEqual(rows.map(row => limitRemaining(row,now)),[20,70]);
  assert.deepEqual(rows.map(row => limitRemaining(row,now+60000)),[null,70]);
  assert.equal(saved.generatedAt,checkedAt);
});
