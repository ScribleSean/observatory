// macOS renames the computer when the network changes (Bonjour, DHCP or Tailscale
// names), and a watcher keeps the name it started with, so one computer's history is split across
// several window and AFK buckets. Every local bucket that was running during the read is paired with
// every other, and the time they share is counted once (scripts/activity-timeline.mjs), so the history
// stays continuous across names. `hosts` (activity.hosts in the settings) keeps only the named ones.
const synced = bucket => /synced/i.test(bucket.id) || bucket.data?.readonly === true;
const TYPES = ['currentwindow', 'afkstatus'];
const hostOf = bucket => typeof bucket.hostname === 'string' && bucket.hostname ? bucket.hostname : String(bucket.id).replace(/^aw-watcher-[a-z]+_/, '');

/** The local window and AFK buckets, optionally only those of the named ActivityWatch hosts. */
export function localBuckets(buckets, { hosts = null } = {}) {
  const valid = buckets.filter(bucket => bucket && TYPES.includes(bucket.type) && !synced(bucket));
  for (const bucket of valid) if (typeof bucket.id !== 'string' || !bucket.id || bucket.id.length > 512) throw Error('Invalid activity bucket');
  return Array.isArray(hosts) ? valid.filter(bucket => hosts.includes(hostOf(bucket))) : valid;
}

/**
 * Window and AFK bucket pairs to read for the time from `since` to `until` (ms, either may be null).
 * A bucket counts when its life (created to last updated) overlaps that time.
 */
export function localActivityPairs(buckets, { since = null, until = null, hosts = null } = {}) {
  const valid = localBuckets(buckets, { hosts });
  const overlaps = bucket => {
    const created = Date.parse(bucket.created), updated = Date.parse(bucket.last_updated);
    return (since === null || !(updated < since)) && (until === null || !(created > until));
  };
  const recent = since === null && until === null ? valid : valid.filter(overlaps);
  const chosen = TYPES.every(type => recent.some(bucket => bucket.type === type)) ? recent : valid;
  const windows = chosen.filter(bucket => bucket.type === 'currentwindow').map(bucket => bucket.id);
  const afks = chosen.filter(bucket => bucket.type === 'afkstatus').map(bucket => bucket.id);
  if (!windows.length || !afks.length) throw Error('No local activity watchers');
  if (windows.length > 8 || afks.length > 8) throw Error('Too many local activity watchers');
  return windows.flatMap(window => afks.map(afk => ({ window, afk })));
}

/** The first moment any local window bucket recorded, in ms, or null. */
export function firstRecorded(buckets, { hosts = null } = {}) {
  const times = localBuckets(buckets, { hosts }).filter(bucket => bucket.type === 'currentwindow').map(bucket => Date.parse(bucket.created)).filter(Number.isFinite);
  return times.length ? Math.min(...times) : null;
}
