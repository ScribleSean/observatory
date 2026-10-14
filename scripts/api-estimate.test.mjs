import test from 'node:test';
import assert from 'node:assert/strict';
import { estimate, rates } from './api-estimate.mjs';
import { prices } from './price-table.mjs';
const model = { model:'gpt-6-astra',inputTokens:1000000,cacheReadTokens:1000000,cacheCreationTokens:0,outputTokens:1000000,totalTokens:3000000,inferred:false };
test('scenario keeps uncached, cached and output rates separate', () => assert.equal(estimate([model]).usd,61));
test('unknown and inferred models stay excluded', () => {
  assert.equal(estimate([{...model,inferred:true}]).usd,null);
  assert.equal(estimate([{...model,model:'unknown'}]).excluded,1);
});
test('inconsistent totals cannot be estimated', () => assert.equal(estimate([{...model,totalTokens:2}]).usd,null));

test('rates match the shared price table and are immutable', () => {
  assert.deepEqual(Object.keys(rates), Object.keys(prices.models));
  assert.equal(Object.getPrototypeOf(rates), null);
  assert.ok(Object.isFrozen(rates));
  for (const [id, price] of Object.entries(prices.models)) {
    assert.deepEqual(rates[id], [price.input, price.cachedInput, price.cacheWrite, price.output]);
    assert.ok(Object.isFrozen(rates[id]));
  }
});

test('checked date comes from the shared price table', () => {
  assert.equal(estimate([model]).checked, prices.checkedOn);
});

const claudeModel = {
  model: 'claude-opus-5-5',
  inputTokens: 1000000,
  cacheReadTokens: 1000000,
  cacheCreationTokens: 1000000,
  outputTokens: 1000000,
  totalTokens: 4000000,
  inferred: false,
};
const unpricedModel = { ...claudeModel, model: 'claude-sonnet-4-20250514' };

test('Claude pricing includes all four token classes', () => {
  const price = prices.models[claudeModel.model];
  const result = estimate([claudeModel]);
  assert.equal(result.usd, price.input + price.cachedInput + price.cacheWrite + price.output);
  assert.equal(result.parts.cacheWrites, price.cacheWrite);
});

test('an absent Claude model stays unpriced rather than zero', () => {
  const result = estimate([unpricedModel]);
  assert.equal(result.usd, null);
  assert.notEqual(result.usd, 0);
  assert.equal(result.parts, null);
  assert.equal(result.coveredTokens, 0);
  assert.equal(result.excluded, 1);
});

test('mixed models cover only the priced model', () => {
  const price = prices.models[claudeModel.model];
  const result = estimate([claudeModel, unpricedModel]);
  assert.equal(result.usd, price.input + price.cachedInput + price.cacheWrite + price.output);
  assert.equal(result.coveredTokens, claudeModel.totalTokens);
  assert.equal(result.excluded, 1);
});

test('prototype property names are excluded', () => {
  for (const name of ['__proto__', 'constructor']) {
    const result = estimate([{ ...model, model: name }]);
    assert.equal(result.usd, null);
    assert.equal(result.parts, null);
    assert.equal(result.coveredTokens, 0);
    assert.equal(result.excluded, 1);
  }
});
