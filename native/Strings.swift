// Generated from lib/strings.json by scripts/build-strings.mjs.
enum ObservatoryStrings {
    enum App {
        static let `title` = "Observatory"
    }
    enum Limits {
        static let `deviceNamed` = "{name} ({platform})"
    }
    enum Sections {
        static let `limits` = "Limits"
        static let `activity` = "Activity"
        static let `tokens` = "Tokens"
        static let `dictation` = "Dictation"
        static let `sources` = "Sources"
        static let `settings` = "Settings"
        static let `navigation` = "Sections"
        static let `emptyState` = "This section is not built yet."
    }
    enum Periods {
        static let `now` = "Now"
        static let `day` = "Day"
        static let `week` = "Week"
        static let `month` = "Month"
        static let `all` = "All time"
    }
    enum Devices {
        static let `all` = "All"
        static let `macOS` = "macOS"
        static let `windows` = "Windows"
        static let `device` = "Device"
        static let `period` = "Period"
    }
    enum Providers {
        static let `claudeCode` = "Claude Code"
        static let `codex` = "Codex"
    }
    enum Actions {
        static let `refresh` = "Refresh"
        static let `checkUpdates` = "Check for updates"
        static let `settings` = "Settings"
        static let `openObservatory` = "Open Observatory"
        static let `navigation` = "Actions"
    }
    enum Labels {
        static let `limits` = "Limits"
        static let `remaining` = "remaining"
        static let `totals` = "Totals"
        static let `tokens` = "Tokens"
        static let `screenTime` = "Screen time"
        static let `apiEstimate` = "Codex API-equivalent (estimate)"
        static let `sampleData` = "Sample data"
        static let `skin` = "Skin"
        static let `sourcesRead` = "sources read"
        static let `waiting` = "Waiting for the first collection"
        static let `loading` = "Loading"
        static let `refreshing` = "Refreshing"
        static let `noSnapshot` = "No snapshot yet"
    }
    enum Status {
        static let `unknown` = "Unknown"
        static let `noRecords` = "No records"
        static let `byDevice` = "By device"
        static let `notCollected` = "Not collected yet"
        static let `enableLimits` = "Turn on limits in Settings"
        static let `signIn` = "Sign in to {name}"
        static let `noReading` = "No reading available"
        static let `resetUnknown` = "Reset time unknown"
        static let `readingUnknown` = "reading time unknown"
        static let `hourlyUnavailable` = "Hourly totals are not collected yet"
        static let `allUnverified` = "All needs verified records from every device"
        static let `unknownWindow` = "Unknown window"
        static let `updatedUnknown` = "Updated: Unknown"
        static let `updateAhead` = "Update time is ahead of this device"
        static let `updatedNow` = "Updated just now"
        static let `updatedAgo` = "Updated {age} ago"
    }
    enum Formats {
        static let `weekly` = "weekly"
        static let `day` = "{value}-day"
        static let `hour` = "{value}-hour"
        static let `minute` = "{value}-minute"
        static let `minutes` = "{minutes}m"
        static let `hoursMinutes` = "{hours}h {minutes}m"
        static let `daysHours` = "{days}d {hours}h"
        static let `trillion` = "T"
        static let `billion` = "B"
        static let `million` = "M"
        static let `thousand` = "K"
        static let `compact` = "{value}{suffix}"
        static let `percent` = "{value}%"
        static let `usd` = "${value}"
        static let `resetsIn` = "Resets in {span}"
        static let `runsOut` = "runs out in about {span}"
        static let `asOf` = "as of {time}"
        static let `sourcesRead` = "{read} of {total} sources read"
        static let `separator` = " · "
        static let `filledBlock` = "█"
        static let `emptyBlock` = "░"
    }
    enum Charts {
        static let `item` = "Item"
        static let `value` = "Value"
        static let `showValues` = "Show values"
    }
}
