using System.Diagnostics;

namespace WorkspaceObservatory;

internal static class PairingMaintenance
{
    internal static Task Disconnect(string runtime, CancellationToken cancellation = default) => Run(runtime, false, cancellation);
    internal static Task PrepareRepair(string runtime, CancellationToken cancellation = default) => Run(runtime, true, cancellation);

    private static async Task Run(string runtime, bool repair, CancellationToken cancellation)
    {
        if (!Path.IsPathFullyQualified(runtime) || !Directory.Exists(runtime) ||
            (File.GetAttributes(runtime) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidOperationException("Private runtime unavailable.");
        var node = Path.Combine(AppContext.BaseDirectory, "Runtime", "node.exe");
        var script = Path.Combine(AppContext.BaseDirectory, "Collector", "scripts", repair ? "peer-repair.mjs" : "peer-revocation.mjs");
        if (!File.Exists(node) || !File.Exists(script)) throw new InvalidOperationException("Bundled pairing tools unavailable.");
        using var process = new Process { StartInfo = BridgeProcesses.Create(runtime,
            repair ? "peer-repair.mjs" : "peer-revocation.mjs", "--runtime", Path.GetFullPath(runtime),
            repair ? "--confirm-local-retirement" : "--revoke") };
        process.Start(); process.StandardInput.Close();
        var output = process.StandardOutput.ReadToEndAsync();
        var error = process.StandardError.ReadToEndAsync();
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        timeout.CancelAfter(TimeSpan.FromSeconds(20));
        try { await process.WaitForExitAsync(timeout.Token); }
        catch
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            await process.WaitForExitAsync();
            throw;
        }
        await Task.WhenAll(output, error);
        if (process.ExitCode != 0) throw new InvalidOperationException("Private pairing maintenance could not be verified.");
    }

    internal static void SelfTest()
    {
        var runtime = Path.Combine(Path.GetTempPath(), "observatory-pairing-native-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(runtime);
        try
        {
            var sentinel = Path.Combine(runtime, "synthetic-sentinel.txt");
            File.WriteAllText(sentinel, "preserve");
            Disconnect(runtime).GetAwaiter().GetResult();
            Disconnect(runtime).GetAwaiter().GetResult();
            if (!File.Exists(Path.Combine(runtime, "private-sync", "revoked")) || File.ReadAllText(sentinel) != "preserve")
                throw new InvalidOperationException("Native pairing revocation self-test failed.");
            Console.WriteLine("Native pairing revocation self-test passed with temporary data.");
            PrepareRepair(runtime).GetAwaiter().GetResult();
            var backups = Directory.GetDirectories(runtime, "private-sync-retired-*");
            if (backups.Length != 1 || !File.Exists(Path.Combine(backups[0], "revoked")) ||
                Directory.Exists(Path.Combine(runtime, "private-sync")) || File.ReadAllText(sentinel) != "preserve")
                throw new InvalidOperationException("Native repair preparation self-test failed.");
            Console.WriteLine("Native repair preparation self-test passed with a retained disabled backup.");
        }
        finally { Directory.Delete(runtime, recursive: true); }
    }
}
