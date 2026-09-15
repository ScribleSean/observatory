namespace WorkspaceObservatory;

// Runs in the verified external helper. Trusted receipt/key provisioning and
// candidate download are caller responsibilities, not inferred from arguments.
internal static class UpdateInstall
{
    internal sealed record Result(string SourceRevision, string Recovery, int? ProcessId, bool LaunchConfirmed);

    internal static Task<Result> ApplyAndRelaunch(string installed, string staged, string previousReceipt,
        string candidateEnvelope, string pinnedKey, long previousBuild) => Run(
            () => UpdateActivation.Apply(installed, staged, previousReceipt, candidateEnvelope, pinnedKey, previousBuild),
            activated => UpdateReceiptStore.Persist(installed, candidateEnvelope, pinnedKey, previousBuild, activated.SourceRevision,
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Workspace Observatory")),
            activated => UpdateRelaunch.Start(installed, candidateEnvelope, pinnedKey, previousBuild, activated.SourceRevision));

    private static async Task<Result> Run(Func<Task<UpdateActivation.Result>> activate,
        Func<UpdateActivation.Result, Task> persistReceipt,
        Func<UpdateActivation.Result, Task<UpdateRelaunch.Result>> relaunch)
    {
        // Apply returns only after the writer exits, registration is updated and
        // its setup gate is released. A failed activation must never launch.
        var installed = await activate();
        try
        {
            await persistReceipt(installed);
            var launched = await relaunch(installed);
            return new(installed.SourceRevision, installed.Recovery, launched.ProcessId, launched.EventLoopConfirmed);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or
            System.ComponentModel.Win32Exception or InvalidOperationException or System.Text.Json.JsonException or OperationCanceledException)
        {
            // Replacement succeeded, even if receipt publication failed. Do not
            // report an unchanged installation or
            // roll back after a process may have opened or migrated saved data.
            return new(installed.SourceRevision, installed.Recovery, null, false);
        }
    }

    internal static void SelfTest()
    {
        var activated = new UpdateActivation.Result(new string('a', 40), "synthetic-recovery");
        foreach (var confirmed in new[] { true, false })
        {
            var sequence = new List<string>();
            var result = Run(() => { sequence.Add("activate"); return Task.FromResult(activated); }, value =>
            {
                if (value != activated) throw new Exception("Receipt publication lost activation identity.");
                sequence.Add("receipt"); return Task.CompletedTask;
            }, value =>
            {
                if (value != activated) throw new Exception("Activation identity was lost.");
                sequence.Add("relaunch");
                return Task.FromResult(new UpdateRelaunch.Result(42, confirmed));
            }).GetAwaiter().GetResult();
            if (!sequence.SequenceEqual(new[] { "activate", "receipt", "relaunch" }) || result.LaunchConfirmed != confirmed ||
                result.ProcessId != 42 || result.Recovery != activated.Recovery || result.SourceRevision != activated.SourceRevision)
                throw new Exception("Incorrect update completion state.");
        }
        var launchAttempted = false;
        var rejected = false;
        try
        {
            Run(() => Task.FromException<UpdateActivation.Result>(new IOException("Synthetic replacement failure")),
                _ => throw new Exception("Failed activation reached receipt publication."), _ =>
            {
                launchAttempted = true;
                return Task.FromResult(new UpdateRelaunch.Result(42, true));
            }).GetAwaiter().GetResult();
        }
        catch (IOException) { rejected = true; }
        if (!rejected || launchAttempted) throw new Exception("Failed replacement reached relaunch.");
        foreach (var failure in new Exception[] { new IOException("Synthetic launch failure"),
            new OperationCanceledException("Synthetic verification timeout") })
        {
            var unconfirmed = Run(() => Task.FromResult(activated), _ => Task.CompletedTask, _ =>
                Task.FromException<UpdateRelaunch.Result>(failure)).GetAwaiter().GetResult();
            if (unconfirmed.LaunchConfirmed || unconfirmed.ProcessId is not null || unconfirmed.Recovery != activated.Recovery)
                throw new Exception("Launch failure lost installed recovery state.");
        }
        var receiptFailed = Run(() => Task.FromResult(activated),
            _ => Task.FromException(new IOException("Synthetic receipt publication failure")),
            _ => throw new Exception("Failed receipt publication reached relaunch.")).GetAwaiter().GetResult();
        if (receiptFailed.LaunchConfirmed || receiptFailed.ProcessId is not null || receiptFailed.Recovery != activated.Recovery)
            throw new Exception("Receipt publication failure lost recovery state.");
        Console.WriteLine("Update orchestration preserves replacement identity, stops on activation failure and reports unconfirmed launches without rollback.");
    }
}
