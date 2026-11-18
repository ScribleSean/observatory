// A stand-in for the lane b view-models (lib/scope.mjs, lib/view-r2.mjs, lib/roles.mjs) while their
// bodies are stubs. It builds the documented shapes from view.ledgerHistory so the shell, Overview
// and Sessions can be drawn and tested. app/viewer/r2/data.ts calls the real function first and falls
// back to the one here only while the real one says it is not implemented. Delete this file once
// lane b lands.
import { ROLES, TITLE_ALIASES, KIND_ROLES } from '../../../lib/roles.mjs';
import { METRIC_DIMS } from '../../../lib/r2-blocks.mjs';
import { RANGE_UNITS, SOURCE_IDS, SOURCE_SETTINGS } from '../../../lib/scope.mjs';

const DAY = 86400000;
const HOSTS = ['Mac', 'Windows', 'Linux'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SOURCE_NAMES = { claude: 'Claude Code', codex: 'Codex', grok: 'Grok' };
const UNKNOWN = 'Unknown';
const ms = date => Date.parse(`${date}T00:00:00Z`);
const iso = time => new Date(time).toISOString().slice(0, 10);
const add = (date, days) => iso(ms(date) + days * DAY);
const todayIn = (timeZone, now) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
const short = date => `${MONTHS[Number(date.slice(5, 7)) - 1].slice(0, 3)} ${Number(date.slice(8))}`;
const whole = value => Math.round(value).toLocaleString('en-US');

/** @param {number | null} value @param {string} unit @param {number | null} [of] */
export function show(value, unit, of = null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return UNKNOWN;
  if (unit === 'usd' || unit === 'usdPerChange') return value >= 100 ? `$${whole(value)}` : `$${value.toFixed(2)}`;
  if (unit === 'percent') return `${value > 0 && value < 10 ? value.toFixed(1) : Math.round(value)}%`;
  if (unit === 'tokens') return value >= 1e9 ? `${(value / 1e9).toFixed(2)}B` : value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `${Math.round(value / 1e3)}K` : whole(value);
  return of === null ? whole(value) : `${whole(value)} of ${whole(of)}`;
}

// ---------- scope ----------

function bounds({ unit, anchor }) {
  const year = Number(anchor.slice(0, 4)), month = Number(anchor.slice(5, 7)) - 1;
  if (unit === 'week') { const first = add(anchor, -((new Date(ms(anchor)).getUTCDay() + 6) % 7)); return [first, add(first, 6)]; }
  if (unit === 'month') return [iso(Date.UTC(year, month, 1)), iso(Date.UTC(year, month + 1, 0))];
  if (unit === 'year') return [`${year}-01-01`, `${year}-12-31`];
  return [anchor, anchor];
}

function labelOf(unit, first, end) {
  if (unit === 'all') return 'All time';
  if (unit === 'year') return first.slice(0, 4);
  if (unit === 'month') return `${MONTHS[Number(first.slice(5, 7)) - 1]} ${first.slice(0, 4)}`;
  if (unit === 'week') return `${short(first)} to ${first.slice(5, 7) === end.slice(5, 7) ? Number(end.slice(8)) : short(end)}`;
  return short(first);
}

const span = (first, last) => { const dates = []; for (let date = first; date <= last; date = add(date, 1)) dates.push(date); return dates; };

export function periodOf(range, { timeZone, now = Date.now(), firstDate = null }) {
  const today = todayIn(timeZone, now);
  const [first, end] = range.unit === 'all' ? [firstDate ?? today, today] : bounds(range);
  const last = end < today ? end : today;
  return { unit: range.unit, first, last, dates: span(first, last), current: first <= today && today <= end, partial: end > today, label: labelOf(range.unit, first, end) };
}

function moved({ unit, anchor }, direction) {
  const year = Number(anchor.slice(0, 4)), month = Number(anchor.slice(5, 7)) - 1;
  if (unit === 'week') return add(anchor, 7 * direction);
  if (unit === 'month') return iso(Date.UTC(year, month + direction, 1));
  if (unit === 'year') return `${year + direction}-01-01`;
  return add(anchor, direction);
}

export function stepRange(range, direction, { timeZone, now = Date.now(), firstDate = null }) {
  if (range.unit === 'all') return null;
  const next = { unit: range.unit, anchor: moved(range, direction) };
  const [first, end] = bounds(next);
  if (first > todayIn(timeZone, now) || (firstDate && end < firstDate) || (!firstDate && direction < 0)) return null;
  return next;
}

const EARLIER = { day: ['yesterday', 'the day before'], week: ['last week', 'the week before'], month: ['last month', 'the month before'], year: ['last year', 'the year before'] };

export function comparisonOf(range, context) {
  if (range.unit === 'all' || !context.firstDate) return null;
  const current = periodOf(range, context);
  const [first, end] = bounds({ unit: range.unit, anchor: moved(range, -1) });
  const cut = add(first, Math.max(current.dates.length, 1) - 1);
  const last = cut < end ? cut : end;
  if (last < context.firstDate) return null;
  const word = EARLIER[range.unit][current.current ? 0 : 1];
  return { period: { unit: range.unit, first, last, dates: span(first, last), current: false, partial: false, label: labelOf(range.unit, first, end) }, toDate: last < end, label: `vs ${word}` };
}

export function patchScope(scope, patch) {
  if (!patch) return scope;
  return { devices: patch.devices ?? scope.devices, range: { ...scope.range, ...patch.range }, sources: patch.sources ?? scope.sources };
}

const viewOf = snapshot => snapshot?.view ?? {};
const historyOf = snapshot => Array.isArray(viewOf(snapshot).ledgerHistory) ? viewOf(snapshot).ledgerHistory : [];
const zoneOf = snapshot => viewOf(snapshot).timezone ?? 'UTC';
const setUp = snapshot => HOSTS.filter(host => (snapshot?.devices ?? []).some(device => device.host === host));
const deviceName = (snapshot, host) => viewOf(snapshot).deviceNames?.[host] ?? (snapshot?.devices ?? []).find(device => device.host === host)?.name ?? host;
const sourceOn = (snapshot, id, hosts = HOSTS) => (viewOf(snapshot).config ?? []).some(row => hosts.includes(row.host) && SOURCE_SETTINGS[id].some(key => row.sources?.[key] === true));

function contextOf(snapshot, scope, now) {
  const firsts = historyOf(snapshot).filter(row => scope.devices.includes(row.host) && row.firstDate).map(row => row.firstDate).sort();
  return { timeZone: zoneOf(snapshot), now, firstDate: firsts[0] ?? null };
}

export function defaultScope(snapshot, { now = Date.now() } = {}) {
  return { devices: setUp(snapshot), range: { unit: 'week', anchor: todayIn(zoneOf(snapshot), now) }, sources: SOURCE_IDS.filter(id => sourceOn(snapshot, id)) };
}

export function deviceChips(snapshot, scope) {
  return HOSTS.map(host => {
    const device = (snapshot?.devices ?? []).find(row => row.host === host);
    if (!device) return { host, name: host, state: 'not-set-up', since: null, selected: false };
    return { host, name: deviceName(snapshot, host), state: device.stale || !device.collectedAt ? 'stale' : 'live', since: device.collectedAt ?? null, selected: scope.devices.includes(host) };
  });
}

function grokDays(snapshot, period) {
  return (viewOf(snapshot).grokLimits?.requests?.days ?? []).filter(day => day.date >= period.first && day.date <= period.last);
}

function sourceHasData(snapshot, scope, period, id) {
  if (id === 'grok') return sourceOn(snapshot, id, scope.devices) && grokDays(snapshot, period).some(day => day.count > 0);
  return historyOf(snapshot).some(row => scope.devices.includes(row.host) && row.days.some(day => day.tool === id && day.date >= period.first && day.date <= period.last));
}

export function visibleSources(snapshot, scope, { now = Date.now() } = {}) {
  const period = periodOf(scope.range, contextOf(snapshot, scope, now));
  return SOURCE_IDS.filter(id => sourceOn(snapshot, id) && sourceHasData(snapshot, scope, period, id));
}

export function scopeToSearch(scope) {
  return `?devices=${scope.devices.join(',')}&unit=${scope.range.unit}&anchor=${scope.range.anchor}&sources=${scope.sources.join(',')}`;
}

export function scopeFromSearch(search, fallback) {
  const params = new URLSearchParams(search);
  const list = (key, allowed) => { const found = (params.get(key) ?? '').split(',').filter(value => allowed.includes(value)); return found.length ? found : null; };
  const unit = params.get('unit'), anchor = params.get('anchor');
  return {
    devices: list('devices', fallback.devices) ?? fallback.devices,
    range: { unit: RANGE_UNITS.includes(unit) ? unit : fallback.range.unit, anchor: /^\d{4}-\d{2}-\d{2}$/.test(anchor ?? '') && Number.isFinite(ms(anchor)) ? anchor : fallback.range.anchor },
    sources: list('sources', fallback.sources) ?? fallback.sources,
  };
}

// ---------- roles ----------

export function sessionName(session, { aliases = {} } = {}) {
  const title = (session.title ?? '').trim();
  let role = null, roleSource = null, object = null;
  const prefixed = title.match(/^\[([^\]]+)\]\s*(.+)$/) ?? title.match(/^([^:]+):\s*(.+)$/);
  if (prefixed && ROLES.includes(prefixed[1].trim())) { role = prefixed[1].trim(); roleSource = 'title'; object = prefixed[2].trim(); }
  else if (title) {
    const low = title.toLowerCase();
    const table = { ...TITLE_ALIASES, ...Object.fromEntries(Object.entries(aliases).map(([key, value]) => [key.toLowerCase(), value])) };
    const hit = Object.keys(table).sort((a, b) => b.length - a.length).find(key => low === key || low.startsWith(`${key} `));
    if (hit && ROLES.includes(table[hit])) { role = table[hit]; roleSource = 'alias'; object = title.slice(hit.length).trim() || null; }
    else object = title;
  }
  if (!role && session.origin === 'headless') { role = session.task === 'review' || session.task === 'test' ? 'Reviewer' : 'Runner'; roleSource = 'origin'; }
  if (!role) {
    const kind = session.task ?? [...(session.kinds ?? [])].filter(row => row.kind !== 'main' && row.kind !== 'other').sort((a, b) => (b.apiUsd ?? -1) - (a.apiUsd ?? -1))[0]?.kind;
    role = KIND_ROLES[kind] ?? null; roleSource = role ? 'kind' : null;
  }
  object = object || session.repo || 'Session';
  return { role, roleSource, object, display: role ? `[${role}] ${object}` : object, subtitle: null };
}

