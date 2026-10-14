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
    internal static class Settings
    {
        internal const string Sources = "Sources to collect";
        internal const string Accounts = "Accounts";
        internal const string Devices = "Devices and sharing";
        internal const string Startup = "Startup";
        internal const string About = "About and updates";
        internal const string Activity = "ActivityWatch";
        internal const string Codex = "Codex";
        internal const string Claude = "Claude Code";
        internal const string Wispr = "Wispr Flow";
        internal const string CodexLimits = "Codex limits";
        internal const string ClaudeLimits = "Claude Code limits";
        internal const string ShareCodexLimits = "Share Codex limits";
        internal const string ShareClaudeTokens = "Share Claude Code tokens";
        internal const string Unknown = "Unknown";
        internal const string AppOnly = "Open settings inside the Observatory app to make changes.";
        internal const string On = "On";
        internal const string Off = "Off";
        internal const string Working = "Working";
        internal const string DisclosureHints = "Claude Code hides most footer keyboard hints while a custom status line is configured.";
        internal const string DisclosureReadings = "Readings arrive only while a Claude Code session is responding, and only for Pro and Max subscriptions.";
        internal const string DisclosureSharing = "These limits apply to the whole account. They are observed on this device and are not sent to a paired device.";
        internal const string TurnOn = "Turn on";
        internal const string Cancel = "Cancel";
        internal const string DeviceName = "Device name";
        internal const string NameHint = "Up to 32 characters, and some symbols count as two. Leave it blank to show the platform name. Slashes, backslashes and colons are not allowed.";
        internal const string NameError = "Use up to 32 characters with no slashes, backslashes, colons or control characters.";
        internal const string FieldError = "Check the entered values. This change is not allowed.";
        internal const string Save = "Save";
        internal const string Tailscale = "Check Tailscale";
        internal const string Pairing = "Pairing";
        internal const string PairDevice = "Pair a device";
        internal const string Host = "Host on this device";
        internal const string Join = "Join with an invitation";
        internal const string Identity = "Create device identity";
        internal const string Address = "This device's address";
        internal const string Port = "This device's sync port";
        internal const string Start = "Start";
        internal const string Invitation = "Invitation";
        internal const string InvitationWarning = "Share privately. Clipboard managers may retain copied invitations. It expires within ten minutes.";
        internal const string CopyInvitation = "Copy invitation";
        internal const string Fingerprint = "Peer fingerprint";
        internal const string PeerAddress = "Peer address";
        internal const string PeerPort = "Peer port";
        internal const string Confirm = "Confirm";
        internal const string Claim = "Claim";
        internal const string Disconnect = "Disconnect";
        internal const string Repair = "Repair";
        internal const string Sharing = "Sharing";
        internal const string StartAtLogin = "Start at login";
        internal const string Version = "Version";
        internal const string Build = "Build";
        internal const string CheckUpdates = "Check for updates";
        internal const string Appearance = "Appearance";
        internal const string System = "System";
        internal const string Light = "Light";
        internal const string Dark = "Dark";
        internal const string Skin = "Skin";
        internal const string Sage = "Sage";
        internal const string Almanac = "Almanac";
        internal const string Instrument = "Instrument";
        internal const string AmberCrt = "Amber CRT";
        internal const string ExportData = "Export data";
        internal const string Busy = "Another change is in progress. Try again in a moment.";
        internal const string Cancelled = "Cancelled";
        internal const string Unavailable = "This change could not be made.";
        internal const string Refused = "This change is not allowed.";
        internal const string TimedOut = "No answer from the app yet.";
        internal const string Expired = "The invitation has expired.";
        internal const string Done = "Done";
        internal const string Ready = "Ready";
        internal const string PairingUnavailable = "Pair a device before enabling sharing.";
        internal const string AccountUnavailable = "The account is unavailable.";
        internal const string SourceUnavailable = "The source is unavailable.";
        internal const string PairIdle = "Ready to pair";
        internal const string PairIdentityReady = "Device identity ready";
        internal const string PairIdentityRequired = "Device identity required";
        internal const string PairIdentityRecoveryRequired = "Device identity recovery required";
        internal const string PairInactive = "Pairing inactive";
        internal const string PairWaiting = "Waiting for a device";
        internal const string PairConfirming = "Confirm the invitation";
        internal const string PairAwaitingConfirmation = "Confirm the peer device";
        internal const string PairLocalReady = "Local device ready";
        internal const string PairAcknowledged = "Peer acknowledged";
        internal const string PairConfigurationReady = "Configuration ready";
        internal const string PairWorking = "Pairing in progress";
        internal const string PairCancelled = "Pairing cancelled";
        internal const string PairPaired = "Paired";
        internal const string PairUnpaired = "Unpaired";
        internal const string PairUnavailable = "Pairing unavailable";
        internal const string TailscaleRunning = "Tailscale is running.";
        internal const string TailscaleOffline = "Tailscale is offline.";
        internal const string TailscaleNeedsLogin = "Sign in to Tailscale.";
        internal const string TailscaleNeedsDeviceApproval = "Tailscale needs device approval.";
        internal const string TailscaleStopped = "Tailscale is stopped.";
        internal const string TailscaleStarting = "Tailscale is starting.";
        internal const string TailscaleOtherUser = "Tailscale is in use by another user.";
        internal const string TailscaleNotInstalled = "Tailscale is not installed.";
        internal const string TailscaleUnsupported = "Tailscale is unsupported.";
        internal const string TailscaleUnavailable = "Tailscale status is unavailable.";
    }
}
