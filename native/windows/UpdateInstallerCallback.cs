namespace WorkspaceObservatory;

// WinSparkle callback return values: 1 means handled, -1 means error, and 0
// invokes default shell execution. Observatory must never return 0.
internal sealed class UpdateInstallerCallback
{
    private readonly Func<string, bool> prepareAndLaunch;
    // 0 idle, 1 preparing, 2 completed or uncertain handoff, no retry.
    private int state;

    internal UpdateInstallerCallback(Func<string, bool> prepareAndLaunch)
    {
        this.prepareAndLaunch = prepareAndLaunch ?? throw new ArgumentNullException(nameof(prepareAndLaunch));
    }

    // Called on WinSparkle's thread, not the application UI thread. The supplied
    // operation must retain verified inputs and launch the trusted external helper,
    // not wait for replacement while the host application is still running.
    // Return false only when no helper was launched. Throw on an uncertain launch.
    internal int Handle(string downloadedPath)
    {
        if (Interlocked.CompareExchange(ref state, 1, 0) != 0) return -1;
        try
        {
            if (string.IsNullOrWhiteSpace(downloadedPath) || !Path.IsPathFullyQualified(downloadedPath) ||
                !string.Equals(Path.GetExtension(downloadedPath), ".zip", StringComparison.OrdinalIgnoreCase))
                return -1;
            if (!prepareAndLaunch(downloadedPath)) return -1;
            Interlocked.Exchange(ref state, 2);
            return 1;
        }
        catch
        {
            // Managed exceptions must not escape through the native callback.
            // No fallback installer is safe after an uncertain handoff.
            Interlocked.Exchange(ref state, 2);
            return -1;
        }
        finally { Interlocked.CompareExchange(ref state, 0, 1); }
    }

    internal static void SelfTest()
    {
        var archive = Path.Combine(Path.GetTempPath(), "synthetic-update.zip");
        var invoked = 0;
        var accepted = new UpdateInstallerCallback(_ => { invoked++; return true; });
        foreach (var invalid in new[] { "", "relative.zip", Path.ChangeExtension(archive, ".exe") })
            if (accepted.Handle(invalid) != -1 || invoked != 0) throw new Exception("Invalid download reached handoff.");
        if (accepted.Handle(archive) != 1 || accepted.Handle(archive) != -1 || invoked != 1)
            throw new Exception("Successful handoff was repeated or not acknowledged.");
        var retry = 0;
        var failed = new UpdateInstallerCallback(_ => { retry++; return false; });
        if (failed.Handle(archive) != -1 || failed.Handle(archive) != -1 || retry != 2)
            throw new Exception("Failed preparation did not allow an explicit retry.");
        var uncertain = 0;
        var throwing = new UpdateInstallerCallback(_ => { uncertain++; throw new IOException("Synthetic uncertain launch"); });
        if (throwing.Handle(archive) != -1 || throwing.Handle(archive) != -1 || uncertain != 1)
            throw new Exception("Uncertain handoff was retried or callback exception escaped.");
        using var entered = new ManualResetEventSlim();
        using var finish = new ManualResetEventSlim();
        var concurrent = new UpdateInstallerCallback(_ =>
        {
            entered.Set();
            if (!finish.Wait(TimeSpan.FromSeconds(5))) throw new Exception("Callback fixture timed out.");
            return true;
        });
        var first = Task.Run(() => concurrent.Handle(archive));
        try
        {
            if (!entered.Wait(TimeSpan.FromSeconds(5))) throw new Exception("Callback fixture did not start.");
            if (concurrent.Handle(archive) != -1) throw new Exception("Concurrent handoff was accepted.");
        }
        finally { finish.Set(); }
        if (first.GetAwaiter().GetResult() != 1) throw new Exception("Original handoff was lost.");
        Console.WriteLine("Update installer callback refuses fallback, invalid paths and duplicate handoffs.");
    }
}
