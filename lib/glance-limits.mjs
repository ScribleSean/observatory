import {readingFresh} from './freshness.mjs';

// A limit is low at or below this share left, and spent at or below LIMIT_SPENT_PERCENT.
// The dashboard, glance/mac/Glance.swift (PanelState.low) and glance/windows/Glance.cs
// (PanelState.Low) use the same numbers, and test/repo-rules.test.mjs compares them.
export const LIMIT_LOW_PERCENT = 15;
export const LIMIT_SPENT_PERCENT = 0.5;

// Mirrored by limitRemaining in both native apps. Draw time is the only clock.
export function limitRemaining(row, now = Date.now()) {
  const checked = Date.parse(row.checkedAt), reset = Date.parse(row.resetsAt);
  return row.stale === false && typeof row.remaining === 'number' &&
    Number.isFinite(row.remaining) && row.remaining >= 0 && row.remaining <= 100 &&
    readingFresh(checked, now) &&
    !(reset <= now) ? row.remaining : null;
}
