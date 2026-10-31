// Keep the fictional UTC sample current whenever the dashboard loads it.
const isHours = hours => Array.isArray(hours) && hours.length === 24 && hours.every(value => Number.isFinite(value) && value >= 0);

// Spread a reading day's total over the UTC hours elapsed by the reading, so the hour
// that was current at build time does not decide which hours hold the sample's total.
/** @param {number[]} hours @param {number} reading @returns {number[]} */
function spreadToReading(hours, reading) {
  const total = hours.reduce((sum, value) => sum + value, 0);
  const elapsed = Math.max(1, (reading - new Date(reading).setUTCHours(0, 0, 0, 0)) / 1000);
  const upTo = hour => Math.floor(total * Math.min(hour * 3600, elapsed) / elapsed);
  return hours.map((_, hour) => upTo(hour + 1) - upTo(hour));
}

/**
 * @template {{demo?: boolean, generatedAt?: string}} T
 * @param {T} data
 * @param {number} now
 * @returns {T}
 */
export function shiftDemoClock(data, now = Date.now()) {
  if (data?.demo !== true) return data;
  const built = Date.parse(data.generatedAt ?? '');
  if (!Number.isFinite(built) || !Number.isFinite(now)) return data;
  const offset = now - built;
  // Calendar days must follow today's UTC date, including across midnight.
  const dayOffset = (Math.floor(now / 86400000) - Math.floor(built / 86400000)) * 86400000;
  /** @param {unknown} value @returns {unknown} */
  function shift(value) {
    if (typeof value === 'string') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(Date.parse(value) + dayOffset).toISOString().slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value)))
        return new Date(Date.parse(value) + offset).toISOString();
    }
    if (Array.isArray(value)) return value.map(shift);
    if (value && typeof value === 'object') {
      const row = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shift(item)]));
      const reading = typeof row.checkedAt === 'string' ? Date.parse(row.checkedAt) : NaN;
      if (Array.isArray(row.days) && Number.isFinite(reading)) {
        const date = new Date(reading).toISOString().slice(0, 10);
        row.days = row.days.map(day => day?.date === date && isHours(day.hours) ? { ...day, hours: spreadToReading(day.hours, reading) } : day);
      }
      return row;
    }
    return value;
  }
  return /** @type {T} */ (shift(data));
}
