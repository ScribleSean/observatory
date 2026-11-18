// The Week page: will the limit last, which sessions spent it, what each shipped and what is worth a look.
// Pure functions over the summary feed. A value that is not known stays null and reads as Unknown.
import strings from './strings.json' with { type: 'json' };
import { format } from './format.mjs';
import { when, shown } from './forecast.mjs';
import { validTimeZone } from './timezone.mjs';
import { snapshotFresh } from './freshness.mjs';
import { joined, modelLabel, used, weekWindow, sessionLabel, SERIES } from './ledger-join.mjs';
import { deviceLabel, tenths } from './panel-data.mjs';
import { joinedFlags, rankFlags } from './ledger-flags.mjs';

const HOUR = 3600000;
// Sessions named in the limit bar, rows in the table before "more", rows under Running now, flags on the page.
export const BAR_SESSIONS = 6, TABLE_ROWS = 8, RUNNING_ROWS = 3, PAGE_FLAGS = 4;
// A live session with this many failed tries in a row reads as retrying.
const RETRYING = 5;
// A fan-out reading this recent still says how many subagents are running.
const LIVE_FANOUT_MS = 2 * HOUR / 4;
// The join lives in lib/ledger-join.mjs; these stay importable from here.
export { joined, storedWindows, weekFeed, modelLabel, sessionLabel, SERIES } from './ledger-join.mjs';

const W = strings.week;
const UNKNOWN = strings.status.unknown;
const rows = value => Array.isArray(value) ? value.filter(row => row && typeof row === 'object' && !Array.isArray(row)) : [];
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const time = value => { const at = typeof value === 'string' ? Date.parse(value) : NaN; return Number.isFinite(at) ? at : null; };
const descending = (a, b) => a === b ? 0 : a === null ? 1 : b === null ? -1 : b - a;
// Null when there is nothing to add or any part is Unknown.
const total = values => values.length === 0 || values.some(value => value === null) ? null : values.reduce((sum, value) => sum + value, 0);
const plural = (count, one, many) => count === 1 ? one : format(many, { count: count.toLocaleString('en-US') });
const whole = value => value === null ? UNKNOWN : value.toLocaleString('en-US');

/** "45.0%", "0.3%", or Unknown. Shares are small numbers that are compared, so they keep one decimal. */
export function shareText(value) {
  return number(value) === null ? UNKNOWN : format(strings.formats.percent, { value: tenths(value) });
}
const roundShare = value => number(value) === null ? UNKNOWN
  : format(strings.formats.percent, { value: value < 0.1 ? tenths(value) : value < 10 ? +value.toFixed(1) : Math.round(value) });
// A whole percent, and "<1%" for a part that is not zero but would round to it.
const wholePercent = value => format(strings.formats.percent, { value: value > 0 && value < 1 ? format(strings.formats.under, { value: 1 }) : Math.round(value) });

/** The name each computer goes by, the same one the top of the page lists. */
export function machineNames(summary) {
  const names = new Map(rows(summary?.devices).filter(device => typeof device.name === 'string' && device.name.trim()).map(device => [device.host, device.name.trim()]));
  return host => names.get(host) ?? deviceLabel(host);
}

