// Generated from lib/strings.json by scripts/build-strings.mjs.
namespace WorkspaceObservatory;

internal static class ObservatoryStrings
{
    internal static class App
    {
        internal const string Title = "Observatory";
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
    internal static class Sources
    {
        internal const string StatusOk = "Read";
        internal const string StatusNotConnected = "Not connected";
        internal const string StatusPartial = "Partial coverage";
        internal const string StatusUnavailable = "Unavailable";
        internal const string StatusNotFound = "Not found";
        internal const string StatusStale = "Saved reading";
        internal const string StatusNeedsAuth = "Sign in required";
        internal const string StatusUnsupported = "Not supported";
        internal const string StatusRateLimited = "Usage check rate-limited";
        internal const string PrivateRefusal = "A private folder check failed, so this source was not read.";
        internal const string AncestorRefusal = "A private folder check failed at a parent folder, so this source was not read.";
        internal const string CheckedNow = "Checked just now";
        internal const string CheckedAgo = "Checked {age} ago";
        internal const string CheckAhead = "Check time is ahead of this device";
        internal const string CheckUnknown = "Last check: Unknown";
        internal const string ClaudeLimits = "Claude Code limits";
        internal const string CodexLimits = "Codex limits";
        internal const string CodexTokens = "Codex tokens";
        internal const string ClaudeTokens = "Claude Code tokens";
        internal const string ModelSettings = "Model settings";
        internal const string NoConnected = "No sources are connected";
        internal const string NoRecords = "No source records";
        internal const string StatusCount = "{word}: {count}";
        internal const string NamedDevice = "{name} ({platform})";
    }
    internal static class Dictation
    {
        internal const string AllTools = "All tools";
        internal const string AllDevices = "All devices";
        internal const string Tool = "Tool";
        internal const string Records = "Records";
        internal const string Words = "Words";
        internal const string Audio = "Recorded audio time";
        internal const string ChartTitle = "Recorded audio time by day";
        internal const string Partial = "{value} (partial)";
        internal const string Caveat = "Device histories may overlap, so they are not added together.";
        internal const string Detail = "Missing dates are gaps, not zeros. Transcripts, recordings and credentials are not collected.";
        internal const string Info = "About dictation records";
        internal const string NoMatch = "No dictation records match these filters";
    }
}
