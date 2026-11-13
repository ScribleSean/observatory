import test from 'node:test';
import assert from 'node:assert/strict';
import { windowForecast, engineForecast, scarcest, sentence, when, forecast, lookbackMs, offReason } from '../lib/forecast.mjs';
import { ENGINE_OFF_MS } from '../lib/freshness.mjs';

const HOUR = 3600000;
const now = Date.parse('2026-11-12T15:00:00Z'); // Thursday, 10 AM in New York
const context = { now, timeZone: 'America/New_York' };
const iso = at => new Date(at).toISOString();
// Readings every 10 minutes for the last `hours`, falling `perHour` points an hour to `remaining` now.
const burning = (remaining, perHour, hours, resetsAt) => Array.from({ length: hours * 6 }, (_, index) => {
  const ago = (hours * 6 - index) * HOUR / 6;
  return { at: now - ago, remaining: remaining + perHour * ago / HOUR, resetsAt };
});

test('no reading means unknown, not zero', () => {
  const result = windowForecast({ remaining: null, resetsAt: null, durationMinutes: 300, readings: [], now });
  assert.equal(result.status, 'unknown');
  assert.equal(result.remaining, null);
});

test('steady use runs out before the reset at the measured pace', () => {
  const reset = now + 48 * HOUR;
  const result = windowForecast({ remaining: 40, resetsAt: iso(reset), durationMinutes: 10080, readings: burning(40, 2, 24, reset), now });
  assert.equal(result.status, 'runs-out');
  assert.equal(result.ratePerHour, 2);
  assert.equal(Date.parse(result.runoutAt), now + 20 * HOUR);
  assert.equal(result.confidence, 'high');
});

test('an idle window has room', () => {
  const reset = now + 48 * HOUR;
  const result = windowForecast({ remaining: 30, resetsAt: iso(reset), durationMinutes: 10080, readings: burning(30, 0, 24, reset), now });
  assert.equal(result.status, 'room');
  assert.equal(result.runoutAt, null);
});

test('a window that resets before it would run out has room', () => {
  const reset = now + 5 * HOUR;
  const result = windowForecast({ remaining: 40, resetsAt: iso(reset), durationMinutes: 10080, readings: burning(40, 2, 24, reset), now });
  assert.equal(result.status, 'room');
});

test('a spent window is out until its reset', () => {
  const result = windowForecast({ remaining: 0, resetsAt: iso(now + 3 * HOUR), durationMinutes: 300, readings: [], now });
  assert.equal(result.status, 'out');
});

test('readings from before a reset do not count toward the pace', () => {
  const oldReset = now - 2 * HOUR, reset = now + 3 * HOUR;
  const before = burning(5, 10, 3, oldReset).filter(reading => reading.at < oldReset);
  const after = burning(90, 1, 2, reset);
  const result = windowForecast({ remaining: 90, resetsAt: iso(reset), durationMinutes: 300, readings: [...before, ...after], now });
  assert.equal(result.ratePerHour, 1);
  assert.equal(result.status, 'room');
});

test('too few readings give no pace and a low confidence', () => {
  const result = windowForecast({ remaining: 50, resetsAt: iso(now + 4 * HOUR), durationMinutes: 300,
    readings: [{ at: now - 5 * 60000, remaining: 51, resetsAt: now + 4 * HOUR }], now });
  assert.equal(result.status, 'room');
  assert.equal(result.ratePerHour, null);
  assert.equal(result.confidence, 'low');
});

test('the pace looks back about a day for long windows and an hour or two for short ones', () => {
  assert.equal(lookbackMs(10080), 24 * HOUR);
  assert.equal(lookbackMs(300), 2 * HOUR);
  assert.equal(lookbackMs(null), HOUR);
});

test('an engine is as tight as its tightest window', () => {
  const engine = engineForecast('claude', 'Claude', [
    { status: 'room', remaining: 20, resetsAt: iso(now + HOUR), runoutAt: null, confidence: 'high', window: '5-hour' },
    { status: 'runs-out', remaining: 60, resetsAt: iso(now + 90 * HOUR), runoutAt: iso(now + 30 * HOUR), confidence: 'high', window: 'weekly' },
  ]);
  assert.equal(engine.status, 'runs-out');
  assert.equal(engine.remaining, 60);
  assert.equal(engine.window, 'weekly');
});

