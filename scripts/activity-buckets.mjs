

// macOS renames the computer when the network changes (Bonjour, DHCP or Tailscale
// names), and a watcher keeps the name it started with, so matching by hostname
// can pair an active window watcher with an idle watcher that stopped weeks ago.
export function localActivityPairs(buckets, { since = null } = {}) {
  const synced = bucket => /synced/i.test(bucket.id) || bucket.data?.readonly === true;
  const valid = buckets.filter(bucket => bucket && ['currentwindow', 'afkstatus'].includes(bucket.type) && !synced(bucket));
  for (const bucket of valid) if (typeof bucket.id !== 'string' || !bucket.id || bucket.id.length > 512) throw Error('Invalid activity bucket');
  const recent = since === null ? valid : valid.filter(bucket => Date.parse(bucket.last_updated) >= since);
  const chosen = ['currentwindow', 'afkstatus'].every(type => recent.some(bucket => bucket.type === type)) ? recent : valid;
  const windows = chosen.filter(bucket => bucket.type === 'currentwindow').map(bucket => bucket.id);
  const afks = chosen.filter(bucket => bucket.type === 'afkstatus').map(bucket => bucket.id);
  if (!windows.length || !afks.length) throw Error('No local activity watchers');
  if (windows.length > 8 || afks.length > 8) throw Error('Too many local activity watchers');
  return windows.flatMap(window => afks.map(afk => ({ window, afk })));
}