export function sessionNameOverDays(days, options) {
  return sessionName([...days].reverse().find(day => day.title) ?? days.at(-1) ?? { title: null, origin: null, task: null, repo: null, kinds: [] }, options);
}

// ---------- the numbers ----------

const cache = new WeakMap();
function memo(snapshot, key, build) {
  if (!snapshot || typeof snapshot !== 'object') return build();
  if (!cache.has(snapshot)) cache.set(snapshot, new Map());
  const store = cache.get(snapshot);
  if (!store.has(key)) store.set(key, build());
  return store.get(key);
}

const blank = () => ({ usd: 0, commits: 0, onMain: 0, merges: 0, sessions: 0, subagents: 0, tokens: 0, none: 0, noneCount: 0, unknown: false });
const bump = (map, key, by) => map.set(key, (map.get(key) ?? 0) + by); // zero-ok: a running sum starts at zero, it is not a reading

/** Day totals and joined sessions for one period, over the selected computers and sources. */
function stats(snapshot, scope, period) {
  const total = blank(), byHost = new Map(), sessions = new Map(), unknownDays = [];
  for (const row of historyOf(snapshot)) {
    if (!scope.devices.includes(row.host)) continue;
    const host = blank();
    const aliases = (viewOf(snapshot).config ?? []).find(config => config.host === row.host)?.roleAliases ?? {};
    for (const day of row.days) {
      if (day.date < period.first || day.date > period.last || !scope.sources.includes(day.tool)) continue;
      if (day.status !== 'ok') { total.unknown = host.unknown = true; unknownDays.push({ host: row.host, date: day.date }); continue; }
      for (const sum of [total, host]) {
        sum.usd += day.apiUsd; sum.sessions += day.sessionCount; sum.subagents += day.subagents;
        sum.commits += day.ship.commits; sum.onMain += day.ship.onMain; sum.merges += day.ship.merges;
        sum.tokens += day.tokens.input + day.tokens.output + day.tokens.cacheRead + day.tokens.cacheWrite;
      }
      for (const part of day.sessions) {
        const key = `${row.host}.${day.tool}.${part.id}`;
        const found = sessions.get(key) ?? { key, host: row.host, tool: day.tool, days: [], usd: 0, subagents: 0, commits: 0, onMain: 0, merges: 0,
          models: new Map(), kinds: new Map(), kindAgents: new Map(), ship: new Map(), firstAt: part.firstAt, lastAt: part.lastAt, aliases };
        found.days.push(part); found.usd += part.apiUsd;
        if (part.firstAt < found.firstAt) found.firstAt = part.firstAt;
        if (part.lastAt > found.lastAt) found.lastAt = part.lastAt;
        for (const model of part.models) bump(found.models, model.model, model.apiUsd);
        for (const kind of part.kinds) { bump(found.kinds, kind.kind, kind.apiUsd); bump(found.kindAgents, kind.kind, kind.subagents); found.subagents += kind.subagents; }
        for (const ship of part.ship) {
          const repo = found.ship.get(ship.repo) ?? { commits: 0, onMain: 0, merges: 0 };
          repo.commits += ship.commits; repo.onMain += ship.onMain; repo.merges += ship.merges; found.ship.set(ship.repo, repo);
          found.commits += ship.commits; found.onMain += ship.onMain; found.merges += ship.merges;
        }
        sessions.set(key, found);
      }
    }
    byHost.set(row.host, host);
  }
  const list = [...sessions.values()].map(session => ({ ...session, name: sessionNameOverDays(session.days, { aliases: session.aliases }), repo: session.days.at(-1).repo, origin: session.days.at(-1).origin, task: session.days.at(-1).task }));
  for (const session of list) if (session.commits === 0) { total.none += session.usd; total.noneCount += 1; }
  return { total, byHost, sessions: list.sort((a, b) => b.usd - a.usd), unknownDays };
}

