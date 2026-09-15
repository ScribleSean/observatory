using System.Diagnostics;
using System.Globalization;
using System.Text.RegularExpressions;

namespace WorkspaceObservatory;

// Download preparation runs on WinSparkle's installer thread. Keep retained
// inputs outside its download directory and never wait for activation here.
internal static class UpdateDownload
{
    internal sealed record Prepared(string Installed, string Staged, string PreviousReceipt,
        string CandidateEnvelope, string Helper, long PreviousBuild);

    internal static UpdateInstallerCallback CreateCallback(string installed, string previousReceipt,
        string previousRevision, long previousBuild)
    {
        var trust = UpdateTrust.ReadEmbedded()
            ?? throw new IOException("Release update trust is not configured.");
        return new UpdateInstallerCallback(download =>
        {
            var prepared = Prepare(download, installed, previousReceipt, previousRevision,
                previousBuild, trust.PublicKey).GetAwaiter().GetResult();
            using var child = Process.Start(StartInfo(prepared))
                ?? throw new IOException("The external update helper did not start.");
            // A successful process start is a launch acknowledgement, not proof
            // of activation. The helper re-verifies and waits for graceful quit.
            return true;
        });
    }

    internal static ProcessStartInfo StartInfo(Prepared prepared)
    {
        var start = new ProcessStartInfo(Path.Combine(prepared.Helper, "WorkspaceObservatory.exe"))
        {
            UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = prepared.Helper
        };
        foreach (var argument in new[] { "--apply-update", prepared.Installed, prepared.Staged,
            prepared.PreviousReceipt, prepared.CandidateEnvelope, prepared.PreviousBuild.ToString(CultureInfo.InvariantCulture) })
            start.ArgumentList.Add(argument);
        return start;
    }

    internal static async Task<Prepared> Prepare(string downloaded, string installed, string previousReceipt,
        string previousRevision, long previousBuild, string pinnedKey, CancellationToken cancellation = default)
    {
        foreach (var value in new[] { downloaded, installed, previousReceipt })
            if (!Path.IsPathFullyQualified(value) || Path.GetFullPath(value) != value)
                throw new IOException("Canonical update paths required.");
        if (!Regex.IsMatch(previousRevision, "^[a-f0-9]{40}$") || previousBuild < 1 || previousBuild > 9007199254740991L ||
            !string.Equals(Path.GetExtension(downloaded), ".zip", StringComparison.OrdinalIgnoreCase))
            throw new IOException("Invalid installed update identity or archive.");
        var parent = Path.GetDirectoryName(installed)!;
        // WinSparkle may remove the download's parent at its next startup.
        // Never place retained inputs in that directory or a descendant.
        RequireOutside(parent, Path.GetDirectoryName(downloaded)!);
        RequireOutside(previousReceipt, installed);
        CheckDirectory(parent);
        cancellation.ThrowIfCancellationRequested();
        var retained = Path.Combine(parent, ".observatory-download-" + Guid.NewGuid().ToString("N"));
        if (Path.Exists(retained)) throw new IOException("Retained update directory already exists.");
        Directory.CreateDirectory(retained);
        // Failed preparation is retained for inspection. It never alters the
        // installed app and does not authorize shutdown or a fallback installer.
        var receipt = RetainReceipt(previousReceipt, retained);
        var extracted = UpdateArchive.Extract(downloaded, retained, cancellation);
        var candidate = await UpdateStaging.Stage(extracted, installed, receipt, pinnedKey, previousBuild, cancellation);
        var helper = await UpdateHelper.Stage(installed, receipt, retained, previousRevision, previousBuild, cancellation);
        return new(installed, candidate.Staged, receipt, candidate.EnvelopePath, helper, previousBuild);
    }

    private static void RequireOutside(string path, string root)
    {
        var relative = Path.GetRelativePath(root, path);
        if (relative == "." || (!Path.IsPathFullyQualified(relative) && relative != ".." &&
            !relative.StartsWith(".." + Path.DirectorySeparatorChar, StringComparison.Ordinal)))
            throw new IOException("Retained update inputs must be outside temporary and installed payloads.");
    }

    private static void CheckDirectory(string path)
    {
        for (var current = new DirectoryInfo(path); current is not null; current = current.Parent)
            if (!current.Exists || current.Attributes.HasFlag(FileAttributes.ReparsePoint))
                throw new IOException("Missing or linked update directory.");
    }

    internal static string RetainReceipt(string source, string retained)
    {
        if (!Path.IsPathFullyQualified(source) || !Path.IsPathFullyQualified(retained))
            throw new IOException("Absolute retained receipt paths required.");
        CheckDirectory(Path.GetDirectoryName(source)!);
        CheckDirectory(retained);
        if (File.GetAttributes(source).HasFlag(FileAttributes.ReparsePoint)) throw new IOException("Linked receipt refused.");
        using var input = new FileStream(source, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (input.Length is < 1 or > 8192) throw new IOException("Invalid retained receipt size.");
        var bytes = new byte[8193];
        var length = 0;
        int count;
        while (length < bytes.Length && (count = input.Read(bytes, length, bytes.Length - length)) > 0) length += count;
        if (length is < 1 or > 8192) throw new IOException("Invalid retained receipt size.");
        var destination = Path.Combine(retained, "previous-receipt.json");
        using var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        output.Write(bytes, 0, length);
        output.Flush(true);
        return destination;
    }

    internal static void SelfTest()
    {
        var root = Path.Combine(Path.GetTempPath(), "observatory-download-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            var source = Path.Combine(root, "previous.json");
            File.WriteAllText(source, "synthetic receipt bytes");
            var retained = Directory.CreateDirectory(Path.Combine(root, "retained")).FullName;
            var receipt = RetainReceipt(source, retained);
            File.WriteAllText(source, "changed source");
            if (File.ReadAllText(receipt) != "synthetic receipt bytes") throw new Exception("Receipt was not independently retained.");
            var refused = false;
            try { RetainReceipt(source, retained); } catch (IOException) { refused = true; }
            if (!refused || File.ReadAllText(receipt) != "synthetic receipt bytes") throw new Exception("Retained receipt was overwritten.");
            foreach (var length in new[] { 0, 8193 })
            {
                File.WriteAllBytes(source, new byte[length]);
                refused = false;
                try { RetainReceipt(source, retained); } catch (IOException) { refused = true; }
                if (!refused) throw new Exception("Invalid receipt size accepted.");
            }
            foreach (var inside in new[] { root, Path.Combine(root, "nested") })
            {
                refused = false;
                try { RequireOutside(inside, root); } catch (IOException) { refused = true; }
                if (!refused) throw new Exception("Temporary retention accepted.");
            }
            RequireOutside(root + "-sibling", root);
            var prepared = new Prepared(Path.Combine(root, "installed app"), Path.Combine(root, "candidate"),
                receipt, Path.Combine(root, "envelope.json"), Path.Combine(root, "old helper"), 7);
            var start = StartInfo(prepared);
            if (start.UseShellExecute || start.RedirectStandardOutput || start.RedirectStandardError ||
                start.WorkingDirectory != prepared.Helper || start.FileName != Path.Combine(prepared.Helper, "WorkspaceObservatory.exe") ||
                !start.ArgumentList.SequenceEqual(new[] { "--apply-update", prepared.Installed, prepared.Staged,
                    receipt, prepared.CandidateEnvelope, "7" })) throw new Exception("Unsafe update helper launch arguments.");
        }
        finally { Directory.Delete(root, recursive: true); }
        Console.WriteLine("Downloaded update retention rejects unsafe locations and preserves independent receipt bytes and exact helper arguments.");
    }
}
