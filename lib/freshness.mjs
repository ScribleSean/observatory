export const READING_FRESH_MS = 10 * 60000;
export const DEVICE_FRESH_MS = 15 * 60000;

export const readingFresh = (checked, now) => Number.isFinite(checked) && now >= checked && now - checked < READING_FRESH_MS;

export const snapshotFresh = (at, now) => Number.isFinite(at) && now - at <= DEVICE_FRESH_MS;
