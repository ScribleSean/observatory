using System.Reflection;

namespace WorkspaceObservatory;

// Construct, check and dispose on the application UI thread. Initialization is
// lazy and manual-only. No updater is loaded just by opening the application.
internal sealed class UpdateController : IDisposable
{
    private readonly string installed = Path.TrimEndingDirectorySeparator(AppContext.BaseDirectory);
    private readonly string signedReceipt;
    private readonly Func<bool> ready;
    private readonly Action requestShutdown;
    private readonly CancellationTokenSource lifetime = new();
    private readonly int ownerThread = Environment.CurrentManagedThreadId;
    private WinSparkleLibrary? library;
    private bool checking, disposed;

    internal UpdateController(string runtime, Func<bool> ready, Action requestShutdown)
    {
        signedReceipt = Path.Combine(runtime, "updates", "installed-envelope.json");
        this.ready = ready;
        this.requestShutdown = requestShutdown;
    }

    internal async Task Check()
    {
        if (Environment.CurrentManagedThreadId != ownerThread)
            throw new InvalidOperationException("Update checks must start on the application thread.");
        ObjectDisposedException.ThrowIf(disposed, this);
        if (checking) return;
        checking = true;
        try
        {
            if (library is null)
            {
                var trust = UpdateTrust.ReadEmbedded()
                    ?? throw new IOException("Updates are not available in this build. Release verification is still in progress.");
                var dll = Path.Combine(installed, "Updater", "WinSparkle.dll");
                if (!File.Exists(dll) || !File.Exists(signedReceipt))
                    throw new IOException("This installation is missing its verified update files. Install a complete verified release before checking for updates.");
                var versionText = typeof(UpdateController).Assembly.GetCustomAttribute<AssemblyFileVersionAttribute>()?.Version;
                if (!Version.TryParse(versionText, out var version) || version.Revision < 1)
                    throw new IOException("This application has no valid release build number.");
                var state = await UpdateInstalledState.Verify(installed, signedReceipt, trust.PublicKey, version.Revision, lifetime.Token);
                ObjectDisposedException.ThrowIf(disposed, this);
                if (Environment.CurrentManagedThreadId != ownerThread)
                    throw new InvalidOperationException("Update initialization must resume on the application thread.");
                var updater = new WinSparkleLibrary(dll);
                try
                {
                    updater.ConfigureTrust(trust);
                    updater.AttachCallbacks(new WinSparkleCallbacks(
                        UpdateDownload.CreateCallback(installed, state.ReceiptPath, state.SourceRevision, state.BuildNumber),
                        ready, requestShutdown));
                    updater.Initialize($"{version.Major}.{version.Minor}.{version.Build}", state.BuildNumber);
                    library = updater;
                }
                catch { updater.Dispose(); throw; }
            }
            library.CheckForUpdates();
        }
        finally { checking = false; }
    }

    public void Dispose()
    {
        if (disposed) return;
        if (Environment.CurrentManagedThreadId != ownerThread)
            throw new InvalidOperationException("Updater disposal must stay on the application thread.");
        disposed = true;
        lifetime.Cancel();
        library?.Dispose();
        lifetime.Dispose();
    }

    internal static void SelfTest()
    {
        var runtime = Path.Combine(Path.GetTempPath(), "observatory-no-update-state-" + Guid.NewGuid().ToString("N"));
        var callbacks = 0;
        using var controller = new UpdateController(runtime, () => { callbacks++; return true; }, () => callbacks++);
        var refused = false;
        try { controller.Check().GetAwaiter().GetResult(); } catch (IOException) { refused = true; }
        if (!refused || callbacks != 0 || controller.library is not null || Directory.Exists(runtime))
            throw new Exception("Unavailable updates initialized native code or modified state.");
        Task.Run(() =>
        {
            var wrongThread = false;
            try { controller.Check().GetAwaiter().GetResult(); } catch (InvalidOperationException) { wrongThread = true; }
            if (!wrongThread) throw new Exception("Update controller accepted a foreign thread.");
        }).GetAwaiter().GetResult();
        controller.Dispose();
        refused = false;
        try { controller.Check().GetAwaiter().GetResult(); } catch (ObjectDisposedException) { refused = true; }
        if (!refused) throw new Exception("Disposed updater accepted a check.");
        Console.WriteLine("Update controller refuses missing trust or receipts before native initialization and enforces its thread lifetime.");
    }
}
