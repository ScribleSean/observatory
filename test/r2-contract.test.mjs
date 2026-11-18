// The round 2 contract (docs/R2-PLAN.md): the modules every lane builds against export what the plan
// names, and the fictional fixture has the shape lib/r2-shape.mjs describes. Lanes replace the
// "not implemented" checks with real tests as they fill in the bodies.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as scope from '../lib/scope.mjs';
import * as shape from '../lib/r2-shape.mjs';
import * as roles from '../lib/roles.mjs';
import * as blocks from '../lib/r2-blocks.mjs';
import * as views from '../lib/view-r2.mjs';
import { sampleR2Combined } from '../lib/sample-r2.mjs';
import { WORK_KINDS } from '../lib/ledger-shape.mjs';

const NOW = Date.parse('2026-11-18T15:00:00Z');

test('the contract modules export every name the plan uses', () => {
  for (const name of ['defaultScope', 'periodOf', 'stepRange', 'comparisonOf', 'patchScope', 'deviceChips', 'visibleSources', 'scopeToSearch', 'scopeFromSearch'])
    assert.equal(typeof scope[name], 'function', `scope.${name}`);
  for (const name of ['buildFrame', 'buildOverview', 'buildSessions', 'buildLimits', 'buildTokens', 'buildScreenTime', 'buildDrift', 'buildSettings', 'metric', 'resolveBlock', 'answerQuestion'])
    assert.equal(typeof views[name], 'function', `view-r2.${name}`);
  for (const name of ['cleanLedgerHistory', 'fitLedgerHistory']) assert.equal(typeof shape[name], 'function', `r2-shape.${name}`);
  for (const name of ['sessionName', 'sessionNameOverDays']) assert.equal(typeof roles[name], 'function', `roles.${name}`);
  assert.deepEqual(scope.RANGE_UNITS, ['day', 'week', 'month', 'year', 'all']);
  assert.deepEqual(scope.SOURCE_IDS, ['claude', 'codex', 'grok']);
});

test('every metric names only dims the catalog knows, and every kind maps to a known role', () => {
  assert.deepEqual(Object.keys(blocks.METRIC_DIMS).sort(), [...blocks.METRICS].sort());
  for (const dims of Object.values(blocks.METRIC_DIMS)) for (const dim of dims) assert.ok(blocks.DIMS.includes(dim), dim);
  for (const [kind, role] of Object.entries(roles.KIND_ROLES)) { assert.ok(WORK_KINDS.includes(kind), kind); assert.ok(roles.ROLES.includes(role), role); }
  for (const role of Object.values(roles.TITLE_ALIASES)) assert.ok(roles.ROLES.includes(role), role);
});

test('the fixture is fictional, deterministic and shaped like lib/r2-shape.mjs', () => {
  const combined = sampleR2Combined(NOW);
  assert.deepEqual(sampleR2Combined(NOW), combined);
  const history = combined.view.ledgerHistory;
  assert.deepEqual(history.map(row => row.host), ['Mac', 'Windows', 'Linux']);
  assert.equal(new Set(history.map(row => row.firstDate)).size, 3, 'each computer starts its history on a different date');
  for (const row of history) {
    assert.equal(row.schema, shape.LEDGER_HISTORY_SCHEMA);
    assert.ok(Buffer.byteLength(JSON.stringify(row)) <= shape.LEDGER_HISTORY_BUDGET, `${row.host} fits the history budget`);
    for (const day of row.days) {
      assert.match(day.date, /^\d{4}-\d{2}-\d{2}$/);
      if (day.status === 'unavailable') { assert.equal(day.apiUsd, null); continue; }
      const listed = day.sessions.reduce((total, session) => total + session.apiUsd, 0);
      assert.ok(Math.abs(listed - day.apiUsd) < 0.05, `${row.host} ${day.date} sessions add up to the day`);
      assert.ok(day.ship.onMain <= day.ship.commits);
      for (const session of day.sessions) {
        assert.match(session.id, /^[0-9a-f]{12}$/);
        if (row.host === 'Linux') { assert.equal(session.title, null); assert.equal(session.origin, 'headless'); }
      }
    }
  }
  assert.ok(history.some(row => row.days.some(day => day.status === 'unavailable')), 'one day is Unknown');
  assert.ok(combined.devices.some(device => device.stale), 'one computer is stale');
  assert.ok(combined.view.grokLimits.requests.days.some(day => day.count === null), 'one Grok day has no count');
});

test('the stubs say they are not written yet instead of returning a made-up value', () => {
  assert.throws(() => views.buildOverview(sampleR2Combined(NOW), null), /not implemented/);
  assert.throws(() => scope.periodOf({ unit: 'week', anchor: '2026-11-18' }, { timeZone: 'UTC' }), /not implemented/);
});
