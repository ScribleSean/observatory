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
        var modelFixture = JsonNode.Parse("""{"model":"test-model","inputTokens":40,"cacheReadTokens":0,"cacheCreationTokens":0,"outputTokens":20,"totalTokens":60,"apiEstimate":{"usd":0.25,"coveredTokens":60,"checked":"2026-09-01"}}""")!.AsObject();
        data["tokens"]![0]!["days"]![0]!["models"] = new JsonArray(modelFixture);
        var profileFixture = JsonNode.Parse("""{"date":"2026-09-12","model":"test-model","effort":"high","speed":"standard","inputTokens":20,"cacheReadTokens":0,"cacheCreationTokens":0,"outputTokens":10,"totalTokens":30}""")!.AsObject();
        data["settings"]![0]!["profiles"] = new JsonArray(profileFixture);
        var activityDay = data["activityHistory"]![0]!["days"]![2]!;
        activityDay["hours"] = new JsonArray(Enumerable.Range(0, 24).Select(hour => JsonValue.Create(hour == 12 ? 1800 : 0) as JsonNode).ToArray());
        activityDay["categories"] = JsonNode.Parse("""{"AI apps":1200,"Mixed activity":600}""");
        activityDay["apps"] = JsonNode.Parse("""{"AI apps":{"ChatGPT / Codex":1200},"Mixed activity":{"Do not attribute":600}}""");
        var settingsRoot = Path.Combine(output, "settings-fixture");
        Directory.CreateDirectory(settingsRoot);
        var initialSettings = JsonNode.Parse("""{"activity":false,"codex":false,"wispr":false,"quota":false,"wslDistribution":null,"quotaWslDistribution":null,"futureSetting":"preserved"}""")!.AsObject();
        File.WriteAllText(Path.Combine(settingsRoot, "collector.config.json"), initialSettings.ToJsonString());
        using var settingsCollector = new Collector(settingsRoot);
        var startupRegistered = false;
        var pairingDetails = 0; var disconnects = 0; var repairs = 0;
        var devicePending = new TaskCompletionSource();
        using var form = new NativeDashboard(() => data, () => { refreshes++; return Task.CompletedTask; },
            new SourceSettingsActions(settingsCollector.ReadConfiguration, settingsCollector.UpdateConfiguration),
            new DeviceSettingsActions(() => startupRegistered, value => startupRegistered = value,
                () => pairingDetails++, () => { disconnects++; return devicePending.Task; }, () => { repairs++; return Task.CompletedTask; }));
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
                Check(Children(form).OfType<DataGridView>().Single(grid => grid.AccessibleName == "Recorded history").Rows.Count == 3, "Missing dates not fabricated");
                Check(Children(form).OfType<ActivityHourGraph>().Single().AccessibleDescription?.Contains("12:00: 30 recorded minutes") == true, "Hourly accessible values");
                var appTable = Children(form).OfType<DataGridView>().Single(grid => grid.AccessibleName == "Recorded apps");
                Check(appTable.Rows.Count == 1 && appTable.Rows[0].Cells[1].Value?.ToString() == "ChatGPT / Codex", "App labels and overlap exclusion");
                Capture(form, output, "native-activity");
                var activityGraph = Children(form).OfType<ActivityHourGraph>().Single();
                ((ScrollableControl)activityGraph.Parent!).ScrollControlIntoView(activityGraph);
                Capture(form, output, "native-activity-detail");
                await Select(form, "Activity detail date", "2026-09-01");
                Check(Texts(form).Contains("Hourly breakdown unavailable."), "Missing hourly detail");
                await Select(form, "Device", "Mac");
                Check(Texts(form).Any(value => value.StartsWith("No verified records")), "Unavailable host");
                var sections = Children(form).OfType<ListBox>().Single();
                sections.SelectedItem = "Tokens";
                await Select(form, "Device", "Windows");
                Check(Texts(form).Contains("60 tokens"), "Token total");
                var modelSettings = Children(form).OfType<DataGridView>().Single(grid => grid.AccessibleName == "Recorded model settings");
                Check(modelSettings.Rows[0].Cells[1].Value?.ToString() == "high", "Recorded effort label");
                Check(Texts(form).Contains("30 tokens have no reconciled settings in this scan."), "Partial model settings disclosed");
                Check(Texts(form).Contains("Model's saved comparison: $0.25"), "Saved API comparison");
                Capture(form, output, "native-tokens");
                ((ScrollableControl)modelSettings.Parent!).ScrollControlIntoView(modelSettings);
                Capture(form, output, "native-model-detail");
                var settingsFixture = data["settings"]![0]!.AsObject();
                Check(NativeDashboard.ReconciledProfiles(modelFixture, "2026-09-11", settingsFixture).Length == 0, "Different date withheld");
                profileFixture["inputTokens"] = 41;
                Check(NativeDashboard.ReconciledProfiles(modelFixture, "2026-09-12", settingsFixture).Length == 0, "Per-field overflow withheld");
                profileFixture["inputTokens"] = 20;
                modelFixture["inferred"] = true;
                Check(NativeDashboard.ReconciledProfiles(modelFixture, "2026-09-12", settingsFixture).Length == 0, "Inferred model settings withheld");
                modelFixture["inferred"] = false;
                settingsFixture["snapshotStable"] = false;
                form.Reload();
                Check(!Children(form).OfType<DataGridView>().Any(grid => grid.AccessibleName == "Recorded model settings"), "Unstable settings withheld in UI");
                settingsFixture["snapshotStable"] = true;
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
                sections.SelectedItem = "Settings";
                Check(!Children(form).OfType<CheckBox>().Single(check => check.AccessibleName == "activity").Checked, "Settings loaded existing disabled source");
                Children(form).OfType<CheckBox>().Single(check => check.AccessibleName == "activity").Checked = true;
                Check(settingsCollector.ReadConfiguration()["activity"]!.GetValue<bool>() == false, "Draft is not saved early");
                Children(form).OfType<Button>().Single(button => button.Text == "Save source settings").PerformClick();
                Check(settingsCollector.ReadConfiguration()["activity"]!.GetValue<bool>(), "Source settings saved");
                Check(Snapshot.Text(settingsCollector.ReadConfiguration()["futureSetting"]) == "preserved", "Unrelated settings preserved");
                Capture(form, output, "native-settings");
                try { settingsCollector.UpdateConfiguration(initialSettings, initialSettings); throw new Exception("Stale settings accepted"); }
                catch (InvalidOperationException) { }
                var current = settingsCollector.ReadConfiguration();
                using (var held = new FileStream(Path.Combine(settingsRoot, "collection.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None))
                {
                    try { settingsCollector.UpdateConfiguration(current, initialSettings); throw new Exception("Collection lock ignored"); }
                    catch (IOException) { }
                }
                await Select(form, "Settings page", "This device");
                void ClickDevice(string name) => Children(form).OfType<Button>().Single(button => button.AccessibleName == name).PerformClick();
                Check(Texts(form).Any(value => value.StartsWith("This installation is not registered")), "Startup state read");
                ClickDevice("Toggle login startup");
                Check(startupRegistered && Texts(form).Any(value => value.StartsWith("This installation is registered")), "Startup toggle reread");
                ClickDevice("Pairing details for Mac");
                Check(pairingDetails == 1, "Pairing details callback");
                ClickDevice("Disconnect paired device");
                ClickDevice("Prepare pairing repair");
                Check(disconnects == 1 && repairs == 0, "Concurrent device operation rejected");
                devicePending.SetResult();
                await Task.Delay(100);
                ClickDevice("Prepare pairing repair");
                Check(repairs == 1, "Repair callback after operation completion");
                Capture(form, output, "native-device-settings");
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
