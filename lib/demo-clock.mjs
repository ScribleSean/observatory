// Keep the fictional UTC sample current whenever the dashboard loads it.
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
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shift(item)]));
    return value;
  }
  return /** @type {T} */ (shift(data));
}
