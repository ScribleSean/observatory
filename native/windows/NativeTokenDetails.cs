using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

internal sealed partial class NativeDashboard
{
    private string tokenDetail = "";
    private static readonly string[] TokenFields = ["inputTokens", "cacheReadTokens", "cacheCreationTokens", "outputTokens", "totalTokens"];
    private static string TokenLabel(string field) => field switch {
        "inputTokens" => "Input",
        "cacheReadTokens" => "Cache read",
        "cacheCreationTokens" => "Cache creation",
        "outputTokens" => "Output",
        "reasoningOutputTokens" => "Reasoning (included in output)",
        "totalTokens" => "Total",
        _ => "Unknown"
    };

    internal static JsonObject[] ReconciledProfiles(JsonObject model, string date, JsonObject? settings)
    {
        if (model["inferred"]?.ToJsonString() == "true" || Snapshot.Text(settings?["status"]) != "ok"
            || settings?["snapshotStable"]?.ToJsonString() == "false") return [];
        var profiles = NativeHistory.Rows(settings?["profiles"]).Where(row => Snapshot.Text(row["date"]) == date
            && Snapshot.Text(row["model"]) == Snapshot.Text(model["model"])).ToArray();
        if (profiles.Length == 0) return [];
        foreach (var field in TokenFields)
            if (Snapshot.Number(model[field]) is not { } limit || NativeHistory.Sum(profiles, field) is not { } sum || sum > limit) return [];
        return profiles;
    }

    private void SavedEstimate(JsonNode? estimate, string label)
    {
        var amount = Snapshot.Number(estimate?["usd"]);
        Label(label + ": " + (amount is { } value ? "$" + value.ToString("F2", System.Globalization.CultureInfo.InvariantCulture) : "Unknown"));
        Label("Saved API comparison, not your bill. Covered tokens: " + Snapshot.Format(Snapshot.Number(estimate?["coveredTokens"]))
            + ". Rate check: " + Snapshot.Text(estimate?["checked"]) + ". Hypothetical standard short-context pricing. Unsupported and inferred models may be excluded. Prices are not refreshed here.");
    }

    private void TokenDetails(JsonObject? snapshot, JsonObject[] days)
    {
        var entries = days.SelectMany(day => NativeHistory.Rows(day["models"]).Select(model => (day, model))).ToArray();
        if (entries.Length == 0) { Label("No recorded model detail available."); return; }
        var choices = entries.Select((entry, index) => $"{index + 1}: {Snapshot.Text(entry.day["date"])} · {Snapshot.Text(entry.model["model"])}").ToArray();
        if (!choices.Contains(tokenDetail)) tokenDetail = choices[0];
        Choice("Model detail", choices, tokenDetail, value => tokenDetail = value);
        var (day, model) = entries[Array.IndexOf(choices, tokenDetail)];
        Label("Model: " + Snapshot.Text(model["model"]) + " · Date: " + Snapshot.Text(day["date"])
            + (model["inferred"]?.ToJsonString() == "true" ? " · Inferred model label" : ""));
        Table("Model token classes", ["Metric", "Tokens"], TokenFields.Select(field => new[] { TokenLabel(field), Snapshot.Format(Snapshot.Number(model[field])) }));
        SavedEstimate(day["apiEstimate"], "Selected day's saved comparison");
        SavedEstimate(model["apiEstimate"], "Model's saved comparison");
        var settings = host == "All" ? snapshot?["combinedSettings"] as JsonObject
            : NativeHistory.Rows(snapshot?["settings"]).FirstOrDefault(row => Snapshot.Text(row["host"]) == host);
        if (host == "All" && Snapshot.Text(snapshot?["combinedTokens"]?["verification"]?["status"]) != "verified") settings = null;
        var profiles = ReconciledProfiles(model, Snapshot.Text(day["date"]), settings);
        if (profiles.Length == 0) Label("No reconciled reasoning or speed settings for this model and date. Missing, unstable or conflicting counters are withheld.");
        else
        {
            Table("Recorded model settings", ["Date", "Reasoning effort", "Speed", "Tokens"], profiles.Select(profile => new[] {
                Snapshot.Text(profile["date"]), Snapshot.Text(profile["effort"]), Snapshot.Text(profile["speed"]), Snapshot.Format(Snapshot.Number(profile["totalTokens"])) }));
            var remainder = Snapshot.Number(model["totalTokens"])!.Value - NativeHistory.Sum(profiles, "totalTokens")!.Value;
            if (remainder > 0) Label(Snapshot.Format(remainder) + " tokens have no reconciled settings in this scan.");
        }
        Label("Recorded settings are not measured reasoning time. Each date reconciles independently. Missing settings are never inferred.");
    }
}
