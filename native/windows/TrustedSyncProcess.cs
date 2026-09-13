using System.Diagnostics;

namespace WorkspaceObservatory;

// One app-owned helper. Closing stdin requests a drain, never a forced kill.
internal sealed class TrustedSyncProcess
{
    private readonly string runtime, node, script;
    private Process? child;
    private bool stopping;
    internal bool Running => child is not null && !child.HasExited;

    internal TrustedSyncProcess(string runtime) : this(runtime,
        Path.Combine(AppContext.BaseDirectory, "Runtime", "node.exe"),
        Path.Combine(AppContext.BaseDirectory, "Collector", "scripts", "peer-tls-service.mjs")) { }

    internal TrustedSyncProcess(string runtime, string node, string script)
    { this.runtime = runtime; this.node = node; this.script = script; }

    internal void EnsureStarted()
    {
        if (stopping || Running) return;
        child?.Dispose(); child = null;
        if (!Path.IsPathFullyQualified(runtime) || !Directory.Exists(runtime) ||
            File.GetAttributes(runtime).HasFlag(FileAttributes.ReparsePoint) ||
            !Path.IsPathFullyQualified(node) || !File.Exists(node) ||
            !Path.GetFileName(node).Equals("node.exe", StringComparison.OrdinalIgnoreCase) ||
            !Path.IsPathFullyQualified(script) || !File.Exists(script)) return;
        var start = new ProcessStartInfo(node) { UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
            WorkingDirectory = runtime };
        foreach (var key in new[] { "NODE_OPTIONS", "NODE_EXTRA_CA_CERTS", "NODE_PATH" }) start.Environment.Remove(key);
        start.ArgumentList.Add(script); start.ArgumentList.Add("--runtime"); start.ArgumentList.Add(Path.GetFullPath(runtime));
        var candidate = new Process { StartInfo = start };
        try
        {
            if (!candidate.Start()) { candidate.Dispose(); return; }
            child = candidate;
            // Fixed-size drains never retain service output or private diagnostics.
            _ = Discard(candidate.StandardOutput); _ = Discard(candidate.StandardError);
        }
        catch { candidate.Dispose(); }
    }

    private static async Task Discard(StreamReader stream)
    {
        var buffer = new char[1024];
        try { while (await stream.ReadAsync(buffer) != 0) { } } catch { }
    }

    internal void RequestStop()
    {
        stopping = true;
        try { child?.StandardInput.Close(); } catch { }
    }

    internal async Task<bool> Stop(TimeSpan timeout)
    {
        if (timeout <= TimeSpan.Zero || timeout > TimeSpan.FromMinutes(5)) throw new ArgumentOutOfRangeException(nameof(timeout));
        RequestStop();
        var owned = child;
        if (owned is null) return true;
        try
        {
            using var deadline = new CancellationTokenSource(timeout);
            await owned.WaitForExitAsync(deadline.Token);
            if (!owned.HasExited) return false;
            // No replacement is allowed until this process is confirmed exited.
            if (ReferenceEquals(child, owned)) child = null;
            owned.Dispose();
            return true;
        }
        catch { return false; }
    }

    internal void Resume() => stopping = false;

    internal static async Task SelfTest(string node)
    {
        var runtime = Path.Combine(Path.GetTempPath(), "observatory-native-sync-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(runtime);
        var owner = new TrustedSyncProcess(runtime, node, Path.Combine(AppContext.BaseDirectory, "Collector", "scripts", "peer-tls-service.mjs"));
        try
        {
            owner.EnsureStarted();
            var first = owner.child?.Id ?? throw new Exception("Service did not launch.");
            await Task.Delay(250);
            if (!owner.Running) throw new Exception("Service exited before parent shutdown.");
            owner.EnsureStarted();
            if (owner.child?.Id != first) throw new Exception("Duplicate service launched.");
            if (!await owner.Stop(TimeSpan.FromSeconds(10)) || owner.Running) throw new Exception("Service did not drain.");
            owner.EnsureStarted();if (owner.child is not null) throw new Exception("Stopped owner restarted.");
            owner.Resume();owner.EnsureStarted();
            if (!owner.Running || !await owner.Stop(TimeSpan.FromSeconds(10))) throw new Exception("Service restart failed.");
            if (!await owner.Stop(TimeSpan.FromSeconds(1))) throw new Exception("Repeated stop failed.");
            var slowScript = Path.Combine(runtime, "slow-exit.mjs");
            File.WriteAllText(slowScript, "setTimeout(() => process.exit(0), 750);\n");
            var slow = new TrustedSyncProcess(runtime, node, slowScript);
            try
            {
                slow.EnsureStarted();var slowId = slow.child?.Id;
                if (await slow.Stop(TimeSpan.FromMilliseconds(50)) || !slow.Running)
                    throw new Exception("Slow exit was falsely reported complete.");
                slow.Resume();slow.EnsureStarted();
                if (slow.child?.Id != slowId) throw new Exception("Timeout allowed overlapping helpers.");
                if (!await slow.Stop(TimeSpan.FromSeconds(5))) throw new Exception("Slow helper did not finish.");
            }
            finally { if (!await slow.Stop(TimeSpan.FromSeconds(5))) throw new Exception("Slow test helper remains active."); }
            if (Directory.Exists(Path.Combine(runtime, "private-device-identity"))) throw new Exception("Service created an identity.");
        }
        finally
        {
            if (!await owner.Stop(TimeSpan.FromSeconds(10))) throw new Exception("Test helper remains active.");
            Directory.Delete(runtime, true);
        }
        Console.WriteLine("Native sync owner launch, exclusion, graceful exit and restart passed.");
    }
}