const MODEL_LABELS = [['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku'], ['fable', 'Fable'], ['gpt', 'GPT']];
const modelLabel = id => MODEL_LABELS.find(([word]) => id.toLowerCase().includes(word))?.[1] ?? id;
const KIND_LABELS = { main: 'Coordinating', build: 'Build', review: 'Review', research: 'Research', design: 'Design', test: 'Test', search: 'Search', write: 'Writing', other: 'Other' };

const METRIC = {
  spend: { unit: 'usd', value: sum => sum.usd },
  merged: { unit: 'count', value: sum => sum.merges },
  onMain: { unit: 'count', value: sum => sum.onMain, of: sum => sum.commits },
  churn: { unit: 'count', value: sum => sum.commits - sum.onMain },
  perLanded: { unit: 'usdPerChange', value: sum => sum.onMain > 0 ? sum.usd / sum.onMain : null, ratio: true },
  noCommitSpend: { unit: 'usd', value: sum => sum.none, of: sum => sum.usd },
  tokens: { unit: 'tokens', value: sum => sum.tokens },
  sessions: { unit: 'count', value: sum => sum.sessions },
  subagents: { unit: 'count', value: sum => sum.subagents },
};

/** One part per key of a dim, from the joined sessions. */
function split(snapshot, facts, id, dim) {
  const rule = METRIC[id], groups = new Map();
  const at = (key, label) => { if (!groups.has(key)) groups.set(key, { key, label, ...blank() }); return groups.get(key); };
  const addTo = (group, session, weight = 1) => {
    group.usd += session.usd * weight; group.commits += session.commits * weight; group.onMain += session.onMain * weight; group.merges += session.merges * weight;
    group.sessions += weight; group.subagents += session.subagents * weight; if (session.commits === 0) group.none += session.usd * weight;
  };
  for (const session of facts.sessions) {
    if (dim === 'device') addTo(at(session.host, deviceName(snapshot, session.host)), session);
    else if (dim === 'role') addTo(at(session.name.role ?? 'Other', session.name.role ?? 'Other'), session);
    else if (dim === 'session') addTo(at(session.key, session.name.display), session);
    else if (dim === 'origin') addTo(at(session.origin ?? 'unknown', session.origin === 'headless' ? 'Headless' : session.origin === 'interactive' ? 'Interactive' : UNKNOWN), session);
    else if (dim === 'tool') addTo(at(session.tool, SOURCE_NAMES[session.tool]), session);
    else if (dim === 'model') for (const [model, usd] of session.models) addTo(at(modelLabel(model), modelLabel(model)), session, session.usd ? usd / session.usd : 0);
    else if (dim === 'kind') for (const [kind, usd] of session.kinds) { const group = at(kind, KIND_LABELS[kind] ?? kind); group.usd += usd; if (session.commits === 0) group.none += usd; group.subagents += session.kindAgents.get(kind); }
    else if (dim === 'repo') {
      at(session.repo ?? UNKNOWN, session.repo ?? UNKNOWN).usd += session.usd;
      for (const [repo, ship] of session.ship) { const group = at(repo, repo); group.commits += ship.commits; group.onMain += ship.onMain; group.merges += ship.merges; }
    }
  }
  const all = rule.value(facts.total);
  const parts = [...groups.values()].map(group => {
    const unknown = dim === 'device' && facts.byHost.get(group.key)?.unknown;
    const value = unknown ? null : rule.value(group);
    return { key: group.key, label: group.label, value, text: value === null && !unknown && rule.ratio ? 'None landed' : show(value, rule.unit, rule.of && id === 'onMain' ? rule.of(group) : null),
      share: value === null || facts.total.unknown || rule.ratio || !all ? null : 100 * value / all };
  }).filter(part => part.value === null || part.value > 0 || dim === 'device').sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  if (parts.length <= 8 || rule.ratio) return parts.slice(0, 8);
  const rest = parts.slice(7), value = rest.reduce((sum, part) => sum + part.value, 0);
  return [...parts.slice(0, 7), { key: 'other', label: `${rest.length} more`, value, text: show(value, rule.unit), share: all && !facts.total.unknown ? 100 * value / all : null }];
}

