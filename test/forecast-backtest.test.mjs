import test from 'node:test';
import assert from 'node:assert/strict';
import { backtest, fictionalPoints, seriesFrom, straightLine, report } from '../scripts/harness/forecast-backtest.mjs';

// Five made-up weeks of one weekly limit. No recorded use is in the repository.
const [series] = seriesFrom(fictionalPoints());
const result = backtest(series);

test('the made-up history is the same every run', () => {
  assert.deepEqual(fictionalPoints().slice(0, 500), fictionalPoints().slice(0, 500));
  assert.equal(series.durationMinutes, 10080);
  assert.ok(series.readings.length > 5000);
  assert.deepEqual(backtest(series), result);
});

test('every method is scored on the same forecasts', () => {
  assert.ok(result.moments > 1000);
  for (const target of [3, 6, 12, 24, 'reset']) {
    const counts = ['none', 'line', 'average', 'forecast'].map(method => result.errors[method][target].count);
    assert.ok(counts[0] > 500, `too few forecasts scored at ${target}`);
    assert.deepEqual(counts, Array(4).fill(counts[0]));
  }
});

test('the forecast misses by less than the straight line it replaced, near and a day ahead', () => {
  const { forecast, line } = result.errors;
  assert.ok(forecast[3].mae < line[3].mae * 0.9, `3 hours: ${forecast[3].mae} against ${line[3].mae}`);
  assert.ok(forecast[6].mae < line[6].mae, `6 hours: ${forecast[6].mae} against ${line[6].mae}`);
  assert.ok(forecast[24].mae < line[24].mae, `24 hours: ${forecast[24].mae} against ${line[24].mae}`);
  // Half a day ahead and at the reset neither is better on these readings: allow a fifth either way.
  assert.ok(forecast[12].mae < line[12].mae * 1.2);
  assert.ok(forecast.reset.mae < line.reset.mae * 1.2);
});

test('the stated range holds the outcome about as often as it says', () => {
  for (const target of [3, 6, 12, 24, 'reset']) {
    const { inside, count } = result.range[target];
    assert.ok(count > 500, `too few ranged forecasts at ${target}`);
    assert.ok(inside >= 0.65 && inside <= 0.95, `${target}: inside ${inside}`);
  }
  // The range widens with the look-ahead.
  assert.ok(result.range[3].width < result.range[12].width && result.range[12].width < result.range.reset.width);
});

test('a forecast that says the limit lasts is mostly right, and "may run out" is not a promise', () => {
  const ranOut = claim => result.claims[claim].ranOut;
  assert.ok(ranOut('lasts') <= 0.2);
  assert.ok(ranOut('likely lasts') <= 0.2);
  // The run-out wording has to stay hedged: these windows ran out well under nine times in ten.
  assert.ok(ranOut('may run out, from') > ranOut('likely lasts') && ranOut('may run out, from') < 0.9);
  assert.ok(ranOut('may run out, range') < 0.9);
});

test('the straight line needs three readings and a quarter hour', () => {
  const now = Date.parse('2026-03-10T12:00:00Z'), resetsAt = now + 3600000 * 48;
  const at = (minutes, remaining) => ({ at: now - minutes * 60000, remaining, resetsAt });
  assert.equal(straightLine([at(10, 51)], { now, remaining: 50, resetsAt, durationMinutes: 10080 }), null);
  assert.equal(straightLine([at(120, 54), at(60, 52)], { now, remaining: 50, resetsAt, durationMinutes: 10080 }), 2);
});

test('the report names every method and the range', () => {
  const text = report(result);
  for (const word of ['no spend', 'straight line', 'window average', 'forecast', 'range, 80% stated', 'days better']) assert.ok(text.includes(word), word);
});
