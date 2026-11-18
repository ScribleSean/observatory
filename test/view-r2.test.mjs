// Round 2 view-models against the fictional three-computer fixture: shapes for every range unit,
// Unknown days, a computer that starts later, the "not deduplicated" label, limits never summed and
// Grok never added to dollars.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as v from '../lib/view-r2.mjs';
import { SUM_LABEL as COMBINE_SUM_LABEL } from '../lib/combine.mjs';
import { METRIC_DIMS, METRICS } from '../lib/r2-blocks.mjs';
import { defaultScope, RANGE_UNITS, addDays } from '../lib/scope.mjs';
import { sampleR2Combined } from '../lib/sample-r2.mjs';
import { VIEW_SPECS, PINNED_QUESTIONS } from '../lib/r2-specs.mjs';

const NOW = Date.parse('2026-11-18T15:00:00Z');
const snapshot = sampleR2Combined(NOW);
const base = defaultScope(snapshot, { now: NOW });
const at = (unit, anchor = '2026-11-18', extra = {}) => ({ ...base, range: { unit, anchor }, ...extra });
const history = host => snapshot.view.ledgerHistory.find(row => row.host === host);
const windowsUnavailable = history('Windows').days.find(day => day.status === 'unavailable').date;
const ledgerSum = (hosts, dates, read) => hosts.flatMap(host => history(host).days.filter(day => dates.includes(day.date) && day.status === 'ok')).reduce((sum, day) => sum + read(day), 0);
const close = (a, b) => assert.ok(Math.abs(a - b) < 0.02, `${a} is not ${b}`);

const NUM_KEYS = ['metric', 'unit', 'value', 'text', 'of', 'sumLabel', 'previous', 'delta', 'deltaText', 'breakdowns', 'note', 'atLeast'];
function assertNum(num, metric) {
  assert.deepEqual(Object.keys(num).sort(), [...NUM_KEYS].sort(), `${metric} keys`);
  if (metric) assert.deepEqual(new Set(Object.keys(num.breakdowns)), new Set(METRIC_DIMS[metric]), `${metric} breakdowns`);
  if (num.value === null) assert.ok(/Unknown|None landed/.test(num.text), `${metric} null reads Unknown, not ${num.text}`);
  for (const parts of Object.values(num.breakdowns)) for (const part of parts) {
    assert.deepEqual(Object.keys(part).sort(), ['key', 'label', 'share', 'text', 'value']);
    if (part.value === null) assert.equal(part.text, 'Unknown');
  }
}

test('the sum label matches the combine step', () => assert.equal(v.SUM_LABEL, COMBINE_SUM_LABEL));

test('every builder returns its documented shape for every range unit, and every number has its breakdowns', () => {
  for (const unit of RANGE_UNITS) {
    const scope = at(unit);
    const overview = v.buildOverview(snapshot, scope, { now: NOW });
    assert.deepEqual(Object.keys(overview).sort(), ['agents', 'chart', 'coverage', 'flags', 'frame', 'grok', 'headline', 'limits', 'limitsHeadline', 'running', 'topSessions'].sort());
    for (const [id, num] of Object.entries(overview.headline)) assertNum(num, id);
    assert.ok(overview.topSessions.length <= v.TOP_SESSIONS);
    for (const point of overview.chart) { assertNum(point.spend, null); assert.ok(point.spend.breakdowns.device); }
    assert.ok(overview.chart.length >= 1);
    const sessions = v.buildSessions(snapshot, scope, { now: NOW, groupBy: 'role' });
    assert.deepEqual(Object.keys(sessions).sort(), ['coverage', 'frame', 'groups', 'rows', 'totals']);
    for (const row of sessions.rows) for (const key of ['kind', 'count', 'children', 'key', 'host', 'device', 'tool', 'name', 'models', 'subagents', 'spend', 'share', 'onMain', 'merged', 'perLanded', 'startedAt', 'lastActiveAt', 'running', 'state', 'needsYou', 'repos'])
      assert.ok(Object.hasOwn(row, key), `${unit} row has ${key}`);
    const tokens = v.buildTokens(snapshot, scope, { now: NOW });
    assertNum(tokens.total, 'tokens');
    assert.equal(tokens.days.length, overview.frame.period.dates.length);
    const screen = v.buildScreenTime(snapshot, scope, { now: NOW });
    assertNum(screen.total, 'screenTime');
    assert.equal(screen.hours === null, unit !== 'day');
    for (const metric of METRICS) assertNum(v.metric(snapshot, metric, scope, { now: NOW }), metric);
    assert.ok(Array.isArray(v.buildDrift(snapshot, scope, { now: NOW }).models));
    assert.equal(v.buildLimits(snapshot, scope, { now: NOW }).engines.length, 3);
  }
});

