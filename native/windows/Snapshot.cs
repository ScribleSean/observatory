using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

internal static class Snapshot
{
    internal const int MaxBytes = 16_000_000;

    internal static string? DashboardFile(string runtime, string name)
    {
        if (name is not ("usage.json" or "collector.json")) return null;
        return UnlinkedFile(runtime, "public/local/" + name);
    }

    internal static string? UnlinkedFile(string root, string relative)
    {
        try
        {
            var components = relative.Split(new[] { '/', '\\' }, StringSplitOptions.RemoveEmptyEntries);
            if (Path.IsPathRooted(relative) || relative.Contains(':') || components.Any(part => part is "." or "..")) return null;
            var file = Path.GetFullPath(root);
            if (File.GetAttributes(file).HasFlag(FileAttributes.ReparsePoint)) return null;
            foreach (var component in components)
            {
                file = Path.Combine(file, component);
                var entry = file;
                if (File.GetAttributes(entry).HasFlag(FileAttributes.ReparsePoint)) return null;
            }
            return file;
        }
        catch { return null; }
    }

    internal static JsonObject? Read(string file)
    {
        try
        {
            var info = new FileInfo(file);
            if (!info.Exists || info.Length > MaxBytes || info.Attributes.HasFlag(FileAttributes.ReparsePoint)) return null;
            return JsonNode.Parse(File.ReadAllText(file)) as JsonObject;
        }
        catch { return null; }
    }

    internal static string Text(JsonNode? value, string fallback = "Unknown") =>
        value is JsonValue item && item.TryGetValue<string>(out var result) ? result : fallback;

    internal static double? Number(JsonNode? value)
    {
        if (value is not JsonValue item || item.GetValueKind() != System.Text.Json.JsonValueKind.Number) return null;
        try
        {
            var number = double.Parse(item.ToJsonString(), System.Globalization.CultureInfo.InvariantCulture);
            return double.IsFinite(number) && number >= 0 ? number : null;
        }
        catch { return null; }
    }

    internal static JsonObject? Latest(JsonObject? snapshot, string kind, string host)
    {
        JsonObject? source;
        if (host == "All")
        {
            source = snapshot?[kind == "activity" ? "combined" : "combinedTokens"] as JsonObject;
            if (kind is not ("activity" or "tokens")) return null;
            if (kind == "tokens" && Text(source?["verification"]?["status"]) != "verified") return null;
        }
        else
        {
            source = (snapshot?[kind] as JsonArray)?.OfType<JsonObject>().FirstOrDefault(row =>
                Text(row["host"]) == host && (kind != "dictation" || Text(row["source"]) == "Wispr Flow"));
        }
        if (Text(source?["status"]) != "ok") return null;
        return (source?["days"] as JsonArray)?.OfType<JsonObject>()
            .OrderBy(row => Text(row["date"]), StringComparer.Ordinal).LastOrDefault();
    }

    internal static string Format(double? value) => value?.ToString("N0") ?? "Unknown";
    internal static string Duration(double? seconds) => seconds is null || !double.IsFinite(seconds.Value) || seconds < 0 ? "Unknown" :
        seconds >= 86400 ? $"{Math.Floor(seconds.Value / 86400):0}d {Math.Floor(seconds.Value % 86400 / 3600):0}h {Math.Floor(seconds.Value % 3600 / 60):0}m" :
        seconds >= 3600 ? $"{Math.Floor(seconds.Value / 3600):0}h {Math.Floor(seconds.Value % 3600 / 60):0}m" : $"{seconds / 60:0.#} min";

    internal static void SelfTest()
    {
        void Check(bool value) { if (!value) throw new InvalidOperationException("Snapshot contract failed"); }
        Check(Duration(86400) == "1d 0h 0m" && Duration(90060) == "1d 1h 1m");
        Check(Duration(double.NaN) == "Unknown");
        Check(DashboardHistoryChart.AxisLabel(1e9) == "1B" && DashboardHistoryChart.AxisLabel(1e12) == "1T");
        Check(DashboardHistoryChart.AxisLabel(999_999_999) == "1B");
        Check(Number(JsonValue.Create(true)) is null);
        Check(Number(JsonValue.Create(-1)) is null);
        Check(Number(JsonValue.Create("1")) is null);
        Check(Number(JsonValue.Create(0)) == 0);
        var data = JsonNode.Parse("""
            {"combined":{"status":"ok","days":[{"date":"2026-09-08","seconds":90}]},
             "combinedTokens":{"status":"ok","verification":{"status":"verified"},
             "days":[{"date":"2026-09-08","totalTokens":600}]}}
            """)!.AsObject();
        Check(Number(Latest(data, "activity", "All")?["seconds"]) == 90);
        Check(Number(Latest(data, "tokens", "All")?["totalTokens"]) == 600);
        data["combinedTokens"]!["verification"]!["status"] = "overlap";
        Check(Latest(data, "tokens", "All") is null);
        Check(Latest(data, "dictation", "All") is null);
        Check(Latest(data, "tokens", "Windows") is null);
        Check(Format(null) == "Unknown");
        Console.WriteLine("Windows snapshot self-tests passed");
    }
}
