// How old a reading may be and still count as current. Every view, the
// collectors and both native apps use these two numbers. The native apps
// cannot import this file, so glance/mac/Glance.swift (readingFresh,
// deviceFresh) and glance/windows/Glance.cs (ReadingFreshMinutes,
// DeviceFreshMinutes) copy them, and test/repo-rules.test.mjs fails when a
// copy differs or when a new literal threshold appears anywhere else.

// A limit or source reading.
export const READING_FRESH_MS = 10 * 60000;
// A computer's snapshot, and the combined file built from it.
export const DEVICE_FRESH_MS = 15 * 60000;

// A reading from the future never counts.
export const readingFresh = (checked, now) => Number.isFinite(checked) && now >= checked && now - checked < READING_FRESH_MS;

export const snapshotFresh = (at, now) => Number.isFinite(at) && now - at <= DEVICE_FRESH_MS;
