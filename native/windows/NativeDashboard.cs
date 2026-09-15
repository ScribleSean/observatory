using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

// Reads the sanitized snapshot only. This migration view never opens raw logs.
internal sealed partial class NativeDashboard : Form
{
    private readonly Func<JsonObject?> read;
    private readonly Func<Task> refresh;
    private readonly Font regular = DashboardTypography.AtPixels(14.5f);
    private readonly Font heading = DashboardTypography.AtPixels(22, FontStyle.Bold);
    private readonly Font metric = DashboardTypography.AtPixels(38, FontStyle.Bold);
    private readonly Font brand = DashboardTypography.AtPixels(19, FontStyle.Bold);
    private readonly ListBox sections = new() { Dock = DockStyle.Left, Width = 170, BorderStyle = BorderStyle.None, ItemHeight = 38 };
    private readonly FlowLayoutPanel body = new() { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoScroll = true, Padding = new Padding(24) };
    private string host = "Windows", period = "Day", anchor = "";
    private string allowancePeriod = "All retained";
    private string allowanceDate = "";
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 30000 };
    private bool busy;
    private bool lightMode;
    private bool showRecordedHistory;
    private readonly Label pageTitle = new() { Dock = DockStyle.Top, Height = 42 };
    private readonly Label freshness = new() { Dock = DockStyle.Fill };
    private readonly ToolTip timestampHint = new();
    private readonly Button refreshButton = new DashboardButton { Text = "Refresh", AccessibleName = "Refresh sources", Dock = DockStyle.Right, Width = 110 };
    private readonly Func<JsonObject, CancellationToken, Task<JsonObject>>? readArchive;

    internal NativeDashboard(Func<JsonObject?> read, Func<Task> refresh, SourceSettingsActions? sourceSettings = null, DeviceSettingsActions? deviceSettings = null,
        Func<JsonObject, CancellationToken, Task<JsonObject>>? readArchive = null, bool rememberLayout = false,
        DashboardAppearancePreferences? appearancePreferences = null)
    {
        this.read = read; this.refresh = refresh;
        this.readArchive = readArchive;
        this.sourceSettings = sourceSettings;
        this.deviceSettings = deviceSettings;
        var appearanceStore = appearancePreferences ?? (rememberLayout ? DashboardWindowPreferences.Appearance : null);
        lightMode = appearanceStore?.Read() ?? false;
        Text = "Observatory"; AccessibleName = Text;
        Font = regular; BackColor = Color.FromArgb(28, 29, 27); ForeColor = Color.WhiteSmoke;
        var available = Screen.PrimaryScreen?.WorkingArea.Size ?? new Size(1280, 900);
        ClientSize = new Size(Math.Min(1280, available.Width - 48), Math.Min(800, available.Height - 80));
        MinimumSize = new Size(Math.Min(800, available.Width - 48), Math.Min(560, available.Height - 80));
        StartPosition = FormStartPosition.CenterScreen;
        if (rememberLayout) DashboardWindowPreferences.Attach(this, available);
        sections.BackColor = BackColor; sections.ForeColor = ForeColor;
        sections.ItemHeight = 54;
        sections.DrawMode = DrawMode.OwnerDrawFixed;
        sections.DrawItem += (_, args) =>
        {
            if (args.Index < 0) return;
            var selected = (args.State & DrawItemState.Selected) != 0;
            using var background = new SolidBrush(sections.BackColor);
            args.Graphics.FillRectangle(background, args.Bounds);
            if (selected)
            {
                args.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                using var shape = DashboardCard.Rounded(new RectangleF(args.Bounds.X + 8, args.Bounds.Y + 4, args.Bounds.Width - 16, args.Bounds.Height - 8), 12);
                using var fill = new SolidBrush(DashboardPalette.Surface(lightMode));
                args.Graphics.FillPath(fill, shape);
            }
            var ink = selected ? ForeColor : DashboardPalette.Muted(lightMode);
            var section = sections.Items[args.Index].ToString() ?? "";
            DashboardNavigationIcons.Draw(args.Graphics, section,
                new RectangleF(args.Bounds.X + 20, args.Bounds.Y + (args.Bounds.Height - 22) / 2f, 22, 22), ink);
            TextRenderer.DrawText(args.Graphics, section, regular,
                new Rectangle(args.Bounds.X + 54, args.Bounds.Y, args.Bounds.Width - 62, args.Bounds.Height),
                ink, TextFormatFlags.VerticalCenter | TextFormatFlags.Left);
            args.DrawFocusRectangle();
        };
        sections.AccessibleName = "Sections";
        sections.Items.AddRange(["Allowances", "Activity", "Tokens", "Dictation", "Agents", "Sources", "Settings"]);
        var content = new Panel { Dock = DockStyle.Fill };
        var header = new Panel { Dock = DockStyle.Top, Height = 104, Padding = new Padding(24, 16, 24, 8) };
        pageTitle.Font = heading;
        freshness.ForeColor = Color.Silver;
        refreshButton.BackColor = DashboardCard.Surface;
        refreshButton.FlatAppearance.BorderSize = 0;
        refreshButton.Click += async (_, _) =>
        {
            if (busy) return;
            busy = true; refreshButton.Enabled = false;
            try { await refresh(); }
            catch { if (!IsDisposed) MessageBox.Show(this, "Collection could not complete. Saved records remain available.", "Observatory"); }
            finally { busy = false; if (!IsDisposed) Reload(); }
        };
        var actions = new FlowLayoutPanel { Dock = DockStyle.Right, Width = 218, FlowDirection = FlowDirection.RightToLeft, WrapContents = false, Padding = new Padding(0, 6, 0, 0) };
        refreshButton.Dock = DockStyle.None; refreshButton.Size = new Size(100, 40);
        var devices = new DashboardButton { Text = "Devices", AccessibleName = "Device connection settings", Width = 100, Height = 40 };
        devices.FlatAppearance.BorderSize = 0;
        devices.Click += (_, _) => { sections.SelectedItem = "Settings"; Reload(); body.AutoScrollPosition = Point.Empty; };
        actions.Controls.Add(refreshButton); actions.Controls.Add(devices);
        header.Controls.Add(freshness); header.Controls.Add(pageTitle); header.Controls.Add(actions);
        content.Controls.Add(body); content.Controls.Add(header);
        var rail = new Panel { Dock = DockStyle.Left, Width = 200 };
        var brandLabel = new Label { Text = "Observatory", Font = brand, Dock = DockStyle.Top, Height = 80, Padding = new Padding(20, 20, 0, 0) };
        sections.Dock = DockStyle.Fill;
        rail.Controls.Add(sections); rail.Controls.Add(brandLabel);
        var appearance = new DashboardButton { Text = lightMode ? "Dark mode" : "Light mode", AccessibleName = "Toggle appearance", Dock = DockStyle.Bottom, Height = 44 };
        appearance.Click += (_, _) =>
        {
            lightMode = !lightMode;
            appearanceStore?.Write(lightMode);
            appearance.Text = lightMode ? "Dark mode" : "Light mode";
            DashboardPalette.Apply(this, lightMode);
            UpdateFreshness(read());
        };
        rail.Controls.Add(appearance);
        Controls.Add(content); Controls.Add(rail);
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
    private void ResizeRows()
    {
        foreach (Control row in body.Controls)
        {
            row.Width = row is Button ? Math.Min(ContentWidth, Math.Max(140, row.GetPreferredSize(Size.Empty).Width + 24)) : ContentWidth;
            if (row is Label label) label.MaximumSize = new Size(ContentWidth, 0);
        }
    }
    private Label Label(string value, bool title = false)
    {
        var label = new Label { Text = value, AccessibleName = value, AutoSize = true,
            MaximumSize = new Size(ContentWidth, 0), Margin = new Padding(0, 0, 0, 14), Font = title ? metric : regular };
        body.Controls.Add(label); return label;
    }
    private void Choice(string name, string[] values, string selected, Action<string> changed)
    {
        if (name is "Device" or "Period" or "Tool")
        {
            body.Controls.Add(new DashboardFilters(name, values, selected, value => { changed(value); BeginInvoke(Reload); }) { Width = ContentWidth });
            return;
        }
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
            AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill, BackgroundColor = DashboardCard.Surface,
            BorderStyle = BorderStyle.None, AccessibleName = name, EnableHeadersVisualStyles = false,
            CellBorderStyle = DataGridViewCellBorderStyle.None, ColumnHeadersBorderStyle = DataGridViewHeaderBorderStyle.None,
            SelectionMode = DataGridViewSelectionMode.FullRowSelect };
        table.RowTemplate.Height = 32;
        table.DefaultCellStyle.Padding = new Padding(6, 3, 6, 3);
        table.DefaultCellStyle.BackColor = DashboardCard.Surface; table.DefaultCellStyle.ForeColor = ForeColor;
        table.DefaultCellStyle.SelectionBackColor = Color.FromArgb(66, 79, 62);
        table.ColumnHeadersDefaultCellStyle.BackColor = DashboardCard.Surface; table.ColumnHeadersDefaultCellStyle.ForeColor = Color.FromArgb(190, 196, 185);
        foreach (var column in columns) table.Columns.Add(column, column);
        foreach (var row in values) table.Rows.Add(row.Cast<object>().ToArray());
        table.Height = Math.Min(235, table.ColumnHeadersHeight + Math.Max(1, table.Rows.Count) * table.RowTemplate.Height + 4);
        AddCard(table, name);
        return table;
    }
    private void AddCard(Control content, string name)
    {
        var card = new DashboardCard { Width = ContentWidth, Height = content.Height + 32, AccessibleName = name + " card" };
        content.Dock = DockStyle.Fill;
        card.Controls.Add(content);
        body.Controls.Add(card);
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
                var configure = new DashboardButton { Text = "Review collection settings", AutoSize = true, Height = 40 };
                configure.Click += (_, _) => sections.SelectedItem = "Settings";
                body.Controls.Add(configure);
                Agents(snapshot);
            }
            else if (section == "Settings") SourceSettings();
            else Sources(snapshot);
            Label("Native migration preview. Provider sign-ins remain in their owning applications.");
            ResizeRows();
        }
        finally { DashboardPalette.Apply(this, lightMode); UpdateFreshness(read()); body.ResumeLayout(true); }
    }
    private void UpdateFreshness(JsonObject? snapshot)
    {
        var timestamp = Snapshot.Text(snapshot?["collectedAt"]);
        freshness.Text = Freshness(timestamp, DateTimeOffset.UtcNow);
        freshness.ForeColor = !DateTimeOffset.TryParse(timestamp, out var date) || date > DateTimeOffset.UtcNow || DateTimeOffset.UtcNow - date > TimeSpan.FromMinutes(15)
            ? (lightMode ? Color.FromArgb(151, 77, 12) : Color.DarkOrange) : DashboardPalette.Muted(lightMode);
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
        return $"Updated {(int)age.TotalHours}h ago";
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
        var showActivityHelp = false;
        Choice("Device", ["All", "Mac", "Windows", "Ubuntu"], host, value => { host = value; anchor = ""; });
        Choice("Period", ["Day", "Week", "All retained"], period, value => period = value);
        var days = NativeHistory.Days(snapshot, kind, host);
        if (kind == "activity")
        {
            var archive = NativeHistory.Rows(snapshot?["activityHistory"]).FirstOrDefault(row => Snapshot.Text(row["host"]) == (host == "All" ? "Combined" : host));
            Label(Snapshot.Text(archive?["trackingMessage"], "Tracking freshness is unknown for this saved snapshot."));
            Label("Last tracking coverage: " + Snapshot.Text(archive?["trackingThrough"]));
            showActivityHelp = days.Length > 0 && archive is not null && Snapshot.Text(archive["latestReadStatus"]) != "ok";
        }
        if (days.Length == 0) { Label("No verified records. Missing data is unknown, not zero."); if (kind == "activity") ActivityWatchHelp(); return; }
        var dates = days.Select(day => Snapshot.Text(day["date"])).ToArray();
        if (!dates.Contains(anchor)) anchor = dates[^1];
        if (period != "All retained") Choice(period == "Week" ? "Week ending" : "Recorded day", dates, anchor, value => anchor = value);
        var selected = NativeHistory.Select(days, period, anchor);
        var field = kind == "activity" ? "seconds" : "totalTokens";
        var total = NativeHistory.Sum(selected, field);
        Label(kind == "activity" ? (total is double seconds ? (seconds / 60).ToString("0.#") + " min" : "Unknown") : Snapshot.Format(total) + " tokens", true);
        Label($"{selected.Length} recorded dates. Missing dates are not filled with zeros.");
        Label("Selected recorded days (up to 30 shown)");
        AddCard(new DashboardHistoryChart(selected, kind == "tokens"), "Recorded history");
        var details = new DashboardButton { Text = showRecordedHistory ? "Hide recorded values" : "Show recorded values", AutoSize = true, Height = 40 };
        details.Click += (_, _) => { showRecordedHistory = !showRecordedHistory; Reload(); };
        body.Controls.Add(details);
        if (showRecordedHistory)
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
            if (showActivityHelp) ActivityWatchHelp();
        }
    }
    private void Allowances(JsonObject? snapshot)
    {
        if (readArchive is not null)
        {
            var history = new DashboardButton { Text = "Browse saved allowance history", AutoSize = true };
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
        var start = body.Controls.Count;
        var accountTitle = Label("Account usage");
        accountTitle.Font = heading;
        Label("Account source: " + Snapshot.Text(quota?["status"]));
        var observation = Label(Freshness(Snapshot.Text(quota?["checkedAt"]), DateTimeOffset.UtcNow));
        observation.AccessibleDescription = "Account source: " + Snapshot.Text(quota?["status"]) + ". Last observation: " + Snapshot.Text(quota?["checkedAt"]);
        var windows = NativeHistory.Rows(quota?["windows"]).Where(row => !new[] { "spark", "codex_spark", "codex_bengalfox" }
            .Contains(Snapshot.Text(row["bucket"]), StringComparer.OrdinalIgnoreCase)).ToArray();
        if (quota is null || windows.Length == 0 || Snapshot.Text(quota["status"]) is not ("ok" or "stale")) { Label("No available account limits. Saved token records are separate."); GroupAccountRows(start); return; }
        foreach (var window in windows)
        {
            var remaining = Snapshot.Number(window["remainingPercent"]);
            var windowTitle = Label(Snapshot.Text(window["bucket"]) + " · " + Snapshot.Text(window["window"]) + ": " + Snapshot.Format(remaining) + "% remaining");
            windowTitle.Font = heading;
            if (remaining is double percent && double.IsFinite(percent) && percent >= 0 && percent <= 100)
                body.Controls.Add(new DashboardMeter(percent / 100, "Allowance remaining") { Width = ContentWidth,
                    AccessibleDescription = $"{percent}% remaining" });
            if (QuotaLivePace.Read(quota, window, DateTimeOffset.UtcNow) is { } live)
            {
                Label(live.Remaining, title: true).AccessibleName = "Estimated time remaining at this pace";
                Label("Estimated at this pace · reset in " + live.Reset).ForeColor = Color.Silver;
                Label($"{live.Rate:0.#} percentage points / hour");
            }
            else Label(AllowancePaceText(quota, window, DateTimeOffset.UtcNow)).ForeColor = Color.Silver;
            if (AllowancePaceCoverage(quota, window, DateTimeOffset.UtcNow) is double coverage)
            {
                body.Controls.Add(new DashboardMeter(coverage, "Estimated time coverage until reset, at last check") { Width = ContentWidth, Height = 12,
                    AccessibleDescription = $"{Math.Round(coverage * 100)} percent. Filled portion ends at estimated exhaustion or reset, whichever comes first." });
                var endpoints = new TableLayoutPanel { Width = ContentWidth, Height = 24, ColumnCount = 2 };
                endpoints.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
                endpoints.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
                endpoints.Controls.Add(new Label { Text = "Now", Dock = DockStyle.Fill, TextAlign = ContentAlignment.TopLeft }, 0, 0);
                endpoints.Controls.Add(new Label { Text = "Reset (at last check)", Dock = DockStyle.Fill, TextAlign = ContentAlignment.TopRight }, 1, 0);
                body.Controls.Add(endpoints);
            }
            Label("Allowance used").Font = heading;
            var historyGraph = new QuotaGraph(quota, window, fitHistory: true) { Height = 180, Width = ContentWidth, BackColor = DashboardCard.Surface };
            historyGraph.SelectPeriod(allowancePeriod);
            body.Controls.Add(new DashboardFilters("Period", ["Day", "Week", "All retained"], allowancePeriod, value => { allowancePeriod = value; BeginInvoke(Reload); }) { Width = ContentWidth });
            var recordedDates = QuotaGraph.RecordedDates(quota);
            var recordedDate = recordedDates.Contains(allowanceDate) ? allowanceDate : recordedDates.LastOrDefault() ?? "";
            historyGraph.SelectDate(recordedDate);
            if (allowancePeriod != "All retained" && recordedDates.Length > 0)
                Choice(allowancePeriod == "Week" ? "Week ending" : "Recorded day", recordedDates, recordedDate, value => allowanceDate = value);
            body.Controls.Add(historyGraph);
            Label("Dashed spans: coverage unknown. No estimated readings.").ForeColor = Color.Silver;
            Label("Live snapshot history retains up to 30 days. Older saved observations are in the account archive.").ForeColor = Color.Silver;
            var hourly = QuotaHourlyChart.Read(quota, window);
            if (allowancePeriod != "All retained" && DateTimeOffset.TryParse(Snapshot.Text(quota["checkedAt"]), out var observedAt))
            {
                var range = QuotaGraph.PeriodRange(allowancePeriod, recordedDate, observedAt);
                hourly = hourly.Where(hour => hour.Hour >= range.Start && hour.Hour < range.End).ToArray();
            }
            if (hourly.Length > 0)
            {
                Label("Usage pace by hour").Font = brand;
                body.Controls.Add(new QuotaHourlyChart(hourly) { Width = ContentWidth });
                Label("Rates use observed intervals within each hour. Missing polls, resets and intervals crossing an hour boundary are excluded.").ForeColor = Color.Silver;
            }
        }
        body.Controls.Add(new DailyTokenGraph(quota) { Height = 180, Width = ContentWidth, BackColor = DashboardCard.Surface });
        Label("Account-wide observations, not a device sum. Gaps and resets are separate segments. Daily token totals may lag.");
        GroupAccountRows(start);
    }
    private void GroupAccountRows(int start, string name = "Account usage")
    {
        var rows = body.Controls.Cast<Control>().Skip(start).ToArray();
        var content = new Panel { Dock = DockStyle.Fill, BackColor = DashboardCard.Surface };
        var card = new DashboardCard { Width = ContentWidth,
            AccessibleName = name + " card" };
        var arranging = false;
        void Arrange()
        {
            if (arranging) return;
            arranging = true;
            var y = 0;
            foreach (Control row in content.Controls)
            {
                var width = Math.Max(100, card.ClientSize.Width - card.Padding.Horizontal - 8);
                row.Width = row is Button ? Math.Min(width, Math.Max(140, TextRenderer.MeasureText(row.Text, row.Font).Width + 32)) : width;
                if (row is Label label)
                {
                    label.MaximumSize = new Size(width, 0);
                    label.Height = label.GetPreferredSize(new Size(width, 0)).Height;
                }
                row.Location = new Point(0, y);
                y += row.Height + 16;
            }
            card.Height = y + card.Padding.Vertical;
            arranging = false;
        }
        card.SizeChanged += (_, _) => Arrange();
        foreach (var row in rows)
        {
            content.Controls.Add(row);
            row.SizeChanged += (_, _) => Arrange();
        }
        card.Controls.Add(content);
        body.Controls.Add(card);
        Arrange();
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
            foreach (var source in NativeHistory.Rows(snapshot?[kind]).Where(source => kind != "dictation" ||
                !string.Equals(Snapshot.Text(source["source"]), "TypeWhisper", StringComparison.OrdinalIgnoreCase)))
                rows.Add([kind, Snapshot.Text(source["host"]), Snapshot.Text(source["source"], ""), Snapshot.Text(source["status"]), Snapshot.Text(source["checkedAt"])]);
        foreach (var kind in new[] { "quota", "localModel", "agentSource" })
            if (snapshot?[kind] is JsonObject source) rows.Add([kind, Snapshot.Text(source["host"], ""), Snapshot.Text(source["provider"], ""), Snapshot.Text(source["status"]), Snapshot.Text(source["checkedAt"])]);
        var receipts = NativeHistory.Rows(snapshot?["agents"]);
        Label($"{receipts.Length} handoff receipts · {receipts.Count(row => Snapshot.Text(row["status"]) == "failed")} saved failures. Not a live agent monitor.");
        var latest = receipts.Select(row => DateTimeOffset.TryParse(Snapshot.Text(row["recordedAt"]), out var date) ? (DateTimeOffset?)date : null)
            .Where(date => date.HasValue).OrderBy(date => date).LastOrDefault();
        var receiptLabel = Label("Newest receipt: " + (latest is DateTimeOffset recorded ? Freshness(recorded.ToString("O"), DateTimeOffset.UtcNow) : "Unknown"));
        receiptLabel.AccessibleDescription = latest?.ToString("O") ?? "Unknown";
        var details = new DashboardButton { Text = "View Agents", AccessibleName = "View Agents", AutoSize = true, Height = 40 };
        details.Click += (_, _) => sections.SelectedItem = "Agents";
        body.Controls.Add(details);
        foreach (var kind in new[] { "activity", "tokens", "settings", "dictation", "quota", "localModel", "agentSource" })
        {
            var entries = rows.Where(row => row[0] == kind).ToArray();
            var values = entries.SelectMany(row => new[] {
                (row[1] + " · " + row[2], row[3]),
                ("Last checked", Freshness(row[4], DateTimeOffset.UtcNow))
            }).ToArray();
            if (values.Length == 0) values = [("Status", "No source records")];
            var title = kind switch { "quota" => "Allowances", "localModel" => "Local benchmarks", "agentSource" => "Agent receipts", "settings" => "Tool activity", _ => char.ToUpperInvariant(kind[0]) + kind[1..] };
            AddCard(new DashboardValueCard(title, values), "Source health");
        }
        Label("Provider sign-ins remain on their owning devices. Saved execution records do not show which agents are running now.");
    }
    protected override void Dispose(bool disposing)
    {
        if (disposing) { timer.Stop(); timer.Dispose(); timestampHint.Dispose(); }
        base.Dispose(disposing);
        if (disposing) { regular.Dispose(); heading.Dispose(); metric.Dispose(); brand.Dispose(); }
    }
}
