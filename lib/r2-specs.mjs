// The built-in screens: one json-render spec per view that is made of blocks, one per pinned question,
// and the local rules matcher behind the Ask field. See docs/R2-PLAN.md.
//
// A spec holds queries only (which metric, which breakdown, which scope patch), never numbers or
// session titles. lib/r2-catalog.mjs checks every spec here in a test. Drift and Settings are drawn
// from their builders in lib/view-r2.mjs and have no spec.
//
// Every block takes an optional `span` (columns of 12 it covers, overriding its Section's `columns`)
// and `rows` (rows it covers), so one Section can hold an 8 and a 4 side by side.

import strings from './strings.json' with { type: 'json' };
import { METRIC_DIMS } from './r2-blocks.mjs';
import { ROLES } from './roles.mjs';
import { dateIn, addDays } from './scope.mjs';

const R = strings.r2;
// Built-in specs never change on their own, so they carry a fixed save time.
export const BUILT_IN_SAVED_AT = '2026-11-18T00:00:00.000Z';

/**
 * @typedef {{type: string, props: object, children?: Item[]}} Item
 * @typedef {import('./r2-blocks.mjs').SavedView} SavedView
 * @typedef {import('./scope.mjs').ScopePatch} ScopePatch
 */

/**
 * A flat json-render spec ({root, elements}) from a nested list. Keys are the item's path ("root",
 * "root-0", "root-0-1"), so the same layout always gives the same keys.
 * @param {string | null} title
 * @param {Item[]} items
 */
export function layout(title, items) {
  const elements = {};
  const add = (key, item) => {
    const children = (item.children ?? []).map((child, index) => add(`${key}-${index}`, child));
    elements[key] = { type: item.type, props: item.props, children };
    return key;
  };
  add('root', { type: 'Section', props: { title, columns: 12 }, children: items });
  return { root: 'root', elements };
}

const section = (title, columns, children, extra = {}) => ({ type: 'Section', props: { title, columns, ...extra }, children });
const block = (type, props) => ({ type, props });
const strip = metrics => section(null, 2, metrics.map(metric => block('Headline', { metric })));
const HEADLINE = ['spend', 'merged', 'onMain', 'churn', 'perLanded', 'noCommitSpend'];

const view = (id, title, question, spec, origin = 'built-in') => ({ id, title, question, spec, savedAt: BUILT_IN_SAVED_AT, origin });

/** One spec per view that is made of blocks. */
export const VIEW_SPECS = Object.freeze({
  overview: view('overview', R.viewOverview, null, layout(null, [
    strip(HEADLINE),
    block('SpendLandedChart', { span: 8 }),
    // The Claude meter carries Grok requests when they are on, under its own "Limits now" heading.
    block('LimitMeter', { engine: 'claude', span: 4 }),
    block('SessionsTable', { limit: 14, span: 8, rows: 3 }),
    block('Breakdown', { metric: 'spend', dim: 'role', limit: 6, span: 4 }),
    block('SessionsTable', { running: true, span: 4 }),
    block('Flags', { limit: 5, span: 4 }),
  ])),
  sessions: view('sessions', R.viewSessions, null, layout(null, [
    strip(HEADLINE),
    block('SessionsTable', { groupBy: 'role', limit: 500 }),
  ])),
  limits: view('limits', R.viewLimits, null, layout(null, [
    block('LimitMeter', { engine: 'claude', history: true, span: 8 }),
    block('GrokRequests', { span: 4 }),
    block('LimitMeter', { engine: 'codex', history: true, span: 4 }),
  ])),
  tokens: view('tokens', R.viewTokens, null, layout(null, [
    section(null, 6, [block('Headline', { metric: 'tokens' }), block('Headline', { metric: 'spend' })]),
    block('Timeline', { series: 'tokens', span: 8 }),
    block('Breakdown', { metric: 'spend', dim: 'model', span: 4 }),
    block('Breakdown', { metric: 'tokens', dim: 'tool', span: 4 }),
    block('Breakdown', { metric: 'spend', dim: 'repo', limit: 7, span: 4 }),
    block('Breakdown', { metric: 'spend', dim: 'kind', span: 4 }),
  ])),
  screenTime: view('screen-time', R.viewScreenTime, null, layout(null, [
    block('Headline', { metric: 'screenTime' }),
    block('Timeline', { series: 'screenTime', span: 8, rows: 2 }),
    block('Breakdown', { metric: 'screenTime', dim: 'category', span: 4 }),
    block('Breakdown', { metric: 'screenTime', dim: 'device', span: 4 }),
  ])),
});

/**
 * The pinned questions, in the order the view bar lists them. `pattern` is what the Ask field matches,
 * `patch` what the question sets on the scope bar, `role` the role chip.
 */
