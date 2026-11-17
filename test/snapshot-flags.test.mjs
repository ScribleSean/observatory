import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotFlags} from '../lib/ledger-flags.mjs';

const session = (id, title, extra) => ({id, title, apiUsd: 10, subagents: 0, shipped: {merges: 1}, signals: {}, ...extra});
const row = (host, sessions, apiUsd = 100) => ({host, status: 'ok', tools: [{tool: 'claude', limitEngine: 'claude',
  periods: [{key: 'current', apiUsd, sessions}, {key: 'previous', apiUsd: 5, sessions: [session('p1', 'Old', {signals: {longestRetry: 9}})]}]}]});

test('pools every computer and ignores previous periods', () => {
  const combined = {view: {ledger: [
    row('Mac', [session('a1', 'Release review', {apiUsd: 45, subagents: 300, shipped: {merges: 0}})]),
    row('Linux', [session('b1', 'Package updates', {signals: {longestRetry: 14, retryTool: 'Shell'}})]),
    {host: 'Windows', status: 'not-connected'},
  ]}};
  const flags = snapshotFlags(combined);
  assert.equal(flags.length, 2);
  assert.equal(flags[0].subject, 'Release review');
  assert.match(flags[0].text, /300 subagents/);
  assert.equal(flags[1].subject, 'Package updates');
  assert.ok(!flags.some(flag => flag.subject === 'Old'));
});

test('no ledger gives no flags', () => {
  assert.deepEqual(snapshotFlags({}), []);
  assert.deepEqual(snapshotFlags({view: {ledger: [{host: 'Mac', status: 'unavailable'}]}}), []);
});
