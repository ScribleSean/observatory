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
    internal static class Tokens
    {
        internal const string Input = "Input";
        internal const string Cached = "Cached input";
        internal const string CacheWrite = "Cache writes";
        internal const string Output = "Output";
        internal const string Total = "Total";
        internal const string Classes = "Token classes";
        internal const string ByModel = "By model";
        internal const string Model = "Model";
        internal const string ChartTitle = "{provider} tokens by day, last 30 days";
        internal const string ApiEstimate = "API-equivalent (estimate)";
        internal const string UnderCent = "Under $0.01";
        internal const string PricesChecked = "Prices checked {date}";
        internal const string PricesUnknown = "Price check date Unknown";
        internal const string Partial = "Covers {covered} of {total} tokens. Models without a price are left out.";
        internal const string SettingsTitle = "Recorded reasoning and speed";
        internal const string Effort = "Reasoning";
        internal const string Speed = "Speed";
        internal const string NoSettings = "No settings recorded";
        internal const string Caveat = "Dollar figures are estimates at list price. A subscription is not billed per token.";
        internal const string CaveatLabel = "About these figures";
        internal const string CaveatDetail = "The API-equivalent figure prices recorded tokens with the shared price table. A model with no price in the table is left out and is never counted as free. Session cost is the figure Claude Code reported for its latest session on this device.";
        internal const string DeviceNote = "Claude Code totals are shown per device until overlap between devices can be checked.";
    }
    internal static class Activity
    {
        internal const string NowCaveat = "Now adds the previous clock hour to the current one up to the last reading, so it covers 60 to 120 minutes ending at that reading.";
        internal const string ZoneCaveat = "Days and hours follow the {zone} clock until device time zones are supported.";
        internal const string HourlyTitle = "Screen time by hour, {zone} clock";
        internal const string DailyTitle = "Screen time by day";
        internal const string Date = "Date";
        internal const string CategoriesTitle = "Categories and recorded apps";
        internal const string RecordedApps = "Recorded apps";
        internal const string DeviceOverlap = "Device overlap";
        internal const string NoCategories = "No category breakdown available";
        internal const string NoTracking = "No tracking records for this date. Zero recorded activity does not establish inactivity.";
        internal const string ForegroundNote = "Recorded foreground time, not attention. Combined activity counts device overlap once.";
        internal const string MissingDates = "Missing dates are Unknown, not zero.";
        internal const string WindowOf = "of the last {span}";
        internal const string Details = "Details";
        internal const string NowStale = "The last reading is more than 10 minutes old";
        internal const string NowHourAfter = "No reading yet in the current clock hour";
        internal const string NowNoHours = "Hourly totals are missing for this period";
        internal const string NowDaylight = "Unavailable during a daylight saving change";
        internal const string NowNoReading = "Reading time unknown";
        internal const string NowAhead = "The last reading is ahead of this device's clock";
        internal const string NowZone = "Time zone unknown";
        internal const string NowNoSource = "Not collected yet";
        internal const string TrackingTitle = "Tracking";
        internal const string TrackingRecent = "Recent tracking coverage";
        internal const string TrackingStale = "Tracking is not current";
        internal const string TrackingUnknown = "Tracking freshness unknown";
        internal const string TrackingUnavailable = "Source unavailable";
        internal const string TrackingRecentDetail = "Tracking coverage observed within 10 minutes of collection. This includes idle time, not just active use.";
        internal const string TrackingRecentCombinedDetail = "At least one device had tracking coverage within 10 minutes of collection. This does not verify every device.";
        internal const string TrackingStaleDetail = "No recent tracking coverage at collection. The device may be asleep, offline, or its watchers stopped. Saved history is retained.";
        internal const string TrackingUnknownDetail = "Tracking freshness is unknown. A successful historical read does not prove that watchers are running.";
        internal const string TrackingUnavailableDetail = "The source could not be read. Saved history is retained.";
        internal const string LastCoverage = "Last tracking coverage: {time}";
        internal const string LastCollection = "Last successful collection: {time}";
        internal const string HelpTitle = "ActivityWatch help";
        internal const string Help = "ActivityWatch is a separate application. Install and run it on the device you want to track, enable ActivityWatch in Observatory Settings, then refresh sources. If it is already running, check its local server on port 5600. Missing readings remain Unknown. Tokens and Limits can be used independently.";
        internal const string HelpAddress = "activitywatch.net";
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
        internal const string CollectionPaused = "Collection paused";
        internal const string AppOnly = "Open settings inside the Observatory app to make changes.";
        internal const string On = "On";
        internal const string Off = "Off";
        internal const string Working = "Working";
        internal const string DisclosureHints = "Claude Code hides most of its footer keyboard hints while any custom status line is configured.";
        internal const string DisclosureReadings = "Readings arrive only while a Claude Code session is responding, and only for Pro and Max subscriptions.";
        internal const string DisclosureSharing = "The limits are account-wide. They are observed on this device and are not sent to a paired device.";
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
        internal const string PairJoinConfirm = "Confirm the invitation";
        internal const string PairHostConfirm = "Confirm the peer device";
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
    internal static class Setup
    {
        internal const string StatusUnavailable = "Observatory could not read its settings.";
        internal const string Retry = "Try again";
        internal const string Title = "Set up Observatory";
        internal const string StepLabel = "Step {step} of {count}";
        internal const string SourcesTitle = "Choose what to collect";
        internal const string SourcesIntro = "Turn on the sources this device should read. Everything starts off, and you can change it later in Settings.";
        internal const string SourcesNote = "ActivityWatch is installed separately and must be running. Each other source needs its own application and local records. Turning a source on does not prove it is available, and a source that cannot be read shows Unknown.";
        internal const string PrivacyNote = "Snapshots leave out prompts, window titles, transcripts, audio and credentials. Provider sign-ins stay on the device that owns them.";
        internal const string ActivityHint = "Screen time from ActivityWatch on this device.";
        internal const string CodexHint = "Token use from saved Codex sessions.";
        internal const string ClaudeHint = "Token use from saved Claude Code sessions.";
        internal const string WisprHint = "Dictation statistics from Wispr Flow.";
        internal const string QuotaHint = "Codex account limits, read online through the installed Codex sign-in without making model requests.";
        internal const string ClaudeLimitsHint = "Claude Code account limits, read from a status line that Observatory adds to Claude Code. Read the notes before turning it on.";
        internal const string PairingTitle = "Other devices";
        internal const string PairingIntro = "Pairing a second device is optional. You can pair later, in Settings.";
        internal const string PairingHow = "One device creates an invitation in Settings, and the other device pastes it. Observatory works on this device alone until then.";
        internal const string PairingNoAccount = "There is no Observatory account or hosted sync service.";
        internal const string FinishTitle = "Finish";
        internal const string FinishIntro = "Observatory collects from the sources that are on. You can change them later in Settings.";
        internal const string FinishNone = "No source is on. Each section shows Unknown until a source is turned on in Settings.";
        internal const string Back = "Back";
        internal const string Next = "Continue";
        internal const string Finish = "Finish";
        internal const string AppOnly = "Open Observatory to finish setup.";
    }
}
