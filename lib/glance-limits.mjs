// Mirrored by limitRemaining in both native apps. Draw time is the only clock.
export function limitRemaining(row, now = Date.now()) {
  const checked = Date.parse(row.checkedAt), reset = Date.parse(row.resetsAt);
  return row.stale === false && typeof row.remaining === 'number' &&
    Number.isFinite(row.remaining) && row.remaining >= 0 && row.remaining <= 100 &&
    Number.isFinite(checked) && now >= checked && now - checked < 10 * 60000 &&
    !(reset <= now) ? row.remaining : null;
}
