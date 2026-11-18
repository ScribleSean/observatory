// Round 2 equivalents of the old dashboard's estimate and freshness tests: an unpriced dollar value is
// Unknown and never $0, a partly read period keeps only what was read, and a peer's limit reading stops
// counting as current at exactly ten minutes.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as v from '../lib/view-r2.mjs';
import { sampleR2Combined } from '../lib/sample-r2.mjs';

const NOW = Date.parse('2026-11-18T15:00:00Z');
const tokens = { input: 10, output: 20, cacheRead: 30, cacheWrite: 40 };
const model = (name, apiUsd) => ({ model: name, apiUsd, outputTokens: 20 });
const day = (date, apiUsd, models, extra = {}) => ({ date, tool: 'claude', status: 'ok', frozen: false, apiUsd, sessionCount: 1, subagents: 0, tokens,
  models, kinds: [], origins: [], repos: [], ship: { commits: 0, onMain: 0, merges: 0 }, sessions: [], other: null, ...extra });
// A fictional Mac with only the days given, all read at NOW.
function world(days) {
  const snapshot = sampleR2Combined(NOW);
  snapshot.view.ledgerHistory = [{ host: 'Mac', status: 'ok', checkedAt: new Date(NOW).toISOString(), schema: 2, timeZone: 'UTC',
    firstDate: '2026-11-16', sessionsFrom: '2026-11-16', days }];
  return snapshot;
}
const scope = unit => ({ devices: ['Mac'], sources: ['claude'], range: { unit, anchor: '2026-11-18' } });
const spend = (snapshot, unit) => v.metric(snapshot, 'spend', scope(unit), { now: NOW });
// The week of 2026-11-18 runs Monday the 16th to today.
const WEEK = ['16', '17', '18'].map(d => `2026-11-${d}`);
const priced = (skip = {}) => WEEK.map(date => skip[date] ?? day(date, 2, [model('claude-opus-5-5', 2)]));

test('a day with no price is Unknown spend, never $0', () => {
  const unpriced = world([day('2026-11-18', null, [model('claude-opus-5-5', null)])]);
  const num = spend(unpriced, 'day');
  assert.equal(num.value, null);
  assert.equal(num.text, 'Unknown');
  assert.equal(num.atLeast, null);
  assert.equal(v.buildTokens(unpriced, scope('day'), { now: NOW }).spend.text, 'Unknown');
});

test('one unpriced day makes the whole week Unknown, while the same week fully priced adds up', () => {
  assert.equal(spend(world(priced()), 'week').value, 6);
  assert.equal(spend(world(priced()), 'week').text, '$6.00');
  const partly = spend(world(priced({ '2026-11-17': day('2026-11-17', null, [model('claude-opus-5-5', null)]) })), 'week');
  assert.equal(partly.value, null);
  assert.equal(partly.text, 'Unknown');
});

test('a day the computer could not read is Unknown and the rest is offered as a lower bound', () => {
  const unread = day('2026-11-17', null, [], { status: 'unavailable', tokens: { input: null, output: null, cacheRead: null, cacheWrite: null } });
  const num = spend(world(priced({ '2026-11-17': unread })), 'week');
  assert.equal(num.value, null);
  assert.equal(num.text, 'Unknown');
  assert.deepEqual(num.atLeast, { value: 4, text: 'at least $4.00, 1 day not read on Studio' });
});

const mixed = () => world([day('2026-11-18', null, [model('claude-opus-5-5', 5), model('claude-sonnet-5-5', null)])]);

test('a priced model keeps its own cost next to an unpriced one while the day total is Unknown', () => {
  const result = v.buildTokens(mixed(), scope('day'), { now: NOW });
  assert.equal(result.spend.value, null);
  assert.equal(result.agents.find(row => row.agent === 'Opus').usd.value, 5);
  assert.deepEqual(result.spend.breakdowns.model.find(part => part.label === 'Opus'), { key: 'Opus', label: 'Opus', value: 5, text: '$5.00', share: null });
});

test('an unpriced model is Unknown in the agent rows and the model breakdown, never $0', () => {
  const result = v.buildTokens(mixed(), scope('day'), { now: NOW });
  assert.equal(result.agents.find(row => row.agent === 'Sonnet').usd.value, null);
  assert.deepEqual(result.spend.breakdowns.model.find(part => part.label === 'Sonnet'), { key: 'Sonnet', label: 'Sonnet', value: null, text: 'Unknown', share: null });
});

// A reading another computer made, checked `ageMs` before NOW. No validUntil, so only the age decides.
function peerLimit(ageMs, extra = {}) {
  const snapshot = sampleR2Combined(NOW);
  delete snapshot.view.claudeLimits.validUntil;
  Object.assign(snapshot.view.claudeLimits, { observedOn: 'Windows', checkedAt: new Date(NOW - ageMs).toISOString(), ...extra });
  return snapshot;
}
const claudeWindows = snapshot => v.resolveBlock('LimitMeter', { engine: 'claude', window: 'seven_day' }, snapshot, scope('week'), { now: NOW }).engine.windows;

test('a peer limit reading is stale at exactly ten minutes and current one millisecond sooner', () => {
  const stale = claudeWindows(peerLimit(600000));
  assert.deepEqual(stale.map(window => [window.state, window.readOn]), [['stale', 'Tower']]);
  const current = claudeWindows(peerLimit(599999));
  assert.deepEqual(current.map(window => [window.state, window.remaining, window.readOn]), [['ok', 40, 'Tower']]);
});

test('the same ten minute edge holds through buildLimits, and a reading from the future is not current', () => {
  const state = snapshot => v.buildLimits(snapshot, scope('week'), { now: NOW }).engines.find(engine => engine.engine === 'claude').windows[0].state;
  assert.equal(state(peerLimit(600000)), 'stale');
  assert.equal(state(peerLimit(599999)), 'ok');
  assert.equal(state(peerLimit(-1)), 'stale');
});

test('a validUntil still in the future keeps a ten minute old peer reading current, and one in the past does not', () => {
  assert.equal(claudeWindows(peerLimit(600000, { validUntil: new Date(NOW + 1).toISOString() }))[0].state, 'ok');
  assert.equal(claudeWindows(peerLimit(600000, { validUntil: new Date(NOW - 1).toISOString() }))[0].state, 'stale');
});