const rate = sum => sum.commits > 0 ? Math.round(100 * sum.onMain / sum.commits) : null;
const plural = (count, word) => `${whole(count)} ${word}${Math.round(count) === 1 ? '' : 's'}`;

function deltaText(id, now, before, word) {
  if (before === null) return 'no earlier data';
  const rule = METRIC[id], current = now.unknown ? null : rule.value(now), previous = before.unknown ? null : rule.value(before);
  if (id === 'onMain') return rate(now) === null ? null : `${rate(now)}% landed${rate(before) === null ? '' : `, was ${rate(before)}%`}`;
  if (id === 'churn') return rate(now) === null ? null : `${100 - rate(now)}% not yet on main${rate(before) === null ? '' : `, was ${100 - rate(before)}%`}`;
  if (id === 'noCommitSpend') return null;
  if (current === null || previous === null) return previous === null ? `${word} is ${UNKNOWN}` : null;
  if (id === 'perLanded') return `was ${show(previous, rule.unit)} ${word}`;
  if (rule.unit === 'count') { const diff = Math.round(current - previous); return diff === 0 ? `same as ${word}` : `${whole(Math.abs(diff))} ${diff > 0 ? 'more' : 'fewer'} than ${word}`; }
  if (!previous) return `nothing ${word}`;
  const change = (current - previous) / previous;
  return Math.abs(change) < 0.005 ? `same as ${word}` : `${change > 0 ? 'up' : 'down'} ${Math.round(Math.abs(change) * 100)}% vs ${word}`;
}

