using System.Drawing.Drawing2D;
using System.Globalization;
using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

internal sealed class UsagePopup : Form
{
    private readonly Font normalFont = DashboardTypography.AtPixels(14.5f);
    private readonly Font headingFont = DashboardTypography.AtPixels(19, FontStyle.Bold);
    private readonly Font titleFont = DashboardTypography.AtPixels(22, FontStyle.Bold);
    private readonly Font valueFont = DashboardTypography.AtPixels(22, FontStyle.Bold);
    private readonly Font secondaryFont = DashboardTypography.AtPixels(13);
    private readonly Func<JsonObject?> read;
    private readonly Func<Task> refresh;
    private readonly Action open;
    private readonly FlowLayoutPanel content = new() { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoScroll = false, Padding = new Padding(14) };
    private string host = "Windows";
    private const int BodyWidth = 360;

    internal UsagePopup(Func<JsonObject?> read, Func<Task> refresh, Action open)
    {
        this.read = read; this.refresh = refresh; this.open = open;
        Text = "Observatory";
        AccessibleName = "Observatory usage overview";
        BackColor = DashboardPalette.Background(false); ForeColor = DashboardPalette.Text(false);
        Font = normalFont;
        ClientSize = new Size(388, 560);
        FormBorderStyle = FormBorderStyle.None;
        DoubleBuffered = true;
        ShowInTaskbar = false; StartPosition = FormStartPosition.Manual;
        Controls.Add(content);
        Reload();
    }

    protected override bool ProcessCmdKey(ref Message message, Keys keyData)
    {
        if (keyData == Keys.Escape) { Close(); return true; }
        return base.ProcessCmdKey(ref message, keyData);
    }

    private Button ActionButton(string title, int width = BodyWidth)
    {
        var button = new DashboardButton { Text = title, AccessibleName = title, Width = width, Height = 38,
            FlatStyle = FlatStyle.Flat, BackColor = DashboardCard.Surface, ForeColor = ForeColor,
            TextAlign = ContentAlignment.MiddleLeft, Padding = new Padding(10, 0, 0, 0),
            Margin = new Padding(0, 2, 0, 2), UseVisualStyleBackColor = false };
        button.FlatAppearance.BorderSize = 0;
        button.FlatAppearance.MouseOverBackColor = Color.FromArgb(58, 58, 61);
        button.FlatAppearance.MouseDownBackColor = Color.FromArgb(68, 68, 72);
        return button;
    }

    private void Separator() => content.Controls.Add(new Panel { Width = BodyWidth, Height = 1,
        BackColor = DashboardPalette.Grid(this), Margin = new Padding(0, 8, 0, 8) });

    private void Stat(string title, string value, string date)
    {
        var row = new Panel { Width = BodyWidth, Height = 62, Margin = Padding.Empty };
        row.Controls.Add(new Label { Text = title, ForeColor = Color.Gainsboro, Bounds = new Rectangle(10, 8, 155, 24) });
        row.Controls.Add(new Label { Text = value, ForeColor = ForeColor, TextAlign = ContentAlignment.TopRight,
            Font = valueFont, Bounds = new Rectangle(165, 5, BodyWidth - 175, 29) });
        row.Controls.Add(new Label { Text = date, ForeColor = DashboardPalette.Muted(false),
            Font = secondaryFont, Bounds = new Rectangle(10, 34, BodyWidth - 20, 22) });
        content.Controls.Add(row);
    }

    private Label Label(string text, bool heading = false)
    {
        var label = new Label { Text = text, AutoSize = true, MaximumSize = new Size(BodyWidth, 0),
            Margin = new Padding(8, heading ? 8 : 4, 0, 4), ForeColor = heading ? DashboardPalette.Text(false) : DashboardPalette.Muted(false) };
        if (heading) label.Font = headingFont;
        content.Controls.Add(label); return label;
    }

