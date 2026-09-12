using System.Globalization;
using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

internal sealed partial class NativeDashboard
{
    private string dictationHost = "Windows", dictationProduct = "Wispr Flow", dictationPeriod = "Week", dictationAnchor = "";

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
        Choice("Product", ["Wispr Flow", "TypeWhisper"], dictationProduct, value => { dictationProduct = value; dictationAnchor = ""; });
        Choice("Device", ["Mac", "Windows"], dictationHost, value => { dictationHost = value; dictationAnchor = ""; });
        Choice("Period", ["Day", "Week", "All retained"], dictationPeriod, value => dictationPeriod = value);
        var source = NativeHistory.Rows(snapshot?["dictation"]).FirstOrDefault(row =>
            Snapshot.Text(row["host"]) == dictationHost && Snapshot.Text(row["source"], "TypeWhisper") == dictationProduct);
        Label("Source status: " + Snapshot.Text(source?["status"], "not-connected") + ". Last checked: " + Snapshot.Text(source?["checkedAt"]));
        if (Snapshot.Text(source?["status"]) != "ok")
        {
            Label("Statistics unavailable. Missing records are unknown, not zero. Hosts and products are not combined.");
            return;
        }
        var days = NativeHistory.Rows(source?["days"]).Where(row => DateOnly.TryParseExact(Snapshot.Text(row["date"]),
            "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _)).OrderBy(row => Snapshot.Text(row["date"]), StringComparer.Ordinal).ToArray();
        if (days.Length == 0) { Label("No retained transcription aggregates. This is not a confirmed zero usage total."); return; }
        var dates = days.Select(row => Snapshot.Text(row["date"])).ToArray();
        if (!dates.Contains(dictationAnchor)) dictationAnchor = dates[^1];
        if (dictationPeriod != "All retained") Choice(dictationPeriod == "Week" ? "Week ending" : "Recorded day", dates, dictationAnchor, value => dictationAnchor = value);
        var selected = NativeHistory.Select(days, dictationPeriod, dictationAnchor);
        var wispr = dictationProduct == "Wispr Flow";
        Label(wispr ? "America/New_York dates. The device identifies the store read, not necessarily the recording device."
            : "Device-local dates. History may include recovered or imported transcriptions.");
        Table("Dictation totals", ["Metric", "Recorded value"], new[] {
            new[] { wispr ? "History records" : "Transcriptions", Snapshot.Format(NativeHistory.Sum(selected, "transcriptions")) },
            new[] { "Words", DictationValue(selected, "words", wispr) },
            new[] { "Recorded audio minutes", DictationValue(selected, "audioSeconds", wispr) }
        });
        if (wispr) Label("Word coverage: " + Snapshot.Format(NativeHistory.Sum(selected, "wordRecords")) + " of "
            + Snapshot.Format(NativeHistory.Sum(selected, "transcriptions")) + " records. Audio coverage: "
            + Snapshot.Format(NativeHistory.Sum(selected, "audioRecords")) + " records. Partial coverage is not a full usage total.");
        Table("Daily dictation", ["Date", "Records", "Words", "Audio minutes"], selected.Reverse().Select(day => new[] {
            Snapshot.Text(day["date"]), Snapshot.Format(Snapshot.Number(day["transcriptions"])), DictationValue([day], "words", wispr), DictationValue([day], "audioSeconds", wispr) }));
        if (!wispr)
        {
            var engines = selected.SelectMany(day => NativeHistory.Rows(day["engines"]).Select(engine => new[] {
                Snapshot.Text(day["date"]), Snapshot.Text(engine["engine"]), Snapshot.Format(Snapshot.Number(engine["transcriptions"])) })).ToArray();
            if (engines.Length == 0) Label("Engine breakdown unknown.");
            else Table("Dictation engines", ["Date", "Engine", "Transcriptions"], engines);
        }
        Label("Hosts and products stay separate. Missing dates are not filled with zeros. Transcripts, recordings, app names and custom model names are excluded.");
        if (wispr) Label("History may include unfinished or failed records. Audio duration includes silence. Synced or imported records can overlap.");
    }
}
