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
  }
} as const;

export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{([a-z][A-Za-z0-9]*)\}/g, (_, name) => {
    if (!Object.hasOwn(values, name)) throw new Error(`Missing placeholder: ${name}`);
    return String(values[name]);
  });
}