    internal void Reload()
    {
        if (IsDisposed) return;
        content.SuspendLayout();
        foreach (var control in content.Controls.Cast<Control>().ToArray()) control.Dispose();
        var data = read();
        var title = Label("Observatory", true);
        title.Font = titleFont;
        if (DateTimeOffset.TryParse(Snapshot.Text(data?["collectedAt"]), out var collected))
        {
            var minutes = Math.Max(0, (int)(DateTimeOffset.UtcNow - collected).TotalMinutes);
            Label(minutes == 0 ? "Updated just now" : $"Updated {minutes}m ago");
        }
        Separator();
        var quota = data?["quota"] as JsonObject;
        if (Snapshot.Text(quota?["status"]) != "not-connected" && quota is not null)
        {
            Label("Codex account usage", true);
            var status = Snapshot.Text(quota["status"]);
            Label(Snapshot.Text(quota["latestReadStatus"]) == "waiting" ? "Waiting for the next permitted usage check." : status switch { "ok" => "Latest reading", "stale" => "Saved reading. A fresh check is pending.",
                "needs-auth" => "Sign in through Codex, then refresh.", "unsupported" => "This Codex client or account does not report limits.",
                _ => "Limits unavailable. Check Codex or try again later." });
            if (DateTimeOffset.TryParse(Snapshot.Text(quota["checkedAt"]), out var at)) Label($"Last read {at.ToLocalTime():g}");
            var windows = (quota["windows"] as JsonArray)?.OfType<JsonObject>()
                .Where(row => !new[] { "codex_bengalfox", "codex_spark", "spark" }.Contains(Snapshot.Text(row["bucket"]), StringComparer.OrdinalIgnoreCase)).ToArray() ?? [];
            foreach (var window in windows.Take(2))
            {
                Label($"{WindowLabel(window)}    {Snapshot.Format(Snapshot.Number(window["remainingPercent"]))}% left");
                if (Snapshot.Number(window["remainingPercent"]) is double remaining && double.IsFinite(remaining) && remaining >= 0 && remaining <= 100)
                    content.Controls.Add(new AllowanceMeter { Width = BodyWidth, Height = 5,
                        Value = (int)(remaining * 10),
                        AccessibleName = WindowLabel(window) + " remaining allowance", Margin = new Padding(0, 0, 0, 4) });
            }
            if (windows.Length > 2) Label($"{windows.Length - 2} more allowance windows in Observatory");
            Label("Account-wide limits, not a device sum.");
        }
        else Label("Account limits not connected");
        var hosts = new Panel { Width = BodyWidth, Height = 38, AccessibleName = "Source host", Margin = new Padding(0, 12, 0, 12) };
        var names = new[] { "All", "Mac", "Windows", "Ubuntu" };
        for (var index = 0; index < names.Length; index++)
        {
            var name = names[index];
            var choice = ActionButton(name, BodyWidth / 4 - 3);
            choice.AccessibleRole = AccessibleRole.RadioButton;
            choice.AccessibleDescription = host == name ? "Selected source host" : "Select source host";
            choice.Location = new Point(index * BodyWidth / 4, 0);
            choice.TextAlign = ContentAlignment.MiddleCenter; choice.Padding = Padding.Empty;
            choice.BackColor = host == name ? DashboardPalette.Accent(false) : DashboardCard.Surface;
            choice.ForeColor = host == name ? DashboardPalette.Text(true) : ForeColor;
            choice.Click += (_, _) => { host = name; Reload(); };
            hosts.Controls.Add(choice);
        }
        content.Controls.Add(hosts);
        var activity = Snapshot.Latest(data, "activity", host);
        var tokens = Snapshot.Latest(data, "tokens", host);
        Stat("Active time", Snapshot.Duration(Snapshot.Number(activity?["seconds"])), Snapshot.Text(activity?["date"], "No retained records"));
        Stat("Tokens", Snapshot.Number(tokens?["totalTokens"]) is double total ? DashboardHistoryChart.AxisLabel(total) : "Unknown", Snapshot.Text(tokens?["date"], "No retained records"));
        Separator();
        var refreshButton = ActionButton("Refresh sources");
        refreshButton.Click += async (_, _) => { refreshButton.Enabled = false; try { await refresh(); } finally { if (!IsDisposed) Reload(); } };
        content.Controls.Add(refreshButton);
        var openButton = ActionButton("Open Observatory");
        openButton.Click += (_, _) => { Close(); open(); }; content.Controls.Add(openButton);
        content.ResumeLayout();
        // Size the native surface around its controls instead of hiding navigation
        // below a scroll area. Screen constraints are applied by ShowNearTray.
        var preferred = content.GetPreferredSize(new Size(ClientSize.Width, 0));
        ClientSize = new Size(ClientSize.Width, preferred.Height);
    }

