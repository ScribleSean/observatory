using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

// Reads the sanitized snapshot only. This migration view never opens raw logs.
internal sealed partial class NativeDashboard : Form
{
    private readonly Func<JsonObject?> read;
    private readonly Func<Task> refresh;
    private readonly Font regular = new("Segoe UI", 10);
    private readonly Font heading = new("Segoe UI", 22, FontStyle.Bold);
    private readonly ListBox sections = new() { Dock = DockStyle.Left, Width = 170, BorderStyle = BorderStyle.None, ItemHeight = 38 };
    private readonly FlowLayoutPanel body = new() { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoScroll = true, Padding = new Padding(24) };
    private string host = "Windows", period = "Day", anchor = "";
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 30000 };
    private bool busy;
    private readonly Label pageTitle = new() { Dock = DockStyle.Top, Height = 42 };
    private readonly Label freshness = new() { Dock = DockStyle.Fill };
    private readonly ToolTip timestampHint = new();
    private readonly Button refreshButton = new() { Text = "Refresh", AccessibleName = "Refresh sources", Dock = DockStyle.Right, Width = 110, FlatStyle = FlatStyle.Flat };
    private readonly Func<JsonObject, CancellationToken, Task<JsonObject>>? readArchive;

    internal NativeDashboard(Func<JsonObject?> read, Func<Task> refresh, SourceSettingsActions? sourceSettings = null, DeviceSettingsActions? deviceSettings = null,
        Func<JsonObject, CancellationToken, Task<JsonObject>>? readArchive = null)
    {
        this.read = read; this.refresh = refresh;
        this.readArchive = readArchive;
        this.sourceSettings = sourceSettings;
        this.deviceSettings = deviceSettings;
        Text = "Observatory"; AccessibleName = Text;
        Font = regular; BackColor = Color.FromArgb(30, 30, 32); ForeColor = Color.WhiteSmoke;
        var available = Screen.PrimaryScreen?.WorkingArea.Size ?? new Size(1280, 900);
        ClientSize = new Size(Math.Min(1100, available.Width - 48), Math.Min(780, available.Height - 80));
        MinimumSize = new Size(Math.Min(800, available.Width - 48), Math.Min(560, available.Height - 80));
        StartPosition = FormStartPosition.CenterScreen;
        sections.BackColor = Color.FromArgb(39, 39, 41); sections.ForeColor = ForeColor;
        sections.DrawMode = DrawMode.OwnerDrawFixed;
        sections.DrawItem += (_, args) =>
        {
            if (args.Index < 0) return;
            var selected = (args.State & DrawItemState.Selected) != 0;
            using var background = new SolidBrush(selected ? Color.FromArgb(58, 61, 68) : sections.BackColor);
            args.Graphics.FillRectangle(background, args.Bounds);
            TextRenderer.DrawText(args.Graphics, sections.Items[args.Index].ToString(), regular,
                new Rectangle(args.Bounds.X + 14, args.Bounds.Y, args.Bounds.Width - 20, args.Bounds.Height),
                ForeColor, TextFormatFlags.VerticalCenter | TextFormatFlags.Left);
            args.DrawFocusRectangle();
        };
        sections.AccessibleName = "Sections";
        sections.Items.AddRange(["Allowances", "Activity", "Tokens", "Dictation", "Agents", "Sources", "Settings"]);
        var content = new Panel { Dock = DockStyle.Fill };
        var header = new Panel { Dock = DockStyle.Top, Height = 104, Padding = new Padding(24, 16, 24, 8) };
        pageTitle.Font = heading;
        freshness.ForeColor = Color.Silver;
        refreshButton.BackColor = Color.FromArgb(64, 73, 61);
        refreshButton.FlatAppearance.BorderSize = 0;
        refreshButton.Click += async (_, _) =>
        {
            if (busy) return;
            busy = true; refreshButton.Enabled = false;
            try { await refresh(); }
            catch { if (!IsDisposed) MessageBox.Show(this, "Collection could not complete. Saved records remain available.", "Observatory"); }
            finally { busy = false; if (!IsDisposed) Reload(); }
        };
        header.Controls.Add(freshness); header.Controls.Add(pageTitle); header.Controls.Add(refreshButton);
        content.Controls.Add(body); content.Controls.Add(header);
        Controls.Add(content); Controls.Add(sections);
        sections.SelectedIndexChanged += (_, _) => { anchor = ""; Reload(); body.AutoScrollPosition = Point.Empty; };
        sections.SelectedIndex = 0;
        body.ClientSizeChanged += (_, _) => ResizeRows();
        timer.Tick += (_, _) =>
        {
            if (sections.SelectedItem?.ToString() == "Allowances" || (!ContainsFocus && sections.SelectedItem?.ToString() != "Settings")) Reload();
            else UpdateFreshness(read());
        };
        timer.Start();
    }
    private int ContentWidth => Math.Max(400, body.ClientSize.Width - 66);
    private void ResizeRows() { foreach (Control row in body.Controls) { row.Width = ContentWidth; if (row is Label label) label.MaximumSize = new Size(ContentWidth, 0); } }
    private Label Label(string value, bool title = false)
    {
        var label = new Label { Text = value, AccessibleName = value, AutoSize = true,
            MaximumSize = new Size(ContentWidth, 0), Margin = new Padding(0, 0, 0, 14), Font = title ? heading : regular };
        body.Controls.Add(label); return label;
    }
    private void Choice(string name, string[] values, string selected, Action<string> changed)
    {
        var row = new FlowLayoutPanel { Width = ContentWidth, Height = 42, WrapContents = false };
        row.Controls.Add(new Label { Text = name, AutoSize = true, Padding = new Padding(0, 7, 8, 0) });
        var choice = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 225, AccessibleName = name };
        choice.Items.AddRange(values); choice.SelectedItem = selected;
        choice.SelectedIndexChanged += (_, _) => { changed(choice.SelectedItem?.ToString() ?? ""); BeginInvoke(Reload); };
        row.Controls.Add(choice); body.Controls.Add(row);
    }
    private DataGridView Table(string name, string[] columns, IEnumerable<string[]> values)
    {
        var table = new DataGridView { Width = ContentWidth, Height = 235, ReadOnly = true,
            AllowUserToAddRows = false, AllowUserToDeleteRows = false, RowHeadersVisible = false,
            AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill, BackgroundColor = BackColor,
            BorderStyle = BorderStyle.None, AccessibleName = name, EnableHeadersVisualStyles = false,
            SelectionMode = DataGridViewSelectionMode.FullRowSelect };
        table.DefaultCellStyle.BackColor = BackColor; table.DefaultCellStyle.ForeColor = ForeColor;
        table.DefaultCellStyle.SelectionBackColor = Color.FromArgb(50, 80, 120);
        table.ColumnHeadersDefaultCellStyle.BackColor = Color.FromArgb(45, 45, 48); table.ColumnHeadersDefaultCellStyle.ForeColor = ForeColor;
        foreach (var column in columns) table.Columns.Add(column, column);
        foreach (var row in values) table.Rows.Add(row.Cast<object>().ToArray());
        table.Height = Math.Min(235, table.ColumnHeadersHeight + Math.Max(1, table.Rows.Count) * table.RowTemplate.Height + 4);
        body.Controls.Add(table); return table;
    }
    internal void Reload()
    {
        if (IsDisposed) return;
        body.SuspendLayout();
        try
        {
            foreach (var control in body.Controls.Cast<Control>().ToArray()) control.Dispose();
            var snapshot = read(); var section = sections.SelectedItem?.ToString() ?? "Allowances";
            pageTitle.Text = section;
            UpdateFreshness(snapshot);
            refreshButton.Enabled = !busy;
            if (section is "Activity" or "Tokens") History(snapshot, section == "Activity" ? "activity" : "tokens");
            else if (section == "Allowances") Allowances(snapshot);
            else if (section == "Dictation") Dictation(snapshot);
            else if (section == "Agents")
            {
                Label("Saved execution records, not a live agent monitor. Missing records are not zero usage.");
                var configure = new Button { Text = "Review collection settings", AutoSize = true, Height = 38 };
                configure.Click += (_, _) => sections.SelectedItem = "Settings";
                body.Controls.Add(configure);
                Agents(snapshot);
            }
            else if (section == "Settings") SourceSettings();
            else Sources(snapshot);
            Label("Native migration preview. Provider sign-ins remain in their owning applications.");
            ResizeRows();
        }
        finally { body.ResumeLayout(true); }
    }
    private void UpdateFreshness(JsonObject? snapshot)
    {
        var timestamp = Snapshot.Text(snapshot?["collectedAt"]);
        freshness.Text = Freshness(timestamp, DateTimeOffset.UtcNow);
        freshness.AccessibleDescription = "Snapshot collected at " + timestamp;
        timestampHint.SetToolTip(freshness, freshness.AccessibleDescription);
    }
    internal static void FreshnessSelfTest()
    {
        var now = DateTimeOffset.Parse("2026-01-01T12:00:00Z");
        if (Freshness("2026-01-01T11:56:00Z", now) != "Updated 4m ago" ||
            Freshness("missing", now) != "Updated: Unknown" ||
            !Freshness("2026-01-02T12:00:00Z", now).Contains("ahead"))
            throw new InvalidOperationException("Dashboard freshness contract failed.");
    }
    internal static string Freshness(string timestamp, DateTimeOffset now)
    {
        if (!DateTimeOffset.TryParse(timestamp, out var recorded)) return "Updated: Unknown";
        var age = now - recorded;
        if (age < TimeSpan.Zero) return "Update time is ahead of this device's clock";
        if (age.TotalMinutes < 1) return "Updated just now";
        if (age.TotalHours < 1) return $"Updated {(int)age.TotalMinutes}m ago";
        if (age.TotalDays < 1) return $"Updated {(int)age.TotalHours}h ago";
        return $"Updated {(int)age.TotalDays}d ago";
    }
    private void ActivityWatchHelp()
    {
        Label("ActivityWatch is a separate application. Install and run it on the device you want to track, enable ActivityWatch in Observatory Settings, then refresh sources. If it is already running, check its local server on port 5600. Missing readings remain Unknown. Tokens and Allowances can be used independently.");
        var link = new LinkLabel { Text = "ActivityWatch installation and help", AutoSize = true, LinkColor = Color.LightSkyBlue };
        link.LinkClicked += (_, _) =>
        {
            try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("https://activitywatch.net/") { UseShellExecute = true }); }
            catch { Label("Open https://activitywatch.net/ in your browser for installation help."); }
        };
        body.Controls.Add(link);
    }

    private void History(JsonObject? snapshot, string kind)
    {
        Choice("Device", ["All", "Mac", "Windows", "Ubuntu"], host, value => { host = value; anchor = ""; });
        Choice("Period", ["Day", "Week", "All retained"], period, value => period = value);
        var days = NativeHistory.Days(snapshot, kind, host);
        if (kind == "activity")
        {
            var archive = NativeHistory.Rows(snapshot?["activityHistory"]).FirstOrDefault(row => Snapshot.Text(row["host"]) == (host == "All" ? "Combined" : host));
            Label(Snapshot.Text(archive?["trackingMessage"], "Tracking freshness is unknown for this saved snapshot."));
            Label("Last tracking coverage: " + Snapshot.Text(archive?["trackingThrough"]));
            if (days.Length > 0 && archive is not null && Snapshot.Text(archive["latestReadStatus"]) != "ok") ActivityWatchHelp();
        }
        if (days.Length == 0) { Label("No verified records. Missing data is unknown, not zero."); if (kind == "activity") ActivityWatchHelp(); return; }
        var dates = days.Select(day => Snapshot.Text(day["date"])).ToArray();
        if (!dates.Contains(anchor)) anchor = dates[^1];
        if (period != "All retained") Choice(period == "Week" ? "Week ending" : "Recorded day", dates, anchor, value => anchor = value);
        var selected = NativeHistory.Select(days, period, anchor);
        var field = kind == "activity" ? "seconds" : "totalTokens";
        Label(kind == "activity" ? Snapshot.Duration(NativeHistory.Sum(selected, field)) : Snapshot.Format(NativeHistory.Sum(selected, field)) + " tokens", true);
        Label($"{selected.Length} recorded dates. Missing dates are not filled with zeros.");
        Table("Recorded history", ["Date", kind == "activity" ? "Active time" : "Tokens"], selected.Select(row => new[] {
            Snapshot.Text(row["date"]), kind == "activity" ? Snapshot.Duration(Snapshot.Number(row[field])) : Snapshot.Format(Snapshot.Number(row[field])) }));
        if (kind == "tokens")
        {
            Table("Token classes", ["Metric", "Tokens"], new[] { "inputTokens", "cacheReadTokens", "cacheCreationTokens", "outputTokens", "reasoningOutputTokens" }
                .Select(key => new[] { key, Snapshot.Format(NativeHistory.Sum(selected, key)) }));
            Table("Recorded models", ["Date", "Model", "Tokens"], selected.SelectMany(day => NativeHistory.Rows(day["models"]).Select(model => new[] {
                Snapshot.Text(day["date"]), Snapshot.Text(model["model"]) + (model["inferred"]?.ToJsonString() == "true" ? " (inferred)" : ""), Snapshot.Format(Snapshot.Number(model["totalTokens"])) })));
            Label("Reasoning is included in output. Tokens are not subscription charges. All-device totals require collector-verified deduplication.");
            TokenDetails(snapshot, selected);
        }
        else
        {
            Label("Foreground time does not measure attention. Combined activity counts device overlap once. WSL screen time belongs to Windows.");
            ActivityDetails(selected);
        }
    }
    private void Allowances(JsonObject? snapshot)
    {
        if (readArchive is not null)
        {
            var history = new Button { Text = "Browse saved allowance history", AutoSize = true };
            history.Click += (_, _) => { using var window = new QuotaArchiveWindow(readArchive); window.ShowDialog(this); };
            body.Controls.Add(history);
        }
        Label("Observed on this device");
        AccountAllowance(snapshot?["quota"] as JsonObject);
        if (snapshot?["peerQuota"] is JsonObject peer && Snapshot.Text(peer["host"]) is "Mac" or "Windows")
        {
            Label("Shared from " + Snapshot.Text(peer["host"]));
            Label("Received: " + Snapshot.Text(peer["receivedAt"]) + ". Separate account observation, never added to this device's totals.");
            AccountAllowance(peer);
        }
        else Label("No shared account history. Enable allowance sharing on both paired devices to receive it.");
    }
    private void AccountAllowance(JsonObject? quota)
    {
        Label("Account source: " + Snapshot.Text(quota?["status"]) + ". Last observation: " + Snapshot.Text(quota?["checkedAt"]));
        var windows = NativeHistory.Rows(quota?["windows"]).Where(row => !new[] { "spark", "codex_spark", "codex_bengalfox" }
            .Contains(Snapshot.Text(row["bucket"]), StringComparer.OrdinalIgnoreCase)).ToArray();
        if (quota is null || windows.Length == 0 || Snapshot.Text(quota["status"]) is not ("ok" or "stale")) { Label("No available account limits. Saved token records are separate."); return; }
        foreach (var window in windows)
        {
            Label(Snapshot.Text(window["bucket"]) + " · " + Snapshot.Text(window["window"]) + ": " + Snapshot.Format(Snapshot.Number(window["remainingPercent"])) + "% remaining");
            Label(AllowancePaceText(quota, window, DateTimeOffset.UtcNow));
            if (AllowancePaceCoverage(quota, window, DateTimeOffset.UtcNow) is double coverage)
            {
                body.Controls.Add(new ProgressBar { Width = ContentWidth, Height = 12, Minimum = 0, Maximum = 1000,
                    Value = (int)Math.Round(coverage * 1000), AccessibleName = "Estimated time coverage until reset, at last check",
                    AccessibleDescription = $"{Math.Round(coverage * 100)} percent. Filled portion ends at estimated exhaustion or reset, whichever comes first." });
                var endpoints = new TableLayoutPanel { Width = ContentWidth, Height = 24, ColumnCount = 2 };
                endpoints.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
                endpoints.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
                endpoints.Controls.Add(new Label { Text = "Now", Dock = DockStyle.Fill, TextAlign = ContentAlignment.TopLeft }, 0, 0);
                endpoints.Controls.Add(new Label { Text = "Reset (at last check)", Dock = DockStyle.Fill, TextAlign = ContentAlignment.TopRight }, 1, 0);
                body.Controls.Add(endpoints);
            }
            body.Controls.Add(new QuotaGraph(quota, window) { Height = 180, Width = ContentWidth });
        }
        body.Controls.Add(new DailyTokenGraph(quota) { Height = 180, Width = ContentWidth });
        Label("Account-wide observations, not a device sum. Gaps and resets are separate segments. Daily token totals may lag.");
    }
    internal static string AllowancePaceText(JsonObject quota, JsonObject window, DateTimeOffset now)
    {
        if (Snapshot.Text(quota["status"]) != "ok" || !DateTimeOffset.TryParse(Snapshot.Text(quota["checkedAt"]), out var at) ||
            now < at || now - at >= TimeSpan.FromMinutes(10)) return "Estimate unavailable until a fresh reading.";
        var pace = NativeHistory.Rows(quota["pace"]).FirstOrDefault(row =>
            Snapshot.Text(row["bucket"]) == Snapshot.Text(window["bucket"]) && Snapshot.Text(row["window"]) == Snapshot.Text(window["window"]));
        return pace is not null && Snapshot.Text(pace["asOf"]) == Snapshot.Text(quota["checkedAt"]) && pace["summary"] is JsonValue value && value.TryGetValue<string>(out var summary)
            ? summary : "Not enough recent history to estimate time left.";
    }
    internal static double? AllowancePaceCoverage(JsonObject quota, JsonObject window, DateTimeOffset now)
    {
        if (Snapshot.Text(quota["status"]) != "ok" || !DateTimeOffset.TryParse(Snapshot.Text(quota["checkedAt"]), out var at) ||
            now < at || now - at >= TimeSpan.FromMinutes(10) ||
            !DateTimeOffset.TryParse(Snapshot.Text(window["resetsAt"]), out var reset) || reset <= now) return null;
        var pace = NativeHistory.Rows(quota["pace"]).FirstOrDefault(row =>
            Snapshot.Text(row["bucket"]) == Snapshot.Text(window["bucket"]) && Snapshot.Text(row["window"]) == Snapshot.Text(window["window"]));
        if (pace is null || Snapshot.Text(pace["asOf"]) != Snapshot.Text(quota["checkedAt"]) ||
            Snapshot.Text(pace["status"]) is not ("projected" or "resets-first") ||
            pace["coverageFraction"] is not JsonValue value || !value.TryGetValue<double>(out var fraction) ||
            !double.IsFinite(fraction) || fraction < 0 || fraction > 1) return null;
        return fraction;
    }
    private void Sources(JsonObject? snapshot)
    {
        var rows = new List<string[]>();
        foreach (var kind in new[] { "activity", "tokens", "settings", "dictation" })
            foreach (var source in NativeHistory.Rows(snapshot?[kind])) rows.Add([kind, Snapshot.Text(source["host"]), Snapshot.Text(source["source"], ""), Snapshot.Text(source["status"]), Snapshot.Text(source["checkedAt"])]);
        foreach (var kind in new[] { "quota", "localModel", "agentSource" })
            if (snapshot?[kind] is JsonObject source) rows.Add([kind, Snapshot.Text(source["host"], ""), Snapshot.Text(source["provider"], ""), Snapshot.Text(source["status"]), Snapshot.Text(source["checkedAt"])]);
        Table("Source health", ["Kind", "Device", "Source", "Status", "Last check"], rows);
        var receipts = NativeHistory.Rows(snapshot?["agents"]);
        Label($"{receipts.Length} handoff receipts · {receipts.Count(row => Snapshot.Text(row["status"]) == "failed")} saved failures. Not a live agent monitor.");
        Label("Newest receipt: " + (receipts.Select(row => Snapshot.Text(row["recordedAt"])).Order().LastOrDefault() ?? "Unknown"));
        var details = new Button { Text = "View Agents", AccessibleName = "View Agents", AutoSize = true, Height = 38 };
        details.Click += (_, _) => sections.SelectedItem = "Agents";
        body.Controls.Add(details);
        Label("Provider sign-ins remain on their owning devices. Saved execution records do not show which agents are running now.");
    }
    protected override void Dispose(bool disposing)
    {
        if (disposing) { timer.Stop(); timer.Dispose(); timestampHint.Dispose(); }
        base.Dispose(disposing);
        if (disposing) { regular.Dispose(); heading.Dispose(); }
    }
}
