const minute = 60000;
const timestamp = value => typeof value === 'string' ? Date.parse(value) : NaN;
const percent = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;

// Call separately for each account-scoped local or peer projection. Never
// merge devices or providers here. These are estimates, not saved observations.
export function quotaPace(quota, now = Date.now()) {
  if (!Number.isSafeInteger(now) || now < 0) throw Error('Invalid pace clock');
  const asOf = timestamp(quota?.checkedAt);
  return (Array.isArray(quota?.windows) ? quota.windows : []).map(window => {
    const result = {bucket:window.bucket, window:window.window, status:'insufficient-history',
      asOf:quota.checkedAt, observedMinutes:null, percentagePointsPerHour:null,
      remainingMinutes:null, estimatedExhaustionAt:null};
    if (quota.status !== 'ok' || !Number.isFinite(asOf) || asOf > now || now-asOf >= 10*minute) {
      return {...result,status:'stale'};
    }
    if (!percent(window.remainingPercent)) return result;
    const reset = timestamp(window.resetsAt);
    if (Number.isFinite(reset) && reset <= now) return {...result,status:'reset-pending'};
    if (window.remainingPercent === 0) return {...result,status:'exhausted',remainingMinutes:0};
    let segment = [];
    for (const sample of Array.isArray(quota.history) ? quota.history : []) {
      const at = timestamp(sample?.checkedAt);
      const matches = (Array.isArray(sample?.windows) ? sample.windows : []).filter(row =>
        row?.bucket === window.bucket && row.window === window.window);
      const row = matches.length === 1 ? matches[0] : null;
      if (!Number.isFinite(at) || at > asOf || !row || !percent(row.remainingPercent) ||
          row.resetsAt !== window.resetsAt || row.durationMinutes !== window.durationMinutes) {
        segment = []; continue;
      }
      const previous = segment.at(-1);
      if (previous && (at <= previous.at || at-previous.at > 10*minute || row.remainingPercent > previous.remaining)) segment = [];
      segment.push({at,remaining:row.remainingPercent});
    }
    // Use actual endpoints within the last hour, without interpolating across
    // missing observations, resets, corrections or duplicate timestamps.
    segment = segment.filter(point => point.at >= asOf-60*minute);
    const first = segment[0], last = segment.at(-1);
    if (segment.length < 3 || last.at !== asOf || last.remaining !== window.remainingPercent ||
        last.at-first.at < 15*minute) return result;
    const observedMinutes = (last.at-first.at)/minute;
    const rate = (first.remaining-last.remaining)*60/observedMinutes;
    const measured = {...result,observedMinutes,percentagePointsPerHour:rate};
    if (rate === 0) return {...measured,status:'no-recent-consumption'};
    if (!Number.isFinite(reset)) return {...measured,status:'reset-unknown'};
    const exhaustion = asOf + window.remainingPercent/rate*60*minute;
    if (reset <= exhaustion) return {...measured,status:'resets-first'};
    if (exhaustion <= now) return {...measured,status:'awaiting-observation'};
    return {...measured,status:'projected',remainingMinutes:Math.ceil((exhaustion-now)/minute),
      estimatedExhaustionAt:new Date(exhaustion).toISOString()};
  });
}
