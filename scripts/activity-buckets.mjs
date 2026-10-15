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
