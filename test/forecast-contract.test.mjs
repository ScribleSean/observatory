// One forecast, shown the same everywhere. Each computer forecasts once per reading and stores the result in its
// combined.json. This feeds one combined snapshot to every surface's data builder (the dashboard's Week page, the
// round 2 Limits view and its "Limits now" block, glance.json for the menu bar and tray, the tray text and
// `npm run status -- --json`) and checks that each shows
// the same run-out time, the same words and the same computer state. Any divergence fails here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { combine } from '../lib/combine.mjs';
import { summaryOf } from '../lib/summary.mjs';
import { weekView } from '../lib/view-week.mjs';
import { glanceView } from '../lib/glance-view.mjs';
import { agentStatus } from '../lib/agent-status.mjs';
import { when, between } from '../lib/forecast.mjs';
import { buildLimits, buildOverview, resolveBlock } from '../lib/view-r2.mjs';
import { defaultScope } from '../lib/scope.mjs';
import { ownSnapshot } from './helpers.mjs';

const HOUR = 3600000, MINUTE = 60000;
// Wed Nov 18 2026, 7:40 AM in New York. Every reading below is made up.
const now = Date.parse('2026-11-18T12:40:00Z');
const iso = at => new Date(at).toISOString();
const WEEKDAY = '(Mon|Tue|Wed|Thu|Fri|Sat|Sun)', MONTH = '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';

/** A time a surface shows: a weekday and clock within six days, else a date. A bare clock or a stray date fails. */
function assertTime(text, at, label) {
  const pattern = Math.abs(Date.parse(at) - now) < 6 * 24 * HOUR ? new RegExp(`^${WEEKDAY} \\d{1,2}(:\\d\\d)? (AM|PM)$`) : new RegExp(`^${MONTH} \\d{1,2}$`);
  assert.match(text, pattern, `${label}: "${text}" for ${at}`);
}

/**
 * One limit window: `remaining` left now, spent at an even pace since it opened, resetting in `resetHours`, with
 * `weeks` earlier windows of the same use before it. Every half hour is a reading in the limit history.
 */
function readings({ id, minutes, remaining, resetHours, jitter = 0, weeks = 0 }) {
  const length = minutes * MINUTE, resetsAt = now + resetHours * HOUR, opened = resetsAt - length;
  const rate = (100 - remaining) / ((now - opened) / HOUR);
  const points = [];
  for (let back = weeks; back >= 0; back--) {
    const start = opened - back * length, reset = resetsAt - back * length;
    for (let at = start, step = 0; at < Math.min(start + length, now); at += HOUR / 2, step++)
      points.push({ p: 'claude', w: id, o: 'Mac', t: iso(at), x: iso(reset), d: minutes,
        r: Math.max(0, Math.min(100, 100 - rate * (at - start) / HOUR + ((step * 7) % 11 - 5) * jitter)) });
  }
  return { window: { bucket: 'claude', window: id, durationMinutes: minutes, remainingPercent: remaining, resetsAt: iso(resetsAt), checkedAt: iso(now - MINUTE) }, points };
}

