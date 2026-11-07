import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {cp, mkdir, utimes, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {promisify} from 'node:util';
import {combine} from '../lib/combine.mjs';
import {agentStatus, classifyPace, effectiveHeadroom, MAX_SLOTS, SPEND_MARGIN, windowPace} from '../lib/agent-status.mjs';
import {countCodexJobs, main, STALE_MARKER_MS} from '../scripts/status.mjs';
import {ownSnapshot, withFolder} from './helpers.mjs';

const now = Date.parse('2026-10-21T17:00:00Z');
const iso = at => new Date(at).toISOString();
const hour = 3600000;

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
  assert.equal(classifyPace(50, 25, 120), 'slow');
  assert.equal(classifyPace(50, 24.9, 120), 'hold');
  assert.equal(classifyPace(50, (50 - SPEND_MARGIN) / 2, 120), 'spend');
  assert.equal(classifyPace(50, (50 - SPEND_MARGIN) / 2 + 0.1, 120), 'hold');
  assert.equal(classifyPace(50, 0, 120), 'spend');
});

test('JSON shape is stable and carries no personal data', () => {
  const status = agentStatus(today, now);
  const window = ['percentLeft', 'resetsAt', 'minutesToReset', 'burnPerHour', 'pace'];
  assert.deepEqual(Object.keys(status), ['schema', 'generatedAt', 'current', 'engines', 'nextReturn', 'route', 'cap']);
  assert.deepEqual(Object.keys(status.cap), ['total', 'claude', 'codex', 'codexRunning', 'reason']);
  assert.deepEqual(Object.keys(status.nextReturn.codex), ['resetsAt', 'minutesToReset']);
  assert.equal(status.schema, 1);
  assert.equal(status.generatedAt, iso(now));
  assert.deepEqual(Object.keys(status.engines), ['claude', 'codex']);
  for (const engine of ['claude', 'codex']) {
    assert.deepEqual(Object.keys(status.engines[engine]), ['status', 'headroom', 'effectiveHeadroom', 'pace', 'windows']);
    assert.deepEqual(Object.keys(status.engines[engine].windows), ['five_hour', 'weekly']);
    for (const item of Object.values(status.engines[engine].windows)) assert.deepEqual(Object.keys(item), window);
  }
  assert.deepEqual(Object.keys(status.route), ['code', 'review', 'research']);
  for (const hint of Object.values(status.route)) assert.deepEqual(Object.keys(hint), ['engine', 'reason']);
  const text = JSON.stringify(status);
  for (const secret of ['Test Mac', 'Mac', 'Windows', '/', '\\']) assert.equal(text.includes(secret), false, secret);
});

test('nextReturn gives the reset of the window at 0, the later one when both are at 0', () => {
  assert.deepEqual(agentStatus(today, now).nextReturn, {codex: {resetsAt: iso(now + hour), minutesToReset: 60}});
  const both = fixture({
    claude: [['five_hour', 300, 91, 4 * hour], ['seven_day', 10080, 70, 48 * hour]],
    codex: [['primary', 300, 0, hour], ['secondary', 10080, 0, 100 * hour]],
  });
  assert.deepEqual(agentStatus(both, now).nextReturn, {codex: {resetsAt: iso(now + 100 * hour), minutesToReset: 6000}});
  const fine = fixture({
    claude: [['five_hour', 300, 91, 4 * hour], ['seven_day', 10080, 70, 48 * hour]],
    codex: [['primary', 300, 40, hour], ['secondary', 10080, 55, 100 * hour]],
  });
  assert.deepEqual(agentStatus(fine, now).nextReturn, {});
});

// Claude Ultra: no 5-hour window, weekly 96% left 151 h before reset, a burst of 1.1%/h.
const ultra = fixture({
  claude: [['seven_day', 10080, 96, 151 * hour, 1.1]],
  codex: [['primary', 300, 76, 280 * 60000], ['secondary', 10080, 74, 98 * hour, 3.2]],
});