    private static string WindowLabel(JsonObject row)
    {
        var minutes = Snapshot.Number(row["durationMinutes"]);
        var duration = minutes is null ? Snapshot.Text(row["window"]) : minutes >= 1440 ? $"{minutes / 1440:0.#}d" : minutes >= 60 ? $"{minutes / 60:0.#}h" : $"{minutes:0.#}m";
        return Snapshot.Text(row["bucket"]) + " · " + duration;
    }

    internal void ShowNearTray()
    {
        var area = Screen.FromPoint(Cursor.Position).WorkingArea;
        Height = Math.Min(Height, area.Height - 24); Width = Math.Min(Width, area.Width - 24);
        Location = new Point(Math.Clamp(Cursor.Position.X - Width, area.Left, area.Right - Width),
            Math.Clamp(Cursor.Position.Y - Height, area.Top, area.Bottom - Height));
        Show(); Activate();
    }
    protected override void Dispose(bool disposing)
    {
        var releaseFonts = disposing && !IsDisposed;
        base.Dispose(disposing);
        if (releaseFonts)
        {
            normalFont.Dispose(); headingFont.Dispose(); titleFont.Dispose(); valueFont.Dispose(); secondaryFont.Dispose();
        }
    }
}

internal sealed class AllowanceMeter : Control
{
    [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
    internal int Value { get; set; }
    internal AllowanceMeter() { DoubleBuffered = true; AccessibleRole = AccessibleRole.ProgressBar; }
    protected override void OnPaint(PaintEventArgs e)
    {
        using var track = new SolidBrush(Color.FromArgb(74, 74, 78));
        using var fill = new SolidBrush(Color.FromArgb(223, 223, 230));
        e.Graphics.FillRectangle(track, ClientRectangle);
        e.Graphics.FillRectangle(fill, 0, 0, Width * Math.Clamp(Value, 0, 1000) / 1000f, Height);
    }
    protected override AccessibleObject CreateAccessibilityInstance() => new MeterAccessibility(this);
    private sealed class MeterAccessibility(AllowanceMeter owner) : ControlAccessibleObject(owner)
    {
        public override string? Value { get => $"{owner.Value / 10.0:0.#}% remaining"; set { } }
    }
}

internal sealed class QuotaGraph : Control
{
    private readonly JsonObject quota;
    private JsonObject window;
    private readonly bool fitHistory;
    private string period = "All retained";
    internal void SelectPeriod(string value) { period = value; Invalidate(); }
    internal static DashStyle? ConnectionStyle(double seconds, bool missing, bool sameReset, double priorUsed, double used)
        => seconds <= 0 || !sameReset || used < priorUsed ? null : missing || seconds > 630 ? DashStyle.Dash : DashStyle.Solid;
    internal QuotaGraph(JsonObject quota, JsonObject window, bool fitHistory = false)
    {
        this.quota = quota; this.window = window; this.fitHistory = fitHistory;
        DoubleBuffered = true; ForeColor = Color.WhiteSmoke; BackColor = Color.FromArgb(24, 25, 27);
        AccessibleName = "Allowance history. Gaps and resets are separate segments.";
        AccessibleRole = AccessibleRole.Graphic;
    }
    internal void SelectWindow(JsonObject next) { window = next; Invalidate(); }
    internal static (DateTimeOffset Start, DateTimeOffset End) HistoryRange(JsonObject quota, JsonObject window, DateTimeOffset checkedAt)
    {
        var dates = new List<DateTimeOffset>();
        foreach (var sample in NativeHistory.Rows(quota["history"]))
        {
            var row = NativeHistory.Rows(sample["windows"]).FirstOrDefault(item =>
                Snapshot.Text(item["bucket"]) == Snapshot.Text(window["bucket"]) && Snapshot.Text(item["window"]) == Snapshot.Text(window["window"]));
            if (DateTimeOffset.TryParse(Snapshot.Text(sample["checkedAt"]), out var at) && at <= checkedAt &&
                Snapshot.Number(row?["remainingPercent"]) is double value && double.IsFinite(value) && value >= 0 && value <= 100)
                dates.Add(at);
        }
        if (dates.Count == 0) return (checkedAt.AddHours(-1), checkedAt);
        var end = dates.Max();
        return (dates.Min() < end.AddHours(-1) ? dates.Min() : end.AddHours(-1), end);
    }
    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        var g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias;
        using var grid = new Pen(DashboardPalette.Grid(this));
        using var line = new Pen(DashboardPalette.Accent(DashboardPalette.IsLight(this)), 1.5f) { StartCap = LineCap.Round, EndCap = LineCap.Round };
        using var gap = new Pen(Color.FromArgb(140, line.Color), 1) { DashStyle = DashStyle.Dash };
        using var ink = new SolidBrush(line.Color);
        using var brush = new SolidBrush(DashboardPalette.Muted(DashboardPalette.IsLight(this)));
        var box = new RectangleF(34, 12, Math.Max(1, Width - 44), Math.Max(1, Height - 42));
        foreach (var percent in new[] { 0, 50, 100 })
        {
            var y = box.Bottom - box.Height * percent / 100;
            g.DrawLine(grid, box.Left, y, box.Right, y); g.DrawString(percent + "%", Font, brush, 0, y - 6);
        }
        if (!DateTimeOffset.TryParse(Snapshot.Text(quota["checkedAt"]), out var end))
        {
            AccessibleDescription = "Allowance history is unavailable because its observation time is unknown.";
            TextRenderer.DrawText(g, AccessibleDescription, Font, Rectangle.Round(box), ForeColor,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.WordBreak);
            return;
        }
        var start = end.AddDays(-1);
        if (fitHistory) (start, end) = HistoryRange(quota, window, end);
        if (fitHistory && DateTimeOffset.TryParse(Snapshot.Text(quota["checkedAt"]), out var checkedAt))
        {
            end = checkedAt;
            if (period == "Day") start = end.AddDays(-1);
            if (period == "Week") start = end.AddDays(-7);
        }
        var duration = Math.Max(1, (end - start).TotalSeconds);
        var format = fitHistory ? "MMM d HH:mm" : "HH:mm";
        g.DrawString(start.ToLocalTime().ToString(format), Font, brush, box.Left, box.Bottom + 6);
        var endLabel = end.ToLocalTime().ToString(format);
        g.DrawString(endLabel, Font, brush, box.Right - g.MeasureString(endLabel, Font).Width, box.Bottom + 6);
        PointF? previous = null; DateTimeOffset? previousAt = null; double? previousUsed = null; string? previousReset = null;
        var count = 0;
        var missing = false;
        double? firstUsed = null, lastUsed = null, minimumUsed = null, maximumUsed = null;
        foreach (var sample in (quota["history"] as JsonArray)?.OfType<JsonObject>() ?? [])
        {
            var row = (sample["windows"] as JsonArray)?.OfType<JsonObject>().FirstOrDefault(item =>
                Snapshot.Text(item["bucket"]) == Snapshot.Text(window["bucket"]) && Snapshot.Text(item["window"]) == Snapshot.Text(window["window"]));
            if (!DateTimeOffset.TryParse(Snapshot.Text(sample["checkedAt"]), out var at) || at < start || at > end ||
                Snapshot.Number(row?["remainingPercent"]) is not double remaining || !double.IsFinite(remaining) || remaining < 0 || remaining > 100)
            { missing = true; continue; }
            var used = 100 - remaining; var reset = Snapshot.Text(row?["resetsAt"]);
            var point = new PointF(box.Left + box.Width * (float)((at - start).TotalSeconds / duration), box.Bottom - box.Height * (float)(used / 100));
            var sameReset = reset == previousReset || (DateTimeOffset.TryParse(reset, out var resetTime) && DateTimeOffset.TryParse(previousReset, out var previousResetTime) && Math.Abs((resetTime - previousResetTime).TotalSeconds) <= 2);
            if (previous is PointF prior && previousAt is DateTimeOffset time && previousUsed is double before &&
                ConnectionStyle((at - time).TotalSeconds, missing, sameReset, before, used) is DashStyle stroke)
                g.DrawLine(stroke == DashStyle.Dash ? gap : line, prior, point);
            g.FillEllipse(ink, point.X - 2, point.Y - 2, 4, 4);
            firstUsed ??= used; lastUsed = used;
            minimumUsed = Math.Min(minimumUsed ?? used, used); maximumUsed = Math.Max(maximumUsed ?? used, used);
            previous = point; previousAt = at; previousUsed = used; previousReset = reset; count++;
            missing = false;
        }
        var selection = Snapshot.Text(window["bucket"]) + " " + Snapshot.Text(window["window"]);
        var rangeLabel = fitHistory ? period : "24-hour period";
        AccessibleDescription = count == 0 ? $"{selection}: no observations in this {rangeLabel}."
            : $"{selection}: {count} observations. Allowance used starts at {firstUsed:0.#}%, ends at {lastUsed:0.#}%, and ranges from {minimumUsed:0.#}% to {maximumUsed:0.#}%. Dashed spans mean coverage unknown, not estimated usage. Resets remain separate.";
        if (count == 0)
            TextRenderer.DrawText(g, $"No saved observations in this {rangeLabel}.", Font, Rectangle.Round(box), ForeColor,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.WordBreak);
    }
}

