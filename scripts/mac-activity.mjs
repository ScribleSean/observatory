import { localActivityPairs, localBuckets, firstRecorded } from './activity-buckets.mjs';
import { appLabel } from './activity-timeline.mjs';
import { numeric, category, cleanActivity } from './snapshot-clean.mjs';
import { appClassifier, ruleLabels } from '../lib/my-apps.mjs';

export const ACTIVITYWATCH = 'http://127.0.0.1:5600/api/0';
// The title aw-watcher-window records for every window while its exclude_title setting is on.
export const HIDDEN_TITLE = 'excluded';
async function api(suffix, body) {
  const r = await fetch(ACTIVITYWATCH + suffix, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw Error('ActivityWatch unavailable');
  return r.json();
}

/**
 * Screen time from ActivityWatch for `start` to `end` (default: the last 7 days), every local watcher included.
 * With my-apps rules, each window is labeled from its app and title here, and only the label leaves this function:
 * titles stay in ActivityWatch.
 * @param {{raw?: boolean, rules?: object[], hosts?: string[] | null, start?: Date, end?: Date, request?: typeof api}} [options]
 */
export async function macActivity({ raw = false, rules = [], hosts = null, start = null, end = null, request = api } = {}) {
  const buckets = Object.values(await request('/buckets/'));
  end ??= new Date(); start ??= new Date(end - 7 * 86400000);
  const pairs = localActivityPairs(buckets, { since: start.getTime(), until: end.getTime(), hosts });
  const classify = rules.length ? appClassifier(rules) : null;
  const reports = await Promise.all(pairs.map(async ({window:w,afk:a}) => {
  const q = `w = query_bucket(${JSON.stringify(w)}); a = query_bucket(${JSON.stringify(a)}); a = filter_keyvals(a, "status", ["not-afk"]); RETURN = filter_period_intersect(w, a);`;
  const [events] = await request('/query/', {
    query: [q],
    timeperiods: [`${start.toISOString()}/${end.toISOString()}`],
  });
  const intervals = events.map(e => {
    if (numeric(e.duration) === null) throw Error('Invalid duration');
    const kind = category(String(e.data?.app));
    return { start: e.timestamp, end: new Date(Date.parse(e.timestamp) + e.duration * 1000).toISOString(), category: kind, app:appLabel(e.data?.app),
      ...(classify ? { label: classify({ app: e.data?.app, title: e.data?.title, browser: kind === 'Browser' }), hidden: e.data?.title === HIDDEN_TITLE } : {}) };
  });
  const [observed] = await request('/query/', {
    query:[`w = query_bucket(${JSON.stringify(w)}); a = query_bucket(${JSON.stringify(a)}); RETURN = filter_period_intersect(w, a);`],
    timeperiods:[`${start.toISOString()}/${end.toISOString()}`],
  });
  const trackingIntervals = observed.map(e=>{
    if (numeric(e.duration)===null) throw Error('Invalid tracking duration');
    return {start:e.timestamp,end:new Date(Date.parse(e.timestamp)+e.duration*1000).toISOString()};
  });
  const latest = await request(`/buckets/${encodeURIComponent(w)}/events?limit=1`);
  return {intervals,trackingIntervals,latestEvent:latest[0]?.timestamp};
  }));
  const report={
    intervals:reports.flatMap(r=>r.intervals),
    trackingIntervals:reports.flatMap(r=>r.trackingIntervals),
    start:start.toISOString(), end:end.toISOString(),
    latestEvent:reports.map(r=>r.latestEvent).filter(v=>Number.isFinite(Date.parse(v))).sort((a,b)=>Date.parse(a)-Date.parse(b)).at(-1),
    ...(classify ? { labels: ruleLabels(rules) } : {}),
    firstRecorded: firstRecorded(buckets, { hosts }),
  };
  return raw?report:cleanActivity(report,'Mac');
}

/**
 * Every local window event newer than `after[bucket]` (an ISO time, or none for all), oldest first, without each
 * bucket's newest event, which ActivityWatch may still lengthen. For the raw archive (scripts/raw-archive.mjs).
 * @returns {Promise<{bucket: string, events: {id: unknown, timestamp: string, duration: number, data: object}[]}[]>}
 */
export async function windowEvents({ after = {}, hosts = null, request = api } = {}) {
  const buckets = localBuckets(Object.values(await request('/buckets/')), { hosts }).filter(bucket => bucket.type === 'currentwindow');
  return Promise.all(buckets.map(async bucket => {
    const since = after[bucket.id];
    const list = await request(`/buckets/${encodeURIComponent(bucket.id)}/events?limit=-1${since ? `&start=${encodeURIComponent(since)}` : ''}`);
    if (!Array.isArray(list)) throw Error('Invalid ActivityWatch events');
    const sorted = list.filter(e => e && Number.isFinite(Date.parse(e.timestamp)) && numeric(e.duration) !== null)
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    return { bucket: bucket.id, events: sorted.slice(0, -1).filter(e => !since || Date.parse(e.timestamp) > Date.parse(since)) };
  }));
}