test('the year and all charts are monthly, the rest daily', () => {
  assert.equal(v.buildOverview(snapshot, at('week'), { now: NOW }).chart.length, 3);
  const year = v.buildOverview(snapshot, at('year'), { now: NOW }).chart;
  assert.ok(year.every(point => point.date.endsWith('-01')));
  assert.equal(year.at(-1).date, '2026-11-01');
});

test('a day a computer could not read is Unknown, and so is every total that includes it', () => {
  const day = at('day', windowsUnavailable);
  const alone = v.metric(snapshot, 'spend', { ...day, devices: ['Windows'] }, { now: NOW });
  assert.equal(alone.value, null);
  assert.equal(alone.text, 'Unknown');
  const all = v.metric(snapshot, 'spend', day, { now: NOW });
  assert.equal(all.value, null);
  const parts = Object.fromEntries(all.breakdowns.device.map(part => [part.key, part.value]));
  assert.equal(parts.Windows, null);
  close(parts.Mac, ledgerSum(['Mac'], [windowsUnavailable], d => d.apiUsd));
  for (const part of all.breakdowns.model) assert.equal(part.value, null, 'a part of an Unknown total is Unknown');
  // The total stays Unknown, and says what was read beside it.
  const read = ledgerSum(['Mac', 'Linux'], [windowsUnavailable], d => d.apiUsd);
  close(all.atLeast.value, read);
  assert.equal(all.atLeast.text, `at least ${v.formatValue('usd', all.atLeast.value)}, 1 day not read on Tower`);
  assert.equal(alone.atLeast, null, 'with nothing read there is no known part');
  const week = v.metric(snapshot, 'spend', at('week', windowsUnavailable), { now: NOW });
  assert.equal(week.value, null, 'a multi-day sum with an Unknown day is Unknown');
  assert.match(week.atLeast.text, /^at least \$[\d,.]+, 1 day not read on Tower$/);
  assert.equal(v.metric(snapshot, 'perLanded', day, { now: NOW }).atLeast, null, 'a rate has no lower bound');
  assert.equal(v.metric(snapshot, 'spend', { ...day, devices: ['Mac', 'Linux'] }, { now: NOW }).atLeast, null, 'a known sum has none');
  const frame = v.buildSessions(snapshot, day, { now: NOW });
  assert.deepEqual(frame.coverage.unknownDays, [{ host: 'Windows', name: 'Tower', dates: [windowsUnavailable] }]);
  // Without Windows, the same day is known.
  assert.notEqual(v.metric(snapshot, 'spend', { ...day, devices: ['Mac', 'Linux'] }, { now: NOW }).value, null);
});

test('a computer whose history starts later adds nothing before its first day', () => {
  const linux = history('Linux');
  const month = at('month', addDays(linux.firstDate, 3));
  const view = v.buildOverview(snapshot, { ...month, devices: ['Mac', 'Linux'] }, { now: NOW });
  assert.deepEqual(view.coverage.startsLater, [{ host: 'Linux', name: 'Lab', before: linux.firstDate }]);
  const dates = view.frame.period.dates;
  close(view.headline.spend.value, ledgerSum(['Mac', 'Linux'], dates, d => d.apiUsd));
  const linuxPart = view.headline.spend.breakdowns.device.find(part => part.key === 'Linux').value;
  close(linuxPart, ledgerSum(['Linux'], dates.filter(date => date >= linux.firstDate), d => d.apiUsd));
});

test('a sum across computers says "not deduplicated" next to its per-device parts, one computer does not', () => {
  const week = at('week');
  for (const id of ['spend', 'merged', 'onMain', 'tokens']) {
    const num = v.metric(snapshot, id, { ...week, devices: ['Mac', 'Linux'] }, { now: NOW });
    assert.equal(num.sumLabel, 'not deduplicated', id);
    assert.equal(num.breakdowns.device.length, 2, id);
    assert.equal(v.metric(snapshot, id, { ...week, devices: ['Mac'] }, { now: NOW }).sumLabel, null, id);
  }
  // Sessions are per computer, so their count is never labeled.
  assert.equal(v.metric(snapshot, 'sessions', week, { now: NOW }).sumLabel, null);
});

