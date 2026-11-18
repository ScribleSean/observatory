// One forecast, shown the same everywhere. The hub forecasts once per reading and stores the result in
// combined.json. This feeds one combined snapshot to every surface's data builder (the dashboard's Week page,
// glance.json for the menu bar and tray, the tray text and `npm run status -- --json`) and checks that each
// shows the same run-out time, the same words and the same computer state. Any divergence fails here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { combine } from '../lib/combine.mjs';
import { summaryOf } from '../lib/summary.mjs';
import { weekView } from '../lib/view-week.mjs';
import { glanceView } from '../lib/glance-view.mjs';
import { agentStatus } from '../lib/agent-status.mjs';
import { ownSnapshot } from './helpers.mjs';

const HOUR = 3600000;
// Wed Nov 18 2026, 7:40 AM in New York. Every reading below is made up.
const now = Date.parse('2026-11-18T12:40:00Z');
const timeZone = 'America/New_York';
const iso = at => new Date(at).toISOString();
const DAY_NAMED = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/;
const CLOCK = /\d(:\d\d)? (AM|PM)/;

/**
 * A Mac whose weekly Claude limit has `remaining` left now, spent at an even pace since the window opened
 * `openedHours` ago, and resets in `resetHours`. Every half hour of that is in the limit history.
 */
function snapshotWith({ remaining, openedHours, resetHours, jitter = 0 }) {
  const resetsAt = now + resetHours * HOUR, opened = now - openedHours * HOUR;
  const rate = (100 - remaining) / openedHours;
  const points = [];
  for (let at = opened, step = 0; at < now; at += HOUR / 2, step++)
    points.push({ p: 'claude', w: 'seven_day', o: 'Mac', t: iso(at), r: Math.max(0, Math.min(100, 100 - rate * (at - opened) / HOUR + (step % 7 - 3) * jitter)), x: iso(resetsAt), d: 10080 });
  return ownSnapshot('Mac', now, snapshot => ({ ...snapshot, timezone: timeZone, collectedAt: iso(now - 60000),
    claudeLimits: { status: 'ok', checkedAt: iso(now - 60000), notReported: ['five_hour'],
      windows: [{ bucket: 'claude', window: 'seven_day', durationMinutes: 10080, remainingPercent: remaining, resetsAt: iso(resetsAt), checkedAt: iso(now - 60000) }] },
    limitHistory: [{ host: 'Mac', status: 'ok', points }] }));
}

// The hub's combined.json for this Mac and a PC that the settings turn off.
function combinedWith(reading) {
  const pc = ownSnapshot('Windows', now - 3 * HOUR);
  return combine([{ host: 'Mac', name: 'Studio Mac', snapshot: snapshotWith(reading) }, { host: 'Windows', name: 'Desk PC', snapshot: pc, off: true }],
    { now, generatedBy: 'Mac', engines: { codex: 'off' } });
}

/** What each surface shows, from one combined snapshot. */
function surfaces(combined) {
  const summary = JSON.parse(JSON.stringify(summaryOf(combined)));
  return {
    stored: combined.glance.forecast,
    week: weekView(summary, { now }),
    glance: glanceView(JSON.parse(JSON.stringify(combined)), { now, timeZone: combined.view.timezone }),
    status: JSON.parse(JSON.stringify(agentStatus(combined, now))),
    tray: combined.glance.lines,
    summary,
  };
}

const said = say => say ? [say.lead, say.when, say.tail].filter(Boolean).join(' ') : null;