export const PINNED_QUESTIONS = Object.freeze([
  { id: 'today-spend', question: R.pinTodaySpend, pattern: /\bwhere\b.*\b(spend|spent|money|dollars|cost)\b|\b(spend|money)\b.*\bgo\b/,
    patch: { range: { unit: 'day' } }, today: true, role: null, metric: 'spend',
    spec: layout(null, [
      block('Breakdown', { metric: 'spend', dim: 'role', span: 4 }),
      block('Breakdown', { metric: 'spend', dim: 'model', span: 4 }),
      block('Breakdown', { metric: 'spend', dim: 'kind', span: 4 }),
      block('SpendLandedChart', {}),
      block('SessionsTable', {}),
    ]) },
  { id: 'builders-month', question: R.pinBuildersMonth, pattern: /\bbuilders?\b.*\b(ship|shipped|land|landed|merge|merged|make|made|do|did)\b/,
    patch: { range: { unit: 'month' } }, today: true, role: 'Builder', metric: 'onMain',
    spec: layout(null, [
      strip(['merged', 'onMain', 'churn', 'perLanded']),
      block('SessionsTable', { role: 'Builder', sort: 'onMain', span: 8, rows: 3 }),
      block('Breakdown', { metric: 'onMain', dim: 'role', span: 4 }),
      block('Breakdown', { metric: 'onMain', dim: 'repo', span: 4 }),
      block('Flags', { span: 4 }),
    ]) },
  { id: 'week-last', question: R.pinWeekLast, pattern: /\b(will|does|is|can)\b.*\b(week|limit|limits)\b.*\b(last|enough|run out|runs out|hold)\b|\brun(s)? out\b/,
    patch: { range: { unit: 'week' } }, today: true, role: null, metric: null,
    spec: layout(null, [
      block('LimitMeter', { engine: 'claude', history: true, span: 6 }),
      block('Timeline', { series: 'spend', span: 6 }),
      block('SessionsTable', { running: true, span: 6 }),
      block('Breakdown', { metric: 'spend', dim: 'role', span: 6 }),
    ]) },
  { id: 'needs-me', question: R.pinNeedsMe, pattern: /\bneeds? (me|you|my attention|attention)\b|\bworth a look\b|\bwhat should i (check|look at)\b/,
    patch: { range: { unit: 'week' } }, today: true, role: null, metric: null,
    spec: layout(null, [
      block('Flags', { limit: 5, span: 6 }),
      block('SessionsTable', { running: true, span: 6 }),
      block('SessionsTable', {}),
    ]) },
].map(pin => Object.freeze({ ...pin, view: view(pin.id, pin.question, pin.question, pin.spec) })));

// Words that fill a rule's slots. Earlier entries win, so "cost per landed change" is not spend.
const METRIC_WORDS = [
  ['perLanded', /\b(per (landed|change|commit)|cost per)\b/],
  ['noCommitSpend', /\b(no commits?|nothing to show|wasted|produced nothing)\b/],
  ['churn', /\b(churn|never (reached|landed)|not on main|not yet on main)\b/],
  ['merged', /\b(merged|merges|branches)\b/],
  ['onMain', /\b(landed|land|on main|commits?|ship|shipped)\b/],
  ['grokRequests', /\bgrok\b/],
  ['screenTime', /\b(screen|screen time|at the screen)\b/],
  ['tokens', /\btokens?\b/],
  ['subagents', /\bsub ?agents?\b/],
  ['sessions', /\bsessions?\b/],
  ['spend', /\b(spend|spent|spending|cost|costs|money|dollars|usd)\b/],
];
const DIM_WORDS = [
  ['model', /\b(models?|opus|sonnet|haiku|fable)\b/], ['role', /\broles?\b/], ['repo', /\b(repos?|repository|repositories|projects?)\b/],
  ['device', /\b(devices?|computers?|machines?)\b/], ['kind', /\b(kinds? of work|work kinds?|kinds?)\b/],
  ['category', /\b(apps?|categor(y|ies))\b/], ['tool', /\b(tools?|sources?)\b/], ['origin', /\b(headless|interactive)\b/], ['session', /\bwhich sessions?\b/],
];
const DEVICE_WORDS = [['Mac', /\bmac\b/], ['Windows', /\b(pc|windows)\b/], ['Linux', /\b(linux|ubuntu)\b/]];
const SOURCE_WORDS = [['claude', /\bclaude\b/], ['codex', /\bcodex\b/], ['grok', /\bgrok\b/]];
const TIMELINES = new Set(['spend', 'tokens', 'screenTime', 'grokRequests', 'subagents']);
const LEDGER = new Set(['spend', 'merged', 'onMain', 'churn', 'perLanded', 'noCommitSpend', 'sessions', 'subagents']);

const normalize = text => String(text ?? '').toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const roleIn = text => ROLES.find(role => new RegExp(`\\b${role.toLowerCase()}s?\\b`).test(text)) ?? (/\bchief\b/.test(text) ? 'Chief of staff' : null);

