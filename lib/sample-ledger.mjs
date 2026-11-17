// A fictional ledger in the shape of lib/ledger-shape.mjs, for the preview, the demo and the tests.
// Every name here is made up. Amounts are picked so the screens show each case: a large fan-out with no
// change, merged work, an open PR, a retry loop, a session that resumed on its own, and an untitled one.
const HOUR = 3600000, DAY = 24 * HOUR;
// freshness-exempt: the length of one fan-out slot
const SLOT = 15 * 60000;
const OPUS = 'claude-opus-5-5', SONNET = 'claude-sonnet-4-20250514', FABLE = 'claude-fable-5', HAIKU = 'claude-haiku-4-5';
const ASTRA = 'gpt-6-astra', TERRA = 'gpt-5.6-terra';

const round = value => Math.round(value * 100) / 100;
const shipped = (commits = 0, onMain = 0, merges = 0, prsOpen = null, repos = []) => ({ estimated: true, commits, onMain, merges, prsOpen, repos });
const quiet = { longestRetry: 0, retryTool: null, autoResumeUsd: 0, searchOnTopModelUsd: 0, searchOnSmallModelUsd: 0 };

// [title, usd, subagents, hours ago it started, hours it ran, model split, shipped, extra]
const CLAUDE = {
  Mac: {
    current: { apiUsd: 2810, count: 126, other: { count: 120, apiUsd: 498, subagents: 148, shipped: shipped(61, 48, 5, null, ['field-notes', 'sample-site']) }, sessions: [
      ['Release review', 1638, 372, 112, 7.8, [[OPUS, 0.92], [SONNET, 0.08]], shipped(0, 0, 0, 0, ['field-notes']),
        { kinds: [['search', OPUS, 212, 0.43], ['review', OPUS, 96, 0.31], ['main', OPUS, 0, 0.13], ['review', SONNET, 22, 0.07], ['write', SONNET, 42, 0.06]], peak: 61,
          signals: { ...quiet, searchOnTopModelUsd: 704, searchOnSmallModelUsd: 158 } }],
      ['Docs refresh', 298, 70, 90, 5.2, [[OPUS, 0.2], [SONNET, 0.3], [FABLE, 0.5]], shipped(31, 26, 6, 0, ['sample-site']), { peak: 14 }],
      ['API cleanup', 149, 51, 66, 3.4, [[OPUS, 0.1], [SONNET, 0.9]], shipped(18, 15, 3, 0, ['tide-tables']), { peak: 9 }],
      ['Weekly planning', 95, 20, 40, 1.6, [[OPUS, 0.85], [SONNET, 0.15]], shipped(0, 0, 0, 0, []), { peak: 6 }],
      ['Media player fixes', 77, 11, 30, 2.1, [[OPUS, 0.8], [SONNET, 0.2]], shipped(7, 5, 1, 0, ['field-notes']), { peak: 4 }],
      ['Dashboard redesign', 55, 9, 3.2, 3.2, [[OPUS, 0.7], [HAIKU, 0.3]], shipped(4, 0, 0, null, ['sample-site']),
        { running: 'working', rate: 11, peak: 4, live: 4 }],
    ] },
    previous: { apiUsd: 1980, count: 141, other: { count: 138, apiUsd: 1210, subagents: 260, shipped: shipped(88, 70, 9, null, ['field-notes', 'sample-site']) }, sessions: [
      ['Docs refresh', 402, 64, 150, 6, [[OPUS, 0.3], [SONNET, 0.7]], shipped(22, 20, 4, 0, ['sample-site']), { peak: 12 }],
      ['API cleanup', 241, 38, 120, 4, [[OPUS, 0.2], [SONNET, 0.8]], shipped(15, 12, 2, 0, ['tide-tables']), { peak: 8 }],
      ['Media player fixes', 127, 12, 100, 2, [[OPUS, 0.8], [SONNET, 0.2]], shipped(0, 0, 0, 0, []), { peak: 5 }],
    ] },
  },
  Windows: {
    current: { apiUsd: 830, count: 56, other: { count: 54, apiUsd: 582, subagents: 66, shipped: shipped(19, 12, 2, null, ['tide-tables']) }, sessions: [
      ['Game prototype', 157, 10, 4.5, 4.5, [[OPUS, 0.8], [SONNET, 0.2]], shipped(12, 9, 2, 0, ['tide-tables']),
        { running: 'working', rate: 7.3, peak: 3, live: 2 }],
      ['Package updates', 91, 12, 6, 6, [[OPUS, 0.9], [SONNET, 0.1]], shipped(21, 17, 4, 0, ['sample-site']),
        { running: 'working', rate: 18, peak: 3, live: 0, signals: { ...quiet, longestRetry: 14, retryTool: 'Shell' } }],
    ] },
    previous: { apiUsd: 920, count: 49, other: { count: 48, apiUsd: 742, subagents: 71, shipped: shipped(25, 21, 3, null, ['tide-tables']) }, sessions: [
      ['Game prototype', 178, 16, 130, 5, [[OPUS, 0.75], [SONNET, 0.25]], shipped(9, 9, 3, 0, ['tide-tables']), { peak: 5 }],
    ] },
  },
};
const CODEX = {
  Mac: {
    current: { apiUsd: 118, count: 9, other: { count: 7, apiUsd: 68, subagents: 0, shipped: shipped(6, 4, 1, null, ['field-notes']) }, sessions: [
      ['Upstream fix', 38, 4, 52, 2.4, [[ASTRA, 1]], shipped(3, 0, 0, 1, ['tide-tables']), { peak: 2 }],
      [null, 12, 0, 20, 0.7, [[TERRA, 1]], shipped(0, 0, 0, null, []), {}],
    ] },
    previous: { apiUsd: 96, count: 8, other: { count: 8, apiUsd: 96, subagents: 2, shipped: shipped(5, 5, 1, null, ['field-notes']) }, sessions: [] },
  },
  Windows: {
    current: { apiUsd: 92, count: 5, other: { count: 4, apiUsd: 41, subagents: 0, shipped: shipped(2, 2, 0, null, ['sample-site']) }, sessions: [
      ['Search indexer', 51, 3, 26, 3.1, [[ASTRA, 0.7], [TERRA, 0.3]], shipped(5, 3, 1, 0, ['sample-site']),
        { peak: 2, signals: { ...quiet, autoResumeUsd: 9 } }],
    ] },
    previous: { apiUsd: 70, count: 6, other: { count: 6, apiUsd: 70, subagents: 0, shipped: shipped(4, 4, 1, null, ['sample-site']) }, sessions: [] },
  },
};
const TOOLS = [['claude', 'Claude Code', 'claude', CLAUDE, 3 * DAY], ['codex', 'Codex', 'codex', CODEX, 5 * DAY]];
// The share of a week's spend on each of its seven days, and the commits that reached the default branch.
const DAY_WEIGHTS = [0.08, 0.13, 0.31, 0.16, 0.12, 0.14, 0.06];
const DAY_COMMITS = [3, 9, 0, 14, 11, 12, 5];

