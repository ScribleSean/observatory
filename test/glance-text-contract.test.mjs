// The words on the tray, the menu bar, the status and the dashboard, held to one set of rules. The first contract
// (test/forecast-contract.test.mjs) keeps the forecast the same everywhere. This one keeps what surrounds it the same:
// - Account limits (claudeLimits, codexLimits) are hidden by the hub's setting, stored in the combined view, so every
//   computer shows the same thing.
// - A computer's own usage (tokens, settings, sessions, projects) is hidden only by that computer's setting.
// - A computer that is off, or has a source off, adds nothing to the number it does not contribute to.
// - The reset label, the percent framing and the wording of an old reading are the same on every surface.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { combine } from '../lib/combine.mjs';
import { summaryOf } from '../lib/summary.mjs';
import { weekView } from '../lib/view-week.mjs';
import { glanceView } from '../lib/glance-view.mjs';
import { agentStatus } from '../lib/agent-status.mjs';
import { describe } from '../scripts/status.mjs';
import { runHub, recombine } from '../scripts/hub.mjs';
import { limitRows } from '../lib/view-limits.mjs';
import { limitHistorySeries } from '../lib/view-limit-history.mjs';
import { tokensView } from '../lib/view-tokens.mjs';
import { historyView } from '../lib/view-history.mjs';
import { projectsView } from '../lib/view-projects.mjs';
import { compact } from '../lib/panel-data.mjs';
import strings from '../lib/strings.json' with { type: 'json' };
import { ownSnapshot, withFolder, testConfig } from './helpers.mjs';