test('headline numbers follow the plan definitions', () => {
  const scope = { ...at('week'), devices: ['Mac', 'Linux'] };
  const view = v.buildOverview(snapshot, scope, { now: NOW });
  const dates = view.frame.period.dates;
  const commits = ledgerSum(['Mac', 'Linux'], dates, d => d.ship.commits), onMain = ledgerSum(['Mac', 'Linux'], dates, d => d.ship.onMain);
  const spend = ledgerSum(['Mac', 'Linux'], dates, d => d.apiUsd);
  assert.equal(view.headline.onMain.value, onMain);
  assert.equal(view.headline.onMain.of, commits);
  assert.equal(view.headline.onMain.text, `${onMain} of ${commits}`);
  assert.equal(view.headline.churn.value, commits - onMain);
  close(view.headline.perLanded.value, spend / onMain);
  assert.equal(view.headline.merged.value, ledgerSum(['Mac', 'Linux'], dates, d => d.ship.merges));
  const idle = ['Mac', 'Linux'].flatMap(host => history(host).days.filter(day => dates.includes(day.date)).flatMap(day => day.sessions))
    .filter(session => session.ship.reduce((sum, ship) => sum + ship.commits, 0) === 0);
  close(view.headline.noCommitSpend.value, idle.reduce((sum, session) => sum + session.apiUsd, 0));
  assert.match(view.headline.onMain.deltaText, /landed, was|Unknown/);
});

test('cost per landed change reads None landed when nothing reached main', () => {
  const empty = { ...snapshot, view: { ...snapshot.view, ledgerHistory: snapshot.view.ledgerHistory.map(row => ({ ...row,
    days: row.days.map(day => day.status === 'ok' ? { ...day, ship: { ...day.ship, onMain: 0 }, repos: day.repos.map(repo => ({ ...repo, onMain: 0 })),
      sessions: day.sessions.map(session => ({ ...session, ship: session.ship.map(ship => ({ ...ship, onMain: 0 })) })) } : day) })) } };
  const num = v.metric(empty, 'perLanded', { ...at('week'), devices: ['Mac'] }, { now: NOW });
  assert.deepEqual([num.value, num.text], [null, 'None landed']);
});

test('a previous period with no recorded day reads "no earlier data", not a percentage', () => {
  const linux = history('Linux');
  const first = at('week', linux.firstDate, { devices: ['Linux'] });
  assert.equal(v.metric(snapshot, 'spend', first, { now: NOW }).deltaText, 'no earlier data');
  assert.equal(v.metric(snapshot, 'spend', at('all'), { now: NOW }).deltaText, null);
  assert.match(v.metric(snapshot, 'spend', at('day', '2026-11-17', { devices: ['Mac'] }), { now: NOW }).deltaText, /(up|down) \d+% vs the day before|no change/);
});

test('a stale computer\'s day after its last read is Unknown on its own, not 0', () => {
  const late = { ...snapshot, view: { ...snapshot.view, ledgerHistory: snapshot.view.ledgerHistory.map(row => row.host === 'Windows'
    ? { ...row, checkedAt: '2026-11-17T20:00:00.000Z' } : row) } };
  const today = v.metric(late, 'spend', at('day', '2026-11-18', { devices: ['Windows'] }), { now: NOW });
  assert.equal(today.value, null);
  assert.notEqual(v.metric(late, 'spend', at('day', '2026-11-17', { devices: ['Windows'] }), { now: NOW }).value, null);
});

test('a source that is not in scope adds nothing anywhere', () => {
  const week = at('week', '2026-11-18', { devices: ['Windows'] });
  const both = v.metric(snapshot, 'spend', week, { now: NOW });
  const claude = v.metric(snapshot, 'spend', { ...week, sources: ['claude', 'grok'] }, { now: NOW });
  assert.deepEqual(both.breakdowns.tool.map(part => part.key).sort(), ['claude', 'codex']);
  assert.deepEqual(claude.breakdowns.tool.map(part => part.key), ['claude']);
  const dates = v.buildFrame(snapshot, week, { now: NOW }).period.dates;
  close(claude.value, history('Windows').days.filter(day => day.tool === 'claude' && dates.includes(day.date)).reduce((sum, day) => sum + day.apiUsd, 0));
  assert.equal(v.buildOverview(snapshot, { ...at('week'), sources: ['claude'] }, { now: NOW }).grok, null);
});

