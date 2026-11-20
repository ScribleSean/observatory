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
    const counts = ['none', 'line', 'hour', 'average', 'forecast'].map(method => result.errors[method][target].count);
    assert.ok(counts[0] > 500, `too few forecasts scored at ${target}`);
    assert.deepEqual(counts, Array(5).fill(counts[0]));
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

// The last-hour line was the second forecast (scripts/quota-pace.mjs) until both were merged into lib/forecast.mjs.
// Three hours ahead the two are even. From six hours on the last hour misses more, and by the reset it misses by
// over half as much again, because a burst or a quiet hour is taken as the pace for the rest of the window.
test('the forecast is as good as the last-hour line it absorbed near, and better from six hours on', () => {
  const { forecast, hour } = result.errors;
  assert.ok(forecast[3].mae < hour[3].mae * 1.05, `3 hours: ${forecast[3].mae} against ${hour[3].mae}`);
  for (const target of [6, 12, 24, 'reset']) assert.ok(forecast[target].mae < hour[target].mae, `${target}: ${forecast[target].mae} against ${hour[target].mae}`);
  assert.ok(forecast.reset.mae < hour.reset.mae * 0.75, `reset: ${forecast.reset.mae} against ${hour.reset.mae}`);
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
  for (const word of ['no spend', 'straight line', 'last hour', 'window average', 'forecast', 'range, 80% stated', 'days better']) assert.ok(text.includes(word), word);
});

// The early-window case: each week opens as a work day starts, so the first hour is a burst, the shape that made an
// hour-old window say it runs out. The pace alone, carried over the week from there, is mostly wrong.
test('a window too new to forecast says so, because the pace alone is mostly wrong there', () => {
  const [opensAtWork] = seriesFrom(fictionalPoints({ start: Date.parse('2026-03-02T13:00:00Z') }));
  for (const { early, claims } of [backtest(opensAtWork), result]) {
    assert.ok(early.during.moments > 100, 'the early part of each window is scored');
    // Nothing but "too early" is claimed there.
    assert.equal(claims['too early'].said, early.during.moments);
    // Past the gate the forecast misses the share left at the reset by far less than inside it.
    assert.ok(early.during.resetMiss > early.after.resetMiss * 1.5, `${early.during.resetMiss} inside against ${early.after.resetMiss} after`);
  }
  const { early } = backtest(opensAtWork);
  assert.ok(early.during.runsOut > 50, 'the burst makes the pace say "runs out"');
  assert.ok(early.during.cameTrue < 0.5, `"runs out" came true ${early.during.cameTrue} of the time`);
  // Every share of the window inside the gate is early, and none past it.
  for (const row of early.byShare) if (row.to <= 0.1) assert.ok(row.moments === 0 || row.moments <= early.during.moments);
  assert.match(report(backtest(opensAtWork)), /too early \(gated\)/);
});
