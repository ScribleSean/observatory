// The words on the tray, the menu bar, the status and the dashboard, held to one set of rules. The first contract
// (test/forecast-contract.test.mjs) keeps the forecast the same everywhere. This one keeps what surrounds it the same:
// - Account limits (claudeLimits, codexLimits) are hidden by the hub's setting, stored in the combined view, so every
//   computer shows the same thing.
// - A computer's own usage (tokens, settings, sessions, projects) is hidden only by that computer's setting.
// - A computer that is off, or has a source off, adds nothing to the number it does not contribute to.
// - The reset label, the percent framing and the wording of an old reading are the same on every surface.
// The dashboard surfaces are the round 2 ones (lib/view-r2.mjs and app/viewer/r2): the Limits view, the Overview's
// Limits now, the Sessions and Tokens views, and the sources the scope bar lists.
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
import { limitHistorySeries } from '../lib/view-limit-history.mjs';
import { buildLimits, buildOverview, buildSessions, buildTokens } from '../lib/view-r2.mjs';
import { defaultScope, SOURCE_IDS } from '../lib/scope.mjs';
import { sampleLedgerHistory } from '../lib/sample-r2.mjs';
import { configEcho } from '../lib/config.mjs';
import { compact } from '../lib/panel-data.mjs';
import strings from '../lib/strings.json' with { type: 'json' };
import { ownSnapshot, withFolder, testConfig } from './helpers.mjs';

// The dashboard's own pages, drawn on the server the way the other view tests draw them.
const root = fileURLToPath(new URL('..', import.meta.url));
const { createServer } = await import('vite');
const { default: react } = await import('@vitejs/plugin-react');
const server = await createServer({ configFile: false, root, server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', plugins: [react()] });
after(() => server.close());
const { Limits } = await server.ssrLoadModule('/app/viewer/r2/views/Limits.tsx');
const { Tokens } = await server.ssrLoadModule('/app/viewer/r2/views/Tokens.tsx');

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
  ledger: snapshot.ledger.map(row => ({ ...row, tools: row.tools.filter(tool => tool.tool !== 'codex') })),
  ledgerHistory: snapshot.ledgerHistory.map(row => ({ ...row, days: row.days.filter(day => day.tool !== 'codex') })) });

// What a round 2 collector adds to a snapshot: the daily ledger history (Claude Code and Codex) and the settings echo.
const withRound2 = (snapshot, host, { name = host, role = 'spoke', sources = ALL_ON, at = now } = {}) => ({ ...snapshot,
  ledgerHistory: [sampleLedgerHistory(host, at, { tools: ['claude', 'codex'], timeZone: 'America/New_York' })],
  configEcho: configEcho({ host, device: { name }, role, sources: { ...sources, grokLimits: false } }, new Date(at).toISOString()) });

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
    // Every computer carries the Codex limit. The hub's echo is its own settings, another computer reads Codex only when asked.
    const echo = host === 'Mac' ? { name: 'Studio Mac', role: 'hub', sources } : { name: 'Desk PC', sources: { ...ALL_ON, codex: ownCodex.includes(host) } };
    const round2 = withRound2(snapshot, host, { ...echo, at });
    return host === 'Mac' || ownCodex.includes(host) ? round2 : withoutCodexUsage(round2, host);
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

// The round 2 dashboard, drawn on the server. Its scope is the one the dashboard opens with, so a source that is off is
// not in it. `every` asks for every source anyway, to show that a hidden source is gone from the data, not only the bar.
const scopeOf = (combined, at = now) => defaultScope(combined, { now: at });
const every = (combined, at = now) => ({ ...scopeOf(combined, at), sources: [...SOURCE_IDS] });
const limitsPage = (combined, at = now) => renderToStaticMarkup(createElement(Limits, { snapshot: combined, scope: scopeOf(combined, at), now: at }));
const tokensPage = (combined, at = now) => renderToStaticMarkup(createElement(Tokens, { snapshot: combined, scope: every(combined, at), now: at }));
const limitsVM = (combined, at = now) => buildLimits(combined, scopeOf(combined, at), { now: at });
// The Overview's Limits now: the same engines and the menu bar's line.
const limitsNow = (combined, at = now) => { const overview = buildOverview(combined, scopeOf(combined, at), { now: at }); return { limits: overview.limits, headline: overview.limitsHeadline }; };
// Which tools each computer's sessions in the week came from: "Windows:codex".
const sessionTools = (combined, at = now) => [...new Set(buildSessions(combined, every(combined, at), { now: at, limit: 5000 }).rows
  .flatMap(row => row.kind === 'bundle' ? row.children : [row]).map(row => `${row.host}:${row.tool}`))].sort();