function fanout(start, end, peak) {
  const slots = Math.max(1, Math.round((end - start) / SLOT));
  const first = Math.floor(start / SLOT) * SLOT;
  return Array.from({ length: slots }, (_, index) => {
    const position = slots === 1 ? 0.5 : index / (slots - 1);
    return { at: new Date(first + index * SLOT).toISOString(), count: Math.max(0, Math.round(peak * Math.exp(-(((position - 0.4) / 0.24) ** 2)))) };
  });
}

// Twelve hex characters, like the hash a collector makes of the tool's own session id.
function idOf(text) {
  let hash = 7;
  for (let at = 0; at < text.length; at++) hash = (hash * 31 + text.charCodeAt(at)) % 0xffffffffffff;
  return hash.toString(16).padStart(12, '0');
}

function session(row, index, tool, host, period, now) {
  const [title, apiUsd, subagents, startedHoursAgo, hours, split, ships, extra] = row;
  const shift = period.key === 'previous' ? 7 * DAY : 0;
  const start = now - shift - startedHoursAgo * HOUR, end = Math.min(now - shift, start + hours * HOUR);
  const running = period.key === 'current' && Boolean(extra.running);
  const output = Math.round(apiUsd * 13000);
  const points = subagents > 0 ? fanout(start, end, extra.peak ?? Math.max(1, Math.round(subagents / 6))) : [];
  // A live session's last slot says how many subagents are running now.
  if (running && points.length) points[points.length - 1].count = extra.live ?? 0; // zero-ok: a count of subagents, not a reading
  const models = split.map(([model, part]) => ({ model, apiUsd: round(apiUsd * part), outputTokens: Math.round(output * part) }));
  const kinds = (extra.kinds ?? [['main', split[0][0], 0, split[0][1]], ...(split[1] ? [['build', split[1][0], subagents, split[1][1]]] : []),
    ...(split[2] ? [['write', split[2][0], 0, split[2][1]]] : [])])
    .map(([kind, model, count, part]) => ({ kind, model, subagents: count, apiUsd: round(apiUsd * part) }));
  return {
    id: idOf(`${tool}${host}${period.key}${index}`),
    title, startedAt: new Date(start).toISOString(), lastActiveAt: new Date(end).toISOString(),
    running, state: running ? extra.running : null, ratePerHour: running ? extra.rate : null,
    tokens: { input: Math.round(output * 2.5), output, cacheRead: output * 40, cacheWrite: Math.round(output * 1.5) },
    apiUsd, models, subagents, kinds, fanout: points, shipped: ships, signals: extra.signals ?? quiet,
  };
}

/**
 * One computer's LedgerRow. `host` is Mac or Windows.
 * @returns {import('./ledger-shape.mjs').LedgerRow}
 */
export function sampleLedger(now, { host, checkedAt = new Date(now).toISOString() }) {
  const tools = TOOLS.map(([tool, name, limitEngine, data, resetsIn]) => {
    const reset = Math.floor((now + resetsIn) / HOUR) * HOUR;
    const periods = ['current', 'previous'].map(key => {
      const source = data[host][key];
      const end = key === 'current' ? reset : reset - 7 * DAY, start = end - 7 * DAY;
      const period = { key };
      // Days still ahead in the current window have no record yet.
      const days = DAY_WEIGHTS.flatMap((weight, index) => start + index * DAY > now ? [] : [{
        date: new Date(start + index * DAY).toISOString().slice(0, 10), apiUsd: round(source.apiUsd * weight),
        onMain: Math.round(DAY_COMMITS[index] * (host === 'Mac' ? 1 : 0.4) * (tool === 'claude' ? 1 : 0.2)) }]);
      return { key, start: new Date(start).toISOString(), end: new Date(end).toISOString(), windowKnown: true,
        apiUsd: source.apiUsd, sessionCount: source.count,
        sessions: source.sessions.map((row, index) => session(row, index, tool, host, period, now)), other: source.other, days };
    });
    return { tool, name, limitEngine, periods };
  });
  return { host, status: 'ok', collectedAt: checkedAt, tools };
}
