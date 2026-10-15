using System.Diagnostics;
using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

internal sealed class QuotaArchiveWindow : Form
{
    private readonly Func<JsonObject, CancellationToken, Task<JsonObject>> read;
    private readonly CancellationTokenSource lifetime = new();
    private readonly ComboBox account = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 220, AccessibleName = "Saved account" };
    private readonly ComboBox kind = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 140, AccessibleName = "Record type" };
    private readonly DateTimePicker from = new() { Format = DateTimePickerFormat.Short, Width = 115, Value = DateTime.Today.AddDays(-30), AccessibleName = "From date" };
    private readonly DateTimePicker through = new() { Format = DateTimePickerFormat.Short, Width = 115, AccessibleName = "Through date" };
    private readonly Button load = new DashboardButton { Text = "Load history", AutoSize = true };
    private readonly Button next = new DashboardButton { Text = "Next page", AutoSize = true, Enabled = false };
    private readonly Button more = new DashboardButton { Text = "More accounts", AutoSize = true, Enabled = false };
    private readonly Button allDates = new DashboardButton { Text = "All saved dates", AutoSize = true };
    private readonly FlowLayoutPanel charts = new() { Dock = DockStyle.Top, Height = 280, AutoScroll = true, FlowDirection = FlowDirection.TopDown, WrapContents = false, Visible = false };
    private readonly JsonArray chartReadings = new();
    private readonly Dictionary<string, string> chartPeriods = new(), chartDates = new();
    private readonly Label status = new() { AutoSize = true, MaximumSize = new Size(760, 0) };
    private readonly DataGridView rows = new() { Dock = DockStyle.Fill, ReadOnly = true, AllowUserToAddRows = false,
        AllowUserToDeleteRows = false, AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill, RowHeadersVisible = false,
        AccessibleName = "Saved allowance readings" };
    private JsonArray accounts = new();
    private JsonNode? accountNext, pageNext;
    private bool busy, released;
    private bool lightMode;

    internal QuotaArchiveWindow(Func<JsonObject, CancellationToken, Task<JsonObject>> read, bool lightMode = false)
    {
        this.read = read;
        this.lightMode = lightMode;
        Font = DashboardTypography.AtPixels(DashboardPalette.BodySize);
        BackColor = Color.FromArgb(28, 29, 27); ForeColor = Color.WhiteSmoke;
        account.ForeColor = kind.ForeColor = Color.Black;
        account.BackColor = kind.BackColor = Color.White;
        rows.BackgroundColor = DashboardCard.Surface;
        rows.BorderStyle = BorderStyle.None;
        rows.EnableHeadersVisualStyles = false;
        rows.DefaultCellStyle.BackColor = DashboardCard.Surface;
        rows.DefaultCellStyle.ForeColor = Color.WhiteSmoke;
        rows.DefaultCellStyle.SelectionBackColor = Color.FromArgb(66, 79, 60);
        rows.DefaultCellStyle.SelectionForeColor = Color.White;
        rows.ColumnHeadersDefaultCellStyle.BackColor = Color.FromArgb(37, 39, 35);
        rows.ColumnHeadersDefaultCellStyle.ForeColor = Color.WhiteSmoke;
        rows.GridColor = Color.FromArgb(55, 57, 52);
        Text = "Saved allowance history"; AccessibleName = Text;
        ClientSize = new Size(1080, 780); MinimumSize = new Size(800, 560); StartPosition = FormStartPosition.CenterParent;
        charts.Height = Math.Clamp(ClientSize.Height / 2, 240, 400);
        Resize += (_, _) => charts.Height = Math.Clamp(ClientSize.Height / 2, 240, 400);
        from.MinDate = through.MinDate = new DateTime(1970, 1, 2);
        from.MaxDate = through.MaxDate = new DateTime(9998, 12, 31);
        var filters = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, Padding = new Padding(12), WrapContents = true };
        kind.Items.AddRange(["Observations", "Daily tokens", "Collection results"]); kind.SelectedIndex = 0;
        var done = new DashboardButton { Text = "Done", AutoSize = true, DialogResult = DialogResult.Cancel };
        static Control Field(string label, Control input) {
            var group = new FlowLayoutPanel { AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, WrapContents = false,
                Margin = new Padding(0, 0, 8, 8), AccessibleName = label + " field" };
            group.Controls.Add(new Label { Text = label, AutoSize = true, Padding = new Padding(0, 5, 6, 0) });
            group.Controls.Add(input);
            return group;
        }
        filters.Controls.AddRange([Field("Account", account), more, Field("From", from), Field("Through", through),
            Field("Record type", kind), allDates, load, next, done]);
        var footer = new FlowLayoutPanel { Dock = DockStyle.Bottom, AutoSize = true, Padding = new Padding(12) };
        footer.Controls.Add(status);
        Controls.Add(rows); Controls.Add(charts); Controls.Add(filters); Controls.Add(footer);
        charts.SizeChanged += (_, _) => {
            foreach (Control control in charts.Controls)
                if (control is QuotaGraph or DashboardFilters or ArchiveChartControl) control.Width = Math.Max(240, charts.ClientSize.Width - 32);
        };
        void SelectAllDates() {
            if (account.SelectedIndex < 0) return;
            var selected = accounts[account.SelectedIndex];
            if (Snapshot.Number(selected?["firstAt"]) is double first && Snapshot.Number(selected?["lastAt"]) is double last)
            {
                from.Value = DateTimeOffset.FromUnixTimeMilliseconds((long)first).LocalDateTime;
                through.Value = DateTimeOffset.FromUnixTimeMilliseconds((long)last).LocalDateTime;
            }
        }
        allDates.Click += (_, _) => SelectAllDates();
        rows.Columns.Add("time", "Recorded at"); rows.Columns.Add("value", "Saved reading");
        CancelButton = done; AcceptButton = load;
        load.Click += async (_, _) => await LoadPage(false);
        next.Click += async (_, _) => await LoadPage(true);
        more.Click += async (_, _) => await LoadAccounts(accountNext);
        account.SelectedIndexChanged += (_, _) => { SelectAllDates(); InvalidatePage(); };
        kind.SelectedIndexChanged += (_, _) => InvalidatePage();
        from.ValueChanged += (_, _) => InvalidatePage(); through.ValueChanged += (_, _) => InvalidatePage();
        Shown += async (_, _) => await LoadAccounts(null);
        FormClosed += (_, _) => lifetime.Cancel();
        ApplyAppearance();
    }

    private void ApplyAppearance()
    {
        DashboardPalette.Apply(this, lightMode);
        DashboardPalette.Apply(charts, lightMode, inCard: true);
        rows.GridColor = DashboardPalette.Grid(rows);
    }

    private void InvalidatePage()
    {
        pageNext = null; rows.Rows.Clear(); chartReadings.Clear(); chartPeriods.Clear(); chartDates.Clear(); RenderCharts(); UpdateButtons();
        status.Text = "This PC only. Choose filters and load saved history. These are not live readings or device totals.";
    }
    private void UpdateButtons()
    {
        account.Enabled = kind.Enabled = from.Enabled = through.Enabled = !busy;
        load.Enabled = !busy && account.SelectedIndex >= 0 && from.Value.Date <= through.Value.Date;
        next.Enabled = load.Enabled && pageNext is not null && chartReadings.Count < 10000;
        allDates.Enabled = !busy && account.SelectedIndex >= 0;
        more.Enabled = !busy && accountNext is not null;
        foreach (var filters in charts.Controls.OfType<DashboardFilters>()) filters.Enabled = !busy;
    }
    private async Task Execute(Func<Task> action)
    {
        if (busy) return;
        busy = true; UpdateButtons(); status.Text = "Reading saved history…";
        try { await action(); }
        catch { if (!IsDisposed) {
            pageNext = null; chartReadings.Clear(); rows.Rows.Clear(); RenderCharts();
            status.Text = "Saved history could not be read. No history was deleted.";
        } }
        finally { busy = false; if (!IsDisposed) UpdateButtons(); }
    }
    private Task LoadAccounts(JsonNode? after) => Execute(async () =>
    {
        var request = new JsonObject { ["action"] = "accounts", ["limit"] = 100 };
        if (after is not null) request["after"] = after.DeepClone();
        var reply = await read(request, lifetime.Token);
        if (IsDisposed) return;
        var received = reply["accounts"] as JsonArray ?? throw new InvalidOperationException();
        accountNext = reply["next"]?.DeepClone();
        foreach (var item in received)
        {
            accounts.Add(item?.DeepClone());
            account.Items.Add($"Saved account {accounts.Count}" + (item?["current"]?.GetValue<bool>() == true ? " (current)" : ""));
        }
        if (account.SelectedIndex < 0 && account.Items.Count > 0) account.SelectedIndex = 0;
        status.Text = accounts.Count == 0 ? "No saved allowance history on this PC." : "Select an account and load history. This PC only.";
    });
    private Task LoadPage(bool advance)
    {
        if (!load.Enabled || (advance && (pageNext is null || chartReadings.Count >= 10000))) return Task.CompletedTask;
        var request = new JsonObject { ["action"] = "page", ["scope"] = accounts[account.SelectedIndex]?["scope"]?.DeepClone(),
            ["kind"] = new[] { "timeline", "daily", "poll" }[kind.SelectedIndex],
            ["from"] = new DateTimeOffset(from.Value.Date).ToUnixTimeMilliseconds(),
            ["to"] = new DateTimeOffset(through.Value.Date.AddDays(1)).ToUnixTimeMilliseconds() - 1, ["limit"] = 100 };
        if (advance) request["after"] = pageNext!.DeepClone();
        return Execute(async () =>
        {
            var reply = await read(request, lifetime.Token);
            if (IsDisposed) return;
            var records = reply["records"] as JsonArray ?? throw new InvalidOperationException();
            if (!advance) chartReadings.Clear();
            if (kind.SelectedIndex == 0)
                foreach (var record in records) chartReadings.Add(record?.DeepClone());
            rows.Rows.Clear();
            foreach (var item in records)
            {
                rows.Rows.Add(Snapshot.Text(item?["checkedAt"]), ReadingText(item));
            }
            pageNext = reply["next"]?.DeepClone();
            RenderCharts();
            status.Text = $"{records.Count} saved readings on this page. " + (pageNext is null ? "End of results." : "More readings available.");
            if (!advance && kind.SelectedIndex == 0) {
                var window = NativeHistory.Rows(records).SelectMany(row => NativeHistory.Rows(row["windows"]))
                    .FirstOrDefault(row => Snapshot.Text(row["bucket"]) is not ("spark" or "codex_spark" or "codex_bengalfox"));
                if (window is not null) {
                    try { await ReadFullChart(window); }
                    catch { if (!IsDisposed) status.Text = "Records loaded. Full-range graph could not be rendered. Try its graph button again."; }
                }
            }
        });
    }
    private void RenderCharts()
    {
        foreach (Control control in charts.Controls.Cast<Control>().ToArray()) { charts.Controls.Remove(control); control.Dispose(); }
        charts.Visible = chartReadings.Count > 0 && kind.SelectedIndex == 0;
        if (!charts.Visible) return;
        var quota = new JsonObject { ["history"] = chartReadings.DeepClone(), ["checkedAt"] = chartReadings.LastOrDefault()?["checkedAt"]?.DeepClone() };
        charts.Controls.Add(new Label { AutoSize = true, MaximumSize = new Size(950, 0), Text = pageNext is null
            ? "Loaded history for selected dates. Allowance used. Dashed spans mean unknown coverage."
            : chartReadings.Count >= 10000 ? "Partial history. Preview limit reached. Choose a narrower date range."
            : "Partial history. Load the next page to extend coverage. Dashed spans mean unknown coverage." });
        var windows = NativeHistory.Rows(quota["history"]).SelectMany(row => NativeHistory.Rows(row["windows"]))
            .Where(window => Snapshot.Text(window["bucket"]) is not ("spark" or "codex_spark" or "codex_bengalfox"))
            .GroupBy(window => Snapshot.Text(window["bucket"]) + ":" + Snapshot.Text(window["window"])).Select(group => group.Last());
        foreach (var window in windows)
        {
            var key = Snapshot.Text(window["bucket"]) + ":" + Snapshot.Text(window["window"]);
            var period = chartPeriods.GetValueOrDefault(key, "All retained");
            var width = Math.Max(240, charts.ClientSize.Width - 32);
            var graph = new QuotaGraph(quota, window, fitHistory: true) { Width = width, Height = 180, BackColor = DashboardCard.Surface };
            graph.SelectPeriod(period);
            var dates = QuotaGraph.RecordedDates(quota);
            var selectedDate = chartDates.GetValueOrDefault(key, dates.LastOrDefault() ?? "");
            if (!dates.Contains(selectedDate)) selectedDate = dates.LastOrDefault() ?? "";
            graph.SelectDate(selectedDate);
            var dateRow = new FlowLayoutPanel { Width = width, Height = 42, WrapContents = false, Visible = period != "All retained" };
            var dateLabel = new Label { AutoSize = true, Text = period == "Week" ? "Week ending" : "Recorded day", Padding = new Padding(0, 7, 8, 0) };
            var dateChoice = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 190, AccessibleName = "Recorded allowance date",
                BackColor = Color.White, ForeColor = Color.Black };
            dateChoice.Items.AddRange(dates); dateChoice.SelectedItem = selectedDate;
            dateChoice.SelectedIndexChanged += (_, _) => {
                var date = dateChoice.SelectedItem?.ToString() ?? "";
                chartDates[key] = date; graph.SelectDate(date);
            };
            dateRow.Controls.Add(dateLabel); dateRow.Controls.Add(dateChoice);
            charts.Controls.Add(new Label { AutoSize = true, Text = Snapshot.Text(window["bucket"]) + " · " + Snapshot.Text(window["window"]) + " · Allowance used" });
            var full = new DashboardButton { AutoSize = true, Text = "Full-range graph" };
            full.Click += async (_, _) => await LoadFullChart(window);
            charts.Controls.Add(full);
            charts.Controls.Add(new DashboardFilters("Period", ["Day", "Week", "All retained"], period, value => {
                chartPeriods[key] = value; graph.SelectPeriod(value);
                dateLabel.Text = value == "Week" ? "Week ending" : "Recorded day";
                dateRow.Visible = value != "All retained";
            }) { Width = width });
            charts.Controls.Add(dateRow);
            charts.Controls.Add(graph);
        }
        ApplyAppearance();
    }
    private Task LoadFullChart(JsonObject window)
    {
        if (busy || account.SelectedIndex < 0 || from.Value.Date > through.Value.Date) return Task.CompletedTask;
        return Execute(() => ReadFullChart(window));
    }
    private async Task ReadFullChart(JsonObject window)
    {
        var key = Snapshot.Text(window["bucket"]) + ":" + Snapshot.Text(window["window"]);
        var period = chartPeriods.GetValueOrDefault(key, "All retained");
        var start = period == "Day" ? through.Value.Date : period == "Week" ? through.Value.Date.AddDays(-6) : from.Value.Date;
        var request = new JsonObject { ["action"] = "chart", ["scope"] = accounts[account.SelectedIndex]?["scope"]?.DeepClone(),
            ["bucket"] = window["bucket"]?.DeepClone(), ["window"] = window["window"]?.DeepClone(),
            ["from"] = Math.Max(0, new DateTimeOffset(start).ToUnixTimeMilliseconds()),
            ["to"] = new DateTimeOffset(through.Value.Date.AddDays(1)).ToUnixTimeMilliseconds() - 1 };
            var reply = await read(request, lifetime.Token);
            if (IsDisposed) return;
            var chart = ArchiveChart.Parse(reply["chart"] as JsonObject ?? throw new InvalidOperationException("Chart unavailable."));
            if (!chart.MatchesRange(request["from"]!.GetValue<long>(), request["to"]!.GetValue<long>()))
                throw new InvalidOperationException("Chart date range did not match request.");
            foreach (Control control in charts.Controls.Cast<Control>().ToArray()) { charts.Controls.Remove(control); control.Dispose(); }
            charts.Controls.Add(new Label { AutoSize = true, Text = Snapshot.Text(window["bucket"]) + " · " + Snapshot.Text(window["window"]) + " · Allowance used, full selected range" });
            var choices = NativeHistory.Rows(chartReadings).SelectMany(row => NativeHistory.Rows(row["windows"]))
                .Where(row => Snapshot.Text(row["bucket"]) is not ("spark" or "codex_spark" or "codex_bengalfox"))
                .GroupBy(row => Snapshot.Text(row["bucket"]) + " · " + Snapshot.Text(row["window"]))
                .ToDictionary(group => group.Key, group => group.Last());
            if (choices.Count > 1) {
                var selected = Snapshot.Text(window["bucket"]) + " · " + Snapshot.Text(window["window"]);
                charts.Controls.Add(new DashboardFilters("Limit window", choices.Keys.Order().ToArray(), selected, async value => {
                    if (busy) return;
                    await LoadFullChart(choices[value]);
                }) { Width = Math.Max(240, charts.ClientSize.Width - 32) });
            }
            charts.Controls.Add(new DashboardFilters("Period", ["Day", "Week", "All retained"], period, async value => {
                if (busy) return;
                chartPeriods[key] = value;
                await LoadFullChart(window);
            }) { Width = Math.Max(240, charts.ClientSize.Width - 32) });
            charts.Controls.Add(new Label { AutoSize = true, Text = "Day and Week end on the Through date. All retained uses the selected archive range." });
            charts.Controls.Add(new ArchiveChartControl(chart) { Width = Math.Max(240, charts.ClientSize.Width - 32), BackColor = DashboardCard.Surface, ForeColor = Color.WhiteSmoke });
            ApplyAppearance();
            status.Text = $"{chart.Observations:N0} observations processed. Dashed spans mean unknown coverage. Raw records remain paginated.";
    }
    internal static string ReadingText(JsonNode? item) => item?["windows"] is JsonArray windows
        ? string.Join(" · ", windows.Where(w => Snapshot.Text(w?["bucket"]) is not ("spark" or "codex_spark" or "codex_bengalfox"))
            .Select(w => $"{Snapshot.Text(w?["bucket"])} {Snapshot.Text(w?["window"])}: {Snapshot.Format(Snapshot.Number(w?["remainingPercent"]))}% remaining"))
        : item?["tokens"] is not null ? $"{Snapshot.Text(item["startDate"])}: {Snapshot.Format(Snapshot.Number(item["tokens"]))} reported tokens" : Snapshot.Text(item?["status"]);

    internal static void SelfTest()
    {
        if (QuotaArchiveWindow.ReadingText(JsonNode.Parse("{\"windows\":[{\"bucket\":\"codex\",\"window\":\"weekly\",\"remainingPercent\":42}]}")) != "codex weekly: 42% remaining")
            throw new Exception("Archive percentage formatting failed.");
        if (QuotaArchiveWindow.ReadingText(JsonNode.Parse("{\"tokens\":123,\"startDate\":\"2026-09-14\"}")) != "2026-09-14: 123 reported tokens")
            throw new Exception("Archive token formatting failed.");
        var calls = new List<JsonObject>();
        using var window = new QuotaArchiveWindow((request, _) =>
        {
            calls.Add((JsonObject)request.DeepClone());
            return Task.FromResult(request["action"]!.GetValue<string>() == "accounts"
                ? new JsonObject { ["version"] = 1, ["accounts"] = new JsonArray(new JsonObject { ["scope"] = new string('a', 64), ["current"] = true,
                    ["firstAt"] = 1735689600000L, ["lastAt"] = 1789344000000L }) }
                : new JsonObject { ["version"] = 1, ["records"] = new JsonArray(new JsonObject { ["checkedAt"] = "2026-09-14T00:00:00Z", ["status"] = "ok" }),
                    ["next"] = request["after"] is null ? new JsonObject { ["at"] = 1, ["id"] = 1 } : null });
        });
        window.LoadAccounts(null).GetAwaiter().GetResult();
        if (window.from.Value.Date != DateTimeOffset.FromUnixTimeMilliseconds(1735689600000L).LocalDateTime.Date ||
            window.through.Value.Date != DateTimeOffset.FromUnixTimeMilliseconds(1789344000000L).LocalDateTime.Date)
            throw new Exception("Account selection did not default to all saved dates.");
        if (!window.load.Enabled || window.next.Enabled) throw new Exception("Archive initial controls failed.");
        window.LoadPage(false).GetAwaiter().GetResult();
        if (window.rows.Rows.Count != 1 || !window.next.Enabled) throw new Exception("Archive first page failed.");
        if (calls[^1]["kind"]?.GetValue<string>() != "timeline" || window.chartReadings.Count != 1) throw new Exception("Archive chart omitted timeline coverage.");
        window.LoadPage(true).GetAwaiter().GetResult();
        if (window.next.Enabled || calls[^1]["after"]?["id"]?.GetValue<int>() != 1) throw new Exception("Archive cursor failed.");
        if (window.chartReadings.Count != 2) throw new Exception("Archive chart discarded earlier pages.");
        window.LoadPage(true).GetAwaiter().GetResult();
        if (calls.Count != 3) throw new Exception("Disabled archive pagination performed a read.");
        window.kind.SelectedIndex = 1;
        if (window.rows.Rows.Count != 0 || window.next.Enabled || window.chartReadings.Count != 0) throw new Exception("Changed archive filters retained old page.");
        window.from.Value = window.through.Value.AddDays(1);
        window.LoadPage(false).GetAwaiter().GetResult();
        if (calls.Count != 3 || window.load.Enabled) throw new Exception("Invalid archive dates performed a read.");
    }
    internal static void DesktopTest(string output)
    {
        var mode = "ready"; var cancelled = false;
        JsonObject? lastChartRequest = null;
        Task? pending = null; Exception? failure = null;
        using var window = new QuotaArchiveWindow(async (request, token) =>
        {
            if (mode == "failed") throw new IOException("Synthetic read failure");
            if (mode == "pending")
            {
                using var registration = token.Register(() => cancelled = true);
                await Task.Delay(Timeout.Infinite, token);
            }
            if (Snapshot.Text(request["action"]) == "chart") {
                lastChartRequest = (JsonObject)request.DeepClone();
                if (mode == "chart-failed") throw new IOException("Synthetic chart failure");
                var chart = JsonNode.Parse("""
                    {"version":1,"width":2,"height":2,"from":0,"to":1000,"encoding":"ink-mask-u8","pixels":"AAMAAA==",
                    "scanned":1,"observations":1,"gaps":0,"segments":1,"firstAt":500,"lastAt":500,"minUsed":58,"maxUsed":58}
                    """)!.AsObject();
                chart["from"] = request["from"]!.DeepClone(); chart["to"] = request["to"]!.DeepClone();
                var first = request["from"]!.GetValue<long>(); var span = request["to"]!.GetValue<long>() - first;
                chart["firstAt"] = first + span / 6; chart["lastAt"] = first + span * 5 / 6;
                var mask = new byte[121 * 101];
                for (var x = 20; x <= 100; x++) mask[42 * 121 + x] = (byte)(x <= 40 || x >= 80 ? 1 : x % 7 < 3 ? 2 : 0);
                foreach (var x in new[] { 20, 40, 80, 100 }) mask[42 * 121 + x] = 3;
                chart["width"] = 121L; chart["height"] = 101L; chart["scanned"] = 5L; chart["observations"] = 4L; chart["gaps"] = 1L;
                chart["pixels"] = Convert.ToBase64String(mask);
                return new JsonObject { ["version"] = 1, ["chart"] = chart };
            }
            return request["action"]!.GetValue<string>() == "accounts"
                ? new JsonObject { ["version"] = 1, ["accounts"] = new JsonArray(new JsonObject { ["scope"] = new string('a', 64), ["current"] = true }) }
                : new JsonObject { ["version"] = 1, ["records"] = new JsonArray(new JsonObject { ["checkedAt"] = "2026-09-14T12:00:00Z",
                    ["windows"] = new JsonArray(new JsonObject { ["bucket"] = "codex", ["window"] = "weekly", ["remainingPercent"] = 42 }) }) };
        });
        window.Shown += async (_, _) =>
        {
            try
            {
                await window.LoadPage(false);
                if (window.rows.Rows.Count != 1) throw new Exception("Visible archive page missing.");
                if (!window.charts.Controls.OfType<ArchiveChartControl>().Any()) throw new Exception("Full-range graph did not load with history.");
                if (!window.charts.Controls.OfType<DashboardFilters>().Any()) throw new Exception("Full-range graph lost its period controls.");
                foreach (var light in new[] { false, true }) {
                    window.lightMode = light; window.ApplyAppearance(); window.PerformLayout();
                    if (window.BackColor != DashboardPalette.Background(light) || window.rows.DefaultCellStyle.ForeColor != DashboardPalette.Text(light) ||
                        window.charts.Controls.OfType<ArchiveChartControl>().Single().BackColor != DashboardPalette.Surface(light))
                        throw new Exception("Archive theme did not reach all surfaces.");
                    using var themeImage = new Bitmap(window.Width, window.Height);
                    window.DrawToBitmap(themeImage, new Rectangle(Point.Empty, themeImage.Size));
                    themeImage.Save(Path.Combine(output, light ? "archive-full-light.png" : "archive-full-dark.png"), System.Drawing.Imaging.ImageFormat.Png);
                }
                window.lightMode = false; window.ApplyAppearance();
                var fixtureWindows = window.chartReadings[0]!["windows"]!.AsArray();
                fixtureWindows.Add(new JsonObject { ["bucket"] = "codex", ["window"] = "secondary", ["remainingPercent"] = 70 });
                await window.LoadFullChart(new JsonObject { ["bucket"] = "codex", ["window"] = "weekly" });
                var windowFilters = window.charts.Controls.OfType<DashboardFilters>().Single(filter => filter.AccessibleName == "Limit window");
                windowFilters.Controls.OfType<FlowLayoutPanel>().Single().Controls.OfType<Button>().Single(button => button.Text.Contains("secondary")).PerformClick();
                if (lastChartRequest?["window"]?.GetValue<string>() != "secondary")
                    throw new Exception("Full-range window selector did not query the selected allowance.");
                fixtureWindows.RemoveAt(fixtureWindows.Count - 1);
                window.chartPeriods["codex:weekly"] = "Week";
                await window.LoadFullChart(new JsonObject { ["bucket"] = "codex", ["window"] = "weekly" });
                if (lastChartRequest?["from"]?.GetValue<long>() != new DateTimeOffset(window.through.Value.Date.AddDays(-6)).ToUnixTimeMilliseconds())
                    throw new Exception("Full-range Week did not query seven calendar days.");
                window.RenderCharts();
                var periodFilters = window.charts.Controls.OfType<DashboardFilters>().Single();
                var weekButton = periodFilters.Controls.OfType<FlowLayoutPanel>().Single().Controls.OfType<Button>().Single(button => button.Text == "Week");
                weekButton.PerformClick();
                var dateChoice = window.charts.Controls.OfType<FlowLayoutPanel>().SelectMany(row => row.Controls.OfType<ComboBox>()).Single();
                if (!dateChoice.Visible || dateChoice.Items.Count != 1 || window.chartPeriods["codex:weekly"] != "Week")
                    throw new Exception("Archive recorded week selector missing.");
                window.RenderCharts();
                if (window.charts.Controls.OfType<DashboardFilters>().Single().Controls.OfType<FlowLayoutPanel>().Single().Controls.OfType<Button>()
                    .Single(button => button.Text == "Week").AccessibleDescription != "Selected")
                    throw new Exception("Archive chart period lost on render.");
                foreach (var size in new[] { new Size(820, 560), new Size(700, 460) })
                {
                    window.ClientSize = size; window.PerformLayout();
                    using var bitmap = new Bitmap(window.Width, window.Height);
                    window.DrawToBitmap(bitmap, new Rectangle(Point.Empty, bitmap.Size));
                    bitmap.Save(Path.Combine(output, $"archive-{size.Width}.png"), System.Drawing.Imaging.ImageFormat.Png);
                }
                mode = "chart-failed"; await window.LoadPage(false);
                if (window.rows.Rows.Count != 1 || !window.status.Text.Contains("Records loaded"))
                    throw new Exception("Chart failure discarded readable archive records.");
                mode = "failed"; await window.LoadPage(false);
                if (!window.load.Enabled || !window.status.Text.Contains("No history was deleted")) throw new Exception("Archive error recovery failed.");
                mode = "pending"; pending = window.LoadPage(false);
                if (window.load.Enabled || window.account.Enabled) throw new Exception("Pending archive controls remained active.");
                window.Close();
                if (!cancelled) throw new Exception("Closing archive did not cancel the read.");
            }
            catch (Exception error) { failure = error; }
            finally { window.Close(); }
        };
        Application.Run(window);
        var watch = Stopwatch.StartNew();
        while (pending is { IsCompleted: false } && watch.Elapsed < TimeSpan.FromSeconds(2)) { Application.DoEvents(); Thread.Sleep(10); }
        if (failure is not null) throw failure;
        if (pending is null || !pending.IsCompletedSuccessfully) throw new Exception("Closed archive read did not drain.");
        File.WriteAllText(Path.Combine(output, "archive-result.txt"), "Synthetic archive layout, error recovery, pending controls and close cancellation passed.");
    }
    protected override void Dispose(bool disposing)
    {
        var release = disposing && !released;
        if (release) { released = true; lifetime.Cancel(); }
        base.Dispose(disposing);
        if (release) lifetime.Dispose();
    }
}
