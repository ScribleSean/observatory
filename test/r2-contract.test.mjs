// The round 2 contract (docs/R2-PLAN.md): the modules every lane builds on export what the plan names, and the
// fictional fixture has the shape lib/r2-shape.mjs describes.
import test from 'node:test';
import assert from 'node:assert/strict';
// Named imports: a name the plan uses that a module does not export fails here, when the file loads.
import { defaultScope, periodOf, stepRange, comparisonOf, patchScope, deviceChips, visibleSources, scopeToSearch, scopeFromSearch, RANGE_UNITS, SOURCE_IDS } from '../lib/scope.mjs';
import { cleanLedgerHistory, fitLedgerHistory, LEDGER_HISTORY_SCHEMA, LEDGER_HISTORY_BUDGET } from '../lib/r2-shape.mjs';
import { sessionName, sessionNameOverDays, ROLES, KIND_ROLES, TITLE_ALIASES } from '../lib/roles.mjs';
import { METRICS, METRIC_DIMS, DIMS } from '../lib/r2-blocks.mjs';
import { buildFrame, buildOverview, buildSessions, buildLimits, buildTokens, buildScreenTime, buildDrift, buildSettings, metric, resolveBlock, answerQuestion } from '../lib/view-r2.mjs';
import { sampleR2Combined } from '../lib/sample-r2.mjs';
import { WORK_KINDS } from '../lib/ledger-shape.mjs';

const NOW = Date.parse('2026-11-18T15:00:00Z');

test('the contract modules export every name the plan uses', () => {
  const functions = { defaultScope, periodOf, stepRange, comparisonOf, patchScope, deviceChips, visibleSources, scopeToSearch, scopeFromSearch,
    buildFrame, buildOverview, buildSessions, buildLimits, buildTokens, buildScreenTime, buildDrift, buildSettings, metric, resolveBlock, answerQuestion,
    cleanLedgerHistory, fitLedgerHistory, sessionName, sessionNameOverDays };
  for (const [name, value] of Object.entries(functions)) assert.equal(typeof value, 'function', name);
  assert.deepEqual(RANGE_UNITS, ['day', 'week', 'month', 'year', 'all']);
  assert.deepEqual(SOURCE_IDS, ['claude', 'codex', 'grok']);
});

test('every metric names only dims the catalog knows, and every kind maps to a known role', () => {
  assert.deepEqual(Object.keys(METRIC_DIMS).sort(), [...METRICS].sort());
  for (const dims of Object.values(METRIC_DIMS)) for (const dim of dims) assert.ok(DIMS.includes(dim), dim);
  for (const [kind, role] of Object.entries(KIND_ROLES)) { assert.ok(WORK_KINDS.includes(kind), kind); assert.ok(ROLES.includes(role), role); }
  for (const role of Object.values(TITLE_ALIASES)) assert.ok(ROLES.includes(role), role);
});

test('the fixture is fictional, deterministic and shaped like lib/r2-shape.mjs', () => {
  const combined = sampleR2Combined(NOW);
  assert.deepEqual(sampleR2Combined(NOW), combined);
  const history = combined.view.ledgerHistory;
  assert.deepEqual(history.map(row => row.host), ['Mac', 'Windows', 'Linux']);
  assert.equal(new Set(history.map(row => row.firstDate)).size, 3, 'each computer starts its history on a different date');
  for (const row of history) {
    assert.equal(row.schema, LEDGER_HISTORY_SCHEMA);
    assert.ok(Buffer.byteLength(JSON.stringify(row)) <= LEDGER_HISTORY_BUDGET, `${row.host} fits the history budget`);
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

test('lane b\'s modules are written: they return values instead of throwing', () => {
  const combined = sampleR2Combined(NOW);
  const scopeNow = defaultScope(combined, { now: NOW });
  assert.equal(periodOf({ unit: 'week', anchor: '2026-11-18' }, { timeZone: 'UTC', now: NOW }).first, '2026-11-16');
  assert.ok(buildOverview(combined, scopeNow, { now: NOW }).headline.spend);
  assert.equal(sessionName({ title: 'Builder: Lantern' }).role, 'Builder');
});
