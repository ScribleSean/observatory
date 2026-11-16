export const quotaHistoryMaxGapMs = 630000;
export function sameQuotaReset(a,b) {
  if(a===b)return true;
  return typeof a==='string' && typeof b==='string' &&
    Number.isFinite(Date.parse(a)) && Number.isFinite(Date.parse(b)) && Math.abs(Date.parse(a)-Date.parse(b))<=2000;
}

// A limit a day long or longer cannot fall this far between two readings a few minutes apart by use
// alone. The allowance itself changed, as when the plan changes in the middle of a window, so the
// fall is not use and no pace is measured across it.
export const STEP_POINTS = 20;
// freshness-exempt: the longest gap between two readings that can show a change of allowance.
export const STEP_MS = 15 * 60000;
const STEP_MIN_WINDOW_MINUTES = 1440;
export function allowanceStepped(earlier, later, durationMinutes) {
  return durationMinutes >= STEP_MIN_WINDOW_MINUTES && later.at > earlier.at && later.at - earlier.at <= STEP_MS &&
    earlier.remaining - later.remaining >= STEP_POINTS;
}
