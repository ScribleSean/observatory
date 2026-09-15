namespace WorkspaceObservatory;

// Keep this lease alive through verification and replacement. It prevents new
// participating app/collector starts, but does not authenticate any payload.
internal sealed class UpdateSession : IDisposable
{
    private readonly InstallationGate gate;
    private UpdateSession(InstallationGate gate) { this.gate = gate; }

    internal static UpdateSession Begin(TimeSpan timeout,
        string setupName = InstallationGate.Name,
        string singletonName = "Local\\WorkspaceObservatory",
        string requestName = UpdateQuit.RequestName)
    {
        var gate = InstallationGate.TryEnter(setupName)
            ?? throw new IOException("Installation or command-line collection is busy. Retry the update later.");
        try
        {
            var result = UpdateQuit.Request(singletonName, requestName, timeout);
            if (result != UpdateQuit.Result.Stopped)
                throw new IOException(result == UpdateQuit.Result.Unsupported
                    ? "Quit the older application before updating."
                    : "The application is still finishing work. Update was not started.");
            return new UpdateSession(gate);
        }
        catch { gate.Dispose(); throw; }
    }

    public void Dispose() => gate.Dispose();

    internal static void SelfTest()
    {
        var prefix = "Local\\ObservatoryUpdateSessionTest-" + Guid.NewGuid().ToString("N");
        using (var busy = InstallationGate.TryEnter(prefix)!)
        {
            var rejected = false;
            try { using var unexpected = Begin(TimeSpan.Zero, prefix, prefix + ".app", prefix + ".quit"); }
            catch (IOException) { rejected = true; }
            if (!rejected) throw new Exception("Update entered a busy setup gate.");
        }
        using (var older = new Mutex(false, prefix + ".app"))
        {
            var rejected = false;
            try { using var unexpected = Begin(TimeSpan.Zero, prefix, prefix + ".app", prefix + ".quit"); }
            catch (IOException) { rejected = true; }
            if (!rejected) throw new Exception("Older app without quit receiver was accepted.");
            using var released = InstallationGate.TryEnter(prefix)
                ?? throw new Exception("Unsupported app retained setup gate.");
        }
        foreach (var complete in new[] { false, true })
        {
            using var ready = new ManualResetEventSlim();
            using var finish = new ManualResetEventSlim();
            var owner = Task.Run(() =>
            {
                using var singleton = new Mutex(true, prefix + ".app");
                using var request = new EventWaitHandle(false, EventResetMode.AutoReset, prefix + ".quit");
                try
                {
                    ready.Set();
                    if (!request.WaitOne(TimeSpan.FromSeconds(5))) throw new Exception("Update did not request quit.");
                    if (complete)
                    {
                        using var blocked = InstallationGate.TryEnter(prefix);
                        if (blocked is not null) throw new Exception("Setup gate was not held during shutdown.");
                    }
                    if (!complete) finish.Wait(TimeSpan.FromSeconds(5));
                }
                finally { singleton.ReleaseMutex(); }
            });
            try
            {
                if (!ready.Wait(TimeSpan.FromSeconds(5))) throw new Exception("Update session fixture did not start.");
                UpdateSession? session = null;
                try { session = Begin(complete ? TimeSpan.FromSeconds(5) : TimeSpan.FromMilliseconds(100), prefix, prefix + ".app", prefix + ".quit"); }
                catch (IOException) when (!complete) { }
                using (session)
                {
                    if ((session is not null) != complete) throw new Exception("Incorrect update session result.");
                    using var next = InstallationGate.TryEnter(prefix);
                    if ((next is null) != complete) throw new Exception("Update setup gate lifetime is incorrect.");
                }
            }
            finally { finish.Set(); owner.GetAwaiter().GetResult(); }
            using var released = InstallationGate.TryEnter(prefix)
                ?? throw new Exception("Update setup gate was not released.");
        }
        Console.WriteLine("Update session holds setup exclusion through graceful quit and releases on failure or disposal.");
    }
}