// The hub's combined.json for a Mac with these Claude windows, a PC the settings turn off, Codex off and no Grok.
function combinedWith({ weekly, fiveHour = null, timeZone = 'America/New_York' }) {
  const parts = [readings({ id: 'seven_day', minutes: 10080, ...weekly }), ...(fiveHour ? [readings({ id: 'five_hour', minutes: 300, ...fiveHour })] : [])];
  const mac = ownSnapshot('Mac', now, snapshot => ({ ...snapshot, timezone: timeZone, collectedAt: iso(now - MINUTE),
    // The settings echo the round 2 views read to know which sources are on.
    configEcho: { host: 'Mac', name: 'Studio Mac', role: 'hub', titles: false, roleAliases: {}, checkedAt: null,
      sources: { claudeCode: true, claudeLimits: true, codex: false, codexLimits: false, grokLimits: false }, engines: { claude: 'auto', codex: 'off', grok: 'auto' } },
    claudeLimits: { status: 'ok', checkedAt: iso(now - MINUTE), ...(fiveHour ? {} : { notReported: ['five_hour'] }), windows: parts.map(part => part.window) },
    grokLimits: { status: 'not-connected', windows: [] },
    limitHistory: [{ host: 'Mac', status: 'ok', points: parts.flatMap(part => part.points) }],
    // Two sessions running now on the Mac, so the menu bar and the Week page each have running sessions to name.
    ledger: snapshot.ledger.map(row => ({ ...row, collectedAt: iso(now - MINUTE), tools: row.tools.map(tool => ({ ...tool, periods: tool.periods.map(period =>
      period.key !== 'current' ? period : { ...period, sessions: period.sessions.map((session, index) => index < 2 ? { ...session, running: true, state: 'working', ratePerHour: 2 - index } : session) }) })) })) }));
  return combine([{ host: 'Mac', name: 'Studio Mac', snapshot: mac }, { host: 'Windows', name: 'Desk PC', off: true,
    snapshot: ownSnapshot('Windows', now - 3 * HOUR, snapshot => ({ ...snapshot, grokLimits: { status: 'not-connected', windows: [] } })) }],
    { now, generatedBy: 'Mac', engines: { codex: 'off' } });
}

/** What each surface shows from one combined snapshot, at `at`. */
function surfaces(combined, at = now) {
  const copy = () => JSON.parse(JSON.stringify(combined));
  const r2 = copy(), scope = defaultScope(r2, { now: at });
  const limits = buildLimits(r2, scope, { now: at });
  return { stored: combined.glance.forecast, week: weekView(summaryOf(copy()), { now: at }),
    limits, limitsNow: resolveBlock('LimitMeter', { engine: 'claude' }, r2, scope, { now: at }), overview: buildOverview(r2, scope, { now: at }),
    glance: glanceView(copy(), { now: at, timeZone: combined.view.timezone }),
    status: JSON.parse(JSON.stringify(agentStatus(copy(), at))), tray: combined.glance.lines, summary: summaryOf(copy()) };
}

const joined = say => say ? [say.lead, say.when, say.tail].filter(Boolean).join(' ') : null;
const STATUS_WINDOW = { 10080: 'weekly', 300: 'five_hour' };

/** The round 2 Limits view, its "Limits now" block and the Overview lead with the menu bar's line, in the same words. */
function agreeRound2({ limits, limitsNow, overview, glance }) {
  assert.equal(limits.headline, glance.headline.text, 'round 2 Limits view');
  assert.equal(limitsNow.headline, glance.headline.text, 'round 2 Limits now');
  assert.equal(overview.limitsHeadline, glance.headline.text, 'round 2 Overview');
}