function rangeIn(text, now, timeZone) {
  const today = now === null ? null : dateIn(timeZone, now);
  const anchor = days => today === null ? {} : { anchor: addDays(today, days) };
  if (/\byesterday\b/.test(text)) return { unit: 'day', ...anchor(-1) };
  if (/\btoday\b|\btodays\b/.test(text)) return { unit: 'day', ...anchor(0) };
  if (/\blast week\b/.test(text)) return { unit: 'week', ...anchor(-7) };
  if (/\blast month\b/.test(text)) return { unit: 'month', ...(today === null ? {} : { anchor: `${addDays(`${today.slice(0, 7)}-01`, -1)}` }) };
  if (/\blast year\b/.test(text)) return { unit: 'year', ...(today === null ? {} : { anchor: `${Number(today.slice(0, 4)) - 1}-06-30` }) };
  if (/\b(all time|ever|overall)\b/.test(text)) return { unit: 'all' };
  if (/\bweek\b/.test(text)) return { unit: 'week', ...anchor(0) };
  if (/\bmonth\b/.test(text)) return { unit: 'month', ...anchor(0) };
  if (/\byear\b/.test(text)) return { unit: 'year', ...anchor(0) };
  return null;
}

// The blocks a rule answer draws, from its slots.
function ruleSpec({ metricId, dim, role }) {
  const items = [];
  if (metricId === 'grokRequests') items.push(block('Headline', { metric: metricId }), block('GrokRequests', { span: 8 }));
  else {
    items.push(block('Headline', { metric: metricId, span: 4 }));
    const dims = METRIC_DIMS[metricId];
    const chosen = dim && dims.includes(dim) ? dim : role && dims.includes('role') ? 'role' : dims.find(d => d !== 'device' && d !== 'session') ?? dims[0];
    if (chosen) items.push(block('Breakdown', { metric: metricId, dim: chosen, span: 8 }));
  }
  if (TIMELINES.has(metricId) && metricId !== 'grokRequests') items.push(block('Timeline', { series: metricId }));
  if (LEDGER.has(metricId) || role) items.push(block('SessionsTable', { ...(role ? { role } : {}), ...(metricId === 'onMain' || metricId === 'merged' ? { sort: 'onMain' } : {}) }));
  return layout(null, items);
}

const withToday = (patch, now, timeZone) => now === null || !patch.range || patch.range.anchor ? patch
  : { ...patch, range: { ...patch.range, anchor: dateIn(timeZone, now) } };

/**
 * The Ask field's matcher (lib/view-r2.mjs answerQuestion calls it). Order: a pinned question, a saved
 * view whose title or question the text contains, then the slot rules. No model call.
 * @param {string} question
 * @param {{savedViews?: SavedView[], now?: number | null, timeZone?: string}} [options]
 * @returns {import('./view-r2.mjs').AskAnswer}
 */
export function composeAnswer(question, { savedViews = [], now = null, timeZone = 'UTC' } = {}) {
  const text = normalize(question);
  const none = { matched: null, view: null, suggestions: PINNED_QUESTIONS.map(pin => pin.question), patch: null, role: null, metric: null };
  if (!text) return none;
  const range = rangeIn(text, now, timeZone);
  // A pin answers its own range only: "where did the money go this month" is a rule answer, not today's pin.
  const pin = PINNED_QUESTIONS.find(entry => normalize(entry.question) === text)
    ?? PINNED_QUESTIONS.find(entry => entry.pattern.test(text) && (!range || range.unit === entry.patch.range.unit));
  if (pin) return { matched: pin.id, view: pin.view, suggestions: [], patch: withToday(pin.patch, now, timeZone), role: pin.role, metric: pin.metric };
  const saved = (Array.isArray(savedViews) ? savedViews : []).find(entry => [entry?.title, entry?.question].some(value => {
    const name = normalize(value);
    return name.length >= 3 && (text === name || text.includes(name));
  }));
  if (saved) return { matched: saved.id, view: saved, suggestions: [], patch: null, role: null, metric: null };
  const role = roleIn(text);
  const metricId = METRIC_WORDS.find(([, pattern]) => pattern.test(text))?.[0] ?? (role ? 'spend' : null);
  if (!metricId) return none;
  const dim = DIM_WORDS.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
  const devices = DEVICE_WORDS.filter(([, pattern]) => pattern.test(text)).map(([host]) => host);
  const sources = metricId === 'grokRequests' ? [] : SOURCE_WORDS.filter(([, pattern]) => pattern.test(text)).map(([id]) => id);
  const patch = { ...(range ? { range } : {}), ...(devices.length ? { devices } : {}), ...(sources.length ? { sources } : {}) };
  const title = String(question).trim().slice(0, 80);
  return {
    matched: 'rule', suggestions: [], patch: Object.keys(patch).length ? patch : null, role, metric: metricId,
    view: { id: 'ask', title, question: title, spec: ruleSpec({ metricId, dim, role }), savedAt: now === null ? BUILT_IN_SAVED_AT : new Date(now).toISOString(), origin: 'composed' },
  };
}