test('with no 5-hour window, the weekly window decides and Claude is no longer unknown', () => {
  const status = agentStatus(ultra, now);
  const claude = status.engines.claude;
  assert.equal(claude.windows.five_hour.percentLeft, null);
  assert.equal(claude.status, 'ok');
  assert.equal(claude.headroom, 96);
  assert.equal(claude.effectiveHeadroom, 100);
  assert.equal(claude.pace, 'spend');
  assert.equal(status.engines.codex.status, 'ok');
  // A missing weekly reading still means unknown.
  const noWeekly = fixture({claude: [['five_hour', 300, 80, hour]], codex: [['primary', 300, 76, hour], ['secondary', 10080, 74, 98 * hour]]});
  assert.equal(agentStatus(noWeekly, now).engines.claude.status, 'unknown');
  // A 5-hour window that was reported but went stale is unknown, not absent.
  const staleShort = fixture({claude: [['seven_day', 10080, 96, 151 * hour]], codex: [['primary', 300, 0, hour], ['secondary', 10080, 100, 98 * hour]]});
  const staleView = structuredClone(staleShort);
  for (const row of staleView.glance.limits) if (row.provider === 'codex' && row.window === '5-hour') row.checkedAt = iso(now - 11 * 60000);
  const staleStatus = agentStatus(staleView, now);
  assert.equal(staleStatus.engines.codex.windows.five_hour.percentLeft, null);
  assert.equal(staleStatus.engines.codex.status, 'unknown');
});

test('review and research prefer Claude when it has as much effective headroom; code stays on Codex', () => {
  const status = agentStatus(ultra, now);
  assert.equal(status.route.code.engine, 'codex');
  assert.equal(status.route.review.engine, 'claude');
  assert.equal(status.route.research.engine, 'claude');
  assert.match(status.route.review.reason, /claude has 100% effective headroom, codex has \d+%/);
  // Claude behind its budget loses review to a Codex with more room.
  const tight = fixture({
    claude: [['seven_day', 10080, 20, 151 * hour]],
    codex: [['primary', 300, 90, 280 * 60000], ['secondary', 10080, 74, 98 * hour]],
  });
  assert.equal(agentStatus(tight, now).route.review.engine, 'codex');
});

test('code moves to Claude when every Codex slot is busy or Codex is low', () => {
  const busy = agentStatus(ultra, now, {codexRunning: MAX_SLOTS.codex});
  assert.equal(busy.route.code.engine, 'claude');
  assert.match(busy.route.code.reason, /all \d+ Codex slots busy/);
  assert.equal(agentStatus(ultra, now, {codexRunning: 1}).route.code.engine, 'codex');
  const low = fixture({
    claude: [['seven_day', 10080, 96, 151 * hour]],
    codex: [['primary', 300, 5, 280 * 60000], ['secondary', 10080, 74, 98 * hour]],
  });
  const lowStatus = agentStatus(low, now);
  assert.equal(lowStatus.route.code.engine, 'claude');
  assert.match(lowStatus.route.code.reason, /codex is low/);
});

test('job cap follows pace: Claude spending gives more than the old fixed 6', () => {
  const cap = agentStatus(ultra, now, {codexRunning: 2}).cap;
  assert.equal(cap.claude, MAX_SLOTS.claude);
  assert.ok(cap.codex >= 1 && cap.codex <= MAX_SLOTS.codex);
  assert.equal(cap.total, cap.claude + cap.codex);
  assert.ok(cap.total > 6);
  assert.equal(cap.codexRunning, 2);
  // Out of allowance gives 0 slots; stale readings give 1 each.
  assert.equal(agentStatus(today, now).cap.codex, 0);
  assert.deepEqual([agentStatus(null, now).cap.claude, agentStatus(null, now).cap.codex], [1, 1]);
  // Behind budget and burning toward 0 gives one slot.
  const slow = fixture({claude: [['seven_day', 10080, 10, 151 * hour, 2]], codex: [['primary', 300, 0, hour], ['secondary', 10080, 50, 98 * hour]]});
  assert.equal(agentStatus(slow, now).cap.claude, 1);
});

