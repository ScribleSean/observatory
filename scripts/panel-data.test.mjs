import assert from 'node:assert/strict';
import test from 'node:test';
import { compact, demoSnapshot, devices, duration, limits, periodDays, recordedDays, totals } from '../lib/panel-data.mjs';

const now = Date.parse('2026-03-10T15:00:00Z');
const day = (date, totalTokens) => ({ date, totalTokens });
const snapshot = () => ({
  timezone: 'UTC',
  tokens: [{ host: 'Mac', status: 'ok', days: [day('2026-03-10', 100), day('2026-03-09', 50)] },
    { host: 'Windows', status: 'ok', days: [day('2026-03-10', 40)] }],
  settings: [],
  combinedTokens: { status: 'ok', verification: { status: 'verified' }, days: [day('2026-03-10', 120)] },
  activity: [{ host: 'Mac', status: 'ok', days: [{ date: '2026-03-10', seconds: 3600 }] }],
});

test('All uses the verified aggregate and never adds device records', () => {
  assert.equal(totals(snapshot(), 'All', 'day', new Date(now)).codexTokens, 120);
});

test('All is withheld without verification or with a missing device', () => {
  const unverified = snapshot(); unverified.combinedTokens.verification.status = 'unverified';
  assert.equal(totals(unverified, 'All', 'day', new Date(now)).codexTokens, null);
  const missing = snapshot(); missing.tokens[1].status = 'unavailable';
  assert.deepEqual(recordedDays(missing, 'tokens', 'All'), []);
  assert.match(totals(missing, 'All', 'day', new Date(now)).note, /verified records/);
});

test('a retired host blocks the combined total', () => {
  const retired = snapshot(); retired.tokens.push({ host: 'Ubuntu', status: 'ok', days: [day('2026-03-10', 5)] });
  assert.deepEqual(recordedDays(retired, 'tokens', 'All'), []);
});

test('month covers 30 calendar days and week covers 7', () => {
  const days = Array.from({ length: 45 }, (_, index) => day(new Date(now - index * 86400000).toISOString().slice(0, 10), 1));
  assert.equal(periodDays(days, 'month', '2026-03-10').length, 30);
  assert.equal(periodDays(days, 'week', '2026-03-10').length, 7);
  assert.equal(periodDays(days, 'day', '2026-03-10').length, 1);
  assert.equal(periodDays(days, 'all', '2026-03-10').length, 45);
});

test('missing values stay Unknown and are never zero', () => {
  const broken = snapshot(); broken.tokens[0].days[0].totalTokens = null;
  assert.equal(totals(broken, 'Mac', 'week', new Date(now)).codexTokens, null);
  assert.equal(totals(snapshot(), 'Windows', 'day', new Date(now)).seconds, null);
  assert.equal(compact(null), 'Unknown');
  assert.equal(duration(undefined), 'Unknown');
  assert.equal(totals(snapshot(), 'Mac', 'now', new Date(now)).codexTokens, null);
  const quiet = totals(snapshot(), 'Windows', 'day', new Date(now + 86400000));
  assert.deepEqual([quiet.codexTokens, quiet.codexNote], [null, 'No records']);
  const unread = snapshot(); unread.tokens[1].status = 'unavailable';
  assert.equal(totals(unread, 'Windows', 'day', new Date(now)).codexNote, '');
});

test('Claude Code tokens are per device and have no combined total', () => {
  const data = snapshot();
  data.providerTokenSources = [{ provider: 'claude-code', host: 'Mac', status: 'ok', days: [day('2026-03-10', 70)] }];
  assert.equal(totals(data, 'Mac', 'day', new Date(now)).claudeTokens, 70);
  assert.equal(totals(data, 'All', 'day', new Date(now)).claudeTokens, null);
  assert.equal(totals(data, 'All', 'day', new Date(now)).claudeNote, 'By device');
  assert.equal(totals(data, 'Windows', 'day', new Date(now)).claudeTokens, null);
});

test('a provider without a reading gets one Unknown row', () => {
  const rows = limits({}, now);
  assert.deepEqual(rows.map(row => [row.provider, row.remaining]), [['claude', null], ['codex', null]]);
});

test('limit rows mark old readings and low limits, and reject impossible values', () => {
  const quota = { status: 'ok', checkedAt: new Date(now - 60000).toISOString(), windows: [
    { bucket: 'codex', window: 'primary', durationMinutes: 300, remainingPercent: 81, resetsAt: new Date(now + 3600000).toISOString() },
    { bucket: 'codex', window: 'secondary', durationMinutes: 10080, remainingPercent: 12, resetsAt: new Date(now + 86400000).toISOString() },
    { bucket: 'codex', window: 'other', durationMinutes: 60, remainingPercent: 140, resetsAt: 'bad' },
    { bucket: 'codex_spark', window: 'primary', durationMinutes: 300, remainingPercent: 50 }] };
  const rows = limits({ quota }, now).filter(row => row.provider === 'codex');
  assert.equal(rows.length, 3);
  assert.deepEqual([rows[0].window, rows[0].low, rows[0].stale, rows[0].remaining], ['5-hour', false, false, 81]);
  assert.deepEqual([rows[1].window, rows[1].low], ['weekly', true]);
  assert.equal(rows[2].remaining, null);
  assert.match(rows[2].note, /Reset time unknown/);
  const old = limits({ quota: { ...quota, checkedAt: new Date(now - 3600000).toISOString() } }, now).filter(row => row.provider === 'codex');
  assert.deepEqual([old[0].low, old[0].stale], [false, true]);
  assert.match(old[0].note, /as of/);
});

test('device labels use a custom name or the platform name', () => {
  assert.deepEqual(devices(snapshot()).map(device => device.label), ['macOS', 'Windows']);
  assert.deepEqual(devices({ ...snapshot(), deviceNames: { Mac: ' Studio ' } }).map(device => device.label), ['Studio', 'Windows']);
});

test('the sample snapshot renders every row with a value', () => {
  const demo = demoSnapshot(now);
  assert.equal(limits(demo, now).every(row => row.remaining !== null), true);
  const sums = totals(demo, 'All', 'month', new Date(now));
  assert.equal(sums.codexTokens > 0 && sums.seconds > 0 && sums.usd > 0, true);
});