function facts(snapshot, scope, now) {
  return memo(snapshot, `facts ${JSON.stringify(scope)} ${todayIn(zoneOf(snapshot), now)}`, () => {
    const context = contextOf(snapshot, scope, now);
    const period = periodOf(scope.range, context), comparison = comparisonOf(scope.range, context);
    return { context, period, comparison, now: stats(snapshot, scope, period), before: comparison ? stats(snapshot, scope, comparison.period) : null };
  });
}

function numOf(snapshot, scope, id, sums, before, comparison, withParts = true) {
  const rule = METRIC[id];
  if (!rule) return { metric: id, unit: 'count', value: null, text: UNKNOWN, of: null, sumLabel: null, previous: null, delta: null, deltaText: null, breakdowns: {}, note: null };
  const value = sums.total.unknown ? null : rule.value(sums.total), of = rule.of && !sums.total.unknown ? rule.of(sums.total) : null;
  const previous = before && !before.total.unknown ? rule.value(before.total) : null;
  const hosts = [...sums.byHost.values()].filter(host => host.sessions > 0 || host.unknown).length;
  const landed = !sums.total.unknown && rule.ratio && value === null;
  return {
    metric: id, unit: rule.unit, value, of, previous,
    text: landed ? 'None landed' : show(value, rule.unit, id === 'onMain' ? of : null),
    sumLabel: hosts > 1 && !rule.ratio ? 'not deduplicated' : null,
    delta: value === null || previous === null ? null : value - previous,
    deltaText: scope.range.unit === 'all' ? null : deltaText(id, sums.total, comparison ? before.total : null, comparison ? comparison.label.replace(/^vs /, '') : ''),
    breakdowns: withParts ? Object.fromEntries(METRIC_DIMS[id].map(dim => [dim, split(snapshot, sums, id, dim)])) : {},
    note: id === 'noCommitSpend' && value !== null ? `${show(value, 'usd')} in ${plural(sums.total.noneCount, 'session')}`
      : id === 'spend' ? 'API equivalent prices' : id === 'perLanded' || id === 'merged' ? null : rule.unit === 'count' && id !== 'sessions' && id !== 'subagents' ? 'Commits are estimated' : null,
  };
}

