// The words on the tray, the menu bar, the status and the Week page, held to one set of rules. The first contract
// (test/forecast-contract.test.mjs) keeps the forecast the same everywhere. This one keeps what surrounds it the same:
// a source that is off appears nowhere, a computer that is off adds nothing to a sum, and the reset label and the
// percent framing are the stored ones on every surface.
import test from 'node:test';
import assert from 'node:assert/strict';
import { combine } from '../lib/combine.mjs';
import { summaryOf } from '../lib/summary.mjs';
import { weekView } from '../lib/view-week.mjs';
import { glanceView } from '../lib/glance-view.mjs';
import { agentStatus } from '../lib/agent-status.mjs';
import { describe } from '../scripts/status.mjs';
import { ownSnapshot } from './helpers.mjs';

const HOUR = 3600000, MINUTE = 60000;
const now = Date.parse('2026-11-18T12:40:00Z');
const iso = at => new Date(at).toISOString();
const clone = value => JSON.parse(JSON.stringify(value));

// One Claude window, like test/forecast-contract.test.mjs: `remaining` left now, spent evenly, resetting in `resetHours`.
function claudeWindow({ id, minutes, remaining, resetHours }) {
  const length = minutes * MINUTE, resetsAt = now + resetHours * HOUR, opened = resetsAt - length;
  const rate = (100 - remaining) / ((now - opened) / HOUR);
  const points = [];
  for (let at = opened; at < now; at += HOUR / 2)
    points.push({ p: 'claude', w: id, o: 'Mac', t: iso(at), x: iso(resetsAt), d: minutes, r: Math.max(0, 100 - rate * (at - opened) / HOUR) });
  return { window: { bucket: 'claude', window: id, durationMinutes: minutes, remainingPercent: remaining, resetsAt: iso(resetsAt), checkedAt: iso(now - MINUTE) }, points };
}

const CODEX_FREE = { status: 'ok', plan: 'free', checkedAt: iso(now - MINUTE), provider: 'Codex', scope: 'account',
  windows: [{ bucket: 'codex', window: '30_day', durationMinutes: 43200, remainingPercent: 60, resetsAt: iso(now + 9 * 24 * HOUR), checkedAt: iso(now - MINUTE) }] };

/**
 * A fleet read by the Mac. `others` says how each other computer reads: 'on', 'off' (turned off in the settings, with
 * its last reading kept) or absent. Codex is on or off in the settings, and a copy from the PC still carries a free Codex plan.
 */
function fleet({ others = { Windows: 'off', Linux: 'off' }, codex = false } = {}) {
  const parts = [claudeWindow({ id: 'seven_day', minutes: 10080, remaining: 27, resetHours: 52 }), claudeWindow({ id: 'five_hour', minutes: 300, remaining: 61, resetHours: 2 })];
  const own = (host, at, change = snapshot => snapshot) => ownSnapshot(host, at, snapshot => change({ ...snapshot, timezone: 'America/New_York', collectedAt: iso(at - MINUTE),
    grokLimits: { status: 'not-connected', windows: [] } }));
  const mac = own('Mac', now, snapshot => ({ ...snapshot,
    claudeLimits: { status: 'ok', checkedAt: iso(now - MINUTE), windows: parts.map(part => part.window) },
    limitHistory: [{ host: 'Mac', status: 'ok', points: parts.flatMap(part => part.points) }] }));
  const devices = [{ host: 'Mac', name: 'Studio Mac', snapshot: mac }];
  for (const [host, state] of Object.entries(others)) {
    const at = state === 'off' ? now - 3 * HOUR : now;
    devices.push({ host, name: host === 'Windows' ? 'Desk PC' : 'Desk Linux', off: state === 'off',
      snapshot: own(host, at, snapshot => host === 'Windows' ? { ...snapshot, quota: CODEX_FREE } : snapshot) });
  }
  return combine(devices, { now, generatedBy: 'Mac', engines: {},
    sources: { screenTime: true, claudeCode: true, claudeLimits: true, codex, codexLimits: codex } });
}

function surfaces(combined) {
  const status = agentStatus(clone(combined), now);
  return { tray: combined.glance.lines, glance: glanceView(clone(combined), { now, timeZone: 'America/New_York' }),
    week: weekView(summaryOf(clone(combined)), { now }), status, statusText: describe(status), stored: combined.glance.forecast };
}
const everything = shown => JSON.stringify([shown.tray, shown.glance, shown.week, shown.status, shown.statusText, shown.stored.sentence, shown.stored.windows, shown.stored.engines]);

