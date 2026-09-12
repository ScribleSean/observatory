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

    internal NativeDashboard(Func<JsonObject?> read, Func<Task> refresh, SourceSettingsActions? sourceSettings = null, DeviceSettingsActions? deviceSettings = null)
    {
        this.read = read; this.refresh = refresh;
        this.sourceSettings = sourceSettings;
        this.deviceSettings = deviceSettings;
        Text = "Observatory native preview"; AccessibleName = Text;
        Font = regular; BackColor = Color.FromArgb(30, 30, 32); ForeColor = Color.WhiteSmoke;
        ClientSize = new Size(1000, 720); MinimumSize = new Size(800, 560); StartPosition = FormStartPosition.CenterScreen;
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
        sections.Items.AddRange(["Activity", "Tokens", "Allowances", "Dictation", "Agents", "Sources", "Settings"]);
        Controls.Add(body); Controls.Add(sections);
        sections.SelectedIndexChanged += (_, _) => { anchor = ""; Reload(); };
        sections.SelectedIndex = 0;
        body.ClientSizeChanged += (_, _) => ResizeRows();
        timer.Tick += (_, _) => { if (!ContainsFocus && sections.SelectedItem?.ToString() != "Settings") Reload(); };
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
            var snapshot = read(); var section = sections.SelectedItem?.ToString() ?? "Activity";
            Label(section, true);
            Label("Snapshot: " + Snapshot.Text(snapshot?["collectedAt"]));
            var refreshButton = new Button { Text = "Refresh sources", AccessibleName = "Refresh sources", Height = 36, Width = ContentWidth, Enabled = !busy,
                FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(48, 48, 52), ForeColor = ForeColor,
                TextAlign = ContentAlignment.MiddleLeft, Padding = new Padding(10, 0, 0, 0) };
            refreshButton.FlatAppearance.BorderSize = 0;
            refreshButton.Click += async (_, _) =>
            {
                busy = true; refreshButton.Enabled = false;
                try { await refresh(); } catch { if (!IsDisposed) MessageBox.Show(this, "Collection could not complete. Saved records remain available.", "Observatory"); }
                finally { busy = false; if (!IsDisposed) Reload(); }
            };
            body.Controls.Add(refreshButton);
            if (section is "Activity" or "Tokens") History(snapshot, section == "Activity" ? "activity" : "tokens");
            else if (section == "Allowances") Allowances(snapshot);
            else if (section == "Dictation") Dictation(snapshot);
            else if (section == "Agents") Agents(snapshot);
            else if (section == "Settings") SourceSettings();
            else Sources(snapshot);
            Label("Native migration preview. Provider sign-ins remain in their owning applications.");
            ResizeRows();
        }
        finally { body.ResumeLayout(true); }
    }
    private void History(JsonObject? snapshot, string kind)
    {
        Choice("Device", ["All", "Mac", "Windows", "Ubuntu"], host, value => { host = value; anchor = ""; });
        Choice("Period", ["Day", "Week", "All retained"], period, value => period = value);
        var days = NativeHistory.Days(snapshot, kind, host);
        if (days.Length == 0) { Label("No verified records. Missing data is unknown, not zero."); return; }
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
        }
        else
        {
            Label("Foreground time does not measure attention. Combined activity counts device overlap once. WSL screen time belongs to Windows.");
            ActivityDetails(selected);
        }
    }
    private void Allowances(JsonObject? snapshot)
    {
        var quota = snapshot?["quota"] as JsonObject;
        Label("Account source: " + Snapshot.Text(quota?["status"]) + ". Last observation: " + Snapshot.Text(quota?["checkedAt"]));
        var windows = NativeHistory.Rows(quota?["windows"]).Where(row => !new[] { "spark", "codex_spark", "codex_bengalfox" }
            .Contains(Snapshot.Text(row["bucket"]), StringComparer.OrdinalIgnoreCase)).ToArray();
        if (quota is null || windows.Length == 0 || Snapshot.Text(quota["status"]) is not ("ok" or "stale")) { Label("No available account limits. Saved token records are separate."); return; }
        foreach (var window in windows)
        {
            Label(Snapshot.Text(window["bucket"]) + " · " + Snapshot.Text(window["window"]) + ": " + Snapshot.Format(Snapshot.Number(window["remainingPercent"])) + "% remaining");
            body.Controls.Add(new QuotaGraph(quota, window) { Height = 180, Width = ContentWidth });
        }
        body.Controls.Add(new DailyTokenGraph(quota) { Height = 180, Width = ContentWidth });
        Label("Account-wide observations, not a device sum. Gaps and resets are separate segments. Daily token totals may lag.");
    }
    private void Sources(JsonObject? snapshot)
    {
        var rows = new List<string[]>();
        foreach (var kind in new[] { "activity", "tokens", "settings", "dictation" })
            foreach (var source in NativeHistory.Rows(snapshot?[kind])) rows.Add([kind, Snapshot.Text(source["host"]), Snapshot.Text(source["source"], ""), Snapshot.Text(source["status"]), Snapshot.Text(source["checkedAt"])]);
        foreach (var kind in new[] { "quota", "localModel", "agentSource" })
            if (snapshot?[kind] is JsonObject source) rows.Add([kind, Snapshot.Text(source["host"], ""), Snapshot.Text(source["provider"], ""), Snapshot.Text(source["status"]), Snapshot.Text(source["checkedAt"])]);
        Table("Source health", ["Kind", "Device", "Source", "Status", "Last check"], rows);
        Label("Provider sign-ins remain on their owning devices. Account-limit history is not synchronized yet.");
    }
    protected override void Dispose(bool disposing)
    {
        if (disposing) { timer.Stop(); timer.Dispose(); }
        base.Dispose(disposing);
        if (disposing) { regular.Dispose(); heading.Dispose(); }
    }
}
