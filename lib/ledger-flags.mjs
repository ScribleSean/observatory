// Flags: the few sessions in a week worth a second look, from the raw facts each LedgerSession
// carries in `signals`. Pure: the same period and percent give the same list.
import strings from './strings.json' with {type: 'json'};
import {format} from './format.mjs';
import {limitShare} from './ledger-shape.mjs';
import {joined, weekFeed, sessionLabel} from './ledger-join.mjs';

// Fan-out: many subagents, a large part of the limit window, and nothing merged.
export const FANOUT_MIN_SUBAGENTS = 15;
export const FANOUT_MIN_SHARE = 5; // percent of the limit window
// Model fit: search and research on the top model that a small model would have done for this much less.
export const MODEL_FIT_MIN_SHARE = 1; // percent of the limit window
export const MODEL_FIT_MIN_SAVED_USD = 5; // used when the window share is unknown
// Retry loop: this many failed calls in a row to one tool with the same input.
export const RETRY_MIN = 4;
// Auto-resume: spend in the half hour after a session went on by itself after a limit reset.
export const AUTO_RESUME_MIN_SHARE = 1; // percent of the limit window
export const AUTO_RESUME_MIN_USD = 2; // used when the window share is unknown
export const MAX_FLAGS = 4;

const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const spendShare = (usd, periodUsd) => number(usd) !== null && number(periodUsd) ? 100 * usd / periodUsd : null;

/**
 * The rules, for one session. The one place they live: the dashboard and the menu bar both come here.
 * @param {import('./ledger-shape.mjs').LedgerSession} session
 * @param {{share?: number | null, shareOf?: (usd: number) => number | null}} [context]
 *   share: the session's share of its limit window in percent, or null. shareOf: the same share for an API-priced amount.
 * @returns {{kind: 'fanout' | 'model-fit' | 'retry-loop' | 'auto-resume', tone: 'warn' | 'note', values: object}[]}
 */
export function sessionFlags(session, {share = null, shareOf = () => null} = {}) {
  const found = [], signals = session?.signals ?? {};
  const subagents = number(session?.subagents);
  if (subagents !== null && subagents >= FANOUT_MIN_SUBAGENTS && number(share) !== null && share >= FANOUT_MIN_SHARE && session.shipped?.merges === 0)
    found.push({kind: 'fanout', tone: 'warn', values: {subagents, share, merged: false}});
  const top = number(signals.searchOnTopModelUsd), small = number(signals.searchOnSmallModelUsd);
  if (top !== null && small !== null && top > small) {
    const saved = number(shareOf(top - small));
    if (saved !== null ? saved >= MODEL_FIT_MIN_SHARE : top - small >= MODEL_FIT_MIN_SAVED_USD) {
      const work = (Array.isArray(session.kinds) ? session.kinds : []).filter(part => part?.kind === 'search' || part?.kind === 'research');
      const lead = [...work].sort((a, b) => (number(b.apiUsd) ?? -1) - (number(a.apiUsd) ?? -1))[0];
      found.push({kind: 'model-fit', tone: 'note', values: {model: lead?.model ?? null,
        subagents: work.reduce((sum, part) => sum + (number(part.subagents) ?? 0), 0), // zero-ok: a count of subagents, not a reading
        saved, top, small}});
    }
  }
  const retries = number(signals.longestRetry);
  if (retries !== null && retries >= RETRY_MIN)
    found.push({kind: 'retry-loop', tone: 'warn', values: {count: retries, tool: signals.retryTool ?? null}});
  const resumed = number(signals.autoResumeUsd);
  if (resumed !== null) {
    const window = number(shareOf(resumed));
    if (window !== null ? window >= AUTO_RESUME_MIN_SHARE : resumed >= AUTO_RESUME_MIN_USD)
      found.push({kind: 'auto-resume', tone: 'warn', values: {share: window, usd: resumed}});
  }
  return found;
}

