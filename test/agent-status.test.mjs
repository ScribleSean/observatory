import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {combine} from '../lib/combine.mjs';
import {agentStatus, classifyPace, SPEND_MARGIN} from '../lib/agent-status.mjs';
import {ownSnapshot, withFolder} from './helpers.mjs';

const now = Date.parse('2026-10-21T17:00:00Z');
const iso = at => new Date(at).toISOString();
const hour = 3600000;

// Readings every 10 minutes for the last 30 minutes, falling by `burn` points per hour.
function source(bucket, rows, checkedAt = now) {
  const windows = rows.map(([window, durationMinutes, remainingPercent, resetIn]) =>
    ({bucket, window, durationMinutes, remainingPercent, resetsAt: iso(checkedAt + resetIn)}));
  const history = [30, 20, 10, 0].map(ago => ({checkedAt: iso(checkedAt - ago * 60000),
    windows: rows.map(([window, durationMinutes, remainingPercent, resetIn, burn = 0]) =>
      ({bucket, window, durationMinutes, remainingPercent: remainingPercent + burn * ago / 60, resetsAt: iso(checkedAt + resetIn)}))}));
  return {status: 'ok', checkedAt: iso(checkedAt), windows, history};
}

function fixture({claude, codex, checkedAt = now}) {
  const snapshot = ownSnapshot('Mac', checkedAt, value => ({...value,
    claudeLimits: source('claude', claude, checkedAt), quota: source('codex', codex, checkedAt)}));
  return combine([{host: 'Mac', snapshot}], {now: checkedAt});
}

const today = fixture({
  claude: [['five_hour', 300, 91, 4 * hour, 10], ['seven_day', 10080, 70, 48 * hour, 1]],
  codex: [['primary', 300, 0, hour], ['secondary', 10080, 55, 100 * hour]],
});

test('Codex at 0% on its 5-hour window routes every task to Claude', () => {
  const status = agentStatus(today, now);
  assert.equal(status.current, true);
  assert.equal(status.engines.codex.status, 'out');
  assert.equal(status.engines.codex.headroom, 0);
  assert.equal(status.engines.codex.windows.five_hour.pace, 'out');
  assert.equal(status.engines.claude.headroom, 70);
  assert.equal(status.engines.claude.windows.five_hour.burnPerHour, 10);
  for (const task of ['code', 'review', 'research']) {
    assert.equal(status.route[task].engine, 'claude');
    assert.match(status.route[task].reason, /codex is out for 60 min/);
  }
});

test('the engine with more effective headroom wins, and an engine out of allowance is never picked', () => {
  const both = fixture({
    claude: [['five_hour', 300, 30, hour], ['seven_day', 10080, 90, 48 * hour]],
    codex: [['primary', 300, 80, hour], ['secondary', 10080, 40, 100 * hour]],
  });
  assert.equal(agentStatus(both, now).route.code.engine, 'codex');
  const none = fixture({
    claude: [['five_hour', 300, 0, hour], ['seven_day', 10080, 90, 48 * hour]],
    codex: [['primary', 300, 0, hour], ['secondary', 10080, 40, 100 * hour]],
  });
  assert.equal(agentStatus(none, now).route.code.engine, null);
});

test('stale data gives null, never 0, and no current reading', () => {
  const later = now + 11 * 60000;
  const status = agentStatus(today, later);
  assert.equal(status.current, false);
  for (const engine of ['claude', 'codex']) {
    assert.equal(status.engines[engine].headroom, null);
    assert.equal(status.engines[engine].status, 'unknown');
    for (const window of Object.values(status.engines[engine].windows)) {
      assert.equal(window.percentLeft, null);
      assert.equal(window.burnPerHour, null);
      assert.equal(window.pace, 'unknown');
    }
  }
  assert.equal(status.route.code.engine, null);
  assert.equal(agentStatus(null, now).current, false);
});

test('pace classification boundaries', () => {
  assert.equal(classifyPace(null, 5, 60), 'unknown');
  assert.equal(classifyPace(0, 5, 60), 'out');
  assert.equal(classifyPace(50, null, 60), 'unknown');
  assert.equal(classifyPace(50, 5, null), 'unknown');
  // 50 left, 2 hours to reset: reaching 0 exactly at reset counts as slow.
  assert.equal(classifyPace(50, 25, 120), 'slow');
  assert.equal(classifyPace(50, 24.9, 120), 'hold');
  assert.equal(classifyPace(50, (50 - SPEND_MARGIN) / 2, 120), 'spend');
  assert.equal(classifyPace(50, (50 - SPEND_MARGIN) / 2 + 0.1, 120), 'hold');
  assert.equal(classifyPace(50, 0, 120), 'spend');
});

test('JSON shape is stable and carries no personal data', () => {
  const status = agentStatus(today, now);
  const window = ['percentLeft', 'resetsAt', 'minutesToReset', 'burnPerHour', 'pace'];
  assert.deepEqual(Object.keys(status), ['schema', 'generatedAt', 'current', 'engines', 'route']);
  assert.equal(status.schema, 1);
  assert.equal(status.generatedAt, iso(now));
  assert.deepEqual(Object.keys(status.engines), ['claude', 'codex', 'grokbot']);
  for (const engine of ['claude', 'codex']) {
    assert.deepEqual(Object.keys(status.engines[engine]), ['status', 'headroom', 'pace', 'windows']);
    assert.deepEqual(Object.keys(status.engines[engine].windows), ['five_hour', 'weekly']);
    for (const item of Object.values(status.engines[engine].windows)) assert.deepEqual(Object.keys(item), window);
  }
  assert.deepEqual(status.engines.grokbot, {status: 'unknown', headroom: null, pace: 'unknown', windows: null});
  assert.deepEqual(Object.keys(status.route), ['code', 'review', 'research']);
  for (const hint of Object.values(status.route)) assert.deepEqual(Object.keys(hint), ['engine', 'reason']);
  const text = JSON.stringify(status);
  for (const secret of ['Test Mac', 'Mac', 'Windows', '/', '\\']) assert.equal(text.includes(secret), false, secret);
});

test('npm run status exits 0 with a current reading and 3 without one', {skip: !['darwin', 'win32'].includes(process.platform) && 'settings load on macOS and Windows only'}, async () => {
  await withFolder(async folder => {
    const local = path.join(folder, 'public', 'local');
    await mkdir(local, {recursive: true});
    const config = path.join(folder, 'observatory.config.json');
    await writeFile(config, JSON.stringify({dataFolder: folder}));
    const run = args => promisify(execFile)(process.execPath, ['scripts/status.mjs', ...args],
      {env: {...process.env, OBSERVATORY_CONFIG: config}}).then(result => ({code: 0, ...result}), error => error);
    const missing = await run(['--json']);
    assert.equal(missing.code, 3);
    assert.equal(JSON.parse(missing.stdout).engines.claude.headroom, null);
    const fresh = fixture({
      claude: [['five_hour', 300, 91, 4 * hour, 10], ['seven_day', 10080, 70, 48 * hour, 1]],
      codex: [['primary', 300, 0, hour], ['secondary', 10080, 55, 100 * hour]], checkedAt: Date.now()});
    await writeFile(path.join(local, 'combined.json'), JSON.stringify(fresh));
    const ok = await run(['--json']);
    assert.equal(ok.code, 0);
    assert.equal(JSON.parse(ok.stdout).route.code.engine, 'claude');
    const human = await run([]);
    assert.equal(human.code, 0);
    assert.match(human.stdout, /Route code, review, research: Claude/);
  });
});