test('straight-line pace and time-adjusted headroom', () => {
  assert.equal(windowPace(96, 1.1, 151 * 60, 10080), 'spend');
  assert.equal(windowPace(50, 25, 120, 300), 'spend');
  assert.equal(windowPace(30, 25, 120, 300), 'slow');
  assert.equal(windowPace(30, null, 280, 300), 'hold');
  assert.equal(windowPace(50, null, 150, 300), 'spend');
  assert.equal(windowPace(30, 5, 150, 300), 'hold');
  assert.equal(windowPace(30, 0, 150, 300), 'spend');
  assert.equal(windowPace(30, null, null, 300), 'unknown');
  assert.equal(windowPace(0, 0, 280, 300), 'out');
  assert.equal(windowPace(null, 1, 280, 300), 'unknown');
  assert.equal(effectiveHeadroom(96, 151 * 60, 10080), 100);
  assert.equal(effectiveHeadroom(40, 100 * 60, 10080), 67);
  assert.equal(effectiveHeadroom(0, 60, 300), 0);
  assert.equal(effectiveHeadroom(null, 60, 300), null);
  assert.equal(effectiveHeadroom(55, null, 300), 55);
  assert.equal(effectiveHeadroom(55, 0, 300), 55);
  assert.equal(effectiveHeadroom(10, 150, 300), 20);
  assert.equal(effectiveHeadroom(0.4, 300, 300), 1);
});

test('ties go to Claude for review and research; code needs Codex at 20% effective or more', () => {
  const tie = fixture({claude: [['seven_day', 10080, 50, 84 * hour]], codex: [['primary', 300, 50, 150 * 60000], ['secondary', 10080, 90, 84 * hour]]});
  const status = agentStatus(tie, now);
  assert.equal(status.engines.claude.effectiveHeadroom, status.engines.codex.effectiveHeadroom);
  assert.equal(status.route.review.engine, 'claude');
  assert.equal(status.route.research.engine, 'claude');
  assert.equal(status.route.code.engine, 'codex');
  const edge = left => fixture({claude: [['seven_day', 10080, 96, 151 * hour]], codex: [['primary', 300, left, 150 * 60000], ['secondary', 10080, 90, 84 * hour]]});
  assert.equal(agentStatus(edge(10), now).engines.codex.effectiveHeadroom, SPEND_MARGIN);
  assert.equal(agentStatus(edge(10), now).route.code.engine, 'codex');
  assert.equal(agentStatus(edge(9), now).route.code.engine, 'claude');
  // With Claude out, a busy or low Codex still gets the work.
  const claudeOut = fixture({claude: [['seven_day', 10080, 0, 151 * hour]], codex: [['primary', 300, 5, 150 * 60000], ['secondary', 10080, 90, 84 * hour]]});
  const out = agentStatus(claudeOut, now, {codexRunning: 99});
  for (const task of ['code', 'review', 'research']) assert.equal(out.route[task].engine, 'codex');
});

test('a holding engine gets slots in proportion to its effective headroom, at least 1', () => {
  // Codex 5-hour 30% left with half the window to go, burning 5%/h: over budget, ends near the margin.
  const hold = fixture({claude: [['seven_day', 10080, 96, 151 * hour]], codex: [['primary', 300, 30, 150 * 60000, 5], ['secondary', 10080, 90, 84 * hour]]});
  const status = agentStatus(hold, now, {codexRunning: 3});
  assert.equal(status.engines.codex.pace, 'hold');
  assert.equal(status.engines.codex.effectiveHeadroom, 60);
  assert.equal(status.cap.codex, Math.ceil(MAX_SLOTS.codex * 0.6));
  assert.equal(status.cap.codexRunning, 3);
  assert.equal(status.route.code.engine, 'claude');
  assert.match(status.route.code.reason, /all 3 Codex slots busy/);
  assert.match(status.cap.reason, /codex pace hold, 60% effective gives 3/);
  assert.equal(agentStatus(hold, now).cap.codexRunning, null);
  const thin = fixture({claude: [['seven_day', 10080, 96, 151 * hour]], codex: [['primary', 300, 2, 150 * 60000, 0.1], ['secondary', 10080, 90, 84 * hour]]});
  assert.equal(agentStatus(thin, now).cap.codex, 1);
});

