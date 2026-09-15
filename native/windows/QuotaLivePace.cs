using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

internal sealed record QuotaLivePace(string Remaining, string Reset, double Rate)
{
    internal static QuotaLivePace? Read(JsonObject quota, JsonObject window, DateTimeOffset now)
    {
        if (Snapshot.Text(quota["status"]) != "ok" ||
            !DateTimeOffset.TryParse(Snapshot.Text(quota["checkedAt"]), out var at) ||
            now < at || now - at >= TimeSpan.FromMinutes(10) ||
            !DateTimeOffset.TryParse(Snapshot.Text(window["resetsAt"]), out var reset) || reset <= now)
            return null;
        var pace = NativeHistory.Rows(quota["pace"]).FirstOrDefault(row =>
            Snapshot.Text(row["bucket"]) == Snapshot.Text(window["bucket"]) &&
            Snapshot.Text(row["window"]) == Snapshot.Text(window["window"]));
        if (pace is null || Snapshot.Text(pace["asOf"]) != Snapshot.Text(quota["checkedAt"]) ||
            Snapshot.Text(pace["status"]) is not ("projected" or "resets-first") ||
            Snapshot.Number(pace["percentagePointsPerHour"]) is not double rate || !double.IsFinite(rate) || rate <= 0 ||
            Snapshot.Number(window["remainingPercent"]) is not double remaining || !double.IsFinite(remaining) || remaining <= 0 || remaining > 100)
            return null;
        var seconds = remaining / rate * 3600;
        var resetSeconds = (reset - at).TotalSeconds;
        // Compare durations before constructing a date, avoiding overflow for tiny rates.
        if (seconds >= resetSeconds)
            return new("Lasts until reset", Duration((reset - now).TotalSeconds), rate);
        var left = seconds - (now - at).TotalSeconds;
        if (left <= 0) return null;
        return new(Duration(left), Duration((reset - now).TotalSeconds), rate);
    }

    private static string Duration(double seconds)
    {
        var minutes = (long)Math.Ceiling(seconds / 60);
        return $"{minutes / 60}h {minutes % 60}m";
    }
}
