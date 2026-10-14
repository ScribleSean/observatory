// Generated from lib/strings.json by scripts/build-strings.mjs.
export const STRINGS = {
  "app": {
    "title": "Observatory"
  },
  "limits": {
    "deviceNamed": "{name} ({platform})",
    "nowCaption": "Pace over the last hour",
    "perHour": "{value}% per hour",
    "belowTenth": "<0.1",
    "resetsFirst": "Resets before running out at this pace.",
    "exhausted": "No limit was left at the last reading.",
    "stale": "The reading is too old to estimate pace.",
    "insufficientHistory": "More readings are needed to estimate pace.",
    "noRecentConsumption": "No use was observed in the last hour.",
    "resetUnknown": "The reset time is unknown.",
    "resetPending": "Waiting for the reset to be observed.",
    "awaitingObservation": "Waiting for a new reading.",
    "sessionCost": "Session cost (estimate)",
    "history": "History",
    "chartTitle": "{provider} {window} remaining",
    "historyCaveat": "History covers the readings this device keeps, about the latest 24 hours.",
    "historyInfo": "About history",
    "historyDetail": "Each point is the last reading in its interval and an interval without a reading is a gap, never zero percent.",
    "sharedFrom": "Shared from {device}",
    "observed": "Observed {span} ago",
    "observationUnknown": "Observation time unknown"
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
  }
} as const;

export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{([a-z][A-Za-z0-9]*)\}/g, (_, name) => {
    if (!Object.hasOwn(values, name)) throw new Error(`Missing placeholder: ${name}`);
    return String(values[name]);
  });
}