function agree(combined) {
  const all = surfaces(combined);
  const { stored, week, glance, status, tray, summary, limits } = all;
  agreeRound2(all);
  assert.deepEqual(stored.engines.map(engine => engine.engine), ['claude', 'codex'], 'no Grok: the lead is a Claude window');
  const lead = stored.engines.find(engine => engine.engine === stored.scarce?.engine);
  assert.equal(lead.engine, 'claude');
  // The one sentence: stored, first line of the tray text, and status.
  assert.equal(tray[0], stored.sentence);
  assert.equal(status.forecast.sentence, stored.sentence);
  assert.equal(status.forecast.stale, false);
  // The lead engine in the menu bar and tray, and in status, with the same run-out time and reset.
  assert.equal(glance.headline.text, lead.headline);
  assert.equal(glance.headline.resets, lead.resets);
  for (const record of stored.engines) {
    const engine = status.engines[record.engine];
    assert.deepEqual([engine.forecast.headline, engine.forecast.sentence, engine.forecast.runsOutAt, engine.forecast.resetsLabel],
      [record.headline, record.sentence, record.runoutAt, record.resets], record.engine);
  }
  // Every Claude window, on every surface that shows it.
  const claudeWindows = stored.windows.filter(window => window.engine === 'claude');
  assert.equal(claudeWindows.length, combined.view.claudeLimits.windows.length);
  for (const window of claudeWindows) {
    const name = `${window.engine} ${window.window}`;
    // The stored words name a day: the reset, and a single run-out time.
    assertTime(window.resetsWhen, window.resetsAt, `${name} reset`);
    assert.equal(window.resets, `Resets ${window.resetsWhen}`);
    if (window.claim.when && !/[–]| to |^by /.test(window.claim.when))
      assertTime(window.claim.when, window.status === 'out' ? window.resetsAt : window.earliestAt ?? window.runoutAt ?? window.resetsAt, `${name} claim`);
    // The Week page: the weekly window is the card, any other is a meter that warns in the same words or says its reset.
    if (window.durationMinutes === 10080) {
      assert.equal(joined(week.headline.say), window.headline, `Week card for ${name}`);
      assert.equal(week.headline.resets, window.resets);
      assert.equal(week.headline.pill, window.beforeReset);
    } else {
      const meter = week.meters.find(item => item.engine === window.engine && item.label.endsWith(window.window));
      assert.equal(meter.resets, ['runs-out', 'out'].includes(window.status) ? window.headline : window.resets, `Week meter for ${name}`);
    }
    // glance.json: the lead window is the headline, any other a row with its reset.
    if (window.windowId === lead.windowId) assert.equal(glance.headline.text, window.headline);
    else assert.equal(glance.limits.find(row => row.engine === 'claude' && row.name.endsWith(window.window)).resets, window.resetsWhen, `glance row for ${name}`);
    // The round 2 Limits view: the same words and reset, on its meter and in its "Limits now" block.
    const meter = limits.engines.find(engine => engine.engine === 'claude').windows.find(row => row.windowId === window.windowId);
    assert.deepEqual([meter.forecastText, meter.forecastResets], [window.headline, window.resets], `round 2 meter for ${name}`);
    assert.equal(all.limitsNow.engine.windows.find(row => row.windowId === window.windowId).forecastText, window.headline);
    // Status: the same words, run-out time and reset label.
    const own = status.engines.claude.windows[STATUS_WINDOW[window.durationMinutes]];
    assert.deepEqual([own.forecast.phrase, own.forecast.runsOutAt, own.forecast.resetsLabel, own.forecast.headline],
      [window.phrase, window.runoutAt, window.resets, window.headline], `status ${name}`);
  }
  // The computers' state is decided once, and every surface shows the stored label.
  for (const device of combined.devices) {
    assert.equal(summary.devices.find(row => row.host === device.host).stateLabel, device.stateLabel);
    assert.deepEqual(status.devices.find(row => row.host === device.host), { host: device.host, state: device.state, stateLabel: device.stateLabel, collectedAt: device.collectedAt });
  }
  // Running sessions go by the same names in the menu bar as on the Week page, fastest first.
  assert.ok(glance.running.sessions.length >= 2, 'the fixture has sessions running');
  assert.deepEqual(glance.running.sessions.map(session => session.title), week.running.rows.map(row => row.title));
  return { stored, lead, week, glance, status };
}

test('a stated range reads the same on every surface', () => {
  const { lead, glance } = agree(combinedWith({ weekly: { remaining: 5, resetHours: 20, jitter: 1, weeks: 2 } }));
  assert.equal(lead.status, 'runs-out');
  assert.ok(lead.earliestAt && lead.latestAt, 'the forecast states a range');
  assert.equal(glance.headline.text, 'Claude may run out Wed 8–9 AM');
});

test('a run-out with only an early end reads the same on every surface', () => {
  const { lead, glance } = agree(combinedWith({ weekly: { remaining: 10, resetHours: 18, jitter: 2, weeks: 2 } }));
  assert.ok(lead.earliestAt && !lead.latestAt);
  assert.match(glance.headline.text, new RegExp(`^Claude may run out from ${WEEKDAY} `));
});