test('stale Codex job markers do not count as busy', async () => {
  await withFolder(async folder => {
    await writeFile(path.join(folder, 'a.running'), 'x');
    await writeFile(path.join(folder, 'b.running'), 'x');
    await writeFile(path.join(folder, 'c.md'), 'x');
    const old = (Date.now() - STALE_MARKER_MS - 60000) / 1000;
    await utimes(path.join(folder, 'b.running'), old, old);
    assert.equal(await countCodexJobs(folder), 1);
    assert.equal(await countCodexJobs(path.join(folder, 'missing')), null);
  });
});

function fakeRun(args) {
  let at = now;
  const sleeps = [], output = [];
  const result = main(args, {read: async () => today, clock: () => at, running: async () => null,
    sleep: async ms => { sleeps.push(ms); at += ms; }, write: text => output.push(text), fail: text => output.push(text)});
  return result.then(code => ({code, at, sleeps, output: output.join('')}));
}

test('--wait sleeps until the reset, even after the 0% reading goes stale, then exits 0', async () => {
  const result = await fakeRun(['--wait', 'codex']);
  assert.equal(result.code, 0);
  assert.equal(result.at, now + hour);
  assert.deepEqual(result.sleeps, [hour]);
  assert.notEqual(JSON.parse(result.output).engines.codex.status, 'out');
});

test('--wait returns at once when the engine is not out, and exits 4 on timeout', async () => {
  const ready = await fakeRun(['--wait', 'claude']);
  assert.deepEqual([ready.code, ready.sleeps], [0, []]);
  const late = await fakeRun(['--wait', 'codex', '--timeout', '5']);
  assert.equal(late.code, 4);
  assert.equal(late.at, now + 5 * 60000);
  assert.equal(JSON.parse(late.output).engines.codex.status, 'out');
});

test('--wait exits 2 on a bad engine or timeout', async () => {
  for (const args of [['--wait', 'gemini'], ['--wait'], ['--wait', 'codex', '--timeout', '0'], ['--wait', 'codex', '--timeout', 'soon']]) {
    const result = await fakeRun(args);
    assert.equal(result.code, 2, args.join(' '));
    assert.deepEqual(result.sleeps, []);
  }
});

test('status runs with plain node and no node_modules, exits 0 with a current reading and 3 without one', {skip: !['darwin', 'win32'].includes(process.platform) && 'settings load on macOS and Windows only'}, async () => {
  await withFolder(async folder => {
    const local = path.join(folder, 'public', 'local');
    await mkdir(local, {recursive: true});
    const config = path.join(folder, 'observatory.config.json');
    await writeFile(config, JSON.stringify({dataFolder: folder}));
    const repo = fileURLToPath(new URL('..', import.meta.url));
    const bare = path.join(folder, 'bare');
    for (const entry of ['lib', 'scripts', 'package.json']) await cp(path.join(repo, entry), path.join(bare, entry), {recursive: true});
    const run = args => promisify(execFile)(process.execPath, ['scripts/status.mjs', ...args],
      {cwd: bare, env: {...process.env, OBSERVATORY_CONFIG: config, NODE_PATH: ''}}).then(result => ({code: 0, ...result}), error => error);
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
    assert.match(human.stdout, /Route code: Claude/);
    assert.match(human.stdout, /Route review, research: Claude/);
    assert.match(human.stdout, /Job cap: \d+ \(Claude \d+, Codex 0/);
    assert.match(human.stdout, /Codex back at \d\d:\d\d/);
    const waited = await run(['--wait', 'claude', '--timeout', '1']);
    assert.equal(waited.code, 0);
    assert.equal(JSON.parse(waited.stdout).engines.claude.status, 'ok');
  });
});