// The dashboard's own pages, drawn on the server the way the other view tests draw them.
const root = fileURLToPath(new URL('..', import.meta.url));
const { createServer } = await import('vite');
const { default: react } = await import('@vitejs/plugin-react');
const server = await createServer({ configFile: false, root, server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', plugins: [react()] });
after(() => server.close());
const { LimitsView } = await server.ssrLoadModule('/app/viewer/limits/LimitsView.tsx');
const { TokensSection } = await server.ssrLoadModule('/app/viewer/tokens/tokens.tsx');

const HOUR = 3600000, MINUTE = 60000;
// Wed Nov 18 2026, 7:40 AM in New York. Every reading below is made up.
const now = Date.parse('2026-11-18T12:40:00Z');
const iso = at => new Date(at).toISOString();
const clone = value => JSON.parse(JSON.stringify(value));
const CODEX_OFF = { screenTime: true, claudeCode: true, claudeLimits: true, codex: false, codexLimits: false };
const ALL_ON = { screenTime: true, claudeCode: true, claudeLimits: true, codex: true, codexLimits: true };

// One limit window: `remaining` left now, spent evenly since it opened, resetting in `resetHours`, read `age` minutes ago.
function window({ provider = 'claude', id, minutes, remaining, resetHours, age = 1 }) {
  const length = minutes * MINUTE, resetsAt = now + resetHours * HOUR, opened = resetsAt - length;
  const rate = (100 - remaining) / ((now - opened) / HOUR);
  const points = [];
  for (let at = opened; at < now; at += HOUR / 2)
    points.push({ p: provider, w: id, o: 'Mac', t: iso(at), x: iso(resetsAt), d: minutes, r: Math.max(0, 100 - rate * (at - opened) / HOUR) });
  return { window: { bucket: provider, window: id, durationMinutes: minutes, remainingPercent: remaining, resetsAt: iso(resetsAt), checkedAt: iso(now - age * MINUTE) }, points };
}

// A few finished Codex weeks and 5-hour blocks, so the History page has something to say about Codex.
function codexHistory() {
  const points = [];
  for (const [id, minutes] of [['secondary', 10080], ['primary', 300]])
    for (let back = 1; back <= 3; back++) {
      const reset = now - back * minutes * MINUTE;
      for (let step = 0; step < 6; step++)
        points.push({ p: 'codex', w: id, o: 'Mac', t: iso(reset - (6 - step) * minutes * MINUTE / 8), x: iso(reset), d: minutes, r: 100 - step * 18 });
    }
  return points;
}

const CODEX_QUOTA = { status: 'ok', plan: 'free', checkedAt: iso(now - MINUTE), provider: 'Codex', scope: 'account',
  windows: [{ bucket: 'codex', window: '30_day', durationMinutes: 43200, remainingPercent: 60, resetsAt: iso(now + 9 * 24 * HOUR), checkedAt: iso(now - MINUTE) }] };

// This computer's own Codex usage, removed the way its own collector does when its Codex source is off.
const withoutCodexUsage = (snapshot, host) => ({ ...snapshot, tokens: [{ host, status: 'not-connected' }], settings: [], projectTokens: [],
  ledger: snapshot.ledger.map(row => ({ ...row, tools: row.tools.filter(tool => tool.tool !== 'codex') })) });

/**
 * The hub's combined.json for the Mac. `others` says how each other computer reads: 'on', or 'off' (turned off in the
 * hub's settings, with its last reading kept). A computer in `ownCodex` still reads Codex itself. Every computer
 * carries the Codex limit and its history, which belong to the account.
 */
function fleet({ sources = CODEX_OFF, others = { Windows: 'off' }, ownCodex = [], weeklyRemaining = 27, age = 1, fiveHour = true, screenOff = [] } = {}) {
  const parts = [window({ id: 'seven_day', minutes: 10080, remaining: weeklyRemaining, resetHours: 52, age }), ...(fiveHour ? [window({ id: 'five_hour', minutes: 300, remaining: 61, resetHours: 2, age })] : [])];
  const own = (host, at) => {
    const snapshot = ownSnapshot(host, at, base => ({ ...base, timezone: 'America/New_York', collectedAt: iso(at - MINUTE), grokLimits: { status: 'not-connected', windows: [] },
      claudeLimits: { status: 'ok', checkedAt: iso(now - age * MINUTE), ...(fiveHour ? {} : { notReported: ['five_hour'] }), windows: parts.map(part => part.window) },
      quota: host === 'Mac' ? base.quota : CODEX_QUOTA,
      activity: screenOff.includes(host) ? base.activity.map(row => ({ host: row.host, status: 'not-connected' })) : base.activity,
      limitHistory: [{ host, status: 'ok', points: [...parts.flatMap(part => part.points), ...codexHistory()] }] }));
    return host === 'Mac' || ownCodex.includes(host) ? snapshot : withoutCodexUsage(snapshot, host);
  };
  const devices = [{ host: 'Mac', name: 'Studio Mac', snapshot: own('Mac', now) }];
  for (const [host, state] of Object.entries(others))
    devices.push({ host, name: host === 'Windows' ? 'Desk PC' : 'Desk Linux', off: state === 'off', snapshot: own(host, state === 'off' ? now - 3 * HOUR : now) });
  return combine(devices, { now, generatedBy: 'Mac', engines: {}, sources });
}

function surfaces(combined) {
  const status = agentStatus(clone(combined), now);
  return { tray: combined.glance.lines, glance: glanceView(clone(combined), { now, timeZone: 'America/New_York' }),
    week: weekView(summaryOf(clone(combined)), { now }), status, statusText: describe(status), stored: combined.glance.forecast };
}

const noop = () => {};
const tokensPage = (view, host = 'All') => renderToStaticMarkup(createElement(TokensSection, {
  result: tokensView(view, { host, period: 'week', now }), onHostChange: noop, onPeriodChange: noop, now }));
const history = view => historyView(view, { range: 'month', engine: 'codex', now });
const projects = view => projectsView(view, { host: 'All', now });
const limitLines = surfaced => surfaced.statusText.split('\n').filter(line => /^(Claude|Codex):/.test(line));

test('with the Codex limits off, Codex is on no surface, even with a computer that is on and carries a Codex limit', () => {
  const on = fleet({ sources: ALL_ON, others: { Windows: 'on' }, ownCodex: ['Windows'] });
  const hidden = fleet({ sources: CODEX_OFF, others: { Windows: 'on' } });
  const read = (combined) => { const shown = surfaces(combined);
    return { tray: shown.tray, glance: shown.glance, week: shown.week, limitsText: limitLines(shown), sentence: shown.stored.sentence, windows: shown.stored.windows, engines: shown.stored.engines,
      history: history(combined.view), projects: projects(combined.view), tokens: tokensPage(combined.view), limitRows: limitRows(combined.view, now) }; };
  const withCodex = read(on), without = read(hidden);
  // The check bites: every one of these names Codex when its settings are on.
  for (const [name, part] of Object.entries(withCodex).filter(([name]) => name !== 'windows')) assert.match(JSON.stringify(part), /codex/i, `${name} names Codex when it is on`);
  // With the limits off the computer that is on still carries the limit and its history, and none of it shows.
  assert.equal(hidden.snapshots.Windows.quota.status, 'ok', 'the computer that is on carries a Codex limit');
  assert.ok(hidden.snapshots.Mac.limitHistory[0].points.some(point => point.p === 'codex'), 'and a copy of the Codex history');
  for (const [name, part] of Object.entries(without)) assert.doesNotMatch(JSON.stringify(part), /codex|no plan/i, name);
  assert.ok(withCodex.projects.some(row => row.host === 'Mac') && !without.projects.some(row => row.host === 'Mac'), 'the hub\'s own Codex projects are gone');
  assert.ok(without.history.figures.length > 0, 'the History page still draws, so the check is not vacuous');
  // The history of a hidden engine is not in the stored view either.
  assert.equal(hidden.view.limitHistory.flatMap(row => row.points).some(point => point.p === 'codex'), false);
});

test('whose settings win: usage is hidden by the computer that made it, and the limits by the hub, on the hub and on the spoke', () => withFolder(async hubFolder => withFolder(async spokeFolder => {
  const at = Date.parse('2026-10-21T17:00:00Z');
  const seed = async (folder, file, value) => { const local = path.join(folder, 'public', 'local'); await mkdir(local, { recursive: true, mode: 0o700 }); await writeFile(path.join(local, file), JSON.stringify(value)); };
  const linux = JSON.parse(JSON.stringify(ownSnapshot('Windows', at)).replaceAll('"Windows"', '"Linux"'));
  assert.ok(linux.tokens.some(row => row.host === 'Linux' && row.status === 'ok'), 'the Linux computer reads Codex tokens itself');
  await seed(hubFolder, 'usage.json', ownSnapshot('Mac', at));
  const spokeOf = { name: 'Ubuntu', ssh: 'ubuntu', platform: 'linux', dataFolder: null };
  const hubConfig = testConfig(hubFolder, { role: 'hub', hub: { spokes: [spokeOf] }, sources: { ...CODEX_OFF } });
  const fromHub = await runHub(hubConfig, { now: () => at, transport: { pull: async () => JSON.stringify(linux), push: async () => {} } });
  // The spoke gets the hub's copy, its own snapshot and its own settings: Codex is on there.
  await seed(spokeFolder, 'combined.json', { ...fromHub, hub: { role: 'hub', hubWroteAt: fromHub.generatedAt } });
  await seed(spokeFolder, 'usage.json', linux);
  const spokeConfig = testConfig(spokeFolder, { platform: 'linux', host: 'Linux', device: { name: 'Ubuntu' }, sources: { ...ALL_ON } });
  const fromSpoke = await recombine(spokeConfig, { now: () => at });
  for (const { where, combined } of [{ where: 'hub', combined: fromHub }, { where: 'spoke', combined: fromSpoke }]) {
    const view = combined.view;
    // The hub's limits setting is stored, so the spoke shows the same limits as the hub.
    assert.deepEqual(view.sourcesOff, ['codex', 'grok'].filter(engine => view.sourcesOff.includes(engine)), where);
    assert.ok(view.sourcesOff.includes('codex'), `${where}: the Codex limits are off`);
    assert.doesNotMatch(JSON.stringify([combined.glance.lines, combined.glance.forecast.sentence, history(view)]), /codex/i, `${where}: no Codex limit or history`);
    // Usage belongs to its own computer: the Linux computer's Codex tokens show, the Mac's do not.
    assert.deepEqual(view.tokens.filter(row => row.host !== 'Windows').map(row => `${row.host}:${row.status === 'ok'}`).sort(), ['Linux:true', 'Mac:false'], `${where}: tokens by computer`);
    assert.ok(tokensPage(view).includes('aria-label="Codex"'), `${where}: the Codex card shows Linux's tokens`);
    assert.deepEqual(tokensView(view, { host: 'All', period: 'week', now: at }).codex.byDevice.map(row => row.host), ['Linux'], `${where}: only Linux is in the Codex card`);
    assert.ok(projectsView(view, { host: 'All', now: at }).some(row => row.host === 'Linux'), `${where}: Linux's projects show`);
  }
  // Both computers show the same Codex card and the same limits.
  assert.deepEqual(tokensView(fromHub.view, { host: 'All', period: 'week', now: at }).codex, tokensView(fromSpoke.view, { host: 'All', period: 'week', now: at }).codex);
  assert.deepEqual(fromHub.glance.limits.map(row => row.provider), fromSpoke.glance.limits.map(row => row.provider));
})));

test('with only one computer on, there is no total line, and a computer that is off adds nothing', () => {
  const combined = fleet({ others: { Windows: 'off' } });
  assert.equal(combined.glance.both, null);
  assert.equal(combined.glance.lines.find(line => /^ {2}(All|Both): /.test(line)), undefined);
  assert.ok(combined.glance.lines.some(line => /^ {2}PC: Off$/.test(line)));
});

const allLine = combined => combined.glance.lines.find(line => /^ {2}(All|Both): /.test(line));
const rowOf = (combined, host) => combined.glance.today.find(row => row.host === host);

test('the total adds up the computers that are on, says All, and counts each number by its own contributors', () => {
  const both = fleet({ others: { Windows: 'on' }, sources: ALL_ON, ownCodex: ['Windows'] });
  const mac = rowOf(both, 'Mac'), pc = rowOf(both, 'Windows');
  assert.ok(mac.tokens > 0 && pc.tokens > 0);
  // The sum is written from the two rows' own numbers, with no filter shared with the code.
  assert.match(allLine(both), new RegExp(`^ {2}All: .* screen · ${compact(mac.tokens + pc.tokens)} tokens · .* \\(sum, not deduplicated\\)$`));
  assert.doesNotMatch(both.glance.lines.join('\n'), /Both/);
  // A computer that is off has numbers of its own and adds nothing: the total is the one it would be without it.
  const withOff = fleet({ others: { Windows: 'off' } }), alone = fleet({ others: {} });
  assert.deepEqual(withOff.glance.both, alone.glance.both);
  // Screen time off on both computers: nothing is left to add, so that number reads off, not Unknown.
  const noScreen = fleet({ others: { Windows: 'on' }, screenOff: ['Mac', 'Windows'] });
  assert.match(allLine(noScreen), /^ {2}All: screen off · /);
  assert.ok(rowOf(noScreen, 'Mac').tokens > 0 && allLine(noScreen).includes(`${compact(rowOf(noScreen, 'Mac').tokens + rowOf(noScreen, 'Windows').tokens)} tokens`));
  // Screen time on for one computer only: its number, with no sum label, while the other numbers are still sums.
  const oneScreen = fleet({ others: { Windows: 'on' }, screenOff: ['Windows'] });
  const macScreen = oneScreen.glance.lines.find(line => /^ {2}Mac: /.test(line)).match(/^ {2}Mac: (.*?) screen/)[1];
  assert.ok(allLine(oneScreen).startsWith(`  All: ${macScreen} screen · `), allLine(oneScreen));
  assert.match(allLine(oneScreen), /tokens \(sum, not deduplicated\) · /);
  assert.doesNotMatch(allLine(oneScreen), /screen \(sum/);
  // Nobody has a measure on: every number reads off.
  const none = fleet({ others: { Windows: 'on' }, screenOff: ['Mac', 'Windows'], sources: { ...ALL_ON, screenTime: false } });
  assert.match(allLine(none), /^ {2}All: screen off · /);
});

test('a window the provider does not report reads Not reported and nothing else', () => {
  const combined = fleet({ fiveHour: false });
  assert.ok(combined.glance.lines.includes('  Claude Code 5-hour: Not reported'), combined.glance.lines.join('\n'));
});

test('the reset is the stored label on every surface, never a countdown', () => {
  const shown = surfaces(fleet());
  assert.ok(!JSON.stringify(strings).includes('Resets in'), 'no countdown wording is left in the strings');
  const text = JSON.stringify([shown.tray, shown.glance, shown.week, shown.status, shown.statusText]);
  assert.doesNotMatch(text, /[Rr]esets in /);
  const lines = shown.tray.filter(line => /^ {2}Claude/.test(line));
  assert.equal(lines.length, 2, 'both Claude windows are listed');
  for (const window of shown.stored.windows) {
    assert.match(window.resets, /^Resets (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2}(:\d\d)? (AM|PM)$/);
    const line = lines.find(row => row.includes(` ${window.window}: `));
    assert.ok(line && line.includes(` · ${window.resets}`), `${line} lacks "${window.resets}"`);
  }
  const weekly = shown.stored.windows.find(window => window.windowId === 'seven_day');
  assert.equal(weekly.resets, 'Resets Fri 11:45 AM', 'a known reset: Fri 16:40 UTC is 11:40 AM in New York, rounded to the quarter hour');
  assert.equal(shown.week.headline.resets, weekly.resets);
  assert.equal(shown.status.engines.claude.windows.weekly.forecast.resetsLabel, weekly.resets);
  assert.ok(shown.statusText.includes(weekly.resets), shown.statusText);
  assert.equal(shown.glance.headline.resets, weekly.resets);
  for (const row of limitRows(fleet().view, now).filter(item => item.windowId)) assert.equal(row.note, '', 'the dashboard rows carry no countdown');
});

test('every surface says how much of a limit is used, never how much is left', () => {
  const shown = surfaces(fleet({ weeklyRemaining: 27 }));
  assert.doesNotMatch(JSON.stringify([shown.tray, shown.glance, shown.week, shown.statusText]), /% left/);
  assert.ok(shown.tray.includes('  Claude Code weekly: 73% used · Resets Fri 11:45 AM · runs out around Fri 2:30 AM at this pace') || shown.tray.some(line => /^ {2}Claude Code weekly: 73% used · Resets Fri 11:45 AM/.test(line)), shown.tray.join('\n'));
  assert.equal(shown.glance.headline.used, '73% of the week used');
  assert.match(shown.statusText, /weekly 73% used/);
  assert.equal(shown.week.headline.usedText, '73% used');
  assert.ok(shown.tray.some(line => /^ {2}Claude Code 5-hour: 39% used · /.test(line)));
});

test('an old reading is worded the same everywhere: its last value, with when it was read', () => {
  const shown = surfaces(fleet({ age: 20 }));
  const label = 'as of Wed 7:20 AM';
  assert.ok(shown.tray.some(line => /^ {2}Claude Code weekly: 73% used · Resets Fri 11:45 AM · as of Wed 7:20 AM/.test(line)), shown.tray.join('\n'));
  // With no current reading the forecast has no lead, so the menu bar has no headline number. Every row says its last value.
  assert.equal(shown.glance.headline.used, 'Used: Unknown');
  for (const [name, used] of [['Claude 5-hour', 39], ['Claude weekly', 73]])
    assert.equal(shown.glance.limits.find(row => row.name === name)?.percent, `${used}%, ${label}`, name);
  assert.deepEqual(shown.status.engines.claude.windows.weekly.lastReading, { percentLeft: 27, asOfLabel: label });
  assert.equal(shown.status.engines.claude.windows.weekly.percentLeft, null, 'pace is never judged on an old reading');
  assert.match(shown.statusText, new RegExp(`weekly 73% used, ${label}`));
});

test('a limits source that is off leaves that engine Unknown for job slots, never none, and running jobs always print', () => {
  const claudeOff = fleet({ sources: { ...ALL_ON, claudeLimits: false } });
  const status = agentStatus(clone(claudeOff), now, { codexRunning: 2 });
  assert.equal(status.engines.claude.sourceOff, true);
  assert.equal(status.engines.claude.status, 'unknown');
  assert.equal(status.cap.claude, 1, 'Unknown keeps one Claude slot');
  assert.ok(status.cap.codex >= 1);
  assert.match(describe(status), /Job cap: \d+ \(Claude 1, Codex \d+, 2 Codex running\)/);
  const bothOff = agentStatus(clone(fleet({ sources: { ...ALL_ON, claudeLimits: false, codexLimits: false } })), now, { codexRunning: 3 });
  assert.deepEqual([bothOff.cap.claude, bothOff.cap.codex, bothOff.cap.total], [1, 1, 2]);
  assert.match(bothOff.cap.reason, /\S.*limits off/);
  assert.notEqual(bothOff.cap.reason.trim(), '.');
  assert.match(describe(bothOff), /3 Codex running/);
});

test('a coming reset is never counted down on the dashboard', () => {
  const rows = limitRows(fleet().view, now).filter(row => row.windowId);
  assert.ok(rows.length >= 2);
  for (const row of rows) assert.equal(row.note, '', `${row.name} ${row.window}`);
});

test('with Codex tokens off on the computer that made them, the Tokens page has no Codex card', () => {
  assert.ok(tokensPage(fleet({ sources: ALL_ON }).view).includes('aria-label="Codex"'), 'the check bites: with Codex on, the card is drawn');
  const combined = fleet({ sources: CODEX_OFF, others: { Windows: 'off' } });
  assert.ok(combined.view.tokens.length > 0, 'the view still lists each computer');
  assert.ok(combined.view.tokens.every(row => row.status === 'not-connected'), JSON.stringify(combined.view.tokens));
  const page = tokensPage(combined.view);
  assert.ok(!page.includes('Codex'), 'no Codex card or word on the page');
  assert.ok(page.includes('aria-label="Claude"'), 'Claude is still drawn');
});

test('the limit history is drawn as the percent used, with the heavy end of the week near the top', () => {
  const combined = fleet();
  const data = limitHistorySeries(combined.view, { provider: 'claude', window: 'week', range: 'week', now });
  const points = data.series[0].points;
  assert.ok(points.length > 100);
  // The week was spent evenly from full to 27% left, so the first reading is almost unused and the last is 73% used.
  assert.ok(points[0].used < 3, `the first reading used ${points[0].used}`);
  assert.ok(points.at(-1).used > 72 && points.at(-1).used < 74, `the last reading used ${points.at(-1).used}`);
  const html = renderToStaticMarkup(createElement(LimitsView, { snapshot: combined.view, now }));
  assert.match(html, /limit used over time/);
  assert.doesNotMatch(html, /left over time|% left/);
  // In the drawing, y grows downward, so the line starts low (large y) and ends high (small y).
  const drawn = [...html.matchAll(/<polyline class="ob-history-line claude[^"]*" points="([^"]+)"/g)].map(match => match[1].split(' ').map(pair => pair.split(',').map(Number)))
    .sort((a, b) => b.length - a.length)[0];
  assert.ok(drawn && drawn.length > 100, 'the weekly line is drawn');
  const top = drawn.reduce((least, [, y]) => Math.min(least, y), Infinity), bottom = drawn.reduce((most, [, y]) => Math.max(most, y), -Infinity);
  assert.ok(drawn[0][1] > drawn.at(-1)[1], 'the line rises as the week is used');
  assert.ok(drawn[0][1] > bottom - (bottom - top) * 0.1 && drawn.at(-1)[1] < top + (bottom - top) * 0.1, 'it runs from the bottom to the top of what is drawn');
  assert.match(html, /\d+% used/);
});
