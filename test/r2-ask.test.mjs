// The Ask field: a local rules matcher, no model call and no data access. Pinned questions first,
// then saved views, then slots (metric, breakdown, role, range, device, source).
import test from 'node:test';
import assert from 'node:assert/strict';
import { answerQuestion, answerSentence } from '../lib/view-r2.mjs';
import { checkSpec } from '../lib/r2-catalog.mjs';
import { PINNED_QUESTIONS, layout } from '../lib/r2-specs.mjs';
import { defaultScope } from '../lib/scope.mjs';
import { sampleR2Combined } from '../lib/sample-r2.mjs';

const NOW = Date.parse('2026-11-18T15:00:00Z');
const ask = question => answerQuestion(question, { now: NOW, timeZone: 'America/New_York' });
const blocks = answer => Object.values(answer.view.spec.elements).filter(element => element.type !== 'Section');

test('each pinned question matches itself and loose wordings of it', () => {
  for (const pin of PINNED_QUESTIONS) assert.equal(ask(pin.question).matched, pin.id);
  assert.equal(ask('where did the money go today').matched, 'today-spend');
  assert.equal(ask('What did the builders land?').matched, 'builders-month');
  assert.equal(ask('will my limits last').matched, 'week-last');
  assert.equal(ask('anything worth a look?').matched, 'needs-me');
  const builders = ask('What did Builders ship this month?');
  assert.deepEqual([builders.role, builders.patch, builders.metric], ['Builder', { range: { unit: 'month', anchor: '2026-11-18' } }, 'onMain']);
});

test('a pin does not answer a question about another range', () => {
  const answer = ask('where did the money go this month');
  assert.equal(answer.matched, 'rule');
  assert.deepEqual(answer.patch, { range: { unit: 'month', anchor: '2026-11-18' } });
});

test('slots fill from words: metric, breakdown, role, range, device and source', () => {
  const tokens = ask('tokens by model last week on the mac');
  assert.deepEqual([tokens.matched, tokens.metric, tokens.patch], ['rule', 'tokens', { range: { unit: 'week', anchor: '2026-11-11' }, devices: ['Mac'] }]);
  assert.deepEqual(blocks(tokens).find(element => element.type === 'Breakdown').props, { metric: 'tokens', dim: 'model', span: 8 });
  assert.equal(ask('cost per landed change').metric, 'perLanded');
  assert.equal(ask('spend with no commits').metric, 'noCommitSpend');
  assert.equal(ask('churn on ubuntu yesterday').patch.devices[0], 'Linux');
  assert.deepEqual(ask('churn on ubuntu yesterday').patch.range, { unit: 'day', anchor: '2026-11-17' });
  assert.deepEqual(ask('codex spend this year').patch, { range: { unit: 'year', anchor: '2026-11-18' }, sources: ['codex'] });
  const grok = ask('how many grok requests this week');
  assert.deepEqual([grok.metric, blocks(grok).map(element => element.type)], ['grokRequests', ['Headline', 'GrokRequests']]);
  const reviewers = ask('what did reviewers cost all time');
  assert.deepEqual([reviewers.role, reviewers.metric, reviewers.patch], ['Reviewer', 'spend', { range: { unit: 'all' } }]);
  assert.ok(blocks(reviewers).some(element => element.type === 'SessionsTable' && element.props.role === 'Reviewer'));
});

test('every answer is a valid spec that holds no data', () => {
  for (const question of ['tokens by model', 'spend by repo this month', 'screen time by app', 'merged branches', 'sessions by device', 'subagents this week', 'designers'])
    {
      const answer = ask(question);
      assert.ok(answer.view, question);
      assert.ok(checkSpec(answer.view.spec).ok, `${question}: ${checkSpec(answer.view.spec).errors?.join(', ')}`);
      assert.equal(answer.view.origin, 'composed');
    }
});

test('a question nothing matches gets the pinned questions to try', () => {
  for (const question of ['hello there', '', '   ', null]) {
    const answer = answerQuestion(question);
    assert.deepEqual([answer.matched, answer.view, answer.patch, answer.role], [null, null, null, null]);
    assert.deepEqual(answer.suggestions, PINNED_QUESTIONS.map(pin => pin.question));
  }
});

test('a saved view matches by its title or question', () => {
  const saved = { id: 'repo-churn', title: 'Repo churn', question: 'Which repos never land?', spec: layout(null, [{ type: 'Headline', props: { metric: 'churn' } }]), savedAt: '2026-11-18T00:00:00.000Z', origin: 'composed' };
  assert.equal(answerQuestion('show repo churn', { savedViews: [saved] }).matched, 'repo-churn');
  assert.equal(answerQuestion('which repos never land', { savedViews: [saved] }).view, saved);
});

test('without a clock, ranges keep the scope bar\'s anchor', () => {
  assert.deepEqual(answerQuestion('spend this month').patch, { range: { unit: 'month' } });
  assert.deepEqual(answerQuestion('Where did today\'s spend go?').patch, { range: { unit: 'day' } });
});

test('the answer sentence states figures from the same numbers as the blocks', () => {
  const snapshot = sampleR2Combined(NOW);
  const scope = { ...defaultScope(snapshot, { now: NOW }), devices: ['Mac'] };
  assert.match(answerSentence(snapshot, ask('Where did today\'s spend go?'), scope, { now: NOW }), /^\$\d+(\.\d\d)? spent in Nov 18, the largest part .+ at \$[\d.,]+, \d+%\.$/);
  assert.match(answerSentence(snapshot, ask('What did Builders ship this week?'), scope, { now: NOW }), /commits on main in Nov 16 to 22, Builder at \d+, \d+% of it\.$/);
  assert.equal(answerSentence(snapshot, ask('will the week last'), scope, { now: NOW }), null);
  assert.doesNotMatch(answerSentence(snapshot, ask('tokens this week'), scope, { now: NOW }), /Opus|Sonnet/);
});
