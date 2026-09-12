using System.Drawing.Imaging;
using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

internal static class NativeDashboardTests
{
    internal static void Run(string output)
    {
        var data = JsonNode.Parse("""
          {"schema":2,"collectedAt":"2026-09-12T12:00:00Z",
          "activityHistory":[{"host":"Windows","status":"ok","days":[
          {"date":"2026-09-01","seconds":600},{"date":"2026-09-06","seconds":1200},{"date":"2026-09-12","seconds":1800}]}],
          "tokens":[{"host":"Windows","status":"ok","days":[{"date":"2026-09-12","totalTokens":60,"inputTokens":40,"outputTokens":20}]}],
          "dictation":[{"host":"Windows","source":"Wispr Flow","status":"ok","days":[
          {"date":"2026-09-01","transcriptions":10,"words":100,"wordRecords":10,"audioSeconds":120,"audioRecords":10},
          {"date":"2026-09-12","transcriptions":4,"words":20,"wordRecords":2,"audioSeconds":0,"audioRecords":0}]},
          {"host":"Windows","source":"TypeWhisper","status":"ok","days":[
          {"date":"2026-09-12","transcriptions":1,"words":0,"audioSeconds":0,"engines":[{"engine":"whisper","transcriptions":1}]}]}],
          "agentSource":{"status":"ok"},"agents":[{"model":"test-model","status":"failed","total":99,"role":"review","seconds":2,"recordedAt":"2026-09-12T12:00:00Z","failure":"Synthetic failure"}],
          "localModel":{"status":"ok","records":[{"model":"test-local","status":"ok","input":12,"output":4,"seconds":1}]},
          "settings":[{"host":"Windows","status":"ok","tools":[{"date":"2026-09-12","tool":"functions.exec","namespace":"functions","category":"execution","count":3}]}],
          "combinedTokens":{"status":"ok","verification":{"status":"overlap"},"days":[{"date":"2026-09-12","totalTokens":999}]},
          "quota":{"status":"stale","checkedAt":"2026-09-12T12:00:00Z","windows":[
          {"bucket":"codex","window":"primary","remainingPercent":65},
          {"bucket":"spark","window":"primary","remainingPercent":90}],"history":[],"dailyUsageBuckets":[]}}
          """)!.AsObject();
        var refreshes = 0;
        using var form = new NativeDashboard(() => data, () => { refreshes++; return Task.CompletedTask; });
        form.Shown += async (_, _) =>
        {
            try
            {
                await Task.Delay(200);
                Check(Texts(form).Contains("30 min"), "Day total");
                await Select(form, "Period", "Week");
                Check(Texts(form).Contains("50 min"), "Calendar week total");
                await Select(form, "Period", "All retained");
                Check(Texts(form).Contains("1h 0m"), "Retained total");
                Check(Children(form).OfType<DataGridView>().Single().Rows.Count == 3, "Missing dates not fabricated");
                Capture(form, output, "native-activity");
                await Select(form, "Device", "Mac");
                Check(Texts(form).Any(value => value.StartsWith("No verified records")), "Unavailable host");
                var sections = Children(form).OfType<ListBox>().Single();
                sections.SelectedItem = "Tokens";
                await Select(form, "Device", "Windows");
                Check(Texts(form).Contains("60 tokens"), "Token total");
                Capture(form, output, "native-tokens");
                await Select(form, "Device", "All");
                Check(Texts(form).Any(value => value.StartsWith("No verified records")), "Unverified combined tokens");
                sections.SelectedItem = "Allowances";
                Check(Children(form).OfType<QuotaGraph>().Count() == 1, "Retired allowance hidden");
                Capture(form, output, "native-allowances");
                var quotaGraph = Children(form).OfType<QuotaGraph>().Single();
                var tokenGraph = Children(form).OfType<DailyTokenGraph>().Single();
                Check(quotaGraph.AccessibleDescription?.Contains("no observations") == true, "Empty quota history explained");
                Check(tokenGraph.AccessibleDescription?.Contains("unknown, not zero") == true, "Empty daily totals explained");
                data["quota"]!["dailyUsageBuckets"] = JsonNode.Parse("""[{"startDate":"2026-09-12","tokens":0}]""");
                Capture(form, output, "native-zero-tokens");
                Check(tokenGraph.AccessibleDescription?.Contains("0 tokens") == true, "Recorded zero is not missing");
                data["quota"]!["dailyUsageBuckets"] = new JsonArray();
                data["quota"]!["checkedAt"] = "invalid";
                Capture(form, output, "native-unknown-time");
                Check(quotaGraph.AccessibleDescription?.Contains("observation time is unknown") == true, "Invalid quota time explained");
                Check(tokenGraph.AccessibleDescription?.Contains("unknown, not zero") == true, "Empty summary replaces previous values");
                sections.SelectedItem = "Dictation";
                string Cell(string table, int row, int column) => Children(form).OfType<DataGridView>().Single(grid => grid.AccessibleName == table).Rows[row].Cells[column].Value?.ToString() ?? "";
                Check(Cell("Dictation totals", 0, 1) == "4", "Dictation week excludes older records");
                Check(Cell("Dictation totals", 1, 1) == "20 (partial)", "Partial word coverage");
                Check(Cell("Dictation totals", 2, 1) == "Unknown", "No audio coverage is unknown");
                Capture(form, output, "native-dictation");
                await Select(form, "Period", "All retained");
                Check(Cell("Dictation totals", 0, 1) == "14", "Dictation retained records");
                await Select(form, "Device", "Mac");
                Check(Texts(form).Any(value => value.StartsWith("Statistics unavailable")), "Dictation host not combined");
                await Select(form, "Device", "Windows");
                await Select(form, "Product", "TypeWhisper");
                Check(Cell("Dictation totals", 1, 1) == "0", "Recorded dictation zero");
                Check(Cell("Dictation engines", 0, 1) == "whisper", "Dictation engine detail");
                Check(NativeDashboard.DictationValue([new JsonObject { ["wordRecords"] = 1 }], "words", true) == "Unknown", "Missing dictation counter");
                sections.SelectedItem = "Agents";
                Check(Cell("Handoff receipt", 5, 1) == "Unknown", "Failed receipt tokens withheld");
                Check(Texts(form).Contains("Failure: Synthetic failure"), "Receipt failure detail");
                Capture(form, output, "native-agents");
                data["agents"]![0]!["status"] = "ok";
                form.Reload();
                Check(Cell("Handoff receipt", 5, 1) == "99", "Successful reported counter");
                await Select(form, "Record type", "Local benchmarks");
                Check(Cell("Local benchmark", 1, 1) == "12", "Local benchmark input");
                Check(Cell("Local benchmark", 4, 1) == "Unknown", "Missing local timing");
                await Select(form, "Record type", "Tool requests");
                Check(Cell("Tool requests", 0, 1) == "functions.exec", "Exact tool name");
                Check(Cell("Tool requests", 0, 2) == "functions", "Exact namespace");
                Capture(form, output, "native-tools");
                await Select(form, "Device", "Mac");
                Check(Texts(form).Contains("Tool records unavailable."), "Unavailable tool host");
                sections.SelectedItem = "Sources";
                Check(Children(form).OfType<DataGridView>().Single().Rows.Count == 7, "Source rows");
                Capture(form, output, "native-sources");
                Children(form).OfType<Button>().Single(button => button.Text == "Refresh sources").PerformClick();
                Check(refreshes == 1, "Refresh callback");
                for (var i = 0; i < 20; i++) form.Reload();
                File.WriteAllText(Path.Combine(output, "native-result.txt"), "native-dashboard: passed");
            }
            catch (Exception error)
            {
                File.WriteAllText(Path.Combine(output, "native-result.txt"), "native-dashboard: failed " + error.Message);
                Environment.ExitCode = 1;
            }
            finally { form.Close(); }
        };
        Application.Run(form);
    }
    private static IEnumerable<Control> Children(Control parent)
    {
        foreach (Control child in parent.Controls) { yield return child; foreach (var nested in Children(child)) yield return nested; }
    }
    private static string[] Texts(Control parent) => Children(parent).OfType<Label>().Select(label => label.Text).ToArray();
    private static async Task Select(Control parent, string name, string value)
    {
        Children(parent).OfType<ComboBox>().Single(choice => choice.AccessibleName == name).SelectedItem = value;
        await Task.Delay(100);
    }
    private static void Check(bool value, string name) { if (!value) throw new InvalidOperationException(name); }
    private static void Capture(Form form, string output, string name)
    {
        using var bitmap = new Bitmap(form.Width, form.Height);
        form.DrawToBitmap(bitmap, new Rectangle(Point.Empty, bitmap.Size));
        bitmap.Save(Path.Combine(output, name + ".png"), ImageFormat.Png);
    }
}
