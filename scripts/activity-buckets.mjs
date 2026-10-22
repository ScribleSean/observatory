export function selectActivityPairs(buckets, hostnames) {
  const normalize = value => typeof value === 'string' ? value.toLowerCase().replace(/\.local$/, '') : '';
  const local = new Set(hostnames.map(normalize).filter(Boolean));
  const groups = new Map();
  for (const bucket of buckets) {
    if (!['currentwindow', 'afkstatus'].includes(bucket.type)) continue;
    if (!local.has(normalize(bucket.hostname))) continue;
    if (typeof bucket.id !== 'string' || !bucket.id || bucket.id.length > 512) throw Error('Invalid activity bucket');
    const key = bucket.hostname;
    if (!groups.has(key)) groups.set(key, { windows: [], afks: [] });
    groups.get(key)[bucket.type === 'currentwindow' ? 'windows' : 'afks'].push(bucket.id);
  }
  if (!groups.size || groups.size > 8) throw Error('No bounded local activity pairs');
  return [...groups.values()].map(({windows, afks}) => {
    if (windows.length !== 1 || afks.length !== 1) throw Error('Ambiguous local activity pair');
    return {window: windows[0], afk: afks[0]};
  });
}

export function activityCombinations(pairs) {
  if (!Array.isArray(pairs) || !pairs.length || pairs.length > 8) throw Error('No bounded local activity pairs');
  return pairs.flatMap(({window}) => pairs.map(({afk}) => ({window, afk})));
}

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