/**
 * @typedef {{ lead: string, when: string | null, tail: string }} Say
 * @typedef {{ key: string, series: number, label: string, share: number, text: string }} Segment
 * @typedef {{ engine: string, title: string, resets: string, used: number | null, usedText: string, tone: string, say: Say | null, pill: string | null,
 *   segments: Segment[], rest: { share: number, text: string, label: string } | null }} Headline
 * @typedef {{ engine: string, label: string, used: number | null, usedText: string, tone: string, resets: string }} LimitMeter
 * @typedef {{ key: string, title: string, machine: string, running: boolean, models: { label: string, series: number, part: number }[],
 *   subagents: number | null, subagentsText: string, share: number | null, shareText: string, bar: number | null,
 *   shipped: { tone: string, text: string }, perChange: string }} SessionRow
 * @typedef {{ count: number, expandable: boolean, label: string, subagentsText: string, shareText: string, shipped: string, perChange: string }} MoreRow
 * @typedef {{ label: string, value: string }} Figure
 * @typedef {{ key: string, title: string, rate: number | null, warn: boolean, engine: string | null, meta: string[], rateText: string }} RunningRow
 * @typedef {{ rows: RunningRow[], aside: string, others: { label: string, rateText: string } | null }} Running
 * @typedef {{ key: string, session: string, tone: 'warn' | 'note', share: number | null, lead: string, rest: string, ownLead: string, ownRest: string }} FlagLine
 * @typedef {{ period: 'current' | 'previous', hasPrevious: boolean, computers: string, headline: Headline | null, meters: LimitMeter[],
 *   tools: { id: string, name: string }[], tool: string | null, table: { title: string, machines: boolean, rows: SessionRow[], more: MoreRow | null } | null,
 *   shipped: { title: string, figures: Figure[] } | null, running: Running | null, flags: FlagLine[] }} WeekViewModel
 */

const unknownShipped = { estimated: true, commits: null, onMain: null, merges: null, prsOpen: null, repos: [] };


const READ_ONLY_TASKS = ['review', 'search', 'research'];

/**
 * The pill beside a session: what it shipped, as far as that is known.
 * @returns {{ tone: string, text: string, changes: number | null }}
 */
export function shippedPill(shipped, task = null) {
  const merges = number(shipped?.merges), commits = number(shipped?.commits), prs = number(shipped?.prsOpen);
  if (merges) return { tone: 'ok', text: format(W.merged, { count: merges }), changes: merges };
  if (prs) return { tone: 'open', text: plural(prs, W.prOpen, W.prsOpen), changes: prs };
  if (commits) return { tone: 'ok', text: plural(commits, W.oneCommit, W.commits), changes: commits };
  if (merges === null || commits === null) return { tone: 'none', text: UNKNOWN, changes: null };
  // A review, search or research that wrote nothing is expected to change nothing. That is not waste.
  if (READ_ONLY_TASKS.includes(task) && (Array.isArray(shipped?.repos) ? shipped.repos : []).length === 0) return { tone: 'none', text: W.readOnly, changes: null };
  return { tone: 'none', text: W.noChange, changes: null };
}

function sessionRow(session, join, top, machine) {
  const pill = shippedPill(session.shipped, session.task);
  const parts = rows(session.models).map(model => ({ label: modelLabel(model.model), usd: number(model.apiUsd) }));
  const sum = total(parts.map(part => part.usd));
  return { key: session.key, title: sessionLabel(session), machine: machine(session.host), running: session.running === true,
    models: sum ? parts.map(part => ({ label: part.label, series: join.series(part.label), part: part.usd / sum })) : [],
    subagents: number(session.subagents), subagentsText: whole(number(session.subagents)),
    share: session.share, shareText: shareText(session.share), bar: session.share !== null && top ? session.share / top : null,
    shipped: { tone: pill.tone, text: pill.text },
    perChange: pill.changes && session.share !== null ? shareText(session.share / pill.changes) : '' };
}

// Every session past `shown`, with the ones no computer listed, as one row.
function moreRow(listed, others, shown) {
  const hidden = listed.slice(shown);
  const count = hidden.length + others.reduce((sum, other) => sum + (number(other.count) ?? 0), 0); // zero-ok: a count of sessions, not a reading
  if (count === 0) return null;
  const ships = [...hidden.map(session => session.shipped ?? unknownShipped), ...others.map(other => other.shipped ?? unknownShipped)];
  const merged = total(ships.map(shipped => number(shipped.merges)));
  const share = total([...hidden.map(session => session.share), ...others.map(other => other.share)]);
  return { count, expandable: hidden.length > 0, label: plural(count, W.oneMore, W.moreSessions),
    subagentsText: whole(total([...hidden, ...others].map(part => number(part.subagents)))),
    shareText: shareText(share), shipped: merged === null ? UNKNOWN : format(W.merged, { count: merged }),
    perChange: merged && share !== null ? shareText(share / merged) : '' };
}