internal sealed class DailyTokenGraph : Control
{
    private readonly JsonObject quota;
    internal DailyTokenGraph(JsonObject quota)
    {
        this.quota = quota; DoubleBuffered = true; BackColor = Color.FromArgb(24, 25, 27); ForeColor = Color.WhiteSmoke;
        AccessibleName = "Recent daily account token totals. Missing dates are unknown, not zero.";
        AccessibleRole = AccessibleRole.Graphic;
    }
    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        var values = ((quota["dailyUsageBuckets"] as JsonArray)?.OfType<JsonObject>() ?? [])
            .Select(row => (date: DateOnly.TryParseExact(Snapshot.Text(row["startDate"]), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var day) ? day : (DateOnly?)null,
                tokens: Snapshot.Number(row["tokens"]))).Where(row => row.date is not null && row.tokens is not null).TakeLast(14).ToArray();
        if (values.Length == 0)
        {
            AccessibleDescription = "No saved daily account token totals. Missing data is unknown, not zero.";
            TextRenderer.DrawText(e.Graphics, AccessibleDescription, Font, ClientRectangle, ForeColor,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.WordBreak);
            return;
        }
        var start = values.Min(row => row.date!.Value.DayNumber); var end = values.Max(row => row.date!.Value.DayNumber);
        var maximum = Math.Max(1, values.Max(row => row.tokens!.Value));
        var box = new RectangleF(44, 12, Math.Max(1, Width - 54), Math.Max(1, Height - 42));
        using var brush = new SolidBrush(DashboardPalette.Muted(DashboardPalette.IsLight(this))); using var grid = new Pen(DashboardPalette.Grid(this));
        e.Graphics.DrawLine(grid, box.Left, box.Bottom, box.Right, box.Bottom);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using var ink = new SolidBrush(DashboardPalette.Accent(DashboardPalette.IsLight(this)));
        e.Graphics.DrawString(DashboardHistoryChart.AxisLabel(maximum), Font, brush, 0, box.Top);
        foreach (var row in values)
        {
            var slot = box.Width / (end - start + 1); var height = (float)(row.tokens!.Value / maximum) * box.Height;
            var x = box.Left + slot * (row.date!.Value.DayNumber - start);
            var width = Math.Min(40, Math.Max(1, slot * .7f));
            var center = x + slot / 2;
            if (row.tokens == 0) e.Graphics.FillEllipse(ink, center - 2, box.Bottom - 2, 4, 4);
            else
            {
                using var bar = DashboardCard.Rounded(new RectangleF(center - width / 2, box.Bottom - height, width, height), Math.Min(4, Math.Min(width, height) / 2));
                e.Graphics.FillPath(ink, bar);
            }
        }
        e.Graphics.DrawString(DateOnly.FromDayNumber(start).ToString("MM-dd"), Font, brush, box.Left, box.Bottom + 6);
        e.Graphics.DrawString(DateOnly.FromDayNumber(end).ToString("MM-dd"), Font, brush, box.Right - 38, box.Bottom + 6);
        AccessibleDescription = string.Join(". ", values.Select(row => $"{row.date:yyyy-MM-dd}: {Snapshot.Format(row.tokens)} tokens"));
    }
}
