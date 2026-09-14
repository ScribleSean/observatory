using System.Diagnostics;
using System.Text;
using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

// Owner-local history only. Never expose this bridge to web or peer requests.
internal static class QuotaArchive
{
    internal static JsonObject Parse(string text)
    {
        if (text.Length > 600000 || JsonNode.Parse(text) is not JsonObject value ||
            value["version"]?.GetValue<int>() != 1 ||
            (value["accounts"] is JsonArray) == (value["records"] is JsonArray) ||
            (value["accounts"] is JsonArray accounts && accounts.Count > 100) ||
            (value["records"] is JsonArray records && records.Count > 200))
            throw new InvalidOperationException("Invalid archive response.");
        return value;
    }

    internal static async Task<JsonObject> Run(string runtime, JsonObject request, CancellationToken cancellation)
    {
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
        Parse("{\"version\":1,\"accounts\":[],\"next\":null}");
        Parse("{\"version\":1,\"records\":[],\"next\":null}");
        if (QuotaArchiveWindow.ReadingText(JsonNode.Parse("{\"windows\":[{\"bucket\":\"codex\",\"window\":\"weekly\",\"remainingPercent\":42}]}")) != "codex weekly: 42% remaining")
            throw new Exception("Archive percentage formatting failed.");
        if (QuotaArchiveWindow.ReadingText(JsonNode.Parse("{\"tokens\":123,\"startDate\":\"2026-09-14\"}")) != "2026-09-14: 123 reported tokens")
            throw new Exception("Archive token formatting failed.");
        foreach (var invalid in new[] { "{}", "{\"version\":2,\"records\":[]}", "{\"version\":1,\"accounts\":[],\"records\":[]}" })
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
    private readonly Button load = new() { Text = "Load history", AutoSize = true };
    private readonly Button next = new() { Text = "Next page", AutoSize = true, Enabled = false };
    private readonly Button more = new() { Text = "More accounts", AutoSize = true, Enabled = false };
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
        Text = "Saved allowance history"; AccessibleName = Text;
        ClientSize = new Size(820, 560); MinimumSize = new Size(700, 460); StartPosition = FormStartPosition.CenterParent;
        from.MinDate = through.MinDate = new DateTime(1970, 1, 2);
        from.MaxDate = through.MaxDate = new DateTime(9998, 12, 31);
        var filters = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, Padding = new Padding(12), WrapContents = true };
        kind.Items.AddRange(["Observations", "Daily tokens", "Collection results"]); kind.SelectedIndex = 0;
        var done = new Button { Text = "Done", AutoSize = true, DialogResult = DialogResult.Cancel };
        filters.Controls.AddRange([account, more, new Label { Text = "From", AutoSize = true }, from,
            new Label { Text = "Through", AutoSize = true }, through, kind, load, next, done]);
        var footer = new FlowLayoutPanel { Dock = DockStyle.Bottom, AutoSize = true, Padding = new Padding(12) };
        footer.Controls.Add(status);
        Controls.Add(rows); Controls.Add(filters); Controls.Add(footer);
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
        pageNext = null; rows.Rows.Clear(); UpdateButtons();
        status.Text = "This PC only. Choose filters and load saved history. These are not live readings or device totals.";
    }
    private void UpdateButtons()
    {
        account.Enabled = kind.Enabled = from.Enabled = through.Enabled = !busy;
        load.Enabled = !busy && account.SelectedIndex >= 0 && from.Value.Date <= through.Value.Date;
        next.Enabled = load.Enabled && pageNext is not null;
        more.Enabled = !busy && accountNext is not null;
    }
    private async Task Execute(Func<Task> action)
    {
        if (busy) return;
        busy = true; UpdateButtons(); status.Text = "Reading saved history…";
        try { await action(); }
        catch { if (!IsDisposed) status.Text = "Saved history could not be read. No history was deleted."; }
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
        if (!load.Enabled || (advance && pageNext is null)) return Task.CompletedTask;
        var request = new JsonObject { ["action"] = "page", ["scope"] = accounts[account.SelectedIndex]?["scope"]?.DeepClone(),
            ["kind"] = new[] { "observation", "daily", "poll" }[kind.SelectedIndex],
            ["from"] = new DateTimeOffset(from.Value.Date).ToUnixTimeMilliseconds(),
            ["to"] = new DateTimeOffset(through.Value.Date.AddDays(1)).ToUnixTimeMilliseconds() - 1, ["limit"] = 100 };
        if (advance) request["after"] = pageNext!.DeepClone();
        return Execute(async () =>
        {
            var reply = await read(request, lifetime.Token);
            if (IsDisposed) return;
            var records = reply["records"] as JsonArray ?? throw new InvalidOperationException();
            rows.Rows.Clear();
            foreach (var item in records)
            {
                rows.Rows.Add(Snapshot.Text(item?["checkedAt"]), ReadingText(item));
            }
            pageNext = reply["next"]?.DeepClone();
            status.Text = $"{records.Count} saved readings on this page. " + (pageNext is null ? "End of results." : "More readings available.");
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
        window.LoadPage(true).GetAwaiter().GetResult();
        if (window.next.Enabled || calls[^1]["after"]?["id"]?.GetValue<int>() != 1) throw new Exception("Archive cursor failed.");
        window.LoadPage(true).GetAwaiter().GetResult();
        if (calls.Count != 3) throw new Exception("Disabled archive pagination performed a read.");
        window.kind.SelectedIndex = 1;
        if (window.rows.Rows.Count != 0 || window.next.Enabled) throw new Exception("Changed archive filters retained old page.");
        window.from.Value = window.through.Value.AddDays(1);
        window.LoadPage(false).GetAwaiter().GetResult();
        if (calls.Count != 3 || window.load.Enabled) throw new Exception("Invalid archive dates performed a read.");
    }
    protected override void Dispose(bool disposing)
    {
        var release = disposing && !released;
        if (release) { released = true; lifetime.Cancel(); }
        base.Dispose(disposing);
        if (release) lifetime.Dispose();
    }
}
