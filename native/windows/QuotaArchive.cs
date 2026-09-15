using System.Diagnostics;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Globalization;

namespace WorkspaceObservatory;

// Owner-local history only. Never expose this bridge to web or peer requests.
internal static class QuotaArchive
{
    internal static async Task BridgeSelfTest()
    {
        var runtime = Path.Combine(Path.GetTempPath(), "observatory-archive-bridge-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(runtime);
        try
        {
            var empty = await Run(runtime, new JsonObject { ["action"] = "accounts" }, CancellationToken.None);
            if (empty["accounts"]!.AsArray().Count != 0 || Directory.EnumerateFileSystemEntries(runtime).Any())
                throw new Exception("Opening history created storage.");
            var rejected = false;
            try { await Run(runtime, new JsonObject { ["action"] = "delete" }, CancellationToken.None); }
            catch (InvalidOperationException) { rejected = true; }
            if (!rejected) throw new Exception("Unsupported history action accepted.");

            // Write fictional observations only inside this newly created test runtime.
            const string fixture = """
                import {pathToFileURL} from 'node:url';
                const {readQuotaState,updateQuotaState}=await import(pathToFileURL(process.argv[1]).href);
                const root=process.argv[2],start=Date.parse('2025-01-01T12:00:00Z');
                for(let i=0;i<2;i++) {
                  const before=await readQuotaState(root,start+i);
                  await updateQuotaState(root,{revision:before.revision,scope:'a'.repeat(64),enabled:true,
                    observation:{status:'ok',checkedAt:new Date(start+i).toISOString(),
                      windows:[{bucket:'codex',window:'primary',remainingPercent:70-i*10}]}},start+i);
                }
                """;
            using var seed = new Process { StartInfo = new(Path.Combine(AppContext.BaseDirectory, "Runtime", "node.exe"))
                { UseShellExecute = false, CreateNoWindow = true } };
            foreach (var arg in new[] { "--input-type=module", "--eval", fixture,
                Path.Combine(AppContext.BaseDirectory, "Collector", "scripts", "quota-store.mjs"), runtime }) seed.StartInfo.ArgumentList.Add(arg);
            seed.Start();
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
            try { await seed.WaitForExitAsync(timeout.Token); }
            catch { if (!seed.HasExited) seed.Kill(true); await seed.WaitForExitAsync(); throw; }
            if (seed.ExitCode != 0) throw new Exception("Synthetic archive setup failed.");
            var accounts = await Run(runtime, new JsonObject { ["action"] = "accounts" }, CancellationToken.None);
            if (accounts["accounts"]!.AsArray().Count != 1) throw new Exception("Saved account bridge failed.");
            var query = new JsonObject { ["action"] = "page", ["scope"] = new string('a', 64), ["kind"] = "observation",
                ["from"] = 1735732800000L, ["to"] = 1735732800001L, ["limit"] = 1 };
            var first = await Run(runtime, query, CancellationToken.None);
            if (first["records"]!.AsArray().Count != 1 || first["next"] is null) throw new Exception("Archive bridge first page failed.");
            query["after"] = first["next"]!.DeepClone();
            var second = await Run(runtime, query, CancellationToken.None);
            if (second["records"]!.AsArray().Count != 1 || second["next"] is not null ||
                first["records"]![0]!["checkedAt"]!.ToJsonString() == second["records"]![0]!["checkedAt"]!.ToJsonString())
                throw new Exception("Archive bridge pagination failed.");
            using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
            rejected = false;
            try { await Run(runtime, query, cancelled.Token); } catch (OperationCanceledException) { rejected = true; }
            if (!rejected) throw new Exception("Cancelled archive read proceeded.");
            Console.WriteLine("Packaged allowance archive bridge passed with isolated fictional records.");
        }
        finally { Directory.Delete(runtime, recursive: true); }
    }
    internal static JsonObject Parse(string text)
    {
        if (text.Length > 600000 || JsonNode.Parse(text) is not JsonObject value ||
            value["version"]?.GetValue<int>() != 1 ||
            new[] { value["accounts"] is JsonArray, value["records"] is JsonArray, value["chart"] is JsonObject }.Count(found => found) != 1 ||
            (value["accounts"] is JsonArray accounts && accounts.Count > 100) ||
            (value["records"] is JsonArray records && records.Count > 200))
            throw new InvalidOperationException("Invalid archive response.");
        static bool Integer(JsonNode? node, long maximum = 9007199254740991) =>
            node is JsonValue item && item.TryGetValue<long>(out var number) && number >= 0 && number <= maximum;
        static bool Scope(JsonNode? node) => node is JsonValue item && item.TryGetValue<string>(out var scope) && Regex.IsMatch(scope, "^[a-f0-9]{64}$");
        static bool Stamp(JsonNode? node) => node is JsonValue item && item.TryGetValue<string>(out var stamp) &&
            DateTimeOffset.TryParse(stamp, CultureInfo.InvariantCulture, DateTimeStyles.None, out var date) && date >= DateTimeOffset.UnixEpoch;
        static void Require(bool condition) { if (!condition) throw new InvalidOperationException("Invalid archive response."); }
        if (value["accounts"] is JsonArray catalogue)
        {
            Require(Integer(value["storageBytes"]) && value["storageLimitBytes"]?.GetValue<long>() == 8589934592L);
            var scopes = new HashSet<string>();
            foreach (var item in catalogue)
            {
                Require(item is JsonObject && Scope(item["scope"]) && Integer(item["records"]) && item["records"]!.GetValue<long>() > 0 &&
                    Integer(item["firstAt"], 8640000000000000) && Integer(item["lastAt"], 8640000000000000) &&
                    item["lastAt"]!.GetValue<long>() >= item["firstAt"]!.GetValue<long>() &&
                    item["current"] is JsonValue current && current.TryGetValue<bool>(out _) && scopes.Add(item["scope"]!.GetValue<string>()));
            }
            Require(value["next"] is null || (Scope(value["next"]) && catalogue.Count > 0 && JsonNode.DeepEquals(value["next"], catalogue[^1]?["scope"])));
        }
        if (value["records"] is JsonArray readings)
        {
            foreach (var item in readings)
            {
                Require(item is JsonObject && Stamp(item["checkedAt"]));
                if (item!["windows"] is JsonArray windows)
                {
                    Require(windows.Count is > 0 and <= 32 && item["tokens"] is null && item["status"] is null);
                    foreach (var window in windows)
                        Require(window is JsonObject && Regex.IsMatch(Snapshot.Text(window["bucket"], ""), "^[a-zA-Z0-9_-]{1,80}$") &&
                            Snapshot.Text(window["window"]) is "primary" or "secondary" &&
                            Snapshot.Number(window["remainingPercent"]) is double percent && double.IsFinite(percent) && percent >= 0 && percent <= 100);
                }
                else if (item["tokens"] is not null)
                    Require(Integer(item["tokens"]) && item["status"] is null && DateOnly.TryParseExact(Snapshot.Text(item["startDate"]),
                        "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _));
                else Require(Snapshot.Text(item["status"]) is "ok" or "unavailable" or "needs-auth" or "unsupported" or "rate-limited");
            }
            if (value["next"] is JsonNode cursor)
                Require(cursor is JsonObject page && page.Count == 2 && Integer(page["at"], 8640000000000000) && Integer(page["id"]) && page["id"]!.GetValue<long>() > 0 && readings.Count > 0);
        }
        if (value["chart"] is JsonObject chart) {
            Require(value["next"] is null);
            _ = ArchiveChart.Parse(chart);
        }
        return value;
    }

    internal static async Task<JsonObject> Run(string runtime, JsonObject request, CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (!Path.IsPathFullyQualified(runtime) || !Directory.Exists(runtime) ||
            File.GetAttributes(runtime).HasFlag(FileAttributes.ReparsePoint))
            throw new InvalidOperationException("Invalid archive runtime.");
        var input = request.ToJsonString();
        if (Encoding.UTF8.GetByteCount(input) > 2048) throw new InvalidOperationException("Archive request too large.");
        var node = Path.Combine(AppContext.BaseDirectory, "Runtime", "node.exe");
        var script = Path.Combine(AppContext.BaseDirectory, "Collector", "scripts", "quota-archive-control.mjs");
        using var process = new Process { StartInfo = new(node) { UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true } };
        foreach (var arg in new[] { script, "--runtime", runtime }) process.StartInfo.ArgumentList.Add(arg);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        timeout.CancelAfter(TimeSpan.FromSeconds(20));
        process.Start();
        // Kill also unblocks pending pipe reads. Never retain unbounded helper output.
        using var registration = timeout.Token.Register(() => { try { if (!process.HasExited) process.Kill(true); } catch (InvalidOperationException) { } catch (System.ComponentModel.Win32Exception) { } });
        async Task<string> ReadBounded(StreamReader reader, int limit)
        {
            var buffer = new char[4096]; var output = new StringBuilder();
            int count;
            while ((count = await reader.ReadAsync(buffer.AsMemory(), timeout.Token)) != 0)
            {
                if (output.Length + count > limit) { process.Kill(true); throw new InvalidOperationException("Archive output too large."); }
                output.Append(buffer, 0, count);
            }
            return output.ToString();
        }
        var output = ReadBounded(process.StandardOutput, 600000);
        var error = ReadBounded(process.StandardError, 4096);
        try
        {
            await process.StandardInput.WriteAsync(input.AsMemory(), timeout.Token);
            process.StandardInput.Close();
            await Task.WhenAll(output, error);
            await process.WaitForExitAsync(timeout.Token);
            timeout.Token.ThrowIfCancellationRequested();
            if (process.ExitCode != 0) throw new InvalidOperationException("Saved history is unavailable.");
            return Parse(await output);
        }
        catch
        {
            if (!process.HasExited) process.Kill(true);
            await process.WaitForExitAsync();
            try { await Task.WhenAll(output, error); } catch { }
            throw;
        }
    }

    internal static void SelfTest()
    {
        Parse("{\"version\":1,\"accounts\":[],\"next\":null,\"storageBytes\":0,\"storageLimitBytes\":8589934592}");
        Parse("{\"version\":1,\"records\":[],\"next\":null}");
        if (QuotaArchiveWindow.ReadingText(JsonNode.Parse("{\"windows\":[{\"bucket\":\"codex\",\"window\":\"weekly\",\"remainingPercent\":42}]}")) != "codex weekly: 42% remaining")
            throw new Exception("Archive percentage formatting failed.");
        if (QuotaArchiveWindow.ReadingText(JsonNode.Parse("{\"tokens\":123,\"startDate\":\"2026-09-14\"}")) != "2026-09-14: 123 reported tokens")
            throw new Exception("Archive token formatting failed.");
        foreach (var invalid in new[] { "{}", "{\"version\":2,\"records\":[]}", "{\"version\":1,\"accounts\":[],\"records\":[]}",
            "{\"version\":1,\"records\":[null]}",
            "{\"version\":1,\"records\":[{\"checkedAt\":\"bad\",\"status\":\"ok\"}]}",
            "{\"version\":1,\"records\":[],\"next\":{\"at\":0,\"id\":0}}",
            "{\"version\":1,\"accounts\":[],\"next\":\"not-a-scope\",\"storageBytes\":0,\"storageLimitBytes\":8589934592}",
            "{\"version\":1,\"records\":[{\"checkedAt\":\"2026-09-14T00:00:00Z\",\"tokens\":-1,\"startDate\":\"2026-09-14\"}]}",
            "{\"version\":1,\"records\":[{\"checkedAt\":\"2026-09-14T00:00:00Z\",\"windows\":[{\"bucket\":\"codex\",\"window\":\"primary\",\"remainingPercent\":101}]}]}" })
        {
            var rejected = false;
            try { Parse(invalid); } catch { rejected = true; }
            if (!rejected) throw new Exception("Invalid archive response accepted.");
        }
        QuotaArchiveWindow.SelfTest();
    }
}

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

    internal QuotaArchiveWindow(Func<JsonObject, CancellationToken, Task<JsonObject>> read)
    {
        this.read = read;
        Font = DashboardTypography.AtPixels(14.5f);
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
        from.MinDate = through.MinDate = new DateTime(1970, 1, 2);
        from.MaxDate = through.MaxDate = new DateTime(9998, 12, 31);
        var filters = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, Padding = new Padding(12), WrapContents = true };
        kind.Items.AddRange(["Observations", "Daily tokens", "Collection results"]); kind.SelectedIndex = 0;
        var done = new DashboardButton { Text = "Done", AutoSize = true, DialogResult = DialogResult.Cancel };
        filters.Controls.AddRange([new Label { Text = "Account", AutoSize = true }, account, more, new Label { Text = "From", AutoSize = true }, from,
            new Label { Text = "Through", AutoSize = true }, through, new Label { Text = "Record type", AutoSize = true }, kind, allDates, load, next, done]);
        var footer = new FlowLayoutPanel { Dock = DockStyle.Bottom, AutoSize = true, Padding = new Padding(12) };
        footer.Controls.Add(status);
        Controls.Add(rows); Controls.Add(charts); Controls.Add(filters); Controls.Add(footer);
        charts.SizeChanged += (_, _) => {
            foreach (Control control in charts.Controls)
                if (control is QuotaGraph or DashboardFilters or ArchiveChartControl) control.Width = Math.Max(240, charts.ClientSize.Width - 32);
        };
        allDates.Click += (_, _) => {
            if (account.SelectedIndex < 0) return;
            var selected = accounts[account.SelectedIndex];
            if (Snapshot.Number(selected?["firstAt"]) is double first && Snapshot.Number(selected?["lastAt"]) is double last)
            {
                from.Value = DateTimeOffset.FromUnixTimeMilliseconds((long)first).LocalDateTime;
                through.Value = DateTimeOffset.FromUnixTimeMilliseconds((long)last).LocalDateTime;
            }
        };
        rows.Columns.Add("time", "Recorded at"); rows.Columns.Add("value", "Saved reading");
        CancelButton = done; AcceptButton = load;
        load.Click += async (_, _) => await LoadPage(false);
        next.Click += async (_, _) => await LoadPage(true);
        more.Click += async (_, _) => await LoadAccounts(accountNext);
        account.SelectedIndexChanged += (_, _) => InvalidatePage();
        kind.SelectedIndexChanged += (_, _) => InvalidatePage();
        from.ValueChanged += (_, _) => InvalidatePage(); through.ValueChanged += (_, _) => InvalidatePage();
        Shown += async (_, _) => await LoadAccounts(null);
        FormClosed += (_, _) => lifetime.Cancel();
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
    }
    private Task LoadFullChart(JsonObject window)
    {
        if (busy || account.SelectedIndex < 0 || from.Value.Date > through.Value.Date) return Task.CompletedTask;
        var request = new JsonObject { ["action"] = "chart", ["scope"] = accounts[account.SelectedIndex]?["scope"]?.DeepClone(),
            ["bucket"] = window["bucket"]?.DeepClone(), ["window"] = window["window"]?.DeepClone(),
            ["from"] = new DateTimeOffset(from.Value.Date).ToUnixTimeMilliseconds(),
            ["to"] = new DateTimeOffset(through.Value.Date.AddDays(1)).ToUnixTimeMilliseconds() - 1 };
        return Execute(async () => {
            var reply = await read(request, lifetime.Token);
            if (IsDisposed) return;
            var chart = ArchiveChart.Parse(reply["chart"] as JsonObject ?? throw new InvalidOperationException("Chart unavailable."));
            foreach (Control control in charts.Controls.Cast<Control>().ToArray()) { charts.Controls.Remove(control); control.Dispose(); }
            charts.Controls.Add(new Label { AutoSize = true, Text = Snapshot.Text(window["bucket"]) + " · " + Snapshot.Text(window["window"]) + " · Allowance used, full selected range" });
            charts.Controls.Add(new ArchiveChartControl(chart) { Width = Math.Max(240, charts.ClientSize.Width - 32), BackColor = DashboardCard.Surface, ForeColor = Color.WhiteSmoke });
            status.Text = $"{chart.Observations:N0} observations processed. Dashed spans mean unknown coverage. Raw records remain paginated.";
        });
    }
    internal static string ReadingText(JsonNode? item) => item?["windows"] is JsonArray windows
        ? string.Join(" · ", windows.Where(w => Snapshot.Text(w?["bucket"]) is not ("spark" or "codex_spark" or "codex_bengalfox"))
            .Select(w => $"{Snapshot.Text(w?["bucket"])} {Snapshot.Text(w?["window"])}: {Snapshot.Format(Snapshot.Number(w?["remainingPercent"]))}% remaining"))
        : item?["tokens"] is not null ? $"{Snapshot.Text(item["startDate"])}: {Snapshot.Format(Snapshot.Number(item["tokens"]))} reported tokens" : Snapshot.Text(item?["status"]);

    internal static void SelfTest()
    {
        var calls = new List<JsonObject>();
        using var window = new QuotaArchiveWindow((request, _) =>
        {
            calls.Add((JsonObject)request.DeepClone());
            return Task.FromResult(request["action"]!.GetValue<string>() == "accounts"
                ? new JsonObject { ["version"] = 1, ["accounts"] = new JsonArray(new JsonObject { ["scope"] = new string('a', 64), ["current"] = true }) }
                : new JsonObject { ["version"] = 1, ["records"] = new JsonArray(new JsonObject { ["checkedAt"] = "2026-09-14T00:00:00Z", ["status"] = "ok" }),
                    ["next"] = request["after"] is null ? new JsonObject { ["at"] = 1, ["id"] = 1 } : null });
        });
        window.LoadAccounts(null).GetAwaiter().GetResult();
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
        Task? pending = null; Exception? failure = null;
        using var window = new QuotaArchiveWindow(async (request, token) =>
        {
            if (mode == "failed") throw new IOException("Synthetic read failure");
            if (mode == "pending")
            {
                using var registration = token.Register(() => cancelled = true);
                await Task.Delay(Timeout.Infinite, token);
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
                if (!window.charts.Controls.OfType<QuotaGraph>().Any()) throw new Exception("Saved allowance graph missing.");
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