test('a limit that would run out only after its reset has room, and reads the same on every surface', () => {
  const { lead, glance } = agree(combinedWith({ weekly: { remaining: 70, resetHours: 70, jitter: 0.3 } }));
  assert.equal(lead.status, 'room');
  assert.equal(lead.runoutAt, null, 'no run-out time is claimed past the reset');
  assert.equal(glance.headline.text, 'Claude has room');
  // The reset at a known instant: Sat 10:40 UTC is Sat 5:40 AM in New York, rounded to the quarter hour.
  assert.equal(glance.headline.resets, 'Resets Sat 5:45 AM');
});

test('a spent limit reads the same on every surface', () => {
  const { lead, glance } = agree(combinedWith({ weekly: { remaining: 0, resetHours: 20 } }));
  assert.equal(lead.status, 'out');
  assert.equal(glance.headline.text, 'Claude is out until Thu 3:45 AM');
});

test('when the 5-hour window runs out first it leads the menu bar, and the Week page shows it on its meter in the same words', () => {
  const { lead, glance, week, stored } = agree(combinedWith({ weekly: { remaining: 80, resetHours: 120, jitter: 0.3 }, fiveHour: { remaining: 30, resetHours: 2 } }));
  assert.equal(lead.windowId, 'five_hour');
  assert.equal(glance.headline.used, '70% of the 5-hour limit used');
  const fiveHour = stored.windows.find(window => window.windowId === 'five_hour');
  assert.equal(glance.headline.text, fiveHour.headline);
  assert.equal(week.headline.title, 'Claude weekly limit');
  assert.equal(week.meters.find(meter => meter.label === 'Claude 5-hour').resets, fiveHour.headline);
});

test('in another time zone every surface shows the same words in that zone', () => {
  const { stored, glance } = agree(combinedWith({ weekly: { remaining: 70, resetHours: 70, jitter: 0.3 }, timeZone: 'Asia/Kolkata' }));
  assert.equal(stored.timeZone, 'Asia/Kolkata');
  // Sat 10:40 UTC is Sat 4:10 PM in India, a half-hour zone, rounded to the quarter hour.
  assert.equal(glance.headline.resets, 'Resets Sat 4:15 PM');
});

test('a computer turned off in the settings reads Off everywhere, never the time of its last reading', () => {
  const combined = combinedWith({ weekly: { remaining: 34, resetHours: 70 } });
  const pc = combined.devices.find(device => device.host === 'Windows');
  assert.deepEqual([pc.state, pc.stateLabel], ['off', 'Off']);
  assert.ok(combined.glance.lines.some(line => /^ {2}PC: Off$/.test(line)));
  assert.equal(agentStatus(combined, now).devices.find(device => device.host === 'Windows').stateLabel, 'Off');
});

test('an old forecast reads as old on every surface, with the day and time it was made', () => {
  const combined = combinedWith({ weekly: { remaining: 5, resetHours: 20, jitter: 1, weeks: 2 } });
  const later = now + 20 * MINUTE;
  const all = surfaces(combined, later);
  const { stored, week, glance, status } = all;
  agreeRound2(all);
  const expected = `${stored.engines[0].headline}, as of Wed 7:40 AM`;
  assert.equal(all.limits.engines[0].windows.find(row => row.windowId === 'seven_day').forecastText, `${stored.windows.find(row => row.windowId === 'seven_day').headline}, as of Wed 7:40 AM`);
  assert.equal(glance.headline.text, expected);
  assert.equal(joined(week.headline.say), expected);
  assert.equal(status.engines.claude.forecast.headline, expected);
  assert.equal(status.engines.claude.forecast.stale, true);
  assert.equal(status.forecast.stale, true);
  assert.equal(status.forecast.sentence, `${stored.sentence} As of Wed 7:40 AM.`);
  assert.equal(week.headline.pill, null, 'no hours before the reset from an old forecast');
});

test('past its reset a stored claim no longer holds: Unknown, with when it was made, on every surface', () => {
  const combined = combinedWith({ weekly: { remaining: 0, resetHours: 20 } });
  const later = now + 21 * HOUR;
  const all = surfaces(combined, later);
  const { week, glance, status } = all;
  agreeRound2(all);
  assert.equal(glance.headline.text, 'Unknown, as of Wed 7:40 AM');
  assert.equal(all.limits.engines[0].windows.find(row => row.windowId === 'seven_day').forecastText, 'Unknown, as of Wed 7:40 AM');
  assert.equal(glance.headline.resets, null);
  assert.equal(joined(week.headline.say), 'Unknown, as of Wed 7:40 AM');
  assert.equal(status.engines.claude.forecast.headline, 'Unknown, as of Wed 7:40 AM');
  assert.equal(status.engines.claude.forecast.resetsLabel, null);
});

