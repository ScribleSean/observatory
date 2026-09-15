using System.Text;
using System.Text.Json;

namespace WorkspaceObservatory;

// An installed receipt becomes trusted only after signature and inventory
// verification. A receipt found on disk or beside a download is not authority.
internal static class UpdateInstalledState
{
    internal sealed record Result(string ReceiptPath, string SourceRevision, long BuildNumber);

    internal static async Task<Result> Verify(string installed, string signedReceipt, string pinnedKey,
        long expectedBuild, CancellationToken cancellation = default)
    {
        if (!Path.IsPathFullyQualified(installed) || Path.GetFullPath(installed) != installed ||
            Path.TrimEndingDirectorySeparator(installed) != installed ||
            !Path.IsPathFullyQualified(signedReceipt) || expectedBuild < 1 || expectedBuild > 9007199254740991L)
            throw new IOException("Invalid installed update state.");
        cancellation.ThrowIfCancellationRequested();
        using var gate = InstallationGate.TryEnter()
            ?? throw new IOException("Installation is busy. Retry the update later.");
        var parent = Path.GetDirectoryName(installed)!;
        for (var current = new DirectoryInfo(parent); current is not null; current = current.Parent)
            if (!current.Exists || current.Attributes.HasFlag(FileAttributes.ReparsePoint))
                throw new IOException("Missing or linked installation parent.");
        var retained = Path.Combine(parent, ".observatory-trust-" + Guid.NewGuid().ToString("N"));
        if (Path.Exists(retained)) throw new IOException("Retained trust directory already exists.");
        Directory.CreateDirectory(retained);
        var envelope = UpdateDownload.RetainReceipt(signedReceipt, retained);
        // Keep the exact bytes immutable while the installed verifier reads them
        // and until the authenticated receipt has been retained independently.
        using var lease = new FileStream(envelope, FileMode.Open, FileAccess.Read, FileShare.Read);
        var identity = await UpdateCandidate.Verify(installed, envelope, pinnedKey, 0, cancellation);
        if (identity.BuildNumber != expectedBuild)
            throw new IOException("The signed receipt does not match this application's build.");
        using var document = JsonDocument.Parse(lease);
        var receipt = document.RootElement.GetProperty("receipt");
        var bytes = Encoding.UTF8.GetBytes(receipt.GetRawText());
        var outputPath = Path.Combine(retained, "installed-receipt.json");
        using (var output = new FileStream(outputPath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
        {
            output.Write(bytes);
            output.Flush(true);
        }
        return new(outputPath, identity.SourceRevision, identity.BuildNumber);
    }
}
