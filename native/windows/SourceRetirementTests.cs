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
            foreach (var quota in new[] { false, true })
            {
                var rejected = false;
                try { collector.Configure(quota ? null : "Ubuntu", quota: quota, quotaDistro: quota ? "Ubuntu" : null); }
                catch (ArgumentException) { rejected = true; }
                Check(rejected && !collector.Configured, "New configuration still accepts retired WSL sources.");
            }
            var file = Path.Combine(runtime, "collector.config.json");
            var legacy = JsonNode.Parse("""{"activity":false,"codex":true,"wispr":false,"quota":true,"wslDistribution":"Ubuntu-24.04","quotaWslDistribution":"Ubuntu","futureSetting":"preserved"}""")!.AsObject();
            File.WriteAllText(file, legacy.ToJsonString());
            var history = Path.Combine(runtime, "public", "local", "usage.json");
            const string saved = """{"schema":2,"tokens":[{"host":"Ubuntu","status":"ok","days":[{"date":"2026-09-12","totalTokens":42}]}]}""";
            File.WriteAllText(history, saved);
            var draft = legacy.DeepClone().AsObject();
            draft.Remove("wslDistribution"); draft.Remove("quotaWslDistribution");
            draft["wispr"] = true;
            collector.UpdateConfiguration(legacy, draft);
            var current = collector.ReadConfiguration();
            Check(Snapshot.Text(current["quotaWslDistribution"]) == "Ubuntu", "Settings silently switched a retired account selection to Windows.");
            Check(Snapshot.Text(current["wslDistribution"]) == "Ubuntu-24.04", "Settings rewrote legacy source metadata.");
            Check(current["wispr"]!.GetValue<bool>() && current["futureSetting"]!.GetValue<string>() == "preserved", "Native source changes lost unrelated settings.");
            foreach (var key in new[] { "wslDistribution", "quotaWslDistribution" })
            {
                foreach (var value in new string?[] { null, "OtherDistro" })
                {
                    var changed = current.DeepClone().AsObject(); changed[key] = value;
                    var rejected = false;
                    try { collector.UpdateConfiguration(current, changed); }
                    catch (ArgumentException) { rejected = true; }
                    Check(rejected && JsonNode.DeepEquals(current, collector.ReadConfiguration()), "A retired selection was changed without a supported migration.");
                }
            }
            Check(File.ReadAllText(history) == saved, "Saving settings changed historical source records.");
            Check(Snapshot.Number(Snapshot.Latest(JsonNode.Parse(saved)!.AsObject(), "tokens", "Ubuntu")?["totalTokens"]) == 42, "Historical Ubuntu records are no longer readable.");
            Check(Snapshot.Latest(JsonNode.Parse(saved)!.AsObject(), "activity", "Ubuntu") is null, "Missing legacy activity was invented.");
            Console.WriteLine("Retired source settings rejected, legacy account selection and stored records preserved.");
        }
        finally { Directory.Delete(runtime, true); }
    }

    private static void Check(bool value, string message) { if (!value) throw new InvalidOperationException(message); }
}
