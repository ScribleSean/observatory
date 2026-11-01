import {readingFresh} from './freshness.mjs';

export const LIMIT_LOW_PERCENT = 15;
export const LIMIT_SPENT_PERCENT = 0.5;

export function limitRemaining(row, now = Date.now()) {
  const checked = Date.parse(row.checkedAt), reset = Date.parse(row.resetsAt);
  return row.stale === false && typeof row.remaining === 'number' &&
    Number.isFinite(row.remaining) && row.remaining >= 0 && row.remaining <= 100 &&
    readingFresh(checked, now) &&
    !(reset <= now) ? row.remaining : null;
}
