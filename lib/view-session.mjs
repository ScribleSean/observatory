// The session panel: one session's share, its fan-out over time, where the spend went and what it shipped.
import strings from './strings.json' with { type: 'json' };
import { format } from './format.mjs';
import { compact, usd, span } from './panel-data.mjs';
import { validTimeZone } from './timezone.mjs';
import { when } from './forecast.mjs';
import { joined, flagLines, shippedPill, shareText, modelLabel, machineNames, sessionLabel } from './view-week.mjs';

const S = strings.session;
const UNKNOWN = strings.status.unknown;
const rows = value => Array.isArray(value) ? value.filter(row => row && typeof row === 'object' && !Array.isArray(row)) : [];
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const time = value => { const at = typeof value === 'string' ? Date.parse(value) : NaN; return Number.isFinite(at) ? at : null; };
const whole = value => value === null ? UNKNOWN : value.toLocaleString('en-US');
const KINDS = { search: S.kindSearch, research: S.kindResearch, review: S.kindReview, design: S.kindDesign, build: S.kindBuild,
  test: S.kindTest, write: S.kindWrite, main: S.kindMain, other: S.kindOther };
// At most this many labels under the fan-out chart.
const TICKS = 5;
// Kinds of work named under "Where it went". The rest are one row.
export const KIND_ROWS = 6;
const total = values => values.length === 0 || values.some(value => value === null) ? null : values.reduce((sum, value) => sum + value, 0);
const descending = (a, b) => a === b ? 0 : a === null ? 1 : b === null ? -1 : b - a;

// One row per kind of work, largest first, with the models that did it. Kinds past KIND_ROWS join Other.
function whereItWent(session, join) {
  const groups = new Map();
  for (const part of rows(session.kinds)) {
    const kind = Object.hasOwn(KINDS, part.kind) ? part.kind : 'other';
    const group = groups.get(kind) ?? { kind, parts: [] };
    group.parts.push(part);
    groups.set(kind, group);
  }
  const sized = [...groups.values()].map(group => ({ ...group, usd: total(group.parts.map(part => number(part.apiUsd))) })).sort((a, b) => descending(a.usd, b.usd));
  const named = sized.filter(group => group.kind !== 'other').slice(0, KIND_ROWS);
  const rest = sized.filter(group => !named.includes(group));
  const listed = rest.length ? [...named, { kind: 'other', parts: rest.flatMap(group => group.parts), usd: total(rest.map(group => group.usd)) }] : named;
  return listed.map(group => {
    const spend = new Map();
    for (const part of group.parts) spend.set(modelLabel(part.model), (spend.get(modelLabel(part.model)) ?? 0) + (number(part.apiUsd) ?? 0)); // zero-ok: sizes the model mix, never shown as a reading
    const mix = [...spend].sort((a, b) => b[1] - a[1]);
    const subagents = total(group.parts.map(part => number(part.subagents)));
    return { key: group.kind, label: KINDS[group.kind], lead: mix[0][0],
      models: group.usd ? mix.map(([label, value]) => ({ label, series: join.series(label), part: value / group.usd })) : [],
      subagentsText: whole(subagents), quiet: subagents === 0, shareText: shareText(join.shareOf(session.tool, group.usd)) };
  });
}