test('a snapshot with no stored forecast reads Unknown, in one word, on every surface, and nothing is forecast again', () => {
  const combined = combinedWith({ weekly: { remaining: 34, resetHours: 70 } });
  // As an older version wrote it: engines with phrases, but no stored windows, time or words.
  const { asOf: _asOf, windows: _windows, ...older } = combined.glance.forecast;
  combined.glance.forecast = { ...older, engines: older.engines.map(({ headline: _headline, claim: _claim, resets: _resets, say: _say, ...engine }) => engine) };
  const all = surfaces(combined);
  const { week, glance, status } = all;
  agreeRound2(all);
  assert.equal(glance.headline.text, 'Unknown');
  assert.equal(all.limits.engines[0].windows.find(row => row.windowId === 'seven_day').forecastText, 'Unknown');
  assert.equal(week.headline.say.lead, 'Unknown');
  assert.equal(week.headline.pill, null);
  assert.equal(status.engines.claude.forecast.headline, 'Unknown');
  assert.equal(status.engines.claude.windows.weekly.forecast.runsOutAt, null);
  assert.equal(status.forecast.sentence, null);
});

// Times read against known instants, so a wrong zone or rounding cannot pass by agreeing with itself.
test('times name their day at the edges: noon, midnight, six days out and the night the clocks go back', () => {
  const context = { now, timeZone: 'America/New_York' };
  assert.equal(when('2026-11-20T17:00:00Z', context), 'Fri 12 PM');
  assert.equal(when('2026-11-19T05:00:00Z', context), 'Thu 12 AM');
  assert.equal(when('2026-11-18T13:00:00Z', context), 'Wed 8 AM', 'today still names its day');
  assert.equal(when(iso(now + 6 * 24 * HOUR - 15 * MINUTE), context), 'Tue 7:30 AM');
  assert.equal(when(iso(now + 6 * 24 * HOUR), context), 'Nov 24', 'six days out is a date');
  assert.equal(when(iso(now + 9 * 24 * HOUR), context), 'Nov 27');
  // A same-day range whose end is past six days reads as its start, never "undefined".
  const edge = between(iso(now + (5 * 24 + 22) * HOUR), iso(now + (6 * 24 + 1) * HOUR), context);
  assert.ok(!edge.includes('undefined'), edge);
  assert.match(edge, new RegExp(`^${WEEKDAY} \\d{1,2} (AM|PM)$|^${MONTH} \\d{1,2}$`));
  // Fall back: 1 AM happens twice, and a range inside it reads as that hour, not "1–1 AM".
  const fallBack = { now: Date.parse('2026-10-30T12:00:00Z'), timeZone: 'America/New_York' };
  assert.equal(between('2026-11-01T04:30:00Z', '2026-11-01T06:00:00Z', fallBack), 'Sun 1 AM');
  assert.equal(when('2026-11-01T06:30:00Z', fallBack), 'Sun 1:30 AM');
});

// A source guard, not a run of the apps: they read the stored headline and word no forecast time themselves.
test('source guard: the Mac and Windows apps show the stored forecast words as they are', () => {
  const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  for (const [file, headline] of [['glance/mac/Glance.swift', 'row["headline"]'], ['glance/windows/Glance.cs', 'Get(row, "headline")']]) {
    const source = read(file);
    assert.ok(source.includes(headline), `${file} does not read the stored headline`);
    assert.ok(!source.includes('at this pace'), `${file} edits the stored words`);
    for (const field of ['runoutAt', 'earliestAt', 'latestAt', 'estimatedExhaustionAt'])
      assert.ok(!source.includes(field), `${file} reads ${field} and could word a time itself`);
  }
});