test('the scarcer engine is the one that runs out, even with more left', () => {
  const claude = { engine: 'claude', name: 'Claude', status: 'runs-out', remaining: 40, at: iso(now + 10 * HOUR) };
  const codex = { engine: 'codex', name: 'Codex', status: 'room', remaining: 20, at: null };
  assert.equal(scarcest([codex, claude]), claude);
  assert.equal(scarcest([codex, { ...claude, status: 'room' }]).engine, 'codex');
});

test('the sentence names the scarcer engine first', () => {
  const claude = { engine: 'claude', name: 'Claude', status: 'runs-out', remaining: 40, at: '2026-11-13T21:00:00Z', confidence: 'high' };
  const codex = { engine: 'codex', name: 'Codex', status: 'room', remaining: 80, at: null };
  assert.equal(sentence([codex, claude], context), 'Claude runs out Fri 4 PM at this pace. Codex has room.');
  assert.equal(sentence([{ ...claude, status: 'room' }, codex], context), 'Claude and Codex have room.');
  assert.equal(sentence([{ ...claude, status: 'out', at: '2026-11-12T20:00:00Z' }, codex], context), 'Claude is out until 3 PM. Codex has room.');
});

test('a tight window that lasts says when it resets', () => {
  const claude = { engine: 'claude', name: 'Claude', status: 'room', remaining: 17, resetsAt: '2026-11-13T22:00:00Z', at: null };
  assert.equal(sentence([claude], context), 'Claude lasts until Fri 5 PM.');
});

test('times read as a weekday and hour, rounded to a quarter hour', () => {
  assert.equal(when('2026-11-12T20:10:00Z', context), '3:15 PM');
  assert.equal(when('2026-11-14T13:00:00Z', context), 'Sat 8 AM');
  assert.equal(when('2026-12-03T13:00:00Z', context), 'Dec 3');
});

test('the forecast reads stored limit history and leaves absent windows out', () => {
  const reset = now + 48 * HOUR;
  const points = burning(40, 2, 24, reset).map(reading => ({ p: 'claude', w: 'seven_day', o: 'Mac', t: iso(reading.at), r: reading.remaining, x: iso(reset), d: 10080 }));
  const view = { limitHistory: [{ host: 'Mac', points }], claudeLimits: { windows: [{ bucket: 'claude', window: 'seven_day', durationMinutes: 10080, resetsAt: iso(reset) }] }, quota: { windows: [] } };
  const rows = [
    { provider: 'claude', bucket: 'claude', windowId: 'five_hour', window: '5-hour', remaining: null, absent: 'Not reported', stale: false },
    { provider: 'claude', bucket: 'claude', windowId: 'seven_day', window: 'weekly', remaining: 40, stale: false, resetsAt: iso(reset) },
  ];
  const result = forecast(view, rows, context);
  assert.equal(result.engines[0].status, 'runs-out');
  assert.equal(result.engines[1].status, 'unknown');
  assert.equal(result.menu, 'Claude 40%');
  assert.equal(result.sentence, 'Claude runs out Fri 6 AM at this pace. Codex has no current reading.');
});

test('a window with no current number keeps the engine from saying it has room', () => {
  const engine = engineForecast('claude', 'Claude', [
    { status: 'room', remaining: 80, resetsAt: iso(now + HOUR), runoutAt: null, confidence: 'high', window: '5-hour' },
    { status: 'unknown', remaining: null, resetsAt: null, runoutAt: null, confidence: 'low', window: 'weekly' },
  ]);
  assert.equal(engine.status, 'unknown');
  assert.equal(engine.remaining, null);
});

// Off: an engine that cannot be used shows Off, never its last number.
const codexRows = [{ provider: 'codex', bucket: 'codex', windowId: 'primary', window: 'monthly', remaining: 78, stale: false, resetsAt: iso(now + 20 * 24 * HOUR) }];
const codexView = quota => ({ claudeLimits: { windows: [] }, quota: { status: 'ok', checkedAt: iso(now - 60000),
  windows: [{ bucket: 'codex', window: 'primary', durationMinutes: 43200, remainingPercent: 78, resetsAt: iso(now + 20 * 24 * HOUR) }], ...quota } });
const codexOf = result => result.engines.find(engine => engine.engine === 'codex');