function headline(join, engineId, names, period, context, outlook) {
  const window = join.engines.get(engineId)?.window ?? weekWindow(join.windows, engineId);
  if (!window) return null;
  const value = used(window, period);
  const said = shown(outlook, window, context.now);
  const tools = join.tools.filter(tool => tool.engine === engineId);
  const base = { engine: engineId, title: format(W.limitTitle, { name: names.get(engineId) ?? window.name, window: window.window }),
    // Last week's end is a past time, not a forecast. This week's reset label is the stored one.
    resets: period === 'previous' ? (time(tools[0]?.end ?? null) === null ? '' : format(W.ended, { time: when(tools[0].end, context) }))
      : said.resets ?? '',
    used: value, usedText: value === null ? UNKNOWN : format(W.used, { value: Math.round(value) }), tone: '', say: null, pill: null };
  if (period === 'current' && value !== null) Object.assign(base, {
    tone: window.status === 'out' ? 'spent' : window.status === 'runs-out' ? 'warn' : '',
    say: said.say, pill: said.pill });
  // The bar: the largest sessions on this engine, then everything else it spent. Only shares of the
  // weekly limit fit on the limit's bar; shares of spend do not.
  const weekly = join.engines.get(engineId)?.shareKind === 'week';
  const own = weekly ? join.sessions.filter(session => tools.some(tool => tool.id === session.tool) && session.share !== null) : [];
  const named = own.slice(0, BAR_SESSIONS);
  const rest = value === null ? null : Math.max(0, value - named.reduce((sum, session) => sum + session.share, 0));
  const count = total(tools.map(tool => tool.count));
  return { ...base,
    segments: named.map((session, index) => ({ key: session.key, series: index % SERIES, label: sessionLabel(session), share: session.share, text: roundShare(session.share) })),
    rest: rest !== null && own.length > 0 && rest > 0.05 ? { share: rest, text: roundShare(rest),
      label: count !== null && count > named.length ? format(W.others, { count: (count - named.length).toLocaleString('en-US') }) : W.otherSessions } : null };
}

function meters(join, names, skip, outlook, now) {
  return join.windows.filter(window => window !== skip).map(window => {
    const value = used(window, 'current');
    // A window forecast to run out, or out, says so in its own stored words. Any other says when it resets.
    const warns = window.status === 'out' || window.status === 'runs-out';
    const said = shown(outlook, window, now);
    const say = warns || said.stale ? said.say : null;
    return { engine: window.engine, label: format(W.meter, { name: names.get(window.engine) ?? window.name, window: window.window }),
      used: value, usedText: value === null ? UNKNOWN : format(strings.formats.percent, { value: Math.round(value) }),
      tone: window.status === 'out' ? 'spent' : window.status === 'runs-out' ? 'warn' : '',
      resets: say ? [say.lead, say.when, say.tail].filter(Boolean).join(' ') : said.resets ?? strings.status.resetUnknown };
  });
}

function shippedTotals(join) {
  const parts = [...join.sessions, ...join.others];
  const ships = parts.map(part => part.shipped ?? unknownShipped);
  const spent = total(parts.map(part => number(part.apiUsd)));
  const idle = parts.filter((part, index) => { const pill = shippedPill(ships[index], parts[index].task); return pill.changes === null && pill.text === W.noChange; });
  const judged = ships.every(shipped => number(shipped.merges) !== null && number(shipped.commits) !== null);
  const wasted = spent && judged ? idle.reduce((sum, part) => sum + number(part.apiUsd), 0) / spent * 100 : null;
  return [
    { label: W.branchesMerged, value: whole(total(ships.map(shipped => number(shipped.merges)))) },
    { label: W.commitsLabel, value: whole(total(ships.map(shipped => number(shipped.commits)))) },
    { label: W.onMainLabel, value: whole(total(ships.map(shipped => number(shipped.onMain)))) },
    { label: W.spentNoChange, value: wasted === null ? UNKNOWN : wholePercent(wasted) },
  ];
}