export function metric(snapshot, id, scope, { now = Date.now() } = {}) {
  return memo(snapshot, `metric ${id} ${JSON.stringify(scope)} ${todayIn(zoneOf(snapshot), now)}`, () => {
    const found = facts(snapshot, scope, now);
    return numOf(snapshot, scope, id, found.now, found.before, found.comparison);
  });
}

export function buildFrame(snapshot, scope, { now = Date.now() } = {}) {
  const found = facts(snapshot, scope, now);
  return {
    scope, period: found.period, comparison: found.comparison, devices: deviceChips(snapshot, scope),
    sources: SOURCE_IDS.map(id => ({ id, name: SOURCE_NAMES[id], on: sourceOn(snapshot, id), hasData: sourceHasData(snapshot, scope, found.period, id) })),
    steps: { back: stepRange(scope.range, -1, found.context), forward: stepRange(scope.range, 1, found.context) },
    timeZone: zoneOf(snapshot), generatedAt: snapshot?.generatedAt ?? '', stale: (snapshot?.devices ?? []).some(device => device.stale),
  };
}

function coverageOf(snapshot, scope, found) {
  const byHost = new Map();
  for (const { host, date } of found.now.unknownDays) byHost.set(host, [...(byHost.get(host) ?? []), date]);
  return {
    from: found.context.firstDate,
    unknownDays: [...byHost].map(([host, dates]) => ({ host, name: deviceName(snapshot, host), dates: [...new Set(dates)] })),
    startsLater: historyOf(snapshot).filter(row => scope.devices.includes(row.host) && row.firstDate && row.firstDate > found.period.first && row.firstDate <= found.period.last)
      .map(row => ({ host: row.host, name: deviceName(snapshot, row.host), before: row.firstDate })),
    sessionsTrimmed: false,
  };
}

// ---------- sessions ----------

function rowOf(snapshot, session, periodUsd) {
  const sums = { total: { ...blank(), usd: session.usd, commits: session.commits, onMain: session.onMain, merges: session.merges }, byHost: new Map() };
  const base = (id, extra = {}) => ({ ...numOf(snapshot, { range: { unit: 'all' } }, id, sums, null, null, false), sumLabel: null, note: null, ...extra });
  const part = (key, label, value, text) => ({ key, label, value, text, share: session.usd ? 100 * value / session.usd : null });
  return {
    kind: 'session', count: 1, children: [], key: session.key, host: session.host, device: deviceName(snapshot, session.host), tool: session.tool, name: session.name,
    models: [...session.models].sort((a, b) => b[1] - a[1]).map(([model]) => modelLabel(model)), subagents: session.subagents,
    spend: base('spend', { breakdowns: {
      model: [...session.models].sort((a, b) => b[1] - a[1]).map(([model, usd]) => part(model, modelLabel(model), usd, show(usd, 'usd'))),
      kind: [...session.kinds].sort((a, b) => b[1] - a[1]).map(([kind, usd]) => part(kind, KIND_LABELS[kind] ?? kind, usd, show(usd, 'usd'))) } }),
    share: periodUsd ? 100 * session.usd / periodUsd : null,
    onMain: base('onMain', { breakdowns: { repo: [...session.ship].map(([repo, ship]) => ({ key: repo, label: repo, value: ship.onMain, text: `${show(ship.onMain, 'count', ship.commits)} on main`, share: null })) } }),
    merged: base('merged'), perLanded: base('perLanded'),
    startedAt: session.firstAt, lastActiveAt: session.lastAt, running: false, state: null, needsYou: false,
    repos: [...new Set([session.repo, ...session.ship.keys()].filter(Boolean))],
  };
}