test('each off signal has its own reason, and an on engine has none', () => {
  const fresh = { status: 'ok', checkedAt: iso(now - 60000) };
  assert.equal(offReason(fresh, 'auto', now), null);
  assert.equal(offReason(fresh, 'off', now), 'off');
  assert.equal(offReason({ status: 'needs-auth', checkedAt: null }, 'auto', now), 'signed-out');
  assert.equal(offReason({ ...fresh, plan: 'free' }, 'auto', now), 'no-plan');
  assert.equal(offReason({ ...fresh, plan: 'plus' }, 'auto', now), null);
  assert.equal(offReason({ status: 'stale', checkedAt: iso(now - ENGINE_OFF_MS) }, 'auto', now), 'no-reading');
  assert.equal(offReason({ status: 'stale', checkedAt: iso(now - ENGINE_OFF_MS + 60000) }, 'auto', now), null);
  assert.equal(offReason({ status: 'unavailable' }, 'auto', now), null, 'never read is Unknown, not Off');
});

test('"on" keeps a free plan shown, but a sign-out still reads Off', () => {
  assert.equal(offReason({ status: 'ok', checkedAt: iso(now), plan: 'free' }, 'on', now), null);
  assert.equal(offReason({ status: 'needs-auth' }, 'on', now), 'signed-out');
});

test('a plan that ended reads Off instead of the free allowance', () => {
  const result = forecast(codexView({ plan: 'free' }), codexRows, context);
  const codex = codexOf(result);
  assert.equal(codex.status, 'off');
  assert.equal(codex.figure, 'Off');
  assert.equal(codex.remaining, null);
  assert.equal(codex.phrase, 'has no plan');
  assert.equal(result.menu, null, 'an Off engine never fills the menu bar');
  assert.equal(result.scarce, null);
});

test('a signed-out engine reads Off', () => {
  const codex = codexOf(forecast(codexView({ status: 'needs-auth' }), codexRows, context));
  assert.equal(codex.status, 'off');
  assert.equal(codex.phrase, 'is signed out');
});

test('an engine set off in the config reads Off', () => {
  const codex = codexOf(forecast(codexView({}), codexRows, { ...context, settings: { codex: 'off' } }));
  assert.equal(codex.status, 'off');
  assert.equal(codex.phrase, 'is off');
});

test('an engine with no reading for a day says since when', () => {
  const last = now - 3 * 24 * HOUR;
  const codex = codexOf(forecast(codexView({ status: 'stale', checkedAt: iso(last) }), [{ ...codexRows[0], stale: true }], context));
  assert.equal(codex.status, 'off');
  assert.equal(codex.at, iso(last));
  assert.equal(codex.phrase, 'has no reading since Mon 10 AM');
});

test('a paid plan with a fresh reading keeps its number', () => {
  const result = forecast(codexView({ plan: 'plus' }), codexRows, context);
  assert.equal(codexOf(result).status, 'room');
  assert.equal(codexOf(result).remaining, 78);
  assert.equal(result.menu, 'Codex 78%');
});

test('off engines come last in the sentence', () => {
  const result = forecast({ ...codexView({ plan: 'free' }), claudeLimits: { windows: [] } },
    [...codexRows, { provider: 'claude', bucket: 'claude', windowId: 'seven_day', window: 'weekly', remaining: 30, stale: false, resetsAt: iso(now + 48 * HOUR) }], context);
  assert.equal(result.sentence, 'Claude has room. Codex has no plan.');
});

// Grok: optional, with a limit when the app reports one and requests either way.
const grokRow = { provider: 'grok', bucket: 'grok', windowId: 'weekly', window: 'weekly', remaining: 54, stale: false, resetsAt: iso(now + 4 * 24 * HOUR) };
const grokSource = extra => ({ status: 'ok', checkedAt: iso(now - 2 * HOUR), validUntil: iso(now + 20 * HOUR),
  windows: [{ bucket: 'grok', window: 'weekly', durationMinutes: 10080, remainingPercent: 54, resetsAt: iso(now + 4 * 24 * HOUR) }],
  requests: { timeZone: 'America/New_York', checkedAt: iso(now - 60000), days: [{ date: '2026-11-11', count: 9 }, { date: '2026-11-12', count: 3 }] }, ...extra });

test('no Grok tile unless its source is set up', () => {
  assert.deepEqual(forecast(codexView({}), codexRows, context).engines.map(engine => engine.engine), ['claude', 'codex']);
  assert.deepEqual(forecast({ ...codexView({}), grokLimits: { status: 'not-connected', windows: [] } }, codexRows, context).engines.map(engine => engine.engine), ['claude', 'codex']);
});

test('Grok with a limit shows the share left, today\'s requests and when it was read', () => {
  const grok = forecast({ ...codexView({}), grokLimits: grokSource() }, [...codexRows, grokRow], context).engines.find(engine => engine.engine === 'grok');
  assert.equal(grok.status, 'room');
  assert.equal(grok.remaining, 54);
  assert.equal(grok.detail, '3 requests today · as of 8 AM');
});

