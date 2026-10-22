import { localActivityPairs } from './activity-buckets.mjs';
import { appLabel } from './activity-timeline.mjs';
import { numeric, category, cleanActivity } from './snapshot-clean.mjs';
async function api(suffix, body) {
  const r = await fetch('http://127.0.0.1:5600/api/0' + suffix, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw Error('ActivityWatch unavailable');
  return r.json();
}
export async function macActivity({raw=false}={}) {
  const buckets = Object.values(await api('/buckets/'));
  const end = new Date(), start = new Date(end - 7 * 86400000);
  const pairs = localActivityPairs(buckets, { since: start.getTime() });
  const reports = await Promise.all(pairs.map(async ({window:w,afk:a}) => {
  const q = `w = query_bucket(${JSON.stringify(w)}); a = query_bucket(${JSON.stringify(a)}); a = filter_keyvals(a, "status", ["not-afk"]); RETURN = filter_period_intersect(w, a);`;
  const [events] = await api('/query/', {
    query: [q],
    timeperiods: [`${start.toISOString()}/${end.toISOString()}`],
  });
  const intervals = events.map(e => {
    if (numeric(e.duration) === null) throw Error('Invalid duration');
    return { start: e.timestamp, end: new Date(Date.parse(e.timestamp) + e.duration * 1000).toISOString(), category: category(String(e.data?.app)), app:appLabel(e.data?.app) };
  });
  const [observed] = await api('/query/', {
    query:[`w = query_bucket(${JSON.stringify(w)}); a = query_bucket(${JSON.stringify(a)}); RETURN = filter_period_intersect(w, a);`],
    timeperiods:[`${start.toISOString()}/${end.toISOString()}`],
  });
  const trackingIntervals = observed.map(e=>{
    if (numeric(e.duration)===null) throw Error('Invalid tracking duration');
    return {start:e.timestamp,end:new Date(Date.parse(e.timestamp)+e.duration*1000).toISOString()};
  });
  const latest = await api(`/buckets/${encodeURIComponent(w)}/events?limit=1`);
  return {intervals,trackingIntervals,latestEvent:latest[0]?.timestamp};
  }));
  const report={
    intervals:reports.flatMap(r=>r.intervals),
    trackingIntervals:reports.flatMap(r=>r.trackingIntervals),
    start:start.toISOString(), end:end.toISOString(),
    latestEvent:reports.map(r=>r.latestEvent).filter(v=>Number.isFinite(Date.parse(v))).sort((a,b)=>Date.parse(a)-Date.parse(b)).at(-1),
  };
  return raw?report:cleanActivity(report,'Mac');
}