function bundleOf(snapshot, key, name, rows, periodUsd) {
  const usd = rows.reduce((sum, row) => sum + row.spend.value, 0);
  const session = { key, host: rows[0].host, tool: rows[0].tool, name, usd, subagents: rows.reduce((sum, row) => sum + row.subagents, 0),
    commits: rows.reduce((sum, row) => sum + row.onMain.of, 0), onMain: rows.reduce((sum, row) => sum + row.onMain.value, 0), merges: rows.reduce((sum, row) => sum + row.merged.value, 0),
    models: new Map(), kinds: new Map(), ship: new Map(), firstAt: rows.map(row => row.startedAt).sort()[0], lastAt: rows.map(row => row.lastActiveAt).sort().at(-1), repo: null };
  for (const row of rows) {
    for (const part of row.spend.breakdowns.model) bump(session.models, part.key, part.value);
    for (const part of row.spend.breakdowns.kind) bump(session.kinds, part.key, part.value);
  }
  const hosts = new Set(rows.map(row => row.host));
  return { ...rowOf(snapshot, session, periodUsd), kind: 'bundle', count: rows.length, children: rows, device: hosts.size === 1 ? rows[0].device : `${hosts.size} computers`,
    repos: [...new Set(rows.flatMap(row => row.repos))] };
}

const SORTS = { spend: row => row.spend.value, onMain: row => row.onMain.value, perLanded: row => row.perLanded.value, startedAt: row => Date.parse(row.startedAt), subagents: row => row.subagents };

export function buildSessions(snapshot, scope, { now = Date.now(), groupBy = null, role = null, running = false, sort = 'spend', limit = 25 } = {}) {
  const found = facts(snapshot, scope, now), frame = buildFrame(snapshot, scope, { now });
  const periodUsd = found.now.sessions.reduce((sum, session) => sum + session.usd, 0);
  const single = found.now.sessions.map(session => ({ session, row: rowOf(snapshot, session, periodUsd) }));
  // Headless runs of one role and repository fold together, then sessions under 1% of spend fold per role.
  const folded = [], headless = new Map(), small = new Map();
  for (const { session, row } of single) {
    if (session.origin === 'headless') { const key = `${session.name.role}.${session.repo}`; headless.set(key, [...(headless.get(key) ?? []), row]); }
    else if (row.share !== null && row.share < 1) small.set(session.name.role ?? 'Other', [...(small.get(session.name.role ?? 'Other') ?? []), row]);
    else folded.push(row);
  }
  for (const [key, rows] of headless) {
    const { role: found, object } = rows[0].name;
    const word = found === 'Reviewer' ? 'review ' : '';
    folded.push(rows.length === 1 ? rows[0] : bundleOf(snapshot, `bundle.headless.${key}`, { role: found, roleSource: 'origin', object: `Headless ${word}runs, ${object}`, display: `[${found}] Headless ${word}runs, ${object}`, subtitle: null }, rows, periodUsd));
  }
  for (const [key, rows] of small) {
    const repos = new Set(rows.flatMap(row => row.repos)).size, named = key === 'Other' ? null : key;
    const object = `Smaller sessions, ${plural(repos, 'repo')}`;
    folded.push(rows.length === 1 ? rows[0] : bundleOf(snapshot, `bundle.small.${key}`, { role: named, roleSource: null, object, display: named ? `[${named}] ${object}` : object, subtitle: null }, rows, periodUsd));
  }
  const by = SORTS[sort] ?? SORTS.spend;
  const order = (a, b) => (by(b) ?? -1) - (by(a) ?? -1);
  const all = folded.filter(row => (!role || row.name.role === role) && (!running || row.running)).sort(order);
  const rows = all.slice(0, limit), rest = all.slice(limit);
  const total = list => ({ total: list.reduce((sum, row) => { sum.usd += row.spend.value; sum.commits += row.onMain.of; sum.onMain += row.onMain.value; sum.merges += row.merged.value; return sum; }, blank()), byHost: new Map() });
  const sumNum = (id, list) => ({ ...numOf(snapshot, { range: { unit: 'all' } }, id, total(list), null, null, false), sumLabel: null, note: null });
  const keyOf = { role: row => row.name.role ?? 'Other', device: row => row.device, repo: row => row.repos[0] ?? UNKNOWN }[groupBy];
  const groups = keyOf ? [...rows.reduce((map, row) => map.set(keyOf(row), [...(map.get(keyOf(row)) ?? []), row]), new Map())].map(([key, list]) => ({
    key, label: key, count: list.reduce((sum, row) => sum + row.count, 0), rows: list, spend: sumNum('spend', list), onMain: sumNum('onMain', list), merged: sumNum('merged', list),
    perLanded: sumNum('perLanded', list), subagents: list.reduce((sum, row) => sum + row.subagents, 0),
  })).sort((a, b) => b.spend.value - a.spend.value) : null;
  return { frame, rows, groups, coverage: coverageOf(snapshot, scope, found),
    totals: { count: found.now.total.unknown ? null : found.now.total.sessions, listed: rows.length,
      other: rest.length ? { count: rest.reduce((sum, row) => sum + row.count, 0), rows: rest.length, spend: sumNum('spend', rest), onMain: sumNum('onMain', rest), subagents: rest.reduce((sum, row) => sum + row.subagents, 0) } : null } };
}

