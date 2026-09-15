using System.IO.Compression;
using System.Text.RegularExpressions;

namespace WorkspaceObservatory;

// Staging is not authentication. Verify the signed installation receipt and
// full extracted inventory before executing or promoting any extracted file.
internal static class UpdateArchive
{
    internal sealed record Limits(long ArchiveBytes = 512 * 1024 * 1024L,
        long ExpandedBytes = 768 * 1024 * 1024L, long FileBytes = 192 * 1024 * 1024L, int Entries = 8000);

    private static void UnlinkedDirectory(string folder)
    {
        for (var current = new DirectoryInfo(folder); current is not null; current = current.Parent)
            if (!current.Exists || current.Attributes.HasFlag(FileAttributes.ReparsePoint))
                throw new IOException("Missing or linked staging directory.");
    }

    internal static string Extract(string archivePath, string parent, CancellationToken cancellation = default, Limits? limits = null)
    {
        limits ??= new();
        if (limits.ArchiveBytes < 1 || limits.ExpandedBytes < 1 || limits.FileBytes < 1 || limits.Entries < 1)
            throw new ArgumentOutOfRangeException(nameof(limits));
        if (!Path.IsPathFullyQualified(archivePath) || !Path.IsPathFullyQualified(parent))
            throw new IOException("Absolute archive and staging paths required.");
        UnlinkedDirectory(parent);
        UnlinkedDirectory(Path.GetDirectoryName(archivePath)!);
        if (File.GetAttributes(archivePath).HasFlag(FileAttributes.ReparsePoint)) throw new IOException("Linked update archive refused.");
        using var input = new FileStream(archivePath, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (input.Length == 0 || input.Length > limits.ArchiveBytes) throw new IOException("Update archive size limit exceeded.");
        using var archive = new ZipArchive(input, ZipArchiveMode.Read);
        if (archive.Entries.Count == 0 || archive.Entries.Count > limits.Entries) throw new IOException("Update archive entry limit exceeded.");
        var names = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
        long expanded = 0;
        foreach (var entry in archive.Entries)
        {
            cancellation.ThrowIfCancellationRequested();
            var directory = entry.FullName.EndsWith('/');
            var name = directory ? entry.FullName[..^1] : entry.FullName;
            var components = name.Split('/');
            if (name.Length is 0 or > 220 || components.Any(part =>
                !Regex.IsMatch(part, @"^[A-Za-z0-9_][A-Za-z0-9_. +\-]*$") || part.EndsWith('.') || part.EndsWith(' ') ||
                Regex.IsMatch(part, @"^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)", RegexOptions.IgnoreCase)) ||
                !names.TryAdd(name, directory)) throw new IOException("Unsafe or duplicate update archive path.");
            var unixType = (entry.ExternalAttributes >> 16) & 0xf000;
            if ((unixType != 0 && unixType != (directory ? 0x4000 : 0x8000)) ||
                (entry.ExternalAttributes & (int)FileAttributes.ReparsePoint) != 0)
                throw new IOException("Linked or special archive entry refused.");
            if (entry.Length < 0 || entry.Length > limits.FileBytes || (directory && entry.Length != 0) ||
                entry.Length > limits.ExpandedBytes - expanded) throw new IOException("Expanded update archive size limit exceeded.");
            expanded += entry.Length;
        }
        foreach (var name in names.Keys)
        {
            var ancestor = name;
            while (ancestor.LastIndexOf('/') is var separator && separator >= 0)
            {
                ancestor = ancestor[..separator];
                if (names.TryGetValue(ancestor, out var directory) && !directory)
                    throw new IOException("Archive file conflicts with a parent directory.");
            }
        }
        cancellation.ThrowIfCancellationRequested();
        var staged = Path.Combine(parent, ".observatory-stage-" + Guid.NewGuid().ToString("N"));
        if (Path.Exists(staged)) throw new IOException("Staging path already exists.");
        Directory.CreateDirectory(staged);
        try
        {
            var buffer = new byte[65536];
            foreach (var entry in archive.Entries)
            {
                cancellation.ThrowIfCancellationRequested();
                var destination = Path.Combine(staged, entry.FullName.Replace('/', Path.DirectorySeparatorChar));
                if (entry.FullName.EndsWith('/')) { Directory.CreateDirectory(destination); continue; }
                var folder = Path.GetDirectoryName(destination)!;
                Directory.CreateDirectory(folder);
                UnlinkedDirectory(folder);
                using var source = entry.Open();
                using var target = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None);
                long copied = 0;
                int count;
                while ((count = source.Read(buffer)) > 0)
                {
                    cancellation.ThrowIfCancellationRequested();
                    if (count > entry.Length - copied) throw new IOException("Archive entry exceeded its declared size.");
                    target.Write(buffer, 0, count);
                    copied += count;
                }
                if (copied != entry.Length) throw new IOException("Incomplete archive entry.");
                target.Flush(true);
            }
            return staged;
        }
        catch (Exception error)
        {
            throw new IOException("Update extraction failed. Partial staging is retained for inspection: " + staged, error);
        }
    }
}