function agree(combined) {
  const { stored, week, glance, status, tray, summary } = surfaces(combined);
  const lead = stored.engines.find(engine => engine.engine === stored.scarce?.engine);
  assert.ok(lead, 'the stored forecast names a lead engine');
  // The one sentence: stored, first line of the tray text, and status.
  assert.equal(tray[0], stored.sentence);
  assert.equal(status.forecast.sentence, stored.sentence);
  assert.equal(status.forecast.asOf, stored.asOf);
  // The lead engine: menu bar and tray headline, status, and the same run-out time.
  assert.equal(glance.headline.text, lead.headline);
  assert.equal(glance.headline.resets, lead.resets);
  // The status covers Claude and Codex. Each engine it covers carries the stored words.
  for (const record of stored.engines.filter(item => status.engines[item.engine])) {
    const engine = status.engines[record.engine];
    assert.equal(engine.forecast.headline, record.headline);
    assert.equal(engine.forecast.sentence, record.sentence);
    assert.equal(engine.forecast.runsOutAt, record.runoutAt);
    assert.equal(engine.forecast.resetsLabel, record.resets);
  }
  // Every window: the Week page's headline or meter, and status, with the same words and time.
  for (const window of stored.windows) {
    const head = week.headline?.engine === window.engine && week.headline.title.includes(window.window) ? week.headline : null;
    if (head) {
      assert.equal(said(head.say), window.headline, `Week headline for ${window.engine} ${window.window}`);
      assert.equal(head.resets, window.resets);
      assert.equal(head.pill, window.beforeReset);
    }
    const id = { 10080: 'weekly', 300: 'five_hour' }[window.durationMinutes];
    const own = status.engines[window.engine]?.windows[id];
    if (own && own.percentLeft !== null) {
      assert.equal(own.forecast.phrase, window.phrase, `status ${window.engine} ${id}`);
      assert.equal(own.forecast.runsOutAt, window.runoutAt);
      assert.equal(own.forecast.resetsLabel, window.resets);
    }
    // The lead window's words in the menu bar are the same claim the Week page shows.
    if (window.engine === lead.engine && window.windowId === lead.windowId) assert.equal(glance.headline.text, window.headline);
    // A meter on the Week page that warns shows the same headline.
    const meter = week.meters.find(item => item.engine === window.engine && item.label.endsWith(window.window));
    if (meter && (window.status === 'runs-out' || window.status === 'out')) assert.equal(meter.resets, window.headline);
  }
  // Every time a surface shows names its day.
  for (const text of [stored.sentence, lead.headline, lead.resets, ...stored.windows.flatMap(window => [window.phrase, window.resets])])
    if (text && CLOCK.test(text)) assert.match(text, DAY_NAMED, text);
  // The computers' state is decided once, and every surface shows the stored label.
  for (const device of combined.devices) {
    assert.equal(summary.devices.find(row => row.host === device.host).stateLabel, device.stateLabel);
    assert.deepEqual(status.devices.find(row => row.host === device.host), { host: device.host, state: device.state, stateLabel: device.stateLabel, collectedAt: device.collectedAt });
  }
  // A running session goes by the same name in the menu bar as on the Week page.
  const named = new Set((week.running?.rows ?? []).map(row => row.title));
  for (const session of glance.running?.sessions ?? []) assert.ok(named.has(session.title) || (week.running?.others ?? null), session.title);
  return { stored, lead, week, glance, status };
}

test('a limit forecast to run out reads the same on every surface', () => {
  const { lead, glance } = agree(combinedWith({ remaining: 34, openedHours: 98, resetHours: 70, jitter: 0.6 }));
  assert.equal(lead.status, 'runs-out');
  assert.match(glance.headline.text, /^Claude (may run out|runs out)/);
});

test('a limit with room reads the same on every surface', () => {
  const { stored } = agree(combinedWith({ remaining: 70, openedHours: 98, resetHours: 70, jitter: 0.3 }));
  assert.equal(stored.engines.find(engine => engine.engine === 'claude').status, 'room');
});

test('a spent limit reads the same on every surface', () => {
  const { lead, glance } = agree(combinedWith({ remaining: 0, openedHours: 98, resetHours: 20 }));
  assert.equal(lead.status, 'out');
  assert.match(glance.headline.text, /^Claude is out until (Mon|Tue|Wed|Thu|Fri|Sat|Sun) /);
});

test('a computer turned off in the settings reads Off everywhere, never the time of its last reading', () => {
  const combined = combinedWith({ remaining: 34, openedHours: 98, resetHours: 70 });
  const pc = combined.devices.find(device => device.host === 'Windows');
  assert.deepEqual([pc.state, pc.stateLabel], ['off', 'Off']);
  assert.ok(combined.glance.lines.some(line => /^ {2}PC: Off$/.test(line)));
  assert.equal(agentStatus(combined, now).devices.find(device => device.host === 'Windows').stateLabel, 'Off');
});

test('a snapshot with no stored forecast reads Unknown on every surface, and nothing is forecast again', () => {
  const combined = combinedWith({ remaining: 34, openedHours: 98, resetHours: 70 });
  // As an older version wrote it: engines with phrases, but no stored windows, time or words.
  const { asOf: _asOf, windows: _windows, ...older } = combined.glance.forecast;
  combined.glance.forecast = { ...older, engines: older.engines.map(({ headline: _headline, claim: _claim, resets: _resets, ...engine }) => engine) };
  const { week, glance, status } = surfaces(combined);
  assert.equal(glance.headline.text, 'Unknown');
  assert.equal(week.headline.say.lead, 'Run-out time: Unknown');
  assert.equal(week.headline.pill, null);
  assert.equal(status.engines.claude.windows.weekly.forecast.runsOutAt, null);
  assert.equal(status.forecast.sentence, null);
});

// The menu bar and tray apps draw the stored words. Neither formats a run-out time or edits the sentence itself.
test('the Mac and Windows apps show the stored forecast words as they are', () => {
  const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  for (const [file, headline] of [['glance/mac/Glance.swift', 'row["headline"]'], ['glance/windows/Glance.cs', 'Get(row, "headline")']]) {
    const source = read(file);
    assert.ok(source.includes(headline), `${file} does not read the stored headline`);
    assert.ok(!source.includes('at this pace'), `${file} edits the stored words`);
    for (const field of ['runoutAt', 'earliestAt', 'latestAt', 'estimatedExhaustionAt'])
      assert.ok(!source.includes(field), `${file} reads ${field} and could word a time itself`);
  }
});
