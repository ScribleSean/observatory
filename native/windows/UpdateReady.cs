using System.Diagnostics;
using System.Text.RegularExpressions;

namespace WorkspaceObservatory;

internal static class UpdateReady
{
    internal const string Prefix = "Local\\Observatory.UpdateReady.";
    internal static bool Valid(string name) => Regex.IsMatch(name, @"^Local\\Observatory\.UpdateReady\.[a-f0-9]{32}$");
    internal static bool Signal(string name)
    {
        if (!Valid(name)) return false;
        try
        {
            if (!EventWaitHandle.TryOpenExisting(name, out var ready)) return false;
            using (ready) return ready.Set();
        }
        catch (Exception error) when (error is UnauthorizedAccessException or IOException) { return false; }
    }

    internal static void SelfTest()
    {
        var name = Prefix + Guid.NewGuid().ToString("N");
        using var ready = new EventWaitHandle(false, EventResetMode.ManualReset, name);
        if (Signal("Local\\Unrelated") || Signal(Prefix + "invalid")) throw new Exception("Unsafe readiness event accepted.");
        var start = new ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = false, CreateNoWindow = true };
        // Framework-dependent checks run as dotnet <assembly>. Packaged checks
        // run through the app host and must not receive an extra assembly argument.
        if (string.Equals(Path.GetFileNameWithoutExtension(Environment.ProcessPath), "dotnet", StringComparison.OrdinalIgnoreCase))
            start.ArgumentList.Add(typeof(UpdateReady).Assembly.Location);
        start.ArgumentList.Add("--test-update-ready");
        start.ArgumentList.Add(name);
        using var child = Process.Start(start) ?? throw new Exception("Readiness fixture did not start.");
        try
        {
            if (!ready.WaitOne(TimeSpan.FromSeconds(10)) || !child.WaitForExit(10000) || child.ExitCode != 0)
                throw new Exception("Readiness subprocess did not acknowledge.");
        }
        finally { if (!child.HasExited) { child.Kill(entireProcessTree: true); child.WaitForExit(); } }
        Console.WriteLine("Update readiness subprocess acknowledges only a scoped event without opening collection.");
    }
}
