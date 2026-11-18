// Server-side renders of the Limits, Tokens, Screen time, Drift and Settings views (round 2, lane d), from
// the fictional fixture's settings echo and ledger history and from view-models shaped as lib/view-r2.mjs
// documents them. Unknown is never drawn as 0, limits show once with the computer they were read on, and
// Settings has no control that changes anything.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sampleR2Combined } from '../lib/sample-r2.mjs';
import { RANGE_UNITS } from '../lib/scope.mjs';
import { SESSION_DAYS } from '../lib/r2-shape.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const { createServer } = await import('vite');
const { default: react } = await import('@vitejs/plugin-react');
const server = await createServer({ configFile: false, root, server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', plugins: [react()],
  css: { postcss: {} } });
after(() => server.close());
const load = path => server.ssrLoadModule(path);
const { LimitsBody, devicePoints } = await load('/app/viewer/r2/views/Limits.tsx');
const { TokensBody, tokenKinds } = await load('/app/viewer/r2/views/Tokens.tsx');
const { ScreenTimeBody } = await load('/app/viewer/r2/views/ScreenTime.tsx');
const { DriftBody, setupRows } = await load('/app/viewer/r2/views/Drift.tsx');
const { SettingsBody, firstLedgerDate, COLLECT_EVERY_MINUTES } = await load('/app/viewer/r2/views/Settings.tsx');
const { dayColumns } = await load('/app/viewer/r2/views/parts.tsx');

const NOW = Date.parse('2026-11-18T15:00:00Z'), HOUR = 3600000;
const combined = sampleR2Combined(NOW);
const { view } = combined;
const TZ = view.timezone;
const html = element => renderToStaticMarkup(element);
const clean = (markup, label) => {
  for (const bad of ['NaN', 'undefined', 'null', 'Infinity', '—']) assert.ok(!markup.includes(bad), `${label} shows ${bad}`);
  return markup;
};

