using System.Text.Json;
using System.Text.RegularExpressions;

namespace WorkspaceObservatory;

// Stages trusted OLD code outside the installation. It does not launch it or
// request shutdown. The caller supplies independently retained receipt state.
internal static class UpdateHelper
{
    internal static string Parse(string output, string parent, string previousRevision, long previousBuild)
    {
        if (output.Length > 4096 || !Path.IsPathFullyQualified(parent) || Path.GetFullPath(parent) != parent ||
            !Regex.IsMatch(previousRevision, "^[a-f0-9]{40}$") || previousBuild < 0 || previousBuild > 9007199254740991L)
            throw new IOException("Invalid helper staging response.");
        using var document = JsonDocument.Parse(output);
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object || root.EnumerateObject().Count() != 5 ||
            root.EnumerateObject().Select(p => p.Name).Distinct().Count() != 5 ||
            root.GetProperty("schema").GetInt32() != 1 || root.GetProperty("status").GetString() != "helper-staged" ||
            root.GetProperty("sourceRevision").GetString() != previousRevision ||
            root.GetProperty("buildNumber").GetInt64() != previousBuild)
            throw new IOException("Invalid helper staging identity.");
        var helper = root.GetProperty("helper").GetString() ?? "";
        if (!Path.IsPathFullyQualified(helper) || Path.GetFullPath(helper) != helper ||
            !string.Equals(Path.GetDirectoryName(helper), parent, StringComparison.OrdinalIgnoreCase) ||
            !Regex.IsMatch(Path.GetFileName(helper), "^\\.observatory-helper-[A-Za-z0-9]{6}$"))
            throw new IOException("Invalid helper staging location.");
        return helper;
    }

    internal static async Task<string> Stage(string installed, string previousReceipt, string parent,
        string previousRevision, long previousBuild, CancellationToken cancellation = default)
    {
        if (!Path.IsPathFullyQualified(installed) || !Path.IsPathFullyQualified(previousReceipt) ||
            !Path.IsPathFullyQualified(parent)) throw new IOException("Absolute helper paths required.");
        cancellation.ThrowIfCancellationRequested();
        using var gate = InstallationGate.TryEnter()
            ?? throw new IOException("Installation is busy. Retry the update later.");
        var output = await UpdateCandidate.RunTrustedCommand("stage-update-helper.mjs",
            new[] { installed, previousReceipt, parent }, cancellation);
        return Parse(output, parent, previousRevision, previousBuild);
    }

    internal static void SelfTest()
    {
        var parent = Path.Combine(Path.GetTempPath(), "observatory-helper-fixture");
        var helper = Path.Combine(parent, ".observatory-helper-Ab12cD");
        var revision = new string('a', 40);
        var good = JsonSerializer.Serialize(new { schema = 1, status = "helper-staged", helper,
            sourceRevision = revision, buildNumber = 7 });
        if (Parse(good, parent, revision, 7) != helper) throw new Exception("Helper path was lost.");
        foreach (var bad in new[] { "null", "{}", good + good, new string('x', 4097),
            good.Replace("helper-staged", "payload-staged"), good.Replace("\"buildNumber\":7", "\"buildNumber\":8"),
            good.Replace(revision, new string('b', 40)), good.Replace(".observatory-helper-Ab12cD", "installed"),
            good.Replace("\"schema\":1", "\"schema\":1,\"schema\":1") })
        {
            var refused = false;
            try { Parse(bad, parent, revision, 7); } catch { refused = true; }
            if (!refused) throw new Exception("Invalid helper response accepted.");
        }
        Console.WriteLine("Helper response binds external path to the previous installed identity.");
    }
}
