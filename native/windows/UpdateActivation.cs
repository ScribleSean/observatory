using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace WorkspaceObservatory;

internal static class UpdateActivation
{
    internal sealed record Result(string SourceRevision, string Recovery);

    internal static async Task<Result> Apply(string installed, string staged, string previousReceipt,
        string candidateEnvelope, string pinnedKey, long previousBuild, string registrationPath = UpdateRegistration.KeyPath)
    {
        var helper = Path.TrimEndingDirectorySeparator(Path.GetFullPath(AppContext.BaseDirectory));
        foreach (var folder in new[] { installed, staged })
        {
            if (!Path.IsPathFullyQualified(folder)) throw new IOException("Absolute payload paths required.");
            var root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(folder));
            if (helper.Equals(root, StringComparison.OrdinalIgnoreCase) ||
                helper.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                throw new IOException("Run update activation from the verified external helper.");
        }
        if (!Path.IsPathFullyQualified(previousReceipt)) throw new IOException("Absolute trusted receipt required.");
        var candidate = await UpdateCandidate.Verify(staged, candidateEnvelope, pinnedKey, previousBuild);
        var registration = UpdateRegistration.Capture(installed, registrationPath);
        var fileVersion = FileVersionInfo.GetVersionInfo(Path.Combine(staged, "WorkspaceObservatory.exe"));
        var displayVersion = $"{fileVersion.FileMajorPart}.{fileVersion.FileMinorPart}.{fileVersion.FileBuildPart}";
        using var session = UpdateSession.Begin(TimeSpan.FromSeconds(270));
        using var process = new Process { StartInfo = new(Path.Combine(helper, "Runtime", "node.exe")) {
            UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = helper,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true } };
        foreach (var argument in new[] { Path.Combine(helper, "Updater", "apply-update.mjs"), installed, staged,
            previousReceipt, candidateEnvelope, pinnedKey }) process.StartInfo.ArgumentList.Add(argument);
        foreach (var variable in new[] { "NODE_OPTIONS", "NODE_PATH", "NODE_EXTRA_CA_CERTS" })
            process.StartInfo.Environment.Remove(variable);
        if (!process.Start()) throw new IOException("Replacement helper did not start.");
        try
        {
        process.StandardInput.Close();
        async Task<string?> Read(StreamReader reader)
        {
            var value = new StringBuilder();
            var buffer = new char[1024];
            var oversized = false;
            int count;
            while ((count = await reader.ReadAsync(buffer)) > 0)
            {
                if (count > 8192 - value.Length) oversized = true;
                if (!oversized) value.Append(buffer, 0, count);
            }
            return oversized ? null : value.ToString();
        }
        var output = Read(process.StandardOutput);
        var error = Read(process.StandardError);
        // Once replacement begins, keep the gate until the writer actually exits.
        // Do not cancel or forcibly kill a process in the middle of its transaction.
        await process.WaitForExitAsync();
        await Task.WhenAll(output, error);
        if (process.ExitCode != 0 || await output is not string response || await error is null)
            throw new IOException("Replacement did not report verified success. Inspect retained recovery files before restarting.");
        using var document = JsonDocument.Parse(response);
        var value = document.RootElement;
        if (value.ValueKind != JsonValueKind.Object || value.EnumerateObject().Count() != 7 ||
            value.EnumerateObject().Select(p => p.Name).Distinct().Count() != 7 ||
            value.GetProperty("schema").GetInt32() != 1 || value.GetProperty("status").GetString() != "payload-replaced" ||
            value.GetProperty("installed").GetString() != installed ||
            value.GetProperty("sourceRevision").GetString() != candidate.SourceRevision)
            throw new IOException("Replacement result requires recovery inspection.");
        var recovery = value.GetProperty("recovery").GetString() ?? "";
        if (!Path.IsPathFullyQualified(recovery) || Path.GetDirectoryName(recovery) != Path.GetDirectoryName(installed) ||
            !Path.GetFileName(recovery).StartsWith(".observatory-update-", StringComparison.Ordinal) ||
            value.GetProperty("previous").GetString() != Path.Combine(recovery, "previous") ||
            value.GetProperty("journal").GetString() != Path.Combine(recovery, "transaction.jsonl"))
            throw new IOException("Replacement recovery location is invalid.");
        UpdateRegistration.SetVersion(registration, displayVersion);
        return new(candidate.SourceRevision, recovery);
        }
        finally
        {
            // Even an IPC failure must not release setup exclusion while the writer lives.
            if (!process.HasExited) await process.WaitForExitAsync();
        }
    }
}
