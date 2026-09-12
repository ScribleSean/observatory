using System.Globalization;
using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

internal static class NativeHistory
{
    internal static JsonObject[] Rows(JsonNode? value) => (value as JsonArray)?.OfType<JsonObject>().ToArray() ?? [];
    internal static JsonObject[] Days(JsonObject? snapshot, string kind, string host)
    {
        if (kind is not ("activity" or "tokens")) return [];
        JsonObject? source;
        if (kind == "activity" && Rows(snapshot?["activityHistory"]).FirstOrDefault(row =>
                Snapshot.Text(row["host"]) == (host == "All" ? "Combined" : host)) is { } archive) source = archive;
        else if (host == "All")
        {
            source = snapshot?[kind == "activity" ? "combined" : "combinedTokens"] as JsonObject;
            if (kind == "tokens" && Snapshot.Text(source?["verification"]?["status"]) != "verified") return [];
        }
        else source = Rows(snapshot?[kind]).FirstOrDefault(row => Snapshot.Text(row["host"]) == host);
        return Snapshot.Text(source?["status"]) == "ok" ? Rows(source?["days"])
            .Where(row => Date(Snapshot.Text(row["date"])).HasValue)
            .OrderBy(row => Snapshot.Text(row["date"]), StringComparer.Ordinal).ToArray() : [];
    }
    private static DateOnly? Date(string value) => DateOnly.TryParseExact(value, "yyyy-MM-dd",
        CultureInfo.InvariantCulture, DateTimeStyles.None, out var date) ? date : null;
    internal static JsonObject[] Select(JsonObject[] days, string period, string anchor)
    {
        if (period == "All retained") return days;
        if (period is not ("Day" or "Week") || Date(anchor) is not { } end) return [];
        var start = period == "Week" ? end.AddDays(-6) : end;
        return days.Where(row => Date(Snapshot.Text(row["date"])) is { } day && day >= start && day <= end).ToArray();
    }
    internal static double? Sum(JsonObject[] rows, string field)
    {
        if (rows.Length == 0) return null;
        double total = 0;
        foreach (var row in rows)
        {
            if (Snapshot.Number(row[field]) is not { } number) return null;
            total += number;
            if (!double.IsFinite(total)) return null;
        }
        return total;
    }
    internal static void SelfTest()
    {
        void Check(bool value) { if (!value) throw new InvalidOperationException("Native history contract failed"); }
        var data = JsonNode.Parse("""
          {"activityHistory":[{"host":"Windows","status":"ok","days":[
          {"date":"2026-09-01","seconds":600},{"date":"2026-09-06","seconds":1200},
          {"date":"2026-09-12","seconds":1800}]}],
          "combinedTokens":{"status":"ok","verification":{"status":"overlap"},"days":[{"date":"2026-09-12","totalTokens":99}]}}
          """)!.AsObject();
        var days = Days(data, "activity", "Windows");
        Check(Sum(Select(days, "Week", "2026-09-12"), "seconds") == 3000);
        Check(Sum(Select(days, "All retained", ""), "seconds") == 3600);
        Check(Select(days, "Day", "2026-09-07").Length == 0);
        Check(Days(data, "tokens", "All").Length == 0);
        Check(Days(data, "activity", "Mac").Length == 0);
        Check(Sum([new JsonObject { ["n"] = 2 }, new JsonObject()], "n") is null);
        Console.WriteLine("Native history self-tests passed");
    }
}
