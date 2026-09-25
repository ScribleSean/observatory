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
    private readonly TrustedSyncProcess trustedSync;
    private bool pairingPaused;
    private bool resumePending;
    internal event Action? Changed;

    internal Collector(string runtime)
    {
        this.runtime = runtime;
        trustedSync = new TrustedSyncProcess(runtime);
        Directory.CreateDirectory(Path.Combine(runtime, "public", "local"));
        timer.Tick += async (_, _) => await Refresh();
        allowanceTimer.Tick += async (_, _) => await RefreshAfterResumeOrAllowances();
    }

    internal void Start() { if (operations.Stopping) return; timer.Start(); allowanceTimer.Start(); EnsureTrustedSync(); _ = Refresh(); }
    private void EnsureTrustedSync()
    {
        if (Busy) return;
        if (pairingPaused || lifetime.IsCancellationRequested || !Configured || !FirstRunSetup.AllowsCollection(runtime) ||
            !File.Exists(Path.Combine(runtime, "private-sync", "tls-trust.json"))) { trustedSync.RequestStop(); return; }
        try { trustedSync.Resume(); trustedSync.EnsureStarted(); } catch { /* Retry on the next normal tick. */ }
    }
    internal bool Configured => File.Exists(Path.Combine(runtime, "collector.config.json"));
    internal bool Busy => operations.Busy || operations.Stopping;

    // Queue only. Never perform file or network work inside a power broadcast.
    internal void RequestResumeRefresh() { if (!lifetime.IsCancellationRequested) resumePending = true; }

    private async Task RefreshAfterResumeOrAllowances()
    {
        EnsureTrustedSync();
        if (resumePending)
        {
            if (Busy || pairingPaused || lifetime.IsCancellationRequested) return;
            resumePending = false;
            await Refresh();
            return;
        }
        await RefreshAllowancesIfDue();
    }

    internal async Task<bool> StopGracefully(TimeSpan timeout)
    {
        if (timeout <= TimeSpan.Zero || timeout > TimeSpan.FromMinutes(5))
            throw new ArgumentOutOfRangeException(nameof(timeout));
        var restartTimer = timer.Enabled;
        var restartAllowanceTimer = allowanceTimer.Enabled;
        timer.Stop();
        allowanceTimer.Stop();
        try
        {
            await operations.Stop().WaitAsync(timeout);
            if (!await trustedSync.Stop(TimeSpan.FromSeconds(5))) throw new TimeoutException();
            return true;
        }
        catch (TimeoutException)
        {
            operations.Resume();
            trustedSync.Resume();
            if (restartTimer) timer.Start();
            if (restartAllowanceTimer) allowanceTimer.Start();
            return false;
        }
    }

    internal Task DisconnectPairing() => MaintainPairing(false);
    internal Task PreparePairingRepair() => MaintainPairing(true);

    internal Action<bool> BeginDirectPairing()
    {
        if (pairingPaused || lifetime.IsCancellationRequested || !FirstRunSetup.AllowsCollection(runtime) || !operations.TryBegin())
            throw new InvalidOperationException("Collection or setup is active.");
        var released = 0;
        return exitVerified =>
        {
            if (Interlocked.Exchange(ref released, 1) != 0) return;
            // Retain a collection pause if the owned helper may still be writing.
            if (!exitVerified) pairingPaused = true;
            operations.Complete();
        };
    }

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

    internal void Configure(string? distro, bool wispr = false, bool quota = false, string? quotaDistro = null, bool activity = true, bool codex = true, bool claude = false)
    {
        if (Busy) throw new InvalidOperationException("Collection or shutdown is active.");
        if (distro is not null && !Regex.IsMatch(distro, "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")) throw new ArgumentException("Invalid distribution");
        if (quotaDistro is not null && !Regex.IsMatch(quotaDistro, "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")) throw new ArgumentException("Invalid quota distribution");
        var file = Path.Combine(runtime, "collector.config.json");
        var settings = new JsonObject { ["activity"] = activity, ["codex"] = codex, ["claude"] = claude, ["wispr"] = wispr, ["wslDistribution"] = distro, ["quota"] = quota, ["quotaWslDistribution"] = quotaDistro };
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
        // Older settings views do not expose this opt-in source yet. Preserve
        // their save path while writing a secure default for legacy config.
        if (desired["claude"] is JsonNode claude)
        {
            if (claude is not JsonValue value || !value.TryGetValue<bool>(out var enabled)) throw new ArgumentException("Invalid source setting.");
            current["claude"] = enabled;
        }
        else current["claude"] ??= false;
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

    internal Task Refresh() => Refresh(quotaOnly: false);

    private static void WriteAttemptStatus(string runtime, bool quotaOnly, string state)
    {
        var file = Path.Combine(runtime, "public", "local", quotaOnly ? "allowance-collector.json" : "collector.json");
        var status = new JsonObject { ["state"] = state, ["intervalSeconds"] = 300 };
        status[state == "running" ? "startedAt" : "finishedAt"] = DateTimeOffset.UtcNow.ToString("O");
        if (quotaOnly) status["mode"] = "allowances-only";
        var temporary = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try { File.WriteAllText(temporary, status.ToJsonString()); File.Move(temporary, file, true); }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    private async Task Refresh(bool quotaOnly)
    {
        if (pairingPaused || !Configured || lifetime.IsCancellationRequested) return;
        if (!FirstRunSetup.AllowsCollection(runtime)) return;
        if (!operations.TryBegin()) return;
        if (!quotaOnly) resumePending = false;
        try
        {
            // Serialize app and command-line collection without relying on a stale PID file.
            using var locked = new FileStream(Path.Combine(runtime, "collection.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
            var node = Path.Combine(AppContext.BaseDirectory, "Runtime", "node.exe");
            if (!File.Exists(node)) node = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe");
            var script = Path.Combine(AppContext.BaseDirectory, "Collector", "scripts", "collect-windows.mjs");
            if (!File.Exists(node) || !File.Exists(script)) throw new InvalidOperationException("Collector runtime unavailable");
            if (quotaOnly) WriteAttemptStatus(runtime, true, "running");
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
            if (quotaOnly) WriteAttemptStatus(runtime, true, "ok");
        }
        catch (IOException) { /* An existing collector or unavailable storage remains visible through freshness. */ }
        catch
        {
            try
            {
                WriteAttemptStatus(runtime, quotaOnly, "failed");
            }
            catch { }
        }
        finally { operations.Complete(); if (!lifetime.IsCancellationRequested) Changed?.Invoke(); }
    }

    public void Dispose() { trustedSync.RequestStop(); timer.Stop(); timer.Dispose(); allowanceTimer.Stop(); allowanceTimer.Dispose(); lifetime.Cancel(); lifetime.Dispose(); }

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
            var local = Path.Combine(root, "public", "local");
            Directory.CreateDirectory(local);
            var heavyStatus = Path.Combine(local, "collector.json");
            File.WriteAllText(heavyStatus, "Full collection freshness must not change.");
            foreach (var state in new[] { "failed", "running", "ok" })
            {
                WriteAttemptStatus(root, true, state);
                var attempt = Snapshot.Read(Path.Combine(local, "allowance-collector.json"));
                if (Snapshot.Text(attempt?["state"]) != state || Snapshot.Text(attempt?["mode"]) != "allowances-only" ||
                    !DateTimeOffset.TryParse(Snapshot.Text(attempt?[state == "running" ? "startedAt" : "finishedAt"]), out _))
                    throw new Exception("Allowance attempt status did not advance.");
            }
            if (File.ReadAllText(heavyStatus) != "Full collection freshness must not change." || Directory.GetFiles(local, "*.tmp").Length != 0)
                throw new Exception("Allowance attempt changed full collection status or left temporary files.");
            using var collector = new Collector(root);
            collector.RequestResumeRefresh();
            collector.RequestResumeRefresh();
            collector.pairingPaused = true;
            collector.RefreshAfterResumeOrAllowances().GetAwaiter().GetResult();
            if (!collector.resumePending) throw new Exception("Pairing pause lost pending resume.");
            collector.pairingPaused = false;
            collector.operations.TryBegin();
            collector.RefreshAfterResumeOrAllowances().GetAwaiter().GetResult();
            if (!collector.resumePending) throw new Exception("Busy collector lost pending resume.");
            collector.operations.Complete();
            collector.operations.Stop().GetAwaiter().GetResult();
            collector.RefreshAfterResumeOrAllowances().GetAwaiter().GetResult();
            if (!collector.resumePending) throw new Exception("Shutdown allowed pending resume work.");
            collector.operations.Resume();
            collector.RefreshAfterResumeOrAllowances().GetAwaiter().GetResult();
            if (collector.resumePending || File.Exists(Path.Combine(root, "collection.lock")) ||
                File.ReadAllText(heavyStatus) != "Full collection freshness must not change.")
                throw new Exception("Unconfigured resume bypassed collection consent.");
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
            collector.Configure(null, activity: false, codex: false);
            var releasePairing = collector.BeginDirectPairing();
            if (!collector.Busy || collector.operations.TryBegin()) throw new Exception("Pairing did not reserve collection.");
            var duplicateDenied = false;
            try { collector.BeginDirectPairing(); } catch (InvalidOperationException) { duplicateDenied = true; }
            if (!duplicateDenied) throw new Exception("Concurrent pairing was permitted.");
            var pairingDrain = collector.StopGracefully(TimeSpan.FromSeconds(2));
            if (pairingDrain.IsCompleted) throw new Exception("Shutdown did not wait for pairing.");
            releasePairing(true); releasePairing(false);
            if (!pairingDrain.GetAwaiter().GetResult() || collector.pairingPaused) throw new Exception("Verified pairing cleanup failed.");
            collector.operations.Resume();
            collector.BeginDirectPairing()(false);
            if (!collector.pairingPaused || collector.Busy) throw new Exception("Unverified helper exit did not preserve collection pause.");
            collector.Refresh().GetAwaiter().GetResult();
            if (File.ReadAllText(heavyStatus) != "Full collection freshness must not change.") throw new Exception("Paused pairing allowed collection.");
            collector.pairingPaused = false;
            if (!collector.StopGracefully(TimeSpan.FromSeconds(1)).GetAwaiter().GetResult()) throw new Exception("Idle shutdown failed.");
            if (File.ReadAllText(sentinel) != "Synthetic saved history. Do not change.") throw new Exception("Shutdown changed saved data.");
            Console.WriteLine("Collector shutdown waits, blocks settings, preserves work and resumes after timeout.");
        }
        finally { Directory.Delete(root, recursive: true); }
    }
}
