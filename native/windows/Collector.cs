using System.Diagnostics;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace WorkspaceObservatory;

internal sealed class Collector : IDisposable
{
    private readonly string runtime;
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 300000 };
    private readonly System.Windows.Forms.Timer allowanceTimer = new() { Interval = 30000 };
    private long nextAllowanceAttemptTick;
    private readonly CancellationTokenSource lifetime = new();
    private readonly OperationDrain operations = new();
    private bool pairingPaused;
    internal event Action? Changed;

    internal Collector(string runtime)
    {
        this.runtime = runtime;
        Directory.CreateDirectory(Path.Combine(runtime, "public", "local"));
        timer.Tick += async (_, _) => await Refresh();
        allowanceTimer.Tick += async (_, _) => await RefreshAllowancesIfDue();
    }

    internal void Start() { if (operations.Stopping) return; timer.Start(); allowanceTimer.Start(); _ = Refresh(); }
    internal bool Configured => File.Exists(Path.Combine(runtime, "collector.config.json"));
    internal bool Busy => operations.Busy || operations.Stopping;

    internal async Task<bool> StopGracefully(TimeSpan timeout)
    {
        if (timeout <= TimeSpan.Zero || timeout > TimeSpan.FromMinutes(5))
            throw new ArgumentOutOfRangeException(nameof(timeout));
        var restartTimer = timer.Enabled;
        var restartAllowanceTimer = allowanceTimer.Enabled;
        timer.Stop();
        allowanceTimer.Stop();
        try { await operations.Stop().WaitAsync(timeout); return true; }
        catch (TimeoutException)
        {
            operations.Resume();
            if (restartTimer) timer.Start();
            if (restartAllowanceTimer) allowanceTimer.Start();
            return false;
        }
    }

    internal Task DisconnectPairing() => MaintainPairing(false);
    internal Task PreparePairingRepair() => MaintainPairing(true);

    internal async Task<QuotaSharingStatus> Sharing(string action, string? token)
    {
        if (lifetime.IsCancellationRequested || !FirstRunSetup.AllowsCollection(runtime) || !operations.TryBegin())
            throw new InvalidOperationException("Collection or setup is active. Try again after it finishes.");
        try
        {
            using var locked = new FileStream(Path.Combine(runtime, "collection.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
            return await QuotaSharing.Run(runtime, action, token, lifetime.Token);
        }
        finally { operations.Complete(); }
    }

    private async Task MaintainPairing(bool repair)
    {
        // The timer may have started work while the confirmation was open.
        // Preserve the request to stop future collection even in that race.
        pairingPaused = true;
        if (lifetime.IsCancellationRequested || !operations.TryBegin()) throw new InvalidOperationException("A local operation is running.");
        try
        {
            using var locked = new FileStream(Path.Combine(runtime, "collection.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
            if (repair) await PairingMaintenance.PrepareRepair(runtime, lifetime.Token);
            else await PairingMaintenance.Disconnect(runtime, lifetime.Token);
            pairingPaused = false;
        }
        finally { operations.Complete(); }
    }

    internal void Configure(string? distro, bool wispr = false, bool quota = false, string? quotaDistro = null, bool activity = true, bool codex = true)
    {
        if (Busy) throw new InvalidOperationException("Collection or shutdown is active.");
        if (distro is not null && !Regex.IsMatch(distro, "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")) throw new ArgumentException("Invalid distribution");
        if (quotaDistro is not null && !Regex.IsMatch(quotaDistro, "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")) throw new ArgumentException("Invalid quota distribution");
        var file = Path.Combine(runtime, "collector.config.json");
        var settings = new JsonObject { ["activity"] = activity, ["codex"] = codex, ["wispr"] = wispr, ["wslDistribution"] = distro, ["quota"] = quota, ["quotaWslDistribution"] = quotaDistro };
        var temporary = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try { File.WriteAllText(temporary, settings.ToJsonString()); File.Move(temporary, file, true); }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    internal string? Distribution => Snapshot.Read(Path.Combine(runtime, "collector.config.json"))?["wslDistribution"]?.GetValue<string>();

    internal JsonObject ReadConfiguration() => Snapshot.Read(Path.Combine(runtime, "collector.config.json"))
        ?? throw new InvalidOperationException("Source settings are unavailable.");

    internal void UpdateConfiguration(JsonObject expected, JsonObject desired)
    {
        if (Busy || !FirstRunSetup.AllowsCollection(runtime)) throw new InvalidOperationException("Collection or setup is active. Try again after it finishes.");
        using var locked = new FileStream(Path.Combine(runtime, "collection.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        var file = Path.Combine(runtime, "collector.config.json");
        if (File.GetAttributes(file).HasFlag(FileAttributes.ReparsePoint)) throw new InvalidOperationException("Linked configuration is not editable here.");
        var current = ReadConfiguration();
        if (!JsonNode.DeepEquals(current, expected)) throw new InvalidOperationException("Settings changed elsewhere. Reload before saving.");
        foreach (var key in new[] { "activity", "codex", "wispr", "quota" })
        {
            if (desired[key] is not JsonValue value || !value.TryGetValue<bool>(out var enabled)) throw new ArgumentException("Invalid source setting.");
            current[key] = enabled;
        }
        foreach (var key in new[] { "wslDistribution", "quotaWslDistribution" })
        {
            var distro = desired[key]?.GetValue<string>();
            if (distro is not null && !Regex.IsMatch(distro, "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")) throw new ArgumentException("Invalid distribution.");
            current[key] = distro;
        }
        var temporary = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try { File.WriteAllText(temporary, current.ToJsonString()); File.Move(temporary, file, true); }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    internal static bool AllowanceRefreshDue(JsonObject? quota, DateTimeOffset now) =>
        DateTimeOffset.TryParse(Snapshot.Text(quota?["nextAttemptAt"]), out var deadline) && deadline <= now;

    private async Task RefreshAllowancesIfDue()
    {
        if (Busy || pairingPaused || lifetime.IsCancellationRequested || Environment.TickCount64 < nextAllowanceAttemptTick) return;
        try
        {
            if (ReadConfiguration()["quota"]?.GetValue<bool>() != true ||
                !AllowanceRefreshDue(Snapshot.Read(Path.Combine(runtime, "public", "local", "usage.json"))?["quota"] as JsonObject, DateTimeOffset.UtcNow)) return;
            nextAllowanceAttemptTick = Environment.TickCount64 + 60000;
            await Refresh(quotaOnly: true);
        }
        catch { /* Missing or invalid state waits for the normal full refresh. */ }
    }

    internal async Task Refresh(bool quotaOnly = false)
    {
        if (pairingPaused || !Configured || lifetime.IsCancellationRequested) return;
        if (!FirstRunSetup.AllowsCollection(runtime)) return;
        if (!operations.TryBegin()) return;
        try
        {
            // Serialize app and command-line collection without relying on a stale PID file.
            using var locked = new FileStream(Path.Combine(runtime, "collection.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
            var node = Path.Combine(AppContext.BaseDirectory, "Runtime", "node.exe");
            if (!File.Exists(node)) node = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe");
            var script = Path.Combine(AppContext.BaseDirectory, "Collector", "scripts", "collect-windows.mjs");
            if (!File.Exists(node) || !File.Exists(script)) throw new InvalidOperationException("Collector runtime unavailable");
            using var process = new Process { StartInfo = new ProcessStartInfo(node)
                { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true } };
            process.StartInfo.ArgumentList.Add(script);
            if (quotaOnly) process.StartInfo.ArgumentList.Add("--quota-only");
            process.StartInfo.Environment["OBSERVATORY_RUNTIME"] = runtime;
            var python = Path.Combine(AppContext.BaseDirectory, "Runtime", "python", "python.exe");
            if (File.Exists(python)) process.StartInfo.Environment["OBSERVATORY_PYTHON"] = python;
            process.Start();
            var output = process.StandardOutput.ReadToEndAsync();
            var error = process.StandardError.ReadToEndAsync();
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
            timeout.CancelAfter(TimeSpan.FromSeconds(240));
            try { await process.WaitForExitAsync(timeout.Token); }
            catch { if (!process.HasExited) process.Kill(entireProcessTree: true); throw; }
            await Task.WhenAll(output, error);
            if (process.ExitCode != 0) throw new InvalidOperationException("Collection failed");
        }
        catch (IOException) { /* An existing collector or unavailable storage remains visible through freshness. */ }
        catch
        {
            try
            {
                var file = Path.Combine(runtime, "public", "local", quotaOnly ? "allowance-collector.json" : "collector.json");
                var status = new JsonObject { ["state"] = "failed", ["finishedAt"] = DateTimeOffset.UtcNow.ToString("O"), ["intervalSeconds"] = 300 };
                File.WriteAllText(file + ".tmp", status.ToJsonString()); File.Move(file + ".tmp", file, true);
            }
            catch { }
        }
        finally { operations.Complete(); if (!lifetime.IsCancellationRequested) Changed?.Invoke(); }
    }

    public void Dispose() { timer.Stop(); timer.Dispose(); allowanceTimer.Stop(); allowanceTimer.Dispose(); lifetime.Cancel(); lifetime.Dispose(); }

    internal static void ShutdownSelfTest()
    {
        var dueNow = DateTimeOffset.Parse("2026-09-09T12:00:00Z");
        if (!AllowanceRefreshDue(new JsonObject { ["nextAttemptAt"] = "2026-09-09T12:00:00Z" }, dueNow) ||
            !AllowanceRefreshDue(new JsonObject { ["nextAttemptAt"] = "2026-09-09T11:59:00Z" }, dueNow) ||
            AllowanceRefreshDue(new JsonObject { ["nextAttemptAt"] = "2026-09-09T12:00:01Z" }, dueNow) ||
            AllowanceRefreshDue(new JsonObject { ["nextAttemptAt"] = "invalid" }, dueNow) || AllowanceRefreshDue(null, dueNow))
            throw new Exception("Allowance deadline selection failed.");
        var root = Path.Combine(Path.GetTempPath(), "observatory-drain-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            using var collector = new Collector(root);
            var sentinel = Path.Combine(root, "saved-history-test.txt");
            File.WriteAllText(sentinel, "Synthetic saved history. Do not change.");
            if (!collector.operations.TryBegin()) throw new Exception("Test operation did not start.");
            var stopped = collector.StopGracefully(TimeSpan.FromSeconds(2));
            if (stopped.IsCompleted || !collector.Busy) throw new Exception("Collector did not wait for active work.");
            var denied = false;
            try { collector.Configure(null); } catch (InvalidOperationException) { denied = true; }
            if (!denied || File.Exists(Path.Combine(root, "collector.config.json"))) throw new Exception("Configuration changed during shutdown.");
            collector.operations.Complete();
            if (!stopped.GetAwaiter().GetResult()) throw new Exception("Completed collector operation did not drain.");
            if (!collector.operations.Stopping || collector.lifetime.IsCancellationRequested) throw new Exception("Graceful stop cancelled work or resumed prematurely.");

            collector.operations.Resume();
            if (!collector.operations.TryBegin()) throw new Exception("Test operation could not restart.");
            if (collector.StopGracefully(TimeSpan.FromMilliseconds(10)).GetAwaiter().GetResult())
                throw new Exception("Collector shutdown ignored active work.");
            if (!collector.operations.Busy || collector.operations.Stopping || collector.lifetime.IsCancellationRequested)
                throw new Exception("Timeout cancelled work or failed to resume.");
            collector.operations.Complete();
            if (!collector.StopGracefully(TimeSpan.FromSeconds(1)).GetAwaiter().GetResult()) throw new Exception("Idle shutdown failed.");
            if (File.ReadAllText(sentinel) != "Synthetic saved history. Do not change.") throw new Exception("Shutdown changed saved data.");
            Console.WriteLine("Collector shutdown waits, blocks settings, preserves work and resumes after timeout.");
        }
        finally { Directory.Delete(root, recursive: true); }
    }
}