// ---------- overview ----------

function chartOf(snapshot, scope, found) {
  const monthly = scope.range.unit === 'year' || scope.range.unit === 'all';
  const buckets = new Map();
  for (const date of found.period.dates) { const key = monthly ? `${date.slice(0, 7)}-01` : date; buckets.set(key, [...(buckets.get(key) ?? []), date]); }
  return [...buckets].map(([date, dates]) => {
    const sums = stats(snapshot, scope, { first: dates[0], last: dates.at(-1) });
    const point = id => ({ ...numOf(snapshot, { range: { unit: 'all' } }, id, sums, null, null, false), note: null });
    const device = [...sums.byHost].filter(([, host]) => host.usd > 0 || host.unknown).map(([host, sum]) => ({ key: host, label: deviceName(snapshot, host), value: sum.unknown ? null : sum.usd, text: show(sum.unknown ? null : sum.usd, 'usd'), share: null }));
    return { date, spend: { ...point('spend'), breakdowns: { device } }, onMain: point('onMain'), churn: point('churn'), merged: point('merged') };
  });
}

function flagsOf(snapshot, scope, found, frame) {
  const lines = [];
  const stale = frame.devices.filter(chip => chip.selected && chip.state === 'stale');
  const clock = time => new Intl.DateTimeFormat('en-US', { timeZone: frame.timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(time));
  if (stale.length && found.period.current) lines.push({ text: `${stale.map(chip => chip.name).join(', ')} last read ${stale[0].since ? clock(stale[0].since) : UNKNOWN}`, sessionKey: null });
  const now = rate(found.now.total), before = found.before && !found.before.total.unknown ? rate(found.before.total) : null;
  if (!found.now.total.unknown && now !== null && before !== null && now <= before - 8) lines.push({ text: `Landed rate ${now}%, was ${before}% ${found.comparison.label.replace(/^vs /, '')}`, sessionKey: null });
  for (const session of found.now.sessions.filter(row => row.commits > 5 && row.onMain === 0).slice(0, 2))
    lines.push({ text: `${session.name.display} has 0 of ${session.commits} commits on main, ${show(session.usd, 'usd')}`, sessionKey: session.key });
  for (const session of found.now.sessions.filter(row => row.commits === 0 && row.usd > 3).slice(0, 1))
    lines.push({ text: `${session.name.display} spent ${show(session.usd, 'usd')} with no commits`, sessionKey: session.key });
  return lines;
}

export function buildOverview(snapshot, scope, { now = Date.now() } = {}) {
  return memo(snapshot, `overview ${JSON.stringify(scope)} ${todayIn(zoneOf(snapshot), now)}`, () => {
    const found = facts(snapshot, scope, now), frame = buildFrame(snapshot, scope, { now });
    const headline = Object.fromEntries(['spend', 'merged', 'onMain', 'churn', 'perLanded', 'noCommitSpend'].map(id => [id, metric(snapshot, id, scope, { now })]));
    return { frame, headline, chart: chartOf(snapshot, scope, found), agents: [], grok: null, topSessions: buildSessions(snapshot, scope, { now, limit: 6 }).rows,
      running: [], limits: [], flags: flagsOf(snapshot, scope, found, frame), coverage: coverageOf(snapshot, scope, found) };
  });
}

// ---------- ask ----------

const RULES = [[/limit|last\b|run out|pace/, 'week-last'], [/need|waiting|stuck|flag/, 'needs-me'], [/ship|land|merg|churn|commit|builder/, 'builders-month'], [/spend|cost|where|money|today|\$/, 'spend-today']];

export function answerQuestion(question, { savedViews = [] } = {}) {
  const text = question.toLowerCase().trim();
  const words = text.split(/[^a-z0-9]+/).filter(word => word.length > 3);
  const titled = savedViews.find(view => view.origin === 'composed' && words.some(word => `${view.title} ${view.question ?? ''}`.toLowerCase().includes(word)));
  const ruled = RULES.find(([pattern]) => pattern.test(text))?.[1];
  const view = savedViews.find(row => row.id === ruled) ?? titled ?? null;
  return { matched: view?.id ?? null, view, suggestions: view ? [] : savedViews.filter(row => row.question).map(row => row.question).slice(0, 4) };
}
