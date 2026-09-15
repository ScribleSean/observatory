namespace WorkspaceObservatory;

internal static class UpdateReceiptStore
{
    internal static string EnvelopePath(string runtime) => Path.Combine(runtime, "updates", "installed-envelope.json");

    // Publish only an envelope that authenticates the current installed bytes.
    // Existing receipt bytes are retained before an atomic replacement. This
    // does not claim power-loss durability for the directory entry.
    internal static async Task<string> Persist(string installed, string envelope, string pinnedKey,
        long previousBuild, string expectedRevision, string runtime)
    {
        if (!Path.IsPathFullyQualified(runtime) || Path.GetFullPath(runtime) != runtime)
            throw new IOException("Canonical update state directory required.");
        using var gate = InstallationGate.TryEnter()
            ?? throw new IOException("Installation is busy. Receipt was not published.");
        CheckDirectory(runtime);
        var updates = Path.GetDirectoryName(EnvelopePath(runtime))!;
        Directory.CreateDirectory(updates);
        CheckDirectory(updates);
        var retained = Path.Combine(updates, ".receipt-" + Guid.NewGuid().ToString("N"));
        if (Path.Exists(retained)) throw new IOException("Receipt staging directory already exists.");
        Directory.CreateDirectory(retained);
        var staged = UpdateDownload.RetainReceipt(envelope, retained);
        using (var lease = new FileStream(staged, FileMode.Open, FileAccess.Read, FileShare.Read))
        {
            var identity = await UpdateCandidate.Verify(installed, staged, pinnedKey, previousBuild);
            if (identity.SourceRevision != expectedRevision)
                throw new IOException("Installed identity changed before receipt publication.");
        }
        var destination = EnvelopePath(runtime);
        if (Path.Exists(destination))
        {
            var attributes = File.GetAttributes(destination);
            if ((attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0)
                throw new IOException("Linked or non-file installed receipt refused.");
            var backup = Path.Combine(retained, "previous-installed-envelope.json");
            File.Replace(staged, destination, backup);
        }
        else File.Move(staged, destination);
        return destination;
    }

    private static void CheckDirectory(string path)
    {
        for (var current = new DirectoryInfo(path); current is not null; current = current.Parent)
            if (!current.Exists || current.Attributes.HasFlag(FileAttributes.ReparsePoint))
                throw new IOException("Missing or linked update state directory.");
    }
}