function fanout(session, context) {
  const points = rows(session.fanout).filter(point => time(point.at) !== null && number(point.count) !== null);
  if (points.length === 0) return null;
  const peak = points.reduce((best, point) => point.count > best.count ? point : best);
  const hour = at => new Intl.DateTimeFormat('en-US', { timeZone: context.timeZone, hour: 'numeric' }).format(at);
  const clock = at => new Intl.DateTimeFormat('en-US', { timeZone: context.timeZone, hour: 'numeric', minute: '2-digit' }).format(at);
  // Labels sit on whole hours, spaced so at most TICKS of them fit.
  const hourOf = at => Number(new Intl.DateTimeFormat('en-US', { timeZone: context.timeZone, hour: 'numeric', hourCycle: 'h23' }).format(at));
  const minuteOf = at => Number(new Intl.DateTimeFormat('en-US', { timeZone: context.timeZone, minute: 'numeric' }).format(at));
  const hours = (time(points.at(-1).at) - time(points[0].at)) / 3600000;
  const step = [1, 2, 3, 4, 6, 12].find(size => hours / size <= TICKS) ?? 24;
  return { peak: peak.count, peakText: format(S.peak, { count: whole(peak.count), time: clock(time(peak.at)) }),
    bars: points.map(point => ({ count: point.count, label: `${clock(time(point.at))}: ${whole(point.count)}` })),
    // A label at the very end of the chart would run past its edge.
    ticks: points.flatMap((point, index) => minuteOf(time(point.at)) === 0 && hourOf(time(point.at)) % step === 0 && index / points.length <= 0.92 ? [{ index, text: hour(time(point.at)) }] : []) };
}

/**
 * @param {any} summary the summary feed @param {string} key the session's key from the Week page
 * @param {{period?: 'current'|'previous', now?: number}} options
 * @returns {{ key: string, title: string, running: boolean, meta: string[], figures: { label: string, value: string }[],
 *   fanout: { peak: number, peakText: string, bars: { count: number, label: string }[], ticks: { index: number, text: string }[] } | null,
 *   kinds: { key: string, label: string, lead: string, models: { label: string, series: number, part: number }[], subagentsText: string, quiet: boolean, shareText: string }[],
 *   shipped: { tone: string, text: string, line: string[] }, flags: import('./view-week.mjs').FlagLine[] } | null}
 */
export function sessionView(summary, key, { period = 'current', now = Date.now() } = {}) {
  const join = joined(summary, period);
  const session = join.sessions.find(entry => entry.key === key);
  if (!session) return null;
  const context = { now, timeZone: validTimeZone(summary?.timezone) ? summary.timezone : 'UTC' };
  const start = time(session.startedAt), end = time(session.lastActiveAt);
  const pill = shippedPill(session.shipped, session.task);
  const tokens = session.tokens ?? {};
  const read = [number(tokens.cacheRead), number(tokens.input), number(tokens.cacheWrite)];
  const sent = read.some(value => value === null) ? null : read[0] + read[1] + read[2];
  const cacheHit = sent ? Math.round(read[0] / sent * 100) : null;
  const shipped = session.shipped ?? {};
  const repos = Array.isArray(shipped.repos) ? shipped.repos.filter(name => typeof name === 'string' && name) : [];
  return {
    key, title: sessionLabel(session), running: session.running === true,
    meta: [machineNames(summary)(session.host), join.tools.find(tool => tool.id === session.tool)?.name,
      start !== null && end !== null ? format(S.span, { start: when(session.startedAt, context), end: when(session.lastActiveAt, context) }) : null,
      start !== null && end !== null && end >= start ? span(end - start) : null].filter(Boolean),
    figures: [
      { label: session.shareKind === 'spend' ? S.shareOfSpend : S.shareOfWeek, value: shareText(session.share) },
      { label: strings.week.subagents, value: whole(number(session.subagents)) },
      { label: S.outputTokens, value: compact(number(tokens.output)) },
      { label: S.apiPrices, value: usd(number(session.apiUsd)) },
    ],
    fanout: fanout(session, context),
    kinds: whereItWent(session, join),
    shipped: { tone: pill.tone, text: pill.text,
      line: [number(shipped.commits) === null ? null : format(S.shippedLine, { commits: whole(number(shipped.commits)), onMain: whole(number(shipped.onMain)) }),
        repos.length ? format(S.repos, { repos: repos.join(', ') }) : null,
        cacheHit === null ? null : format(S.cacheHit, { value: cacheHit })].filter(Boolean) },
    flags: flagLines(session, join),
  };
}