test('account limits show once each, with the computer they were read on, whatever the devices', () => {
  const all = v.buildLimits(snapshot, at('week'), { now: NOW }).engines;
  const one = v.buildLimits(snapshot, at('week', '2026-11-18', { devices: ['Linux'] }), { now: NOW }).engines;
  assert.deepEqual(one, all);
  const claude = all.find(engine => engine.engine === 'claude');
  // The 5-hour window was left out of the latest reading, so it reads Not reported, with no number and no computer.
  assert.deepEqual(claude.windows.map(window => [window.label, window.remaining, window.readOn, window.state]), [['weekly', 40, 'Studio', 'ok'], ['5 hour', null, null, 'absent']]);
  for (const engine of all) assert.equal(new Set(engine.windows.map(window => window.windowId)).size, engine.windows.length);
  // Codex reports a free plan with nothing left: it reads Off, with no number.
  const codex = all.find(engine => engine.engine === 'codex').windows[0];
  assert.deepEqual([codex.state, codex.remaining], ['off', null]);
  // Past weeks come from the stored readings, the second one ran out.
  const month = v.buildLimits(snapshot, at('month'), { now: NOW }).engines.find(engine => engine.engine === 'claude').windows[0].pastWindows;
  assert.ok(month.length >= 2);
  assert.ok(month.some(window => window.used === 100));
});

