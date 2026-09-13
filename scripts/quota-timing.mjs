// Match the native timer's bounded scheduling tolerance. This only controls
// continuity between observations, never the freshness of the latest reading.
export const quotaHistoryMaxGapMs = 630000;
export function sameQuotaReset(a,b) {
  if(a===b)return true;
  return typeof a==='string' && typeof b==='string' &&
    Number.isFinite(Date.parse(a)) && Number.isFinite(Date.parse(b)) && Math.abs(Date.parse(a)-Date.parse(b))<=2000;
}