const limitLines = surfaced => surfaced.statusText.split('\n').filter(line => /^(Claude|Codex):/.test(line));

test('with the Codex limits off, Codex is on no surface, even with a computer that is on and carries a Codex limit', () => {
  const on = fleet({ sources: ALL_ON, others: { Windows: 'on' }, ownCodex: ['Windows'] });
  const hidden = fleet({ sources: CODEX_OFF, others: { Windows: 'on' } });
  const read = (combined) => { const shown = surfaces(combined);
    const limits = limitsVM(combined);
    return { tray: shown.tray, glance: shown.glance, week: shown.week, limitsText: limitLines(shown), sentence: shown.stored.sentence, windows: shown.stored.windows, engines: shown.stored.engines,
      limits: { headline: limits.headline, engines: limits.engines }, limitsPage: limitsPage(combined), limitsNow: limitsNow(combined), sources: scopeOf(combined).sources }; };
  const withCodex = read(on), without = read(hidden);
  // The check bites: every one of these names Codex when its settings are on.
  for (const [name, part] of Object.entries(withCodex).filter(([name]) => name !== 'windows')) assert.match(JSON.stringify(part), /codex/i, `${name} names Codex when it is on`);
  // With the limits off the computer that is on still carries the limit and its history, and none of it shows.
  assert.equal(hidden.snapshots.Windows.quota.status, 'ok', 'the computer that is on carries a Codex limit');
  assert.ok(hidden.snapshots.Mac.limitHistory[0].points.some(point => point.p === 'codex'), 'and a copy of the Codex history');
  for (const [name, part] of Object.entries(without)) assert.doesNotMatch(JSON.stringify(part), /codex|no plan/i, name);
  assert.ok(without.limitsPage.includes('Claude Code weekly'), 'the Limits page still draws Claude, so the check is not vacuous');
  // Usage follows the computer that made it: with Codex on there, its sessions show, and the hub's own never do.
  assert.ok(sessionTools(on).includes('Windows:codex'), sessionTools(on).join());
  assert.deepEqual(sessionTools(hidden).filter(tool => tool.endsWith(':codex')), []);
  assert.ok(sessionTools(hidden).includes('Mac:claude'), 'the hub\'s Claude sessions stay');
  // The history of a hidden engine is not in the stored view either.
  assert.equal(hidden.view.limitHistory.flatMap(row => row.points).some(point => point.p === 'codex'), false);
});