test('a source that is off appears on no surface, even when another computer carries a copy of it', () => {
  const on = surfaces(fleet({ codex: true }));
  assert.match(everything(on), /Codex/, 'the check bites: with Codex on, it is named');
  const off = surfaces(fleet({ codex: false }));
  // The status keeps its fixed engine slots for job routing, but marks the one that is off and does not print it.
  assert.equal(off.status.engines.codex.sourceOff, true);
  for (const [name, part] of Object.entries({ tray: off.tray, glance: off.glance, week: off.week, statusText: off.statusText, sentence: off.stored.sentence, windows: off.stored.windows, engines: off.stored.engines }))
    assert.doesNotMatch(JSON.stringify(part), /codex|no plan/i, name);
  assert.equal(off.stored.engines.some(engine => engine.engine === 'codex'), false);
  assert.equal(off.glance.limits.some(row => row.engine === 'codex'), false);
});

const sumLine = lines => lines.find(line => /^ {2}(All|Both): /.test(line));

test('with only one computer on, there is no total line, and a computer that is off adds nothing', () => {
  const combined = fleet({ others: { Windows: 'off', Linux: 'off' } });
  assert.equal(combined.glance.both, null);
  assert.equal(sumLine(combined.glance.lines), undefined);
  assert.ok(combined.glance.lines.some(line => /^ {2}PC: Off$/.test(line)));
});

test('with several computers on, the total is the sum of those on, labeled, and says All', () => {
  for (const others of [{ Windows: 'on' }, { Windows: 'on', Linux: 'on' }, { Windows: 'off', Linux: 'on' }]) {
    const combined = fleet({ others });
    const line = sumLine(combined.glance.lines);
    assert.ok(line, JSON.stringify(others));
    assert.match(line, /^ {2}All: /);
    assert.match(line, /\(sum, not deduplicated\)$/);
    assert.doesNotMatch(combined.glance.lines.join('\n'), /Both/);
    // Only computers that are on add to it.
    const adding = combined.glance.today.filter(row => row.state !== 'off');
    assert.equal(combined.glance.both.tokens, adding.reduce((total, row) => row.tokensOn ? total + row.tokens : total, 0), JSON.stringify(others));
  }
  // A computer that is off has real numbers of its own and still adds nothing.
  const withOff = fleet({ others: { Windows: 'off', Linux: 'on' } }), without = fleet({ others: { Linux: 'on' } });
  assert.deepEqual(withOff.glance.both, without.glance.both);
  assert.equal(sumLine(withOff.glance.lines), sumLine(without.glance.lines));
});

const LIMIT_LINE = /^ {2}(Claude Code|Codex) (5-hour|7-day|weekly|30-day)/;

test('the reset is the stored label on every surface, never a countdown', () => {
  const shown = surfaces(fleet());
  assert.doesNotMatch(everything(shown), /Resets in |resets in /);
  const limitLines = shown.tray.filter(line => /^ {2}Claude/.test(line));
  assert.ok(limitLines.length >= 2, 'both Claude windows are listed');
  for (const window of shown.stored.windows) {
    const line = limitLines.find(row => row.includes(` ${window.window}: `));
    assert.ok(window.resets && /^Resets (Mon|Tue|Wed|Thu|Fri|Sat|Sun) /.test(window.resets), window.resets);
    assert.ok(line && line.includes(` · ${window.resets}`), `${line} lacks "${window.resets}"`);
  }
  const weekly = shown.stored.windows.find(window => window.windowId === 'seven_day');
  assert.equal(shown.week.headline.resets, weekly.resets);
  assert.equal(shown.status.engines.claude.windows.weekly.forecast.resetsLabel, weekly.resets);
  assert.ok(shown.statusText.includes(weekly.resets), shown.statusText);
});

test('every surface says how much of a limit is used, never how much is left', () => {
  const shown = surfaces(fleet());
  assert.doesNotMatch(everything(shown), /% left/);
  assert.doesNotMatch(shown.statusText, /% left/);
  const weeklyLine = shown.tray.find(line => /^ {2}Claude Code 7 days?|^ {2}Claude Code.*week/i.test(line)) ?? shown.tray.find(line => /27% left|73% used/.test(line));
  assert.ok(weeklyLine?.includes('73% used'), weeklyLine);
  assert.equal(shown.glance.headline.used, '73% of the week used');
  assert.match(shown.statusText, /weekly 73% used/);
  assert.equal(shown.week.headline.usedText, '73% used');
  for (const line of shown.tray.filter(row => LIMIT_LINE.test(row))) assert.match(line, /: (\d+% used|Unknown|Off|none)/, line);
});