const periods = {
  day: { unit: 'day', first: '2026-11-18', last: '2026-11-18', dates: ['2026-11-18'], current: true, partial: false, label: 'Nov 18' },
  week: { unit: 'week', first: '2026-11-16', last: '2026-11-18', dates: ['2026-11-16', '2026-11-17', '2026-11-18'], current: true, partial: true, label: 'Nov 16 to 22' },
  month: { unit: 'month', first: '2026-11-01', last: '2026-11-18', dates: Array.from({ length: 18 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`), current: true, partial: true, label: 'November 2026' },
  year: { unit: 'year', first: '2026-01-01', last: '2026-11-18', dates: [], current: true, partial: true, label: '2026' },
  all: { unit: 'all', first: '2026-07-22', last: '2026-11-18', dates: [], current: true, partial: false, label: 'All time' },
};
for (const unit of ['year', 'all']) for (let date = periods[unit].first; date <= '2026-11-18'; ) {
  periods[unit].dates.push(date);
  const next = new Date(`${date}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1); date = next.toISOString().slice(0, 10);
}
const chips = (selected = ['Mac', 'Windows', 'Linux']) => combined.devices.map(device => ({ host: device.host, name: device.name, state: device.stale ? 'stale' : 'live', since: device.collectedAt, selected: selected.includes(device.host) }));
const frame = (unit = 'week', selected) => ({ scope: { devices: selected ?? ['Mac', 'Windows', 'Linux'], range: { unit, anchor: '2026-11-18' }, sources: ['claude', 'codex', 'grok'] },
  period: periods[unit], comparison: null, devices: chips(selected), sources: [], steps: { back: null, forward: null }, timeZone: TZ, generatedAt: combined.generatedAt, stale: false });
const num = (value, text, extra = {}) => ({ metric: null, unit: 'count', value, text, of: null, sumLabel: null, previous: null, delta: null, deltaText: null, breakdowns: {}, note: null, ...extra });
const part = (key, value, text) => ({ key, label: key, value, text, share: null });

test('the collection interval Settings states is the one the collector writes', async () => {
  const source = await readFile(new URL('../scripts/collect.mjs', import.meta.url), 'utf8');
  const seconds = [...source.matchAll(/intervalSeconds:(\d+)/g)].map(match => Number(match[1]));
  assert.ok(seconds.length > 0);
  for (const value of seconds) assert.equal(value, COLLECT_EVERY_MINUTES * 60);
});

test('Settings shows each computer\'s sources from the settings echo, with no control that changes them', () => {
  const settingsVM = { frame: frame(), computers: view.config.map(row => ({ host: row.host, name: row.name, role: row.role, sources: row.sources, engines: row.engines, titles: row.titles })),
    sources: [{ id: 'claude', name: 'Claude Code', reads: 'Session logs', on: { Mac: true, Windows: true, Linux: true } },
      { id: 'codex', name: 'Codex', reads: 'Session logs and plan quota', on: { Mac: false, Windows: true, Linux: false } },
      { id: 'grok', name: 'GrokBot', reads: 'Requests per day', on: { Mac: true, Windows: false, Linux: false } }],
    roleAliases: [{ prefix: 'tidepool notes', role: 'Researcher' }], howToChange: 'Edit observatory.config.json on that computer. The next collection uses it.' };
  const markup = clean(html(createElement(SettingsBody, { vm: settingsVM, firstDate: firstLedgerDate(view), roleWeek: null, pins: null, now: NOW })), 'Settings');
  for (const control of ['<input', '<button', '<select', '<textarea', 'role="switch"', 'class="sw', 'onclick']) assert.ok(!markup.toLowerCase().includes(control), `no ${control}`);
  for (const name of ['Studio', 'Tower', 'Lab']) assert.ok(markup.includes(name), name);
  assert.ok(markup.includes('On · Studio, Tower and Lab'), 'Claude Code is on on every computer');
  assert.ok(markup.includes('On · Tower') && markup.includes('On · Studio and Tower'), 'Codex on Tower only, screen time off on Lab');
  for (const key of ['sources.claudeCode', 'sources.codexLimits', 'sources.grokLimits', 'sources.screenTime']) assert.ok(markup.includes(key), key);
  assert.ok(markup.includes('observatory.config.json') && markup.includes('The next collection uses it'));
  assert.ok(markup.includes(`kept for ${SESSION_DAYS} days`) && markup.includes(`every ${COLLECT_EVERY_MINUTES} minutes`));
  const first = view.ledgerHistory.find(row => row.host === 'Mac').firstDate;
  assert.equal(firstLedgerDate(view), first, 'history starts on the earliest first date, the Mac\'s');
  assert.ok(markup.includes(`, ${first.slice(0, 4)}`) && markup.includes('120 days'), 'the Mac keeps 120 days');
  assert.ok(!markup.includes('~/.observatory') && !markup.includes('90 days'), 'no placeholder from the mockup');
  assert.ok(markup.includes('titles starting &quot;tidepool notes&quot; read as Researcher'));
  assert.ok(markup.includes('Stale') && markup.includes('Live'));
});

const weekReset = NOW + 58 * HOUR;
const limitsVM = (weekly = {}) => ({ frame: frame(), engines: [
  { engine: 'claude', name: 'Claude Code', plan: null, windows: [
    { windowId: 'seven_day', label: 'weekly', remaining: null, resetsAt: null, readOn: null, checkedAt: null, state: 'stale', forecast: null, pastWindows: [], ...weekly },
    { windowId: 'five_hour', label: '5 hour', remaining: null, resetsAt: null, readOn: null, checkedAt: '2026-11-12T10:00:00Z', state: 'stale', forecast: null, pastWindows: [] }] },
  { engine: 'grok', name: 'GrokBot', plan: null, windows: [] }] });
const grok = { total: num(null, 'Unknown', { unit: 'requests' }), days: view.grokLimits.requests.days.map(day => ({ date: day.date, value: day.count })),
  weekly: { remaining: 64, resetsAt: view.grokLimits.windows[0].resetsAt, checkedAt: view.grokLimits.windows[0].checkedAt } };

test('Limits reads Unknown, never 0, before the app reports a window', () => {
  const vm = limitsVM();
  const markup = clean(html(createElement(LimitsBody, { vm, grok, readings: [], byDevice: devicePoints(view, vm.engines[0].windows[0], NOW, TZ), now: NOW, timeZone: TZ })), 'Limits');
  assert.ok(markup.includes('Claude Code weekly limit') && markup.includes('Unknown'));
  assert.ok(!/>0%</.test(markup), 'no 0% for a window never read');
  assert.ok(markup.includes('not reported since Nov 12'), 'the 5 hour window says since when');
  assert.ok(markup.includes('requests per day, last 30 days') && markup.includes('64% left'), 'Grok shows requests per day and its weekly limit');
  assert.ok(markup.includes('class="z unk"'), 'a day with no count read is drawn hollow');
  assert.ok(!markup.includes('$'), 'Grok requests are never in dollars');
});

test('Limits shows the weekly limit once, with the computer it was read on, and splits it by device in points', () => {
  const vm = limitsVM({ remaining: 40, resetsAt: new Date(weekReset).toISOString(), readOn: 'Studio', checkedAt: new Date(NOW).toISOString(), state: 'ok',
    forecast: { status: 'room', ratePerHour: 0.5 }, pastWindows: [{ start: '2026-11-06', used: 94 }, { start: '2026-10-30', used: 100 }] });
  const readings = Array.from({ length: 12 }, (_, index) => ({ at: weekReset - 168 * HOUR + index * 8 * HOUR, used: index * 5 }));
  const byDevice = devicePoints(view, vm.engines[0].windows[0], NOW, TZ);
  const markup = clean(html(createElement(LimitsBody, { vm, grok, readings, byDevice, now: NOW, timeZone: TZ })), 'Limits');
  assert.equal(markup.match(/60%<small>used<\/small>/g)?.length, 1, 'the weekly limit shows once, never summed');
  assert.ok(markup.includes('read on Studio'));
  assert.ok(markup.includes('89%') && markup.includes('at the reset'), '60% plus 0.5 points an hour for 58 hours');
  assert.ok(markup.includes('Ran out before the reset') && markup.includes('Lasted, 6% unused'));
  assert.ok(markup.includes('1<small>of the last 2</small>'));
  assert.equal(byDevice.length, 3);
  const known = byDevice.filter(device => device.points !== null);
  assert.ok(Math.abs(known.reduce((sum, device) => sum + device.points, 0) - 60) < 1e-6 || byDevice.some(device => device.points === null), 'points add up to the percent used');
});

const tokensVM = (unit, selected, overrides = {}) => {
  const f = frame(unit, selected);
  return { frame: f,
    total: num(2_400_000_000, '2.40B', { unit: 'tokens', sumLabel: (selected ?? [1, 2]).length > 1 ? 'not deduplicated' : null,
      breakdowns: { device: [part('Studio', 2e9, '2.00B'), part('Tower', 4e8, '400.0M')] } }),
    spend: num(812, '$812', { unit: 'usd', breakdowns: { model: [part('Opus 5.5', 600, '$600'), part('Sonnet 4', 212, '$212')], repo: [part('lantern', 500, '$500')], kind: [part('Build', 400, '$400')] } }),
    days: f.period.dates.map(date => ({ date, tokens: num(1e8, '100.0M'), spend: num(30, '$30.00') })), agents: [], repos: [], ...overrides };
};

test('Tokens renders for every range unit, and a sum across computers sits beside its parts as not deduplicated', () => {
  for (const unit of RANGE_UNITS) {
    const vm = tokensVM(unit);
    const kinds = tokenKinds(view, vm.frame.scope, vm.frame.period.dates);
    const markup = clean(html(createElement(TokensBody, { vm, kinds, now: NOW })), `Tokens ${unit}`);
    assert.ok(markup.includes('All tokens') && markup.includes('Spend per million tokens'), unit);
    assert.ok(markup.includes('Studio 2.00B, Tower 400.0M. Summed across computers, not deduplicated'), unit);
  }
  const week = tokensVM('week');
  assert.equal(tokenKinds(view, week.frame.scope, ['2026-11-09']).cacheRead, null, 'Tower could not read one day, so its kinds are Unknown');
});

test('Tokens shows Unknown for a stale computer alone today, and an empty state when nothing ran', () => {
  const stale = clean(html(createElement(TokensBody, { vm: tokensVM('day', ['Windows']), kinds: { cacheRead: null, cacheWrite: null, output: null, input: null }, now: NOW })), 'Tokens stale');
  assert.ok(stale.includes('<b>Unknown</b>') && stale.includes('Tower has not been read since'));
  const empty = clean(html(createElement(TokensBody, { vm: tokensVM('week', ['Mac'], { total: num(0, '0', { unit: 'tokens' }) }), kinds: { cacheRead: 0, cacheWrite: 0, output: 0, input: 0 }, now: NOW })), 'Tokens empty');
  assert.ok(empty.includes('No tokens') && empty.includes('Nothing ran in Nov 16 to 22'));
});

const screenVM = (unit, selected, total = 65280) => {
  const f = frame(unit, selected);
  return { frame: f, total: num(total, '18h 8m', { unit: 'seconds', breakdowns: { category: [part('AI apps', 37862, ''), part('Browser', 27418, '')] } }),
    days: f.period.dates.map(date => ({ date, seconds: num(3600, '1h'), tracked: true })), hours: unit === 'day' ? Array.from({ length: 24 }, (_, hour) => hour * 60) : null, apps: [] };
};

test('Screen time follows the settings echo: off everywhere, off on one computer, and no invented screen on and off split', () => {
  const off = view.config.map(row => ({ ...row, sources: { ...row.sources, screenTime: false } }));
  assert.ok(html(createElement(ScreenTimeBody, { vm: screenVM('week'), spend: null, config: off, now: NOW })).includes('Screen time is off'));
  assert.ok(html(createElement(ScreenTimeBody, { vm: screenVM('week', ['Linux']), spend: null, config: view.config, now: NOW })).includes('Off on Lab'));
  for (const unit of RANGE_UNITS) {
    const markup = clean(html(createElement(ScreenTimeBody, { vm: screenVM(unit), spend: num(812, '$812'), config: view.config, now: NOW })), `Screen time ${unit}`);
    assert.ok(markup.includes('18h 8m') && markup.includes('58%'), unit);
    assert.ok(markup.includes('Lab has screen time off'), unit);
    for (const invented of ['Agents and the screen', 'Screen off', 'Screen on']) assert.ok(!markup.includes(invented), invented);
  }
  const stale = html(createElement(ScreenTimeBody, { vm: screenVM('day', ['Windows']), spend: null, config: view.config, now: NOW }));
  assert.ok(stale.includes('<b>Unknown</b>') && stale.includes('Tower was last read at'));
});

test('Drift compares every computer against the hub and calls a platform difference by design', () => {
  const rows = setupRows(view.config, [], ['Mac', 'Windows', 'Linux']);
  const row = name => rows.find(item => item.setting === name);
  assert.equal(row('Screen time').state, 'design', 'Linux collects no screen time');
  assert.equal(row('Codex sessions').state, 'differs');
  assert.equal(row('Session titles').values.Linux, 'hashed away');
  assert.equal(row('Most used model').values.Mac, 'Unknown', 'no settings read is Unknown');
  const markup = clean(html(createElement(DriftBody, { vm: { frame: frame(), models: [], setup: [] }, rows, reference: 'Mac', now: NOW })), 'Drift');
  assert.ok(markup.includes('Studio is the reference') && markup.includes('Differs by design') && markup.includes('Differs'));
  assert.ok(markup.includes('Tower values are from the'), 'a stale computer is named in the footer');
});

test('day, month, year and all time bucket into hours, days, months and weeks with future buckets empty', () => {
  const values = new Map(periods.all.dates.map(date => [date, 1]));
  assert.equal(dayColumns(periods.week, values, '2026-11-18').length, 7);
  assert.equal(dayColumns(periods.week, values, '2026-11-18').filter(column => column.future).length, 4);
  assert.equal(dayColumns(periods.month, values, '2026-11-18').length, 30);
  assert.equal(dayColumns(periods.year, values, '2026-11-18').length, 12);
  assert.ok(dayColumns(periods.all, values, '2026-11-18').every((column, index, list) => index === 0 || column.key > list[index - 1].key));
  values.set('2026-11-17', null);
  assert.equal(dayColumns(periods.week, values, '2026-11-18')[1].value, null, 'an Unknown day makes its bucket Unknown');
});