test('whose settings win: usage is hidden by the computer that made it, and the limits by the hub, on the hub and on the spoke', () => withFolder(async hubFolder => withFolder(async spokeFolder => {
  const at = Date.parse('2026-10-21T17:00:00Z');
  const seed = async (folder, file, value) => { const local = path.join(folder, 'public', 'local'); await mkdir(local, { recursive: true, mode: 0o700 }); await writeFile(path.join(local, file), JSON.stringify(value)); };
  const linux = JSON.parse(JSON.stringify(ownSnapshot('Windows', at)).replaceAll('"Windows"', '"Linux"'));
  assert.ok(linux.tokens.some(row => row.host === 'Linux' && row.status === 'ok'), 'the Linux computer reads Codex tokens itself');
  const linuxSnapshot = withRound2(linux, 'Linux', { name: 'Ubuntu', at });
  await seed(hubFolder, 'usage.json', withRound2(ownSnapshot('Mac', at), 'Mac', { name: 'Test Mac', role: 'hub', sources: CODEX_OFF, at }));
  const spokeOf = { name: 'Ubuntu', ssh: 'ubuntu', platform: 'linux', dataFolder: null };
  const hubConfig = testConfig(hubFolder, { role: 'hub', hub: { spokes: [spokeOf] }, sources: { ...CODEX_OFF } });
  const fromHub = await runHub(hubConfig, { now: () => at, transport: { pull: async () => JSON.stringify(linuxSnapshot), push: async () => {} } });
  // The spoke gets the hub's copy, its own snapshot and its own settings: Codex is on there.
  await seed(spokeFolder, 'combined.json', { ...fromHub, hub: { role: 'hub', hubWroteAt: fromHub.generatedAt } });
  await seed(spokeFolder, 'usage.json', linuxSnapshot);
  const spokeConfig = testConfig(spokeFolder, { platform: 'linux', host: 'Linux', device: { name: 'Ubuntu' }, sources: { ...ALL_ON } });
  const fromSpoke = await recombine(spokeConfig, { now: () => at });
  for (const { where, combined } of [{ where: 'hub', combined: fromHub }, { where: 'spoke', combined: fromSpoke }]) {
    const view = combined.view;
    // The hub's limits setting is stored, so the spoke shows the same limits as the hub.
    assert.deepEqual(view.sourcesOff, ['codex', 'grok'].filter(engine => view.sourcesOff.includes(engine)), where);
    assert.ok(view.sourcesOff.includes('codex'), `${where}: the Codex limits are off`);
    assert.doesNotMatch(JSON.stringify([combined.glance.lines, combined.glance.forecast.sentence, limitsVM(combined, at).engines, limitsPage(combined, at)]), /codex/i, `${where}: no Codex limit or history`);
    // Usage belongs to its own computer: the Linux computer's Codex tokens show, the Mac's do not.
    assert.deepEqual(view.tokens.filter(row => row.host !== 'Windows').map(row => `${row.host}:${row.status === 'ok'}`).sort(), ['Linux:true', 'Mac:false'], `${where}: tokens by computer`);
    assert.deepEqual(sessionTools(combined, at).filter(tool => tool.endsWith(':codex')), ['Linux:codex'], `${where}: only Linux's Codex sessions show`);
    assert.ok(sessionTools(combined, at).includes('Mac:claude'), `${where}: the Mac's Claude sessions show`);
  }
  // Both computers show the same sessions and the same limits.
  assert.deepEqual(sessionTools(fromHub, at), sessionTools(fromSpoke, at));
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
  assert.match(allLine(noScreen), /^ {2}All: screen time off · /);
  assert.ok(rowOf(noScreen, 'Mac').tokens > 0 && allLine(noScreen).includes(`${compact(rowOf(noScreen, 'Mac').tokens + rowOf(noScreen, 'Windows').tokens)} tokens`));
  // Screen time on for one computer only: its number, with no sum label, while the other numbers are still sums.
  const oneScreen = fleet({ others: { Windows: 'on' }, screenOff: ['Windows'] });
  const macScreen = oneScreen.glance.lines.find(line => /^ {2}Mac: /.test(line)).match(/^ {2}Mac: (.*?) screen/)[1];
  assert.ok(allLine(oneScreen).startsWith(`  All: ${macScreen} screen · `), allLine(oneScreen));
  assert.match(allLine(oneScreen), /tokens \(sum, not deduplicated\) · /);
  assert.doesNotMatch(allLine(oneScreen), /screen \(sum/);
  // Nobody has a measure on: every number reads off.
  const none = fleet({ others: { Windows: 'on' }, screenOff: ['Mac', 'Windows'], sources: { ...ALL_ON, screenTime: false } });
  assert.match(allLine(none), /^ {2}All: screen time off · /);
});

test('a window the provider does not report reads Not reported and nothing else', () => {
  const combined = fleet({ fiveHour: false });
  assert.ok(combined.glance.lines.includes('  Claude Code 5-hour: Not reported'), combined.glance.lines.join('\n'));
  const fiveHour = limitsVM(combined).engines.find(engine => engine.engine === 'claude').windows.find(window => window.windowId === 'five_hour');
  assert.deepEqual([fiveHour?.state, fiveHour?.remaining], ['absent', null]);
  const page = limitsPage(combined);
  assert.match(page, /Claude Code 5 hour<\/span><b class="unk">Not reported<\/b><\/div><\/div>/, 'the Limits page says Not reported and nothing else');
  // An unreported window cannot be the tight one, so the lead is still the engine whose windows were read.
  assert.equal(combined.glance.forecast.scarce?.engine, 'claude');
  assert.equal(limitsNow(combined).headline, limitsVM(combined).headline);
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
  // The dashboard's limit windows carry the same stored label, and the pages never count down.
  const combined = fleet();
  const dashboard = limitsVM(combined).engines.find(engine => engine.engine === 'claude').windows;
  for (const window of shown.stored.windows) assert.equal(dashboard.find(row => row.windowId === window.windowId)?.forecastResets, window.resets, window.windowId);
  const page = limitsPage(combined);
  assert.ok(page.includes(weekly.resets), 'the Limits page shows the stored reset label');
  assert.doesNotMatch(page, /[Rr]esets in |, in \d/);
});

test('every surface says how much of a limit is used, never how much is left', () => {
  const shown = surfaces(fleet({ weeklyRemaining: 27 }));
  assert.doesNotMatch(JSON.stringify([shown.tray, shown.glance, shown.week, shown.statusText]), /% left/);
  assert.ok(shown.tray.includes('  Claude Code weekly: 73% used · Resets Fri 11:45 AM · runs out around Fri 2:30 AM at this pace') || shown.tray.some(line => /^ {2}Claude Code weekly: 73% used · Resets Fri 11:45 AM/.test(line)), shown.tray.join('\n'));
  assert.equal(shown.glance.headline.used, '73% of the week used');
  assert.match(shown.statusText, /weekly 73% used/);
  assert.equal(shown.week.headline.usedText, '73% used');
  assert.ok(shown.tray.some(line => /^ {2}Claude Code 5-hour: 39% used · /.test(line)));
  const page = limitsPage(fleet({ weeklyRemaining: 27 }));
  assert.doesNotMatch(page, /% left|unused/);
  assert.match(page, /73%<small>used<\/small>/);
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
  // The Limits view and its Codex card say the same: the last value, with when it was read.
  const combined = fleet({ age: 20 });
  const weekly = limitsVM(combined).engines.find(engine => engine.engine === 'claude').windows.find(window => window.windowId === 'seven_day');
  assert.deepEqual([weekly.state, weekly.remaining, weekly.asOf], ['stale', 27, label]);
  assert.ok(limitsPage(combined).includes(label), 'the Limits page dates the old reading');
});

// The Limits strip's cell for one label, as text, and the tag at the end of the weekly burn line.
const textOf = markup => markup.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const stripCell = (page, label) => { const at = page.indexOf(`>${label}<`); assert.ok(at > 0, `the strip has "${label}"`); return textOf(page.slice(at + label.length + 1, at + 600)); };
const burnTag = page => { const tag = page.match(/<span class="tagl"[^>]*><b[^>]*>([^<]*)<\/b> <span class="fa">([^<]*)<\/span>/); assert.ok(tag, 'the burn line has an end tag'); return `${tag[1]} ${tag[2]}`; };

test('the Limits strip and the burn chart show one stored reading by one freshness rule: current, as of, or Unknown in both', () => {
  // Current: the value and "now" in the chart.
  const current = limitsPage(fleet());
  assert.match(stripCell(current, 'Claude Code weekly limit'), /^73% used /);
  assert.equal(burnTag(current), '73% now');
  // Old: the last value with when it was read, in both.
  const label = 'as of Wed 7:20 AM';
  const old = limitsPage(fleet({ age: 20 }));
  assert.ok(stripCell(old, 'Claude Code weekly limit').startsWith(`73% used ${label}`), stripCell(old, 'Claude Code weekly limit'));
  assert.equal(burnTag(old), `73% ${label}`);
  // No stored reading to date: the history still holds readings of this window, but neither shows a number.
  const unread = fleet({ age: 20 });
  unread.glance.limits = unread.glance.limits.filter(row => !(row.provider === 'claude' && row.windowId === 'seven_day'));
  const weekly = limitsVM(unread).engines.find(engine => engine.engine === 'claude').windows.find(window => window.windowId === 'seven_day');
  assert.deepEqual([weekly.state, weekly.remaining, weekly.asOf], ['stale', null, null]);
  const page = limitsPage(unread);
  assert.match(page, /<path d="M[^"]+" fill="none" stroke="var\(--text\)"/, 'the stored readings are still drawn');
  assert.match(stripCell(page, 'Claude Code weekly limit'), /^Unknown /);
  assert.equal(burnTag(page), 'Unknown now');
});

test('a limits source that is off leaves that engine Unknown for job slots, never none, and running jobs always print', () => {
  const claudeOff = fleet({ sources: { ...ALL_ON, claudeLimits: false } });
  const status = agentStatus(clone(claudeOff), now, { codexRunning: 2 });
  assert.equal(status.engines.claude.sourceOff, true);
  assert.equal(status.engines.claude.status, 'unknown');
  assert.equal(status.cap.claude, 1, 'Unknown keeps one Claude slot');
  assert.equal(status.cap.total, status.cap.codex, 'no phantom Claude slot in the total');
  assert.match(describe(status), /Job cap: \d+ \(Claude 1, Codex \d+, 2 Codex running\)/);
  const bothOff = agentStatus(clone(fleet({ sources: { ...ALL_ON, claudeLimits: false, codexLimits: false } })), now, { codexRunning: 3 });
  assert.deepEqual([bothOff.cap.claude, bothOff.cap.codex, bothOff.cap.total], [1, 1, 2]);
  assert.match(bothOff.cap.reason, /\S.*limits off/);
  assert.notEqual(bothOff.cap.reason.trim(), '.');
  assert.match(describe(bothOff), /3 Codex running/);
});

test('a coming reset is never counted down on the dashboard', () => {
  const combined = fleet({ sources: ALL_ON });
  const windows = limitsVM(combined).engines.flatMap(engine => engine.windows);
  assert.ok(windows.length >= 2);
  const text = JSON.stringify([limitsPage(combined), limitsNow(combined)]);
  assert.doesNotMatch(text, /[Rr]esets in |, in \d+[dhm]/);
});

test('with Codex tokens off on the computer that made them, the Tokens page has no Codex card', () => {
  // The Tokens page names Codex through its model (the fixture's is gpt-6-astra) and the view-model by its tool.
  const codexOn = fleet({ sources: ALL_ON });
  assert.match(tokensPage(codexOn), /gpt-6-astra/, 'the check bites: with Codex on, the page shows its model');
  assert.match(JSON.stringify(buildTokens(codexOn, every(codexOn), { now })), /codex/i);
  const combined = fleet({ sources: CODEX_OFF, others: { Windows: 'off' } });
  assert.ok(combined.view.tokens.length > 0, 'the view still lists each computer');
  assert.ok(combined.view.tokens.every(row => row.status === 'not-connected'), JSON.stringify(combined.view.tokens));
  const page = tokensPage(combined);
  assert.doesNotMatch(page, /Codex|gpt-6-astra/, 'no Codex word or model on the page');
  assert.match(page, /Opus/, 'Claude models are still drawn');
  assert.doesNotMatch(JSON.stringify({ ...buildTokens(combined, every(combined), { now }), frame: null }), /codex/i);
});

test('the limit history is drawn as the percent used, with the heavy end of the week near the top', () => {
  const combined = fleet();
  const data = limitHistorySeries(combined.view, { provider: 'claude', window: 'week', range: 'week', now });
  const points = data.series[0].points;
  assert.ok(points.length > 100);
  // The week was spent evenly from full to 27% left, so the first reading is almost unused and the last is 73% used.
  assert.ok(points[0].used < 3, `the first reading used ${points[0].used}`);
  assert.ok(points.at(-1).used > 72 && points.at(-1).used < 74, `the last reading used ${points.at(-1).used}`);
  const html = limitsPage(combined);
  assert.doesNotMatch(html, /left over time|% left/);
  // In the Limits view's burn chart, y is 100 minus the share used, so the line starts low (large y) and ends high.
  const path = html.match(/<path d="(M[^"]+)" fill="none" stroke="var\(--text\)"/)?.[1];
  assert.ok(path, 'the weekly line is drawn');
  const drawn = [...path.matchAll(/[ML](\d+),([\d.]+)/g)].map(match => [Number(match[1]), Number(match[2])]);
  assert.ok(drawn.length > 100, `the weekly line has ${drawn.length} points`);
  assert.ok(drawn[0][1] > 97 && drawn.at(-1)[1] > 26 && drawn.at(-1)[1] < 28, 'it runs from almost unused to 73% used');
  assert.match(html, /\d+%<small>used<\/small>/);
});

test('a spoke with no hub copy follows its own limits settings, and turns them on when asked', () => withFolder(async folder => {
  const at = Date.parse('2026-10-21T17:00:00Z');
  const local = path.join(folder, 'public', 'local');
  await mkdir(local, { recursive: true, mode: 0o700 });
  await writeFile(path.join(local, 'usage.json'), JSON.stringify(ownSnapshot('Windows', at)));
  const config = limits => testConfig(folder, { platform: 'windows', host: 'Windows', device: { name: 'PC' }, sources: { ...ALL_ON, codexLimits: limits } });
  const off = await recombine(config(false), { now: () => at });
  assert.ok(off.view.sourcesOff.includes('codex'), 'with its own Codex limits off, the spoke hides them');
  assert.ok(!off.hub.hubWroteAt, 'there was never a hub copy');
  // The spoke's own last output carries sourcesOff, and it is not the hub's word.
  const on = await recombine(config(true), { now: () => at + 60000 });
  assert.ok(!on.view.sourcesOff.includes('codex'), 'turning its Codex limits on takes effect');
  assert.ok(on.glance.limits.some(row => row.provider === 'codex'));
}));

test('a project list keeps its Claude projects when Codex is turned off after it was collected', () => {
  const snapshot = ownSnapshot('Mac', now);
  const before = snapshot.projectTokens.find(row => row.host === 'Mac');
  assert.ok(before.providers.includes('codex') && before.projects.some(project => project.sessions.some(session => session.provider === 'claude')));
  const claudeTokens = before.projects.flatMap(project => project.sessions).filter(session => session.provider === 'claude').reduce((sum, session) => sum + session.totalTokens, 0);
  const combined = combine([{ host: 'Mac', name: 'Mac', snapshot }], { now, generatedBy: 'Mac', sources: CODEX_OFF });
  const list = combined.view.projectTokens.find(row => row.host === 'Mac');
  assert.equal(list.status, 'ok');
  assert.deepEqual(list.providers, ['claude']);
  const kept = list.projects.flatMap(project => project.sessions);
  assert.ok(kept.length > 0 && kept.every(session => session.provider === 'claude'));
  assert.equal(kept.reduce((sum, session) => sum + session.totalTokens, 0), claudeTokens);
  assert.doesNotMatch(JSON.stringify(combined.view.projectTokens), /codex/i);
});

test('a Mac hub with Codex off still shows the Codex card for another computer that reads Codex', () => {
  const combined = fleet({ sources: CODEX_OFF, others: { Windows: 'on' }, ownCodex: ['Windows'] });
  assert.deepEqual(sessionTools(combined).filter(tool => tool.endsWith(':codex')), ['Windows:codex']);
  assert.ok(scopeOf(combined).sources.includes('codex'), 'Codex is in the scope bar, for the computer that reads it');
  assert.match(tokensPage(combined), /gpt-6-astra/, 'the Tokens page shows the Codex model');
  assert.ok(!combined.view.sourcesOff.includes('claude'));
  // The Mac's own Codex tokens are not in it, and the Codex limits stay hidden.
  assert.ok(combined.view.tokens.find(row => row.host === 'Mac').status === 'not-connected');
  assert.doesNotMatch(JSON.stringify([combined.glance.lines, limitsVM(combined).engines, limitsPage(combined)]), /Codex/);
});

// The menu bar and tray icon (lib/glance-icon.mjs) against the dashboard's Limits view for the Claude weekly window,
// read from the view model's own fields: its percent used, whether it dates the reading, and the stored forecast it
// shows (current only). Room is on pace, runs-out or out is over pace, and anything else is a pace the dashboard does
// not state, which the icon shows as stale. No Claude weekly window in the view is off.
const DAY_CLOCK = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2}:\d\d\s(AM|PM)$/u;
function iconFromLimits(combined, at = now) {
  const weekly = limitsVM(combined, at).engines.find(engine => engine.engine === 'claude')?.windows.find(window => window.windowId === 'seven_day');
  if (!weekly || weekly.state === 'off' || weekly.state === 'absent') return { state: 'off', fraction: null, text: 'Off', tip: 'Off' };
  const used = weekly.remaining === null ? null : Math.round(100 - weekly.remaining), fraction = used === null ? null : used / 100;
  if (used === null || weekly.state === 'stale' || weekly.asOf) return { state: 'stale', fraction, text: DAY_CLOCK, tip: /^Last read /u };
  const status = weekly.forecastStale ? null : weekly.forecast?.status ?? null;
  const [state, pace] = status === 'room' ? ['on-pace', 'on pace'] : ['runs-out', 'out'].includes(status) ? ['over-pace', 'over pace'] : ['stale', 'pace Unknown'];
  return { state, fraction, text: `${used}%`, tip: `${used}% used, ${pace}` };
}
const iconOf = (combined, at = now) => glanceView(clone(combined), { now: at, timeZone: 'America/New_York' }).icon;
const edited = (combined, change) => { const copy = clone(combined); change(copy.glance.forecast); return copy; };

test('the menu bar and tray icon shows the Limits view\'s share used and its pace verdict, never its own', () => {
  const cases = [
    { name: 'over pace', combined: fleet(), at: now, state: 'over-pace' },
    { name: 'on pace', combined: fleet({ weeklyRemaining: 80 }), at: now, state: 'on-pace' },
    { name: 'an old reading', combined: fleet({ age: 20 }), at: now, state: 'stale' },
    { name: 'an old snapshot', combined: fleet({ weeklyRemaining: 80 }), at: now + 20 * MINUTE, state: 'stale' },
    { name: 'a reading the reset has passed', combined: fleet({ weeklyRemaining: 80 }), at: now + 53 * HOUR, state: 'stale' },
    { name: 'an old forecast over a current reading', combined: edited(fleet({ weeklyRemaining: 80 }), forecast => { forecast.asOf = iso(now - HOUR); }), at: now, state: 'stale' },
    { name: 'no stored forecast for the window', combined: edited(fleet({ weeklyRemaining: 80 }), forecast => { forecast.windows = forecast.windows.filter(window => window.windowId !== 'seven_day'); }), at: now, state: 'stale' },
    { name: 'no stored forecast at all', combined: edited(fleet({ weeklyRemaining: 80 }), forecast => { delete forecast.asOf; delete forecast.windows; }), at: now, state: 'stale' },
    { name: 'the Claude limit off', combined: fleet({ sources: { ...CODEX_OFF, claudeLimits: false } }), at: now, state: 'off' },
  ];
  for (const { name, combined, at, state } of cases) {
    const icon = iconOf(combined, at), dashboard = iconFromLimits(combined, at);
    assert.equal(icon.state, state, name);
    assert.equal(icon.state, dashboard.state, `${name}: the icon's center and the Limits view`);
    assert.equal(icon.fraction, dashboard.fraction, `${name}: the ring and the Limits view's percent used`);
    for (const key of ['text', 'tip'])
      if (typeof dashboard[key] === 'string') assert.equal(icon[key], dashboard[key], `${name}: ${key}`);
      else assert.match(icon[key], dashboard[key], `${name}: ${key}`);
  }
  assert.deepEqual([iconOf(fleet()).text, iconOf(fleet()).tip], ['73%', '73% used, over pace']);
  const old = iconOf(fleet({ age: 20 }));
  assert.equal(old.fraction, 0.73);
  assert.match(old.text, /^Wed 7:20\sAM$/u);
  assert.equal(old.tip, `Last read ${old.text}`);
  assert.deepEqual(iconOf(fleet({ sources: { ...CODEX_OFF, claudeLimits: false } })), { state: 'off', fraction: null, text: 'Off', tip: 'Off', stale: null, accent: false });
  // What the apps switch to once glance.json itself goes old: the same ring, frozen, with when it was read.
  const live = iconOf(fleet());
  assert.equal(live.stale.fraction, live.fraction);
  assert.match(live.stale.text, /^Wed 7:39\sAM$/u);
  // A read time ahead of the clock is no read time: it is never shown.
  const ahead = clone(fleet({ age: 20 }));
  for (const row of ahead.glance.limits) row.checkedAt = iso(now + HOUR);
  ahead.generatedAt = iso(now + HOUR);
  assert.equal(iconOf(ahead).text, 'Unknown');
});