// A session runs now only on a computer whose ledger is fresh, the same rule the menu bar uses (lib/glance-view.mjs).
// An old ledger, from a computer that is off or unreachable, says what was running then.
function runningNow(join, now, machine, fresh) {
  const live = join.sessions.filter(session => session.running === true && fresh.has(session.host)).map(session => {
    const rate = join.shareOf(session.tool, number(session.ratePerHour));
    const last = rows(session.fanout).at(-1);
    const subagents = last && time(last.at) !== null && now - time(last.at) <= LIVE_FANOUT_MS ? number(last.count) : null;
    const retrying = (number(session.signals?.longestRetry) ?? -1) >= RETRYING;
    const state = retrying ? W.retrying : subagents ? plural(subagents, W.oneSubagentNow, W.subagentsNow)
      : { working: W.working, waiting: W.waiting, idle: W.idle }[session.state] ?? '';
    return { key: session.key, title: sessionLabel(session), rate, warn: retrying, engine: join.tools.find(tool => tool.id === session.tool)?.engine ?? null,
      meta: [machine(session.host), modelLabel(rows(session.models)[0]?.model), state].filter(Boolean),
      rateText: rate === null ? UNKNOWN : format(W.perHour, { value: tenths(rate) }) };
  }).sort((a, b) => descending(a.rate, b.rate));
  if (live.length === 0) return null;
  // Rates add up only inside one engine: a share of one limit is not a share of another.
  const sum = rest => new Set(rest.map(row => row.engine)).size === 1 ? total(rest.map(row => row.rate)) : null;
  const all = sum(live), hidden = live.slice(RUNNING_ROWS), tail = sum(hidden);
  return { rows: live.slice(0, RUNNING_ROWS),
    aside: all === null ? plural(live.length, W.runningOne, W.runningCount) : format(live.length === 1 ? W.runningRateOne : W.runningRate, { count: live.length, rate: format(strings.formats.percent, { value: tenths(all) }) }),
    others: hidden.length ? { label: format(W.othersRunning, { count: hidden.length }), rateText: tail === null ? '' : format(W.perHour, { value: tenths(tail) }) } : null };
}

/**
 * A session's flags as sentences: `lead` and `rest` name the session, `ownLead` and `ownRest` are for its own panel.
 * @returns {FlagLine[]}
 */
export function flagLines(session, join) {
  const title = sessionLabel(session);
  const spend = (join.shareKindOf?.(session.tool) ?? 'week') === 'spend';
  const money = value => number(value) === null ? UNKNOWN : format(strings.formats.usd, { value: value.toFixed(2) });
  return joinedFlags(session, join).flatMap(flag => {
    const values = flag.values ?? {};
    const line = (lead, rest, ownLead, ownRest) => [{ key: `${session.key}.${flag.kind}`, kind: flag.kind, session: session.key, tone: flag.tone === 'note' ? 'note' : 'warn', share: flag.share, lead, rest, ownLead, ownRest }];
    if (flag.kind === 'fanout') {
      const rest = format(spend ? W.fanoutSpend : W.fanout, { count: whole(number(values.subagents)), share: roundShare(values.share) }) + (values.merged === false ? ` ${W.noMerge}` : '');
      return line(title, rest, format(W.fanoutOwn, { count: whole(number(values.subagents)) }), format(spend ? W.fanoutOwnRestSpend : W.fanoutOwnRest, { share: roundShare(values.share) }) + (values.merged === false ? ` ${W.noMerge}` : ''));
    }
    if (flag.kind === 'model-fit') {
      const lead = format(W.searchLead, { model: modelLabel(values.model) });
      const rest = spend ? format(W.searchRestSpend, { count: whole(number(values.subagents)), saved: money(number(values.top) !== null && number(values.small) !== null ? values.top - values.small : null) })
        : format(W.searchRest, { count: whole(number(values.subagents)), share: roundShare(values.saved) });
      return line(lead, rest, lead, rest);
    }
    if (flag.kind === 'retry-loop') {
      const tool = typeof values.tool === 'string' && values.tool ? values.tool : W.retryAnyTool;
      return line(title, format(W.retry, { tool, count: whole(number(values.count)) }), format(W.retryOwn, { tool }), format(W.retryOwnRest, { count: whole(number(values.count)) }));
    }
    if (flag.kind === 'auto-resume') {
      const rest = spend ? format(W.resumedRestSpend, { usd: money(values.usd) }) : format(W.resumedRest, { share: roundShare(values.share) });
      return line(format(W.resumedLead, { title }), rest, W.resumedOwn, rest);
    }
    return [];
  });
}

