using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace WorkspaceObservatory;

internal static class UpdateCandidate
{
    internal sealed record Identity(string SourceRevision, long BuildNumber, string ManifestSha256);

    internal static Identity Parse(string output, long previousBuild)
    {
        if (output.Length > 4096 || previousBuild < 0) throw new IOException("Invalid update verification response.");
        using var document = JsonDocument.Parse(output);
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object || root.EnumerateObject().Count() != 5 ||
            root.EnumerateObject().Select(p => p.Name).Distinct().Count() != 5 ||
            root.GetProperty("schema").GetInt32() != 1 || root.GetProperty("status").GetString() != "verified")
            throw new IOException("Invalid update verification response.");
        var revision = root.GetProperty("sourceRevision").GetString() ?? "";
        var digest = root.GetProperty("manifestSha256").GetString() ?? "";
        var build = root.GetProperty("buildNumber").GetInt64();
        if (!Regex.IsMatch(revision, "^[a-f0-9]{40}$") || !Regex.IsMatch(digest, "^[a-f0-9]{64}$") ||
            build <= previousBuild || build > 9007199254740991L)
            throw new IOException("Invalid update verification identity.");
        return new(revision, build, digest);
    }

    // The installed runtime is trusted by the caller. Never execute a verifier
    // or Node binary from the extracted candidate to establish its authenticity.
    internal static async Task<Identity> Verify(string staged, string envelope, string pinnedKey,
        long previousBuild, CancellationToken cancellation = default)
    {
        if (!Path.IsPathFullyQualified(staged) || !Path.IsPathFullyQualified(envelope) ||
            previousBuild < 0 || previousBuild > 9007199254740991L ||
            !Regex.IsMatch(pinnedKey, "^[A-Za-z0-9+/]{43}=$"))
            throw new IOException("Invalid update verification request.");
        var output = await RunTrustedCommand("verify-candidate.mjs", new[] { staged, envelope, pinnedKey,
            previousBuild.ToString(CultureInfo.InvariantCulture) }, cancellation);
        return Parse(output, previousBuild);
    }

    // Only installed updater entry points may use this bounded process runner.
    internal static async Task<string> RunTrustedCommand(string command, string[] arguments,
        CancellationToken cancellation = default)
    {
        if (command is not ("verify-candidate.mjs" or "stage-update-payload.mjs" or "stage-update-helper.mjs"))
            throw new IOException("Unsupported updater command.");
        var node = Path.Combine(AppContext.BaseDirectory, "Runtime", "node.exe");
        var verifier = Path.Combine(AppContext.BaseDirectory, "Updater", command);
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        deadline.CancelAfter(TimeSpan.FromMinutes(2));
        cancellation.ThrowIfCancellationRequested();
        using var process = new Process { StartInfo = new(node) {
            UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = AppContext.BaseDirectory,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true } };
        foreach (var argument in new[] { verifier }.Concat(arguments))
            process.StartInfo.ArgumentList.Add(argument);
        foreach (var variable in new[] { "NODE_OPTIONS", "NODE_PATH", "NODE_EXTRA_CA_CERTS" })
            process.StartInfo.Environment.Remove(variable);
        if (!process.Start()) throw new IOException("Update verifier did not start.");
        process.StandardInput.Close();
        async Task<string> Read(StreamReader reader)
        {
            var result = new StringBuilder();
            var buffer = new char[1024];
            int count;
            while ((count = await reader.ReadAsync(buffer.AsMemory(), deadline.Token)) > 0)
            {
                if (count > 4096 - result.Length) { deadline.Cancel(); throw new IOException("Update verifier output exceeded its limit."); }
                result.Append(buffer, 0, count);
            }
            return result.ToString();
        }
        var output = Read(process.StandardOutput);
        var error = Read(process.StandardError);
        try
        {
            await process.WaitForExitAsync(deadline.Token);
            await Task.WhenAll(output, error);
            if (process.ExitCode != 0) throw new IOException("Candidate verification failed. No update was activated.");
            return await output;
        }
        finally
        {
            // No allowed command modifies the installed app. A cancelled
            // staging copy can remain partial, but cannot become an activation.
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            using var cleanup = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            await process.WaitForExitAsync(cleanup.Token);
            try { await Task.WhenAll(output, error).WaitAsync(cleanup.Token); } catch { }
        }
    }

    internal static void SelfTest()
    {
        var good = JsonSerializer.Serialize(new { schema = 1, status = "verified", sourceRevision = new string('a', 40),
            buildNumber = 8, manifestSha256 = new string('b', 64) });
        if (Parse(good, 7).BuildNumber != 8) throw new Exception("Update identity was not parsed.");
        foreach (var bad in new[] { "null", "{}", good + good, good.Replace("verified", "unknown"),
            good.Replace("\"buildNumber\":8", "\"buildNumber\":7"), good.Replace("\"schema\":1", "\"schema\":1,\"extra\":0"),
            good.Replace(new string('a', 40), "invalid"), new string('x', 4097) })
        {
            var rejected = false;
            try { Parse(bad, 7); } catch { rejected = true; }
            if (!rejected) throw new Exception("Unsafe update response accepted.");
        }
        Console.WriteLine("Native update verification response rejects stale, malformed and oversized identities.");
    }
}
