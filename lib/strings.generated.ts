// Generated from lib/strings.json by scripts/build-strings.mjs.
export const STRINGS = {
  "app": {
    "title": "Observatory"
  },
  "sections": {
    "limits": "Limits",
    "activity": "Activity",
    "tokens": "Tokens",
    "dictation": "Dictation",
    "sources": "Sources",
    "settings": "Settings",
    "navigation": "Sections",
    "emptyState": "This section is not built yet."
  },
  "periods": {
    "now": "Now",
    "day": "Day",
    "week": "Week",
    "month": "Month",
    "all": "All time"
  },
  "devices": {
    "all": "All",
    "macOS": "macOS",
    "windows": "Windows",
    "device": "Device",
    "period": "Period"
  },
  "providers": {
    "claudeCode": "Claude Code",
    "codex": "Codex"
  },
  "actions": {
    "refresh": "Refresh",
    "checkUpdates": "Check for updates",
    "settings": "Settings",
    "openObservatory": "Open Observatory",
    "navigation": "Actions"
  },
  "labels": {
    "limits": "Limits",
    "remaining": "remaining",
    "totals": "Totals",
    "tokens": "Tokens",
    "screenTime": "Screen time",
    "apiEstimate": "Codex API-equivalent (estimate)",
    "sampleData": "Sample data",
    "skin": "Skin",
    "sourcesRead": "sources read",
    "waiting": "Waiting for the first collection",
    "loading": "Loading",
    "refreshing": "Refreshing",
    "noSnapshot": "No snapshot yet"
  },
  "status": {
    "unknown": "Unknown",
    "noRecords": "No records",
    "byDevice": "By device",
    "notCollected": "Not collected yet",
    "enableLimits": "Turn on limits in Settings",
    "signIn": "Sign in to {name}",
    "noReading": "No reading available",
    "resetUnknown": "Reset time unknown",
    "readingUnknown": "reading time unknown",
    "hourlyUnavailable": "Hourly totals are not collected yet",
    "allUnverified": "All needs verified records from every device",
    "unknownWindow": "Unknown window",
    "updatedUnknown": "Updated: Unknown",
    "updateAhead": "Update time is ahead of this device",
    "updatedNow": "Updated just now",
    "updatedAgo": "Updated {age} ago"
  },
  "formats": {
    "weekly": "weekly",
    "day": "{value}-day",
    "hour": "{value}-hour",
    "minute": "{value}-minute",
    "minutes": "{minutes}m",
    "hoursMinutes": "{hours}h {minutes}m",
    "daysHours": "{days}d {hours}h",
    "trillion": "T",
    "billion": "B",
    "million": "M",
    "thousand": "K",
    "compact": "{value}{suffix}",
    "percent": "{value}%",
    "usd": "${value}",
    "resetsIn": "Resets in {span}",
    "runsOut": "runs out in about {span}",
    "asOf": "as of {time}",
    "sourcesRead": "{read} of {total} sources read",
    "separator": " · ",
    "filledBlock": "█",
    "emptyBlock": "░"
  },
  "charts": {
    "item": "Item",
    "value": "Value",
    "showValues": "Show values"
  },
  "sources": {
    "statusOk": "Read",
    "statusNotConnected": "Not connected",
    "statusPartial": "Partial coverage",
    "statusUnavailable": "Unavailable",
    "statusNotFound": "Not found",
    "statusStale": "Saved reading",
    "statusNeedsAuth": "Sign in required",
    "statusUnsupported": "Not supported",
    "statusRateLimited": "Usage check rate-limited",
    "privateRefusal": "A private folder check failed, so this source was not read.",
    "ancestorRefusal": "A private folder check failed at a parent folder, so this source was not read.",
    "checkedNow": "Checked just now",
    "checkedAgo": "Checked {age} ago",
    "checkAhead": "Check time is ahead of this device",
    "checkUnknown": "Last check: Unknown",
    "claudeLimits": "Claude Code limits",
    "codexLimits": "Codex limits",
    "codexTokens": "Codex tokens",
    "claudeTokens": "Claude Code tokens",
    "modelSettings": "Model settings",
    "noConnected": "No sources are connected",
    "noRecords": "No source records",
    "statusCount": "{word}: {count}",
    "namedDevice": "{name} ({platform})"
  },
  "dictation": {
    "allTools": "All tools",
    "allDevices": "All devices",
    "tool": "Tool",
    "records": "Records",
    "words": "Words",
    "audio": "Recorded audio time",
    "chartTitle": "Recorded audio time by day",
    "partial": "{value} (partial)",
    "caveat": "Device histories may overlap, so they are not added together.",
    "detail": "Missing dates are gaps, not zeros. Transcripts, recordings and credentials are not collected.",
    "info": "About dictation records",
    "noMatch": "No dictation records match these filters"
  },
  "activity": {
    "nowCaveat": "Now adds the previous clock hour to the current one up to the last reading, so it covers 60 to 120 minutes ending at that reading.",
    "zoneCaveat": "Days and hours follow the {zone} clock until device time zones are supported.",
    "hourlyTitle": "Screen time by hour, {zone} clock",
    "dailyTitle": "Screen time by day",
    "date": "Date",
    "categoriesTitle": "Categories and recorded apps",
    "recordedApps": "Recorded apps",
    "deviceOverlap": "Device overlap",
    "noCategories": "No category breakdown available",
    "noTracking": "No tracking records for this date. Zero recorded activity does not establish inactivity.",
    "foregroundNote": "Recorded foreground time, not attention. Combined activity counts device overlap once.",
    "missingDates": "Missing dates are Unknown, not zero.",
    "windowOf": "of the last {span}",
    "details": "Details",
    "nowStale": "The last reading is more than 10 minutes old",
    "nowHourAfter": "No reading yet in the current clock hour",
    "nowNoHours": "Hourly totals are missing for this period",
    "nowDaylight": "Unavailable during a daylight saving change",
    "nowNoReading": "Reading time unknown",
    "nowAhead": "The last reading is ahead of this device's clock",
    "nowZone": "Time zone unknown",
    "nowNoSource": "Not collected yet",
    "trackingTitle": "Tracking",
    "trackingRecent": "Recent tracking coverage",
    "trackingStale": "Tracking is not current",
    "trackingUnknown": "Tracking freshness unknown",
    "trackingUnavailable": "Source unavailable",
    "trackingRecentDetail": "Tracking coverage observed within 10 minutes of collection. This includes idle time, not just active use.",
    "trackingRecentCombinedDetail": "At least one device had tracking coverage within 10 minutes of collection. This does not verify every device.",
    "trackingStaleDetail": "No recent tracking coverage at collection. The device may be asleep, offline, or its watchers stopped. Saved history is retained.",
    "trackingUnknownDetail": "Tracking freshness is unknown. A successful historical read does not prove that watchers are running.",
    "trackingUnavailableDetail": "The source could not be read. Saved history is retained.",
    "lastCoverage": "Last tracking coverage: {time}",
    "lastCollection": "Last successful collection: {time}",
    "helpTitle": "ActivityWatch help",
    "help": "ActivityWatch is a separate application. Install and run it on the device you want to track, enable ActivityWatch in Observatory Settings, then refresh sources. If it is already running, check its local server on port 5600. Missing readings remain Unknown. Tokens and Limits can be used independently.",
    "helpAddress": "activitywatch.net"
  }
} as const;

export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{([a-z][A-Za-z0-9]*)\}/g, (_, name) => {
    if (!Object.hasOwn(values, name)) throw new Error(`Missing placeholder: ${name}`);
    return String(values[name]);
  });
}
