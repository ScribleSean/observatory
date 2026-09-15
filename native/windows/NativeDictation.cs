using System.Globalization;
using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

internal sealed partial class NativeDashboard
{
    private string dictationHost = "All devices", dictationProduct = "All tools", dictationPeriod = "Week", dictationAnchor = "";

    internal static string DictationValue(JsonObject[] days, string field, bool wispr)
    {
        var coverage = NativeHistory.Sum(days, field == "words" ? "wordRecords" : "audioRecords");
        if (wispr && (coverage is null || coverage <= 0)) return "Unknown";
        var total = NativeHistory.Sum(days, field);
        if (total is null) return "Unknown";
        var partial = wispr && coverage != NativeHistory.Sum(days, "transcriptions");
        return (field == "audioSeconds" ? (total.Value / 60).ToString("N1", CultureInfo.CurrentCulture) : Snapshot.Format(total))
            + (partial ? " (partial)" : "");
    }

    private void Dictation(JsonObject? snapshot)
    {
        Label("Your voice usage over time, by tool and device.");
        Choice("Tool", ["All tools", "Wispr Flow", "ChatGPT"], dictationProduct, value => { dictationProduct = value; dictationAnchor = ""; });
        Choice("Device", ["All devices", "Mac", "Windows"], dictationHost, value => { dictationHost = value; dictationAnchor = ""; });
        Choice("Period", ["Day", "Week", "All retained"], dictationPeriod, value => dictationPeriod = value);
        var devices = dictationHost == "All devices" ? new[] { "Mac", "Windows" } : [dictationHost];
        var products = dictationProduct == "All tools" ? new[] { "Wispr Flow", "ChatGPT" } : [dictationProduct];
        var sources = devices.SelectMany(device => products.Select(product => {
            var matches = NativeHistory.Rows(snapshot?["dictation"]).Where(row =>
                Snapshot.Text(row["host"]) == device && Snapshot.Text(row["source"]) == product).ToArray();
            var source = product == "Wispr Flow" && matches.Length == 1 ? matches[0] : null;
            var status = product == "ChatGPT" ? "Tracking not yet verified" :
                matches.Length > 1 ? "Ambiguous source" : Snapshot.Text(source?["status"], "not-connected");
            var days = status == "ok" ? NativeHistory.Rows(source?["days"]).Where(row =>
                DateOnly.TryParseExact(Snapshot.Text(row["date"]), "yyyy-MM-dd", CultureInfo.InvariantCulture,
                    DateTimeStyles.None, out _)).OrderBy(row => Snapshot.Text(row["date"]), StringComparer.Ordinal).ToArray() : [];
            return (device, product, source, status, days);
        })).ToArray();
        var dates = sources.SelectMany(source => source.days).Select(day => Snapshot.Text(day["date"]))
            .Distinct().Order(StringComparer.Ordinal).ToArray();
        if (!dates.Contains(dictationAnchor)) dictationAnchor = dates.LastOrDefault() ?? "";
        if (dictationPeriod != "All retained" && dates.Length > 0)
            Choice(dictationPeriod == "Week" ? "Week ending" : "Recorded day", dates, dictationAnchor, value => dictationAnchor = value);
        var selected = sources.Select(source => (source, days: NativeHistory.Select(source.days, dictationPeriod, dictationAnchor))).ToArray();
        Label("Recorded voice time");
        var known = selected.Where(row => DictationValue(row.days, "audioSeconds", true) != "Unknown").ToArray();
        if (known.Length == 0) Label("Recorded audio minutes: Unknown");
        foreach (var row in known)
            Label(row.source.product + " · " + row.source.device + ": " + DictationValue(row.days, "audioSeconds", true) + " min");
        Label("Known recordings in the selected period. Coverage is incomplete. Device histories may overlap and are not added together.");
        Label("By tool and device");
        foreach (var row in selected)
            AddCard(new DashboardValueCard(row.source.product + " · " + row.source.device, [
                ("Status", row.source.status == "ok" ? "Recorded history" : row.source.status),
                ("Last checked", Snapshot.Text(row.source.source?["checkedAt"])),
                ("Records", Snapshot.Format(NativeHistory.Sum(row.days, "transcriptions"))),
                ("Words", DictationValue(row.days, "words", true)),
                ("Recorded audio minutes", DictationValue(row.days, "audioSeconds", true))
            ]), "Voice tool and device");
        var daily = selected.SelectMany(row => row.days.Select(day => new[] {
            Snapshot.Text(day["date"]), row.source.product, row.source.device,
            Snapshot.Format(Snapshot.Number(day["transcriptions"])), DictationValue([day], "words", true),
            DictationValue([day], "audioSeconds", true)
        })).OrderByDescending(row => row[0], StringComparer.Ordinal).ToArray();
        if (daily.Length == 0) Label("No recorded voice statistics in this scope. Missing data is not zero usage.");
        else Table("Voice over time", ["Date", "Tool", "Device", "Records", "Words", "Audio minutes"], daily.Take(60));
        Label("Latest 60 tool/device rows shown. Totals cover the selected period. America/New_York dates. Missing dates are gaps, not zeros.");
        Label("More local speech detection coming soon.");
        Label("ChatGPT voice tracking has not been verified. General ChatGPT screen time is not voice usage.");
        Label("Wispr recording metadata can include silence and unfinished records. Synced or imported histories can overlap, so device totals are not added together. Transcripts, recordings and credentials are excluded.");
    }
}
