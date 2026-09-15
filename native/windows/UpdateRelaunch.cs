using System.Diagnostics;

namespace WorkspaceObservatory;

internal static class UpdateRelaunch
{
    internal sealed record Result(int ProcessId, bool EventLoopConfirmed);

    // Call after activation releases the setup gate. Never roll back automatically
    // after launch: the new application may already have migrated its saved data.
    internal static async Task<Result> Start(string installed, string envelope, string pinnedKey,
        long previousBuild, string expectedRevision)
    {
        var verified = await UpdateCandidate.Verify(installed, envelope, pinnedKey, previousBuild);
        if (verified.SourceRevision != expectedRevision) throw new IOException("Installed update identity changed before relaunch.");
        var name = UpdateReady.Prefix + Guid.NewGuid().ToString("N");
        using var ready = new EventWaitHandle(false, EventResetMode.ManualReset, name, out var created);
        if (!created) throw new IOException("Readiness event already exists.");
        using var process = Process.Start(new ProcessStartInfo(Path.Combine(installed, "WorkspaceObservatory.exe")) {
            UseShellExecute = false, WorkingDirectory = installed,
            ArgumentList = { "--update-ready", name } }) ?? throw new IOException("Updated application did not start.");
        var acknowledged = await Task.Run(() => ready.WaitOne(TimeSpan.FromSeconds(20)));
        return new(process.Id, acknowledged && !process.HasExited);
    }
}
