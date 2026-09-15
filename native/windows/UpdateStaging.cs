using System.Text.Json;
using System.Text.RegularExpressions;

namespace WorkspaceObservatory;

// Prepares a candidate without quitting the app. Activation must reverify it
// under UpdateSession. Receipt and key come from trusted local configuration.
internal static class UpdateStaging
{
    internal sealed record Result(string Staged, string EnvelopePath, string SourceRevision, long BuildNumber);

    internal static Result Parse(string output, string installed, string extracted, long previousBuild)
    {
        if (output.Length > 4096 || previousBuild < 0 || previousBuild > 9007199254740991L ||
            !Path.IsPathFullyQualified(installed) || !Path.IsPathFullyQualified(extracted))
            throw new IOException("Invalid update staging response.");
        using var document = JsonDocument.Parse(output);
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object || root.EnumerateObject().Count() != 6 ||
            root.EnumerateObject().Select(p => p.Name).Distinct().Count() != 6 ||
            root.GetProperty("schema").GetInt32() != 1 || root.GetProperty("status").GetString() != "payload-staged")
            throw new IOException("Invalid update staging response.");
        var staged = root.GetProperty("staged").GetString() ?? "";
        var envelope = root.GetProperty("envelopePath").GetString() ?? "";
        var revision = root.GetProperty("sourceRevision").GetString() ?? "";
        var build = root.GetProperty("buildNumber").GetInt64();
        if (!Path.IsPathFullyQualified(staged) || Path.GetFullPath(staged) != staged ||
            !string.Equals(Path.GetDirectoryName(staged), Path.GetDirectoryName(installed), StringComparison.OrdinalIgnoreCase) ||
            !Regex.IsMatch(Path.GetFileName(staged), "^\\.observatory-candidate-[A-Za-z0-9]{6}$") ||
            string.Equals(staged, installed, StringComparison.OrdinalIgnoreCase) ||
            envelope != Path.Combine(extracted, "installation-envelope.json") ||
            !Regex.IsMatch(revision, "^[a-f0-9]{40}$") || build <= previousBuild || build > 9007199254740991L)
            throw new IOException("Invalid update staging identity or location.");
        return new(staged, envelope, revision, build);
    }

    internal static async Task<Result> Stage(string extracted, string installed, string previousReceipt,
        string pinnedKey, long previousBuild, CancellationToken cancellation = default)
    {
        if (!Path.IsPathFullyQualified(extracted) || !Path.IsPathFullyQualified(installed) ||
            !Path.IsPathFullyQualified(previousReceipt) || previousBuild < 0 || previousBuild > 9007199254740991L ||
            !Regex.IsMatch(pinnedKey, "^[A-Za-z0-9+/]{43}=$"))
            throw new IOException("Invalid update staging request.");
        cancellation.ThrowIfCancellationRequested();
        using var gate = InstallationGate.TryEnter()
            ?? throw new IOException("Installation is busy. Retry the update later.");
        var output = await UpdateCandidate.RunTrustedCommand("stage-update-payload.mjs",
            new[] { extracted, installed, previousReceipt, pinnedKey }, cancellation);
        var result = Parse(output, installed, extracted, previousBuild);
        var verified = await UpdateCandidate.Verify(result.Staged, result.EnvelopePath, pinnedKey, previousBuild, cancellation);
        if (verified.SourceRevision != result.SourceRevision || verified.BuildNumber != result.BuildNumber)
            throw new IOException("Staged update identity changed.");
        return result;
    }

    internal static void SelfTest()
    {
        var parent = Path.Combine(Path.GetTempPath(), "observatory-staging-fixture");
        var installed = Path.Combine(parent, "installed");
        var extracted = Path.Combine(parent, "extracted");
        var staged = Path.Combine(parent, ".observatory-candidate-Ab12cD");
        var good = JsonSerializer.Serialize(new { schema = 1, status = "payload-staged", staged,
            envelopePath = Path.Combine(extracted, "installation-envelope.json"),
            sourceRevision = new string('a', 40), buildNumber = 8 });
        if (Parse(good, installed, extracted, 7).Staged != staged) throw new Exception("Staging response was lost.");
        foreach (var bad in new[] { "{}", "null", good + good, new string('x', 4097),
            good.Replace("payload-staged", "verified"), good.Replace("\"buildNumber\":8", "\"buildNumber\":7"),
            good.Replace("\"schema\":1", "\"schema\":1,\"schema\":1"),
            good.Replace(".observatory-candidate-Ab12cD", "installed"),
            good.Replace("installation-envelope.json", "other.json"), good.Replace(new string('a', 40), "invalid") })
        {
            var refused = false;
            try { Parse(bad, installed, extracted, 7); } catch { refused = true; }
            if (!refused) throw new Exception("Invalid staging response accepted.");
        }
        Console.WriteLine("Update staging response validates sibling location, envelope, schema and advancing identity.");
    }
}