// The one order everywhere: the biggest share of the window first, retry loops last. Ties keep their given order.
export function rankFlags(items) {
  const rank = item => item.kind === 'retry-loop' ? 1 : 0;
  return items.map((item, at) => ({item, at})).sort((a, b) => rank(a.item) - rank(b.item) ||
    (a.item.share === b.item.share ? 0 : a.item.share === null ? 1 : b.item.share === null ? -1 : b.item.share - a.item.share) ||
    (a.item.session ?? '').localeCompare(b.item.session ?? '') || a.at - b.at).map(({item}) => item);
}

/**
 * A session's flags with the share they are ranked by, for a session of lib/ledger-join.mjs's `joined`.
 * The share is the one of the limit window, or else the session's share of what its tool spent.
 */
export function joinedFlags(session, join) {
  const share = number(session.share) ?? join.spendShare(session.tool, session.apiUsd);
  return sessionFlags(session, {share, shareOf: amount => join.shareOf(session.tool, number(amount))})
    .map(flag => ({...flag, session: session.key, share}));
}

/**
 * Flags for one period, with the limit's percent used (null when unknown). A thin wrapper over sessionFlags.
 * @param {import('./ledger-shape.mjs').LedgerPeriod} period
 * @param {number | null} percentUsed  The tool's limit window, percent used, or null when unknown.
 * @returns {{kind: 'fanout' | 'model-fit' | 'retry-loop' | 'auto-resume', sessionId: string, values: object}[]}
 */
export function ledgerFlags(period, percentUsed = null) {
  const periodUsd = period?.apiUsd ?? null;
  const found = [];
  for (const session of Array.isArray(period?.sessions) ? period.sessions : []) {
    const share = limitShare(session.apiUsd, periodUsd, percentUsed) ?? spendShare(session.apiUsd, periodUsd);
    for (const flag of sessionFlags(session, {share, shareOf: amount => limitShare(amount, periodUsd, percentUsed)}))
      found.push({kind: flag.kind, session: session.id, sessionId: session.id, share, values: {title: sessionLabel(session, null), ...flag.values}});
  }
  return rankFlags(found).slice(0, MAX_FLAGS).map(({kind, sessionId, values}) => ({kind, sessionId, values}));
}

const TEXT = {fanout: 'fanout', 'model-fit': 'modelFit', 'retry-loop': 'retryLoop', 'auto-resume': 'autoResume'};

// The flag as a sentence. money and percent format numbers for the reader.
export function flagText(flag, {money = value => `$${Math.round(value)}`, percent = value => `${Math.round(value)}%`, shareKind = 'week'} = {}) {
  const values = flag.values ?? {};
  const title = values.title ?? strings.ledger.untitled;
  const words = {
    fanout: {title, count: values.subagents, share: percent(values.share)},
    modelFit: {title, top: money(values.top), small: money(values.small)},
    retryLoop: {title, count: values.count, tool: values.tool ?? strings.ledger.unknownTool},
    autoResume: {title, usd: money(values.usd)},
  };
  const key = TEXT[flag.kind];
  if (!key) return '';
  return format(strings.ledger[key === 'fanout' && shareKind === 'spend' ? 'fanoutSpend' : key], words[key]);
}

// Flags across every computer in a combined snapshot, from the same join the Week page draws: a tool's
// sessions on every computer are pooled, and shares follow lib/ledger-join.mjs's rule: of the weekly
// limit when the window is a real weekly one, else of what was spent. Returns [{text, subject}].
export function snapshotFlags(combined) {
  const join = joined({week: weekFeed(combined)});
  const titles = new Map(join.sessions.map(session => [session.key, sessionLabel(session, null)]));
  const kinds = new Map(join.sessions.map(session => [session.key, session.shareKind]));
  return rankFlags(join.sessions.flatMap(session => joinedFlags(session, join))).slice(0, MAX_FLAGS)
    .map(flag => ({text: flagText({kind: flag.kind, values: {title: titles.get(flag.session), ...flag.values}}, {shareKind: kinds.get(flag.session)}), subject: titles.get(flag.session)}));
}
