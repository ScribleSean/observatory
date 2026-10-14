// Generated from lib/strings.json by scripts/build-strings.mjs.
namespace WorkspaceObservatory;

internal static class ObservatoryStrings
{
    internal static class App
    {
        internal const string Title = "Observatory";
    }
    internal static class Limits
    {
        internal const string DeviceNamed = "{name} ({platform})";
        internal const string NowCaption = "Pace over the last hour";
        internal const string PerHour = "{value}% per hour";
        internal const string BelowTenth = "<0.1";
        internal const string ResetsFirst = "Resets before running out at this pace.";
        internal const string Exhausted = "No limit was left at the last reading.";
        internal const string Stale = "The reading is too old to estimate pace.";
        internal const string InsufficientHistory = "More readings are needed to estimate pace.";
        internal const string NoRecentConsumption = "No use was observed in the last hour.";
        internal const string ResetUnknown = "The reset time is unknown.";
        internal const string ResetPending = "Waiting for the reset to be observed.";
        internal const string AwaitingObservation = "Waiting for a new reading.";
        internal const string SessionCost = "Session cost (estimate)";
        internal const string History = "History";
        internal const string ChartTitle = "{provider} {window} remaining";
        internal const string HistoryCaveat = "History covers the readings this device keeps, about the latest 24 hours.";
        internal const string HistoryInfo = "About history";
        internal const string HistoryDetail = "Each point is the last reading in its interval and an interval without a reading is a gap, never zero percent.";
        internal const string SharedFrom = "Shared from {device}";
        internal const string Observed = "Observed {span} ago";
        internal const string ObservationUnknown = "Observation time unknown";
    }
    internal static class Sections
    {
        internal const string Limits = "Limits";
        internal const string Activity = "Activity";
        internal const string Tokens = "Tokens";
        internal const string Dictation = "Dictation";
        internal const string Sources = "Sources";
        internal const string Settings = "Settings";
        internal const string Navigation = "Sections";
        internal const string EmptyState = "This section is not built yet.";
    }
    internal static class Periods
    {
        internal const string Now = "Now";
        internal const string Day = "Day";
        internal const string Week = "Week";
        internal const string Month = "Month";
        internal const string All = "All time";
    }
    internal static class Devices
    {
        internal const string All = "All";
        internal const string MacOS = "macOS";
        internal const string Windows = "Windows";
        internal const string Device = "Device";
        internal const string Period = "Period";
    }
    internal static class Providers
    {
        internal const string ClaudeCode = "Claude Code";
        internal const string Codex = "Codex";
    }
    internal static class Actions
    {
        internal const string Refresh = "Refresh";
        internal const string CheckUpdates = "Check for updates";
        internal const string Settings = "Settings";
        internal const string OpenObservatory = "Open Observatory";
        internal const string Navigation = "Actions";
    }
    internal static class Labels
    {
        internal const string Limits = "Limits";
        internal const string Remaining = "remaining";
        internal const string Totals = "Totals";
        internal const string Tokens = "Tokens";
        internal const string ScreenTime = "Screen time";
        internal const string ApiEstimate = "Codex API-equivalent (estimate)";
        internal const string SampleData = "Sample data";
        internal const string Skin = "Skin";
        internal const string SourcesRead = "sources read";
        internal const string Waiting = "Waiting for the first collection";
        internal const string Loading = "Loading";
        internal const string Refreshing = "Refreshing";
        internal const string NoSnapshot = "No snapshot yet";
    }
    internal static class Status
    {
        internal const string Unknown = "Unknown";
        internal const string NoRecords = "No records";
        internal const string ByDevice = "By device";
        internal const string NotCollected = "Not collected yet";
        internal const string EnableLimits = "Turn on limits in Settings";
        internal const string SignIn = "Sign in to {name}";
        internal const string NoReading = "No reading available";
        internal const string ResetUnknown = "Reset time unknown";
        internal const string ReadingUnknown = "reading time unknown";
        internal const string HourlyUnavailable = "Hourly totals are not collected yet";
        internal const string AllUnverified = "All needs verified records from every device";
        internal const string UnknownWindow = "Unknown window";
        internal const string UpdatedUnknown = "Updated: Unknown";
        internal const string UpdateAhead = "Update time is ahead of this device";
        internal const string UpdatedNow = "Updated just now";
        internal const string UpdatedAgo = "Updated {age} ago";
    }
    internal static class Formats
    {
        internal const string Weekly = "weekly";
        internal const string Day = "{value}-day";
        internal const string Hour = "{value}-hour";
        internal const string Minute = "{value}-minute";
        internal const string Minutes = "{minutes}m";
        internal const string HoursMinutes = "{hours}h {minutes}m";
        internal const string DaysHours = "{days}d {hours}h";
        internal const string Trillion = "T";
        internal const string Billion = "B";
        internal const string Million = "M";
        internal const string Thousand = "K";
        internal const string Compact = "{value}{suffix}";
        internal const string Percent = "{value}%";
        internal const string Usd = "${value}";
        internal const string ResetsIn = "Resets in {span}";
        internal const string RunsOut = "runs out in about {span}";
        internal const string AsOf = "as of {time}";
        internal const string SourcesRead = "{read} of {total} sources read";
        internal const string Separator = " · ";
        internal const string FilledBlock = "█";
        internal const string EmptyBlock = "░";
    }
    internal static class Charts
    {
        internal const string Item = "Item";
        internal const string Value = "Value";
        internal const string ShowValues = "Show values";
    }
}
