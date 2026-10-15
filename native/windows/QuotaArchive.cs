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
            var chartReply = await Run(runtime, new JsonObject { ["action"] = "chart", ["scope"] = new string('a', 64),
                ["from"] = 1735732800000L, ["to"] = 1735732801000L, ["bucket"] = "codex", ["window"] = "primary" }, CancellationToken.None);
            var chart = ArchiveChart.Parse(chartReply["chart"]!.AsObject());
            if (chart.Observations != 2 || chart.Gaps != 0 || chart.Pixels.Length != 1024 * 160)
                throw new Exception("Archive full-range chart bridge failed.");
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
    }
}
