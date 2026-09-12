using System.Diagnostics;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace WorkspaceObservatory;

internal sealed class Collector : IDisposable
{
    private readonly string runtime;
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 300000 };
    private readonly CancellationTokenSource lifetime = new();
    private bool busy;
    private bool pairingPaused;
    internal event Action? Changed;

    internal Collector(string runtime)
    {
        this.runtime = runtime;
        Directory.CreateDirectory(Path.Combine(runtime, "public", "local"));
        timer.Tick += async (_, _) => await Refresh();
    }

    internal void Start() { timer.Start(); _ = Refresh(); }
    internal bool Configured => File.Exists(Path.Combine(runtime, "collector.config.json"));
    internal bool Busy => busy;

    internal Task DisconnectPairing() => MaintainPairing(false);
    internal Task PreparePairingRepair() => MaintainPairing(true);

    internal async Task<QuotaSharingStatus> Sharing(string action, string? token)
    {
        if (busy || lifetime.IsCancellationRequested || !FirstRunSetup.AllowsCollection(runtime))
            throw new InvalidOperationException("Collection or setup is active. Try again after it finishes.");
        busy = true;
        try
        {
            using var locked = new FileStream(Path.Combine(runtime, "collection.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
            return await QuotaSharing.Run(runtime, action, token, lifetime.Token);
        }
        finally { busy = false; }
    }

    private async Task MaintainPairing(bool repair)
    {
        // The timer may have started work while the confirmation was open.
        // Preserve the request to stop future collection even in that race.
        pairingPaused = true;
        if (busy || lifetime.IsCancellationRequested) throw new InvalidOperationException("A local operation is running.");
        busy = true;
        try
        {
            using var locked = new FileStream(Path.Combine(runtime, "collection.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
            if (repair) await PairingMaintenance.PrepareRepair(runtime, lifetime.Token);
            else await PairingMaintenance.Disconnect(runtime, lifetime.Token);
            pairingPaused = false;
        }
        finally { busy = false; }
    }

    internal void Configure(string? distro, bool wispr = false, bool quota = false, string? quotaDistro = null, bool activity = true, bool codex = true)
    {
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
        if (busy || !FirstRunSetup.AllowsCollection(runtime)) throw new InvalidOperationException("Collection or setup is active. Try again after it finishes.");
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

    internal async Task Refresh()
    {
        if (busy || pairingPaused || !Configured || lifetime.IsCancellationRequested) return;
        if (!FirstRunSetup.AllowsCollection(runtime)) return;
        busy = true;
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
                var file = Path.Combine(runtime, "public", "local", "collector.json");
                var status = new JsonObject { ["state"] = "failed", ["finishedAt"] = DateTimeOffset.UtcNow.ToString("O"), ["intervalSeconds"] = 300 };
                File.WriteAllText(file + ".tmp", status.ToJsonString()); File.Move(file + ".tmp", file, true);
            }
            catch { }
        }
        finally { busy = false; if (!lifetime.IsCancellationRequested) Changed?.Invoke(); }
    }

    public void Dispose() { timer.Stop(); timer.Dispose(); lifetime.Cancel(); lifetime.Dispose(); }
}