/**
 * Everything the Week page draws.
 * @param {any} summary the summary feed @param {{tool?: string|null, period?: 'current'|'previous', now?: number, shown?: number}} options
 * @returns {WeekViewModel}
 */
export function weekView(summary, { tool = null, period = 'current', now = Date.now(), shown = TABLE_ROWS } = {}) {
  const timeZone = validTimeZone(summary?.timezone) ? summary.timezone : 'UTC';
  const context = { now, timeZone };
  const join = joined(summary, period);
  const outlook = summary?.glance?.forecast;
  const names = new Map(rows(outlook?.engines).map(engine => [engine.engine, engine.name]));
  // The scarcer engine leads. Without a forecast, the first engine that has a window does.
  const lead = [outlook?.scarce?.engine, ...join.tools.map(entry => entry.engine), ...join.windows.map(window => window.engine)]
    .find(engine => engine && join.windows.some(window => window.engine === engine)) ?? null;
  const head = lead === null ? null : headline(join, lead, names, period, context, outlook);
  // A tool loses its tab only when it is known to have no sessions in the period. A tool whose source is off is never
  // read, so it is not listed at all. One that could not be read keeps its tab and reads Unknown.
  const none = entry => entry.count === 0 && !join.sessions.some(session => session.tool === entry.id) &&
    !join.others.some(other => other.tool === entry.id && number(other.count) !== 0);
  const tabs = join.tools.filter(entry => !none(entry));
  const picked = tabs.find(entry => entry.id === tool) ?? tabs.find(entry => entry.engine === lead) ?? tabs[0] ?? null;
  const listed = picked ? join.sessions.filter(session => session.tool === picked.id) : [];
  const top = listed.reduce((most, session) => Math.max(most, session.share ?? 0), 0); // zero-ok: scales the bars, never shown
  const machine = machineNames(summary);
  const flags = rankFlags(join.sessions.flatMap(session => flagLines(session, join))).slice(0, PAGE_FLAGS);
  return {
    period, hasPrevious: join.tools.some(entry => entry.previous),
    computers: rows(summary?.devices).map(device => device.name).filter(name => typeof name === 'string' && name).join(', '),
    headline: head,
    meters: meters(join, names, head ? join.engines.get(head.engine)?.window ?? weekWindow(join.windows, head.engine) : null, outlook, now),
    tools: tabs.map(entry => ({ id: entry.id, name: entry.name })), tool: picked?.id ?? null,
    // The Machine column is there only when the sessions come from more than one computer.
    table: picked ? { title: join.shareKindOf(picked.id) === 'week' ? W.sessionsTitle : W.sessionsTitleSpend, machines: new Set(listed.map(session => session.host)).size > 1, rows: listed.slice(0, shown).map(session => sessionRow(session, join, top, machine)),
      more: moreRow(listed, join.others.filter(other => other.tool === picked.id), shown) } : null,
    shipped: join.tools.length ? { title: period === 'previous' ? W.shippedLast : W.shippedTitle, figures: shippedTotals(join) } : null,
    running: period === 'current' ? runningNow(join, now, machine,
      new Set(rows(summary?.week?.ledger).filter(row => row.status === 'ok' && snapshotFresh(time(row.collectedAt), now)).map(row => row.host))) : null,
    flags,
  };
}

/** Whether any tool kept last week, so the page can offer it. */
export function hasLastWeek(summary) {
  return rows(summary?.week?.ledger).some(row => rows(row.tools).some(tool => rows(tool.periods).some(part => part.key === 'previous')));
}
