using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

internal static class SourceRetirementTests
{
    internal static void Run()
    {
        var runtime = Path.Combine(Path.GetTempPath(), "observatory-source-retirement-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(runtime);
        try
        {
            using var collector = new Collector(runtime);
            var file = Path.Combine(runtime, "collector.config.json");
            var legacy = JsonNode.Parse("""{"activity":false,"codex":true,"wispr":false,"quota":true,"wslDistribution":"Ubuntu-24.04","quotaWslDistribution":"Ubuntu","futureSetting":"preserved"}""")!.AsObject();
            File.WriteAllText(file, legacy.ToJsonString());
            var history = Path.Combine(runtime, "public", "local", "usage.json");
            const string saved = """{"schema":2,"tokens":[{"host":"Other","status":"ok","days":[{"date":"2026-09-12","totalTokens":42}]}]}""";
            File.WriteAllText(history, saved);
            var draft = legacy.DeepClone().AsObject();
            draft.Remove("wslDistribution"); draft.Remove("quotaWslDistribution");
            draft["wispr"] = true;
            collector.UpdateConfiguration(legacy, draft);
            var current = collector.ReadConfiguration();
            Check(!current.ContainsKey("quotaWslDistribution") && !current.ContainsKey("wslDistribution"), "Saving settings kept selectors that are no longer read.");
            Check(current["quota"]!.GetValue<bool>() && current["codex"]!.GetValue<bool>() && !current["activity"]!.GetValue<bool>(), "Saving settings changed an unrelated source switch.");
            Check(current["wispr"]!.GetValue<bool>() && current["futureSetting"]!.GetValue<string>() == "preserved", "Native source changes lost unrelated settings.");
            var resubmitted = current.DeepClone().AsObject(); resubmitted["wslDistribution"] = "OtherDistro";
            collector.UpdateConfiguration(current, resubmitted);
            Check(JsonNode.DeepEquals(current, collector.ReadConfiguration()), "A selector that is no longer read was written back.");
            Check(File.ReadAllText(history) == saved, "Saving settings changed historical source records.");
            Console.WriteLine("Older source selectors dropped on save, other settings and stored records preserved.");
        }
        finally { Directory.Delete(runtime, true); }
    }

    private static void Check(bool value, string message) { if (!value) throw new InvalidOperationException(message); }
}