test('Grok without limit data shows its requests and no percent', () => {
  const result = forecast({ ...codexView({}), grokLimits: grokSource({ windows: [] }) }, codexRows, context);
  const grok = result.engines.find(engine => engine.engine === 'grok');
  assert.equal(grok.status, 'usage');
  assert.equal(grok.figure, '3');
  assert.equal(grok.remaining, null);
  assert.equal(grok.phrase, 'requests today');
  assert.equal(result.menu, 'Codex 78%', 'a request count never fills the menu bar');
});

test('three engines with room share one sentence', () => {
  assert.equal(sentence([{ name: 'Claude', status: 'room', remaining: 80 }, { name: 'Codex', status: 'room', remaining: 70 }, { name: 'Grok', status: 'room', remaining: 60 }], context),
    'Grok, Claude and Codex have room.');
});

// Review fixes.
test('an engine whose saved windows are gone still reads Off a day after its last stored reading', () => {
  const view = { claudeLimits: { status: 'unavailable', windows: [] }, quota: { windows: [] },
    limitHistory: [{ host: 'Mac', points: [{ p: 'claude', w: 'seven_day', o: 'Mac', t: iso(now - 8 * 24 * HOUR), r: 40, x: iso(now - HOUR), d: 10080 }] }] };
  const claude = forecast(view, [{ provider: 'claude', bucket: '', windowId: '', window: '', remaining: null, stale: false }], context).engines[0];
  assert.equal(claude.status, 'off');
  assert.equal(claude.off, 'no-reading');
  assert.equal(claude.phrase, 'has no reading since Nov 4');
});

test('a request count is named in the sentence', () => {
  const result = forecast({ ...codexView({}), grokLimits: grokSource({ windows: [] }) }, codexRows, context);
  assert.equal(result.sentence, 'Codex has room. Claude has no current reading. Grok has 3 requests today.');
});

test('a reading weeks old is named by its date, not a weekday', () => {
  assert.equal(when(iso(now - 20 * 24 * HOUR), context), 'Oct 23');
});

test('without a measured pace a tight window says when it resets, not that it lasts', () => {
  const row = { ...grokRow, remaining: 10 };
  const grok = forecast({ ...codexView({}), grokLimits: grokSource() }, [...codexRows, row], context).engines.find(engine => engine.engine === 'grok');
  assert.equal(grok.phrase, 'resets Mon 10 AM');
});

test('a window the provider never named does not hide the ones it did', () => {
  const rows = [{ provider: 'codex', bucket: 'codex', windowId: 'secondary', window: 'weekly', remaining: 60, stale: false, resetsAt: iso(now + 3 * 24 * HOUR) },
    { provider: 'codex', bucket: '', windowId: '', window: '5-hour', remaining: null, stale: false, gap: true }];
  assert.equal(codexOf(forecast(codexView({}), rows, context)).status, 'room');
});

test('today\'s requests use the time zone the log was counted in', () => {
  const source = grokSource({ windows: [], requests: { timeZone: 'Asia/Tokyo', checkedAt: '2026-11-13T00:55:00Z', days: [{ date: '2026-11-13', count: 4 }] } });
  const grok = forecast({ ...codexView({}), grokLimits: source }, codexRows, { ...context, now: Date.parse('2026-11-13T01:00:00Z') }).engines.find(engine => engine.engine === 'grok');
  assert.equal(grok.figure, '4');
});

test('requests counted on an earlier day give no number for today', () => {
  const source = grokSource({ windows: [], requests: { timeZone: 'America/New_York', checkedAt: iso(now - 14 * HOUR), days: [{ date: '2026-11-11', count: 40 }] } });
  const result = forecast({ ...codexView({}), grokLimits: source }, codexRows, context);
  const grok = result.engines.find(engine => engine.engine === 'grok');
  assert.notEqual(grok.figure, '0');
  assert.equal(grok.status, 'unknown');
});

test('a malformed count is unknown, not zero', () => {
  const source = grokSource({ windows: [], requests: { timeZone: 'America/New_York', checkedAt: iso(now), days: [{ date: '2026-11-12', count: 3.5 }] } });
  assert.equal(forecast({ ...codexView({}), grokLimits: source }, codexRows, context).engines.find(engine => engine.engine === 'grok').status, 'unknown');
});
