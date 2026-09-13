namespace WorkspaceObservatory;

// The NSIS installer uses existence of this named mutex, not ownership, as its
// setup lock. Hold a handle until the app's singleton handle has been created.
// This closes the race between installer CheckRunning and application startup.
internal sealed class InstallationGate : IDisposable
{
    internal const string Name = "Local\\WorkspaceObservatorySetup";
    private readonly Mutex handle;
    private InstallationGate(Mutex handle) { this.handle = handle; }

    internal static InstallationGate? TryEnter(string name = Name)
    {
        var handle = new Mutex(false, name, out var created);
        if (created) return new InstallationGate(handle);
        handle.Dispose();
        return null;
    }

    public void Dispose() => handle.Dispose();

    internal static void SelfTest()
    {
        var name = "Local\\WorkspaceObservatorySetupTest-" + Guid.NewGuid().ToString("N");
        using (var first = TryEnter(name) ?? throw new Exception("Initial setup gate acquisition failed."))
        {
            using var second = Task.Run(() => TryEnter(name)).GetAwaiter().GetResult();
            if (second is not null) throw new Exception("Concurrent setup gate acquisition succeeded.");
        }
        using var after = TryEnter(name) ?? throw new Exception("Released setup gate remained blocked.");
        Console.WriteLine("Installation gate exclusion and release passed.");
    }
}