test('the limits forecast is the one the hub stored, shown through shown() as every surface shows it', () => {
  const limits = v.buildLimits(snapshot, at('week'), { now: NOW });
  const weekly = limits.engines[0].windows[0];
  const stored = snapshot.glance.forecast.windows.find(window => window.engine === 'claude' && window.windowId === 'seven_day');
  assert.equal(weekly.forecast, stored);
  assert.equal(weekly.forecastText, stored.headline);
  assert.equal(weekly.forecastResets, stored.resets);
  assert.equal(v.buildOverview(snapshot, at('week'), { now: NOW }).limits[0].windows[0].forecastText, stored.headline);
  assert.equal(limits.engines[0].headline, snapshot.glance.forecast.engines.find(engine => engine.engine === 'claude').headline);
  // An hour later the stored words are dated, and nothing projects from them.
  const later = v.buildLimits(snapshot, at('week'), { now: NOW + 3600000 }).engines[0].windows[0];
  assert.match(later.forecastText, /, as of Wed \d{1,2}:\d\d (AM|PM)$/);
  assert.equal(later.forecast, null);
  // A snapshot with no stored forecast reads Unknown, never a forecast of its own.
  const none = { ...snapshot, glance: { limits: snapshot.glance.limits } };
  assert.equal(v.buildLimits(none, at('week'), { now: NOW }).engines[0].windows[0].forecastText, 'Unknown');
  assert.equal(v.buildLimits(none, at('week'), { now: NOW }).headline, 'Unknown');
  // The view-models only show the stored forecast: they never call the forecaster.
  const source = readFileSync(new URL('../lib/view-r2.mjs', import.meta.url), 'utf8');
  assert.match(source, /import \{ lastReading, readAt, shown, shownSentence \} from '\.\/forecast\.mjs';/);
  assert.doesNotMatch(source, /windowForecast|projection\(|quota-pace|\bforecast\(/);
});

test('Grok is counted in requests and never added to dollars or tokens', () => {
  const view = v.buildOverview(snapshot, at('week'), { now: NOW });
  const grok = view.agents.find(row => row.agent === 'Grok');
  assert.deepEqual([grok.usd, grok.tokens, grok.requests.unit], [null, null, 'requests']);
  for (const row of view.agents.filter(row => row.agent !== 'Grok')) assert.equal(row.requests, null);
  const dates = view.frame.period.dates;
  close(view.headline.spend.value, ledgerSum(['Mac', 'Windows', 'Linux'], dates, d => d.apiUsd));
  const counts = snapshot.view.grokLimits.requests.days.filter(day => dates.includes(day.date));
  assert.equal(view.grok.total.value, counts.reduce((sum, day) => sum + day.count, 0));
  assert.deepEqual(view.grok.weekly.remaining, 64);
  // A logged day with no count is Unknown, and so is a total over it.
  const missing = snapshot.view.grokLimits.requests.days.find(day => day.count === null).date;
  assert.equal(v.metric(snapshot, 'grokRequests', at('day', missing), { now: NOW }).value, null);
});

test('sessions fold headless runs into named bundles, group by role and show what runs now', () => {
  const linux = v.buildSessions(snapshot, at('week', '2026-11-18', { devices: ['Linux'] }), { now: NOW, limit: 100 });
  const bundles = linux.rows.filter(row => row.kind === 'bundle');
  assert.ok(bundles.length > 0);
  for (const row of bundles) {
    assert.ok(['Reviewer', 'Runner'].includes(row.name.role));
    assert.equal(row.count, row.children.length);
    close(row.spend.value, row.children.reduce((sum, child) => sum + child.spend.value, 0));
  }
  const grouped = v.buildSessions(snapshot, at('week'), { now: NOW, groupBy: 'role', limit: 1000 });
  assert.equal(grouped.groups.reduce((sum, group) => sum + group.rows.length, 0), grouped.rows.length);
  const builders = v.buildSessions(snapshot, at('week'), { now: NOW, role: 'Builder' });
  assert.ok(builders.rows.every(row => row.name.role === 'Builder'));
  const running = v.buildSessions(snapshot, at('week'), { now: NOW, running: true, limit: 100 });
  assert.equal(running.rows.length, 2);
  assert.deepEqual(new Set(running.rows.map(row => row.needsYou)), new Set([false, true]));
  // A past period has nothing running.
  assert.equal(v.buildSessions(snapshot, at('week', '2026-11-04'), { now: NOW, running: true }).rows.length, 0);
  const limited = v.buildSessions(snapshot, at('week'), { now: NOW, limit: 3 });
  assert.equal(limited.rows.length, 3);
  assert.ok(limited.totals.other.count > 0);
  // One rule: the top rows, then everything else as one count. The only bundles are recurring runs and headless runs of one repository.
  const every = v.buildSessions(snapshot, at('week'), { now: NOW, limit: 5000 });
  for (const row of every.rows.filter(row => row.kind === 'bundle'))
    assert.ok(row.key.startsWith('bundle.headless.') && row.name.object.startsWith('Headless runs in ') || row.key.startsWith('bundle.recurring.'), row.key);
  assert.ok(every.rows.some(row => row.key === 'bundle.recurring.Runner|job queue' && row.name.display === '[Runner] job queue' && row.count >= v.RECURRING_MIN));
  assert.ok(every.rows.some(row => row.kind === 'session' && row.share !== null && row.share < 1), 'a small session is its own row');
  assert.equal(limited.totals.other.count + limited.rows.reduce((sum, row) => sum + row.count, 0), limited.totals.count);
  // What is kept as totals only cannot be listed, and it is counted apart. A role filter leaves it out.
  assert.equal(every.totals.other?.count ?? 0, every.totals.unlisted?.count ?? 0);
  assert.equal(v.buildSessions(snapshot, at('month'), { now: NOW, role: 'Builder', limit: 5000 }).totals.other, null);
  // Sorted by spend, largest first.
  const spends = limited.rows.map(row => row.spend.value);
  assert.deepEqual(spends, [...spends].sort((a, b) => b - a));
});

test('recurring runs with one role and object fold into one named row that opens into its runs', () => {
  // Fictional: every listed Mac session this week is a queue run named "LanternBot: job queue", written several ways,
  // except two "Kestrel sync" runs (below the minimum) and three bare "Chief of staff" titles on one Windows day.
  const copy = structuredClone(snapshot);
  const week = v.buildFrame(copy, at('week'), { now: NOW }).period.dates;
  const ledger = host => copy.view.ledgerHistory.find(row => row.host === host).days.filter(day => week.includes(day.date) && day.status === 'ok');
  const spellings = ['LanternBot: job queue', 'LanternBot: Job  queue.', 'LanternBot:  job queue'];
  let queued = 0, kestrel = 0;
  for (const day of ledger('Mac')) for (const session of day.sessions) {
    if (kestrel < 2) { session.title = 'Kestrel sync'; kestrel++; continue; }
    session.title = spellings[queued++ % spellings.length];
  }
  const windowsDay = ledger('Windows').find(day => day.tool === 'claude' && day.sessions.length >= 3);
  for (const session of windowsDay.sessions.slice(0, 3)) session.title = 'Chief of staff';
  // The fixture's own queue runs on other computers this week join the same row.
  queued += ['Windows', 'Linux'].flatMap(host => ledger(host)).flatMap(day => day.sessions).filter(session => /^LanternBot:\s*job queue$/.test(session.title ?? '')).length;
  const rows = v.buildSessions(copy, at('week'), { now: NOW, limit: 5000 }).rows;
  const queue = rows.filter(row => row.name.object.toLowerCase().replace(/[^a-z]+/g, ' ').trim() === 'job queue');
  assert.equal(queue.length, 1, 'one row for every spelling');
  assert.equal(queue[0].kind, 'bundle');
  assert.equal(queue[0].key, 'bundle.recurring.Runner|job queue');
  assert.equal(queue[0].name.display, '[Runner] job queue');
  assert.equal(queue[0].count, queued);
  assert.equal(queue[0].children.length, queued);
  assert.ok(queue[0].children.every(child => child.kind === 'session' && child.name.role === 'Runner'));
  close(queue[0].spend.value, queue[0].children.reduce((sum, child) => sum + child.spend.value, 0));
  // Two runs are not a recurring run, and titles that are only a role name their day, which never recurs.
  assert.equal(rows.filter(row => row.kind === 'session' && /^Kestrel sync$/.test(row.name.object)).length, 2);
  assert.ok(!rows.some(row => row.kind === 'bundle' && row.name.object.startsWith('Kestrel')));
  const bare = new Set(windowsDay.sessions.slice(0, 3).map(session => `Windows.claude.${session.id}`));
  assert.ok(rows.filter(row => row.key.startsWith('bundle.recurring.')).every(row => row.children.every(child => !bare.has(child.key))));
  assert.ok(rows.filter(row => bare.has(row.key)).length === 3, 'each bare role title is its own row');
  // Grouped by role, the queue counts all its runs under Runner.
  const runner = v.buildSessions(copy, at('week'), { now: NOW, groupBy: 'role', limit: 5000 }).groups.find(group => group.key === 'Runner');
  assert.ok(runner.count >= queued);
  // The normalized object ignores case, spacing and end punctuation, and nothing else.
  assert.equal(v.recurringObject(' Job  queue. '), 'job queue');
  assert.notEqual(v.recurringObject('job queue 2'), v.recurringObject('job queue'));
});

test('a breakdown by role has one Other row, last, for sessions with no role and sessions kept as totals only', () => {
  for (const unit of ['week', 'month', 'year']) for (const metric of ['spend', 'sessions', 'onMain']) {
    const parts = v.metric(snapshot, metric, at(unit), { now: NOW }).breakdowns.role;
    const labels = parts.map(part => part.label);
    assert.ok(!labels.some(label => /no role|unlisted|smaller/i.test(label)), labels.join(', '));
    assert.ok(labels.filter(label => label === 'Other').length <= 1);
    if (labels.includes('Other')) assert.equal(labels.at(-1), 'Other');
  }
  const groups = v.buildSessions(snapshot, at('month'), { now: NOW, groupBy: 'role', limit: 5000 }).groups;
  assert.ok(groups.every(group => group.label !== 'No role'));
  assert.equal(groups.find(group => group.key === 'none')?.label ?? 'Other', 'Other');
});

test('screen time adds tracked days only, a single untracked day is Unknown, and a computer with it off adds nothing', () => {
  const mac = snapshot.view.activityHistory.find(row => row.host === 'Mac');
  const untracked = mac.days.find(day => day.trackedSeconds === 0).date;
  assert.equal(v.buildScreenTime(snapshot, at('day', untracked, { devices: ['Mac'] }), { now: NOW }).total.value, null);
  const week = v.buildScreenTime(snapshot, at('week', untracked, { devices: ['Mac'] }), { now: NOW });
  assert.notEqual(week.total.value, null);
  assert.equal(week.days.find(day => day.date === untracked).tracked, false);
  const all = v.buildScreenTime(snapshot, at('week'), { now: NOW });
  assert.deepEqual(all.total.breakdowns.device.map(part => part.key).sort(), ['Mac', 'Windows']);
  assert.equal(all.total.sumLabel, 'not deduplicated');
  assert.equal(v.buildScreenTime(snapshot, at('week', '2026-11-18', { devices: ['Linux'] }), { now: NOW }).total.value, 0);
  const categories = all.total.breakdowns.category.reduce((sum, part) => sum + part.value, 0);
  assert.equal(categories, all.total.value);
});

test('tokens split into input, output and cache parts that add up', () => {
  const tokens = v.buildTokens(snapshot, at('week', '2026-11-18', { devices: ['Mac'] }), { now: NOW });
  assert.equal(tokens.byKind.reduce((sum, part) => sum + part.value, 0), tokens.total.value);
  assert.ok(tokens.repos.length > 0);
  const today = v.buildTokens(snapshot, at('day', '2026-11-18', { devices: ['Mac'] }), { now: NOW });
  assert.ok(today.repos.some(repo => repo.tokens !== null));
  assert.ok(tokens.repos.every(repo => repo.tokens === null));
});

test('settings are read-only, keyed by computer and hold no paths', () => {
  const settings = v.buildSettings(snapshot, base, { now: NOW });
  assert.equal(settings.howToChange, 'Edit observatory.config.json on that computer. The next collection uses it.');
  assert.deepEqual(settings.computers.map(row => [row.host, row.name, row.role]), [['Mac', 'Studio', 'hub'], ['Windows', 'Tower', 'spoke'], ['Linux', 'Lab', 'spoke']]);
  assert.deepEqual(settings.sources.find(row => row.id === 'codex').on, { Mac: false, Windows: true, Linux: false });
  assert.deepEqual(settings.roleAliases, [{ prefix: 'tidepool notes', role: 'Researcher' }, { prefix: 'lanternbot', role: 'Runner' }]);
  assert.doesNotMatch(JSON.stringify(settings), /\/Users\/|C:\\\\|dataFolder|sshAlias/);
});

test('roles use the settings map: a Mac session titled "Tidepool notes" is a Researcher', () => {
  const rows = v.buildSessions(snapshot, at('month'), { now: NOW, limit: 1000 }).rows.flatMap(row => [row, ...row.children]);
  assert.ok(rows.some(row => row.name.role === 'Researcher' && row.name.roleSource === 'alias'));
  assert.ok(rows.some(row => row.name.display.startsWith('[Builder] Lantern')));
});

test('the flags name stale computers and sessions that need a look', () => {
  const flags = v.buildOverview(snapshot, at('week'), { now: NOW }).flags;
  assert.equal(flags[0].text, 'Tower last read Wed 7:00 AM', 'a time names its day');
  assert.ok(flags.length <= v.FLAG_LINES);
  assert.ok(flags.slice(1).every(flag => flag.sessionKey === null || /^(Mac|Windows|Linux)\./.test(flag.sessionKey)));
});

test('every block of every built-in spec resolves against the fixture', () => {
  for (const view of [...Object.values(VIEW_SPECS), ...PINNED_QUESTIONS.map(pin => pin.view)])
    for (const element of Object.values(view.spec.elements)) {
      const model = v.resolveBlock(element.type, element.props, snapshot, base, { now: NOW });
      assert.ok(model !== undefined, element.type);
      if (element.type === 'Headline') assertNum(model.num, element.props.metric);
      if (element.type === 'Breakdown') assert.ok(model.parts.length <= (element.props.limit ?? v.BREAKDOWN_ROWS) + 1);
    }
  assert.throws(() => v.resolveBlock('Nope', {}, snapshot, base, { now: NOW }), /Unknown block/);
  const scoped = v.resolveBlock('Headline', { metric: 'spend', scope: { devices: ['Mac'], range: { unit: 'day' } } }, snapshot, base, { now: NOW });
  assert.deepEqual([scoped.frame.period.unit, scoped.num.breakdowns.device.length], ['day', 1]);
  const noCompare = v.resolveBlock('Headline', { metric: 'spend', compare: false, breakdowns: ['model'] }, snapshot, base, { now: NOW });
  assert.deepEqual([noCompare.num.deltaText, Object.keys(noCompare.num.breakdowns)], [null, ['model']]);
});

test('builders are pure: the same input gives the same output', () => {
  assert.deepEqual(v.buildOverview(snapshot, base, { now: NOW }), v.buildOverview(sampleR2Combined(NOW), base, { now: NOW }));
});

test('a session titled by a user alias from the settings echo shows its role and name in the Sessions view', () => {
  const copy = structuredClone(snapshot);
  copy.view.config = copy.view.config.map(row => row.host === 'Mac' ? { ...row, roleAliases: { ...row.roleAliases, Atlas: 'Chief of staff' } } : row);
  const mac = copy.view.ledgerHistory.find(row => row.host === 'Mac');
  const day = [...mac.days].reverse().find(entry => entry.status === 'ok' && entry.sessions.length);
  const id = day.sessions[0].id;
  for (const entry of mac.days) for (const session of entry.sessions) if (session.id === id) session.title = 'Atlas: chief of staff';
  const rows = v.buildSessions(copy, at('all'), { now: NOW, limit: 500 }).rows;
  const row = rows.flatMap(each => [each, ...each.children]).find(each => each.key.endsWith(`.${id}`));
  assert.ok(row, 'the session is listed');
  assert.deepEqual([row.name.role, row.name.display], ['Chief of staff', '[Chief of staff] Atlas']);
});

test('a computer turned off adds nothing, even when its history has a day it could not read, and is not flagged as stale', () => {
  // The fixture's Tower could not read one day. Turned off in the hub's settings, it leaves every sum and flag.
  const off = { ...snapshot, devices: snapshot.devices.map(device => device.host === 'Windows' ? { ...device, state: 'off', stateLabel: 'Off' } : device) };
  const scope = at('week', windowsUnavailable, { devices: ['Mac', 'Windows', 'Linux'] });
  assert.equal(v.metric(snapshot, 'spend', scope, { now: NOW }).value, null, 'the check bites: with Tower on, the week is Unknown');
  const spend = v.metric(off, 'spend', scope, { now: NOW });
  close(spend.value, ledgerSum(['Mac', 'Linux'], v.buildFrame(off, scope, { now: NOW }).period.dates, day => day.apiUsd));
  assert.deepEqual(spend.breakdowns.device.map(part => part.key).sort(), ['Linux', 'Mac']);
  assert.ok(!v.buildOverview(off, scope, { now: NOW }).flags.some(line => line.text.includes('Tower')));
});

// Hand-made ledger days for the session count: one session id per entry in `ids`, listed or as a compact row.
const zeroTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const handDay = (date, ids, { listed = true, rowsKept = true } = {}) => ({ date, tool: 'claude', status: 'ok', frozen: false, apiUsd: ids.length,
  sessionCount: ids.length, subagents: 0, tokens: zeroTokens, models: [], kinds: [], origins: [], repos: [], ship: { commits: 0, onMain: 0, merges: 0 },
  sessions: listed ? ids.map(id => ({ id, title: null, origin: 'interactive', task: 'build', repo: null, firstAt: `${date}T15:00:00.000Z`, lastAt: `${date}T16:00:00.000Z`,
    apiUsd: 1, tokens: zeroTokens, models: [], kinds: [], ship: [] })) : [],
  other: listed || !ids.length ? null : { count: ids.length, apiUsd: ids.length, subagents: 0, ship: { commits: 0, onMain: 0, merges: 0 }, rows: rowsKept ? ids.map(id => [id, 1, 0, 0]) : [] } });
const unreadDay = date => ({ ...handDay(date, []), status: 'unavailable', apiUsd: null, sessionCount: null });
const withDays = byHost => ({ ...snapshot, view: { ...snapshot.view, ledgerHistory: snapshot.view.ledgerHistory.map(row => byHost[row.host]
  ? { ...row, firstDate: byHost[row.host].days[0].date, sessionsFrom: byHost[row.host].sessionsFrom ?? byHost[row.host].days[0].date, days: byHost[row.host].days } : row) } });

test('sessions count distinct sessions, and an Unknown count gives a true lower bound, not session-days', () => {
  const week = at('week', '2026-11-18', { devices: ['Mac', 'Windows'] });
  // One session runs Monday to Wednesday on the Mac. The PC could not read Tuesday.
  const span = withDays({ Mac: { days: ['2026-11-16', '2026-11-17', '2026-11-18'].map(date => handDay(date, ['aaaaaaaaaaaa'])) },
    Windows: { days: [handDay('2026-11-16', []), unreadDay('2026-11-17'), handDay('2026-11-18', [])] } });
  const partly = v.metric(span, 'sessions', week, { now: NOW });
  assert.equal(partly.value, null);
  assert.deepEqual(partly.atLeast, { value: 1, text: 'at least 1, 1 day not read on Tower' });
  assert.equal(v.metric(span, 'sessions', { ...week, devices: ['Mac'] }, { now: NOW }).value, 1, 'all read: one session');
  // Days older than sessionsFrom keep compact rows, which still tell one session from three.
  const macOnly = { ...week, devices: ['Mac'] };
  const compact = withDays({ Mac: { sessionsFrom: '2026-11-19', days: ['2026-11-16', '2026-11-17', '2026-11-18'].map(date => handDay(date, ['aaaaaaaaaaaa'], { listed: false })) } });
  assert.equal(v.metric(compact, 'sessions', macOnly, { now: NOW }).value, 1);
  // With the compact rows trimmed too, only day counts are left, which would count the session three times: Unknown.
  const counts = withDays({ Mac: { sessionsFrom: '2026-11-19', days: ['2026-11-16', '2026-11-17', '2026-11-18'].map(date => handDay(date, ['aaaaaaaaaaaa'], { listed: false, rowsKept: false })) } });
  const bare = v.metric(counts, 'sessions', macOnly, { now: NOW });
  assert.equal(bare.value, null);
  assert.equal(bare.text, 'Unknown');
  assert.equal(bare.atLeast, null);
});
