using System.Drawing.Imaging;
using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

internal static class NativeDashboardTests
{
    internal static void Run(string output)
    {
        var paceQuota = JsonNode.Parse("""{"status":"ok","checkedAt":"2026-09-09T12:00:00Z","pace":[{"bucket":"codex","window":"primary","asOf":"2026-09-09T12:00:00Z","summary":"Synthetic pace"}]}""")!.AsObject();
        var paceWindow = new JsonObject { ["bucket"] = "codex", ["window"] = "primary" };
        if (NativeDashboard.AllowancePaceText(paceQuota, paceWindow, DateTimeOffset.Parse("2026-09-09T12:01:00Z")) != "Synthetic pace" ||
            NativeDashboard.AllowancePaceText(paceQuota, paceWindow, DateTimeOffset.Parse("2026-09-09T12:10:00Z")) != "Estimate unavailable until a fresh reading.")
            throw new InvalidOperationException("Allowance pace freshness failed");
        paceWindow["resetsAt"] = "2026-09-09T16:00:00Z";
        paceQuota["pace"]![0]!["status"] = "projected";
        foreach (var fraction in new[] { -0.1, 0, 0.625, 1, 1.1 })
        {
            paceQuota["pace"]![0]!["coverageFraction"] = fraction;
            double? expected = fraction >= 0 && fraction <= 1 ? fraction : null;
            if (NativeDashboard.AllowancePaceCoverage(paceQuota, paceWindow, DateTimeOffset.Parse("2026-09-09T12:01:00Z")) != expected ||
                NativeDashboard.AllowancePaceCoverage(paceQuota, paceWindow, DateTimeOffset.Parse("2026-09-09T12:10:00Z")) is not null)
                throw new InvalidOperationException("Allowance reset coverage validation failed");
        }
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
        var initialSettings = JsonNode.Parse("""{"activity":false,"codex":false,"wispr":false,"quota":true,"wslDistribution":null,"quotaWslDistribution":null,"futureSetting":"preserved"}""")!.AsObject();
        File.WriteAllText(Path.Combine(settingsRoot, "collector.config.json"), initialSettings.ToJsonString());
        using var settingsCollector = new Collector(settingsRoot);
        var startupRegistered = false;
        var pairingDetails = 0; var disconnects = 0; var repairs = 0;
        var networkChecks = 0;
        var devicePending = new TaskCompletionSource();
        var confirmSettings = false;
        var confirmations = new List<string>();
        var sharingEnabled = false; var sharingConfirmed = false; var sharingChanges = 0;
        var sharingToken = new string('a', 64);
        Check(QuotaSharing.Parse("{\"version\":1,\"enabled\":false,\"canEnable\":false,\"reason\":\"account-unavailable\",\"token\":null}").CanEnable == false, "Unknown sharing status parsed");
        try { QuotaSharing.Parse("{\"version\":1,\"enabled\":true,\"canEnable\":true,\"reason\":\"ready\",\"token\":\"private\"}"); throw new Exception("Malformed sharing token accepted"); }
        catch (InvalidOperationException) { }
        using var form = new NativeDashboard(() => data, () => { refreshes++; return Task.CompletedTask; },
            new SourceSettingsActions(settingsCollector.ReadConfiguration, settingsCollector.UpdateConfiguration,
                operation => { confirmations.Add(operation); return confirmSettings; }),
            new DeviceSettingsActions(() => startupRegistered, value => startupRegistered = value,
                () => pairingDetails++, () => { disconnects++; return devicePending.Task; }, () => { repairs++; return Task.CompletedTask; },
                (action, token) =>
                {
                    if (action != "status")
                    {
                        Check(action != "enable" || token == sharingToken, "Sharing confirmation token forwarded");
                        sharingChanges++; sharingEnabled = action == "enable";
                    }
                    return Task.FromResult(new QuotaSharingStatus(sharingEnabled, true, "ready", sharingToken));
                }, () => sharingConfirmed, () => { networkChecks++; return Task.FromResult("Synthetic Tailscale status. Peer not checked."); }));
        form.Shown += async (_, _) =>
        {
            try
            {
                await Task.Delay(200);
                var sections = Children(form).OfType<ListBox>().Single();
                Check(sections.Items.Cast<string>().SequenceEqual(new[] { "Allowances", "Activity", "Tokens", "Dictation", "Agents", "Sources", "Settings" }), "Dashboard navigation order");
                Check(sections.SelectedItem?.ToString() == "Allowances", "Allowances is the landing view");
                var clock = DateTimeOffset.Parse("2026-01-01T12:00:00Z");
                Check(NativeDashboard.Freshness("2026-01-01T11:56:00Z", clock) == "Updated 4m ago", "Relative freshness");
                Check(NativeDashboard.Freshness("missing", clock) == "Updated: Unknown", "Unknown freshness");
                Check(NativeDashboard.Freshness("2026-01-02T12:00:00Z", clock).Contains("ahead"), "Future clock is not fresh");
                var persistentRefresh = Children(form).OfType<Button>().Single(button => button.AccessibleName == "Refresh sources");
                Children(form).OfType<Button>().Single(button => button.AccessibleName == "Device connection settings").PerformClick();
                Check(sections.SelectedItem?.ToString() == "Settings", "Devices opens Settings");
                Check(Children(form).OfType<ComboBox>().Single(combo => combo.AccessibleName == "Settings page").SelectedItem?.ToString() == "This device", "Devices opens connection controls");
                sections.SelectedItem = "Agents";
                Children(form).OfType<Button>().Single(button => button.Text == "Review collection settings").PerformClick();
                Check(sections.SelectedItem?.ToString() == "Settings", "Agents collection settings route");
                Check(Children(form).OfType<ComboBox>().Single(combo => combo.AccessibleName == "Settings page").SelectedItem?.ToString() == "Sources", "Agents opens collection controls after Devices");
                Check(ReferenceEquals(persistentRefresh, Children(form).OfType<Button>().Single(button => button.AccessibleName == "Refresh sources")), "Refresh survives navigation");
                sections.SelectedItem = "Activity";
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
                var savedQuota = data["quota"]!.DeepClone();
                var freshAt = DateTimeOffset.UtcNow.ToString("O");
                data["quota"]!["status"] = "ok";
                data["quota"]!["checkedAt"] = freshAt;
                data["quota"]!["windows"]![0]!["resetsAt"] = DateTimeOffset.UtcNow.AddHours(4).ToString("O");
                const string paceSummary = "20.0% of allowance/hour over 60 min. Approximately 2h 30m left at this pace (at last check). Reset in 4h 0m. Estimated allowance covers 63% of the time until reset (at last check).";
                data["quota"]!["pace"] = new JsonArray(new JsonObject { ["bucket"] = "codex", ["window"] = "primary", ["asOf"] = freshAt, ["summary"] = paceSummary, ["status"] = "projected", ["coverageFraction"] = 0.625 });
                form.Reload();
                Check(Texts(form).Contains(paceSummary), "Fresh pace rendered in allowance page");
                var coverageBar = Children(form).OfType<ProgressBar>().Single(bar => bar.AccessibleName == "Estimated time coverage until reset, at last check");
                Check(coverageBar.Value == 625 && coverageBar.Visible && coverageBar.Width > 0, "Reset coverage bar rendered at expected ratio");
                Check(Texts(form).Contains("Reset (at last check)"), "Reset endpoint labelled");
                Capture(form, output, "native-allowance-pace");
                data["quota"]!["checkedAt"] = DateTimeOffset.UtcNow.AddMinutes(-11).ToString("O");
                form.Reload();
                Check(!Texts(form).Contains(paceSummary) && Texts(form).Contains("Estimate unavailable until a fresh reading."), "Stale rendered pace withheld");
                Check(!Children(form).OfType<ProgressBar>().Any(bar => bar.AccessibleName == "Estimated time coverage until reset, at last check"), "Stale reset coverage bar withheld");
                data["quota"] = savedQuota;
                form.Reload();
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
                var localQuota = data["quota"]!.DeepClone();
                data["quota"] = null;
                data["peerQuota"] = JsonNode.Parse("""{"host":"Mac","provider":"Codex","status":"stale","checkedAt":"2026-09-12T12:00:00.000Z","receivedAt":"2026-09-12T12:05:00.000Z","windows":[{"bucket":"codex","window":"primary","remainingPercent":70}],"history":[{"checkedAt":"2026-09-12T12:00:00.000Z","windows":[{"bucket":"codex","window":"primary","remainingPercent":70}]}],"dailyUsageBuckets":[{"startDate":"2026-09-12","tokens":100}]}""");
                form.Reload();
                Check(Texts(form).Contains("Shared from Mac"), "Shared allowance owner label");
                Check(Texts(form).Any(value => value.Contains("never added to this device's totals")), "Peer totals are separate");
                Check(Children(form).OfType<QuotaGraph>().Count() == 1, "Peer graph survives missing local quota");
                Check(Texts(form).Any(value => value.Contains("Account source: stale")), "Peer stale status visible");
                Capture(form, output, "native-shared-allowances");
                data["peerQuota"] = null; form.Reload();
                Check(Children(form).OfType<QuotaGraph>().Count() == 0, "Revoked peer graph removed");
                data["quota"] = localQuota;
                sections.SelectedItem = "Dictation";
                string Cell(string table, int row, int column) => Children(form).OfType<DataGridView>().Single(grid => grid.AccessibleName == table).Rows[row].Cells[column].Value?.ToString() ?? "";
                Check(Cell("By tool and device", 2, 2) == "4", "Dictation week excludes older records");
                Check(Cell("By tool and device", 2, 3) == "20 (partial)", "Partial word coverage");
                Check(Cell("By tool and device", 2, 4) == "Unknown", "No audio coverage is unknown");
                Check(Cell("By tool and device", 3, 5) == "Tracking not yet verified", "ChatGPT coverage explicit");
                Capture(form, output, "native-dictation");
                await Select(form, "Period", "All retained");
                Check(Cell("By tool and device", 2, 2) == "14", "Dictation retained records");
                await Select(form, "Device", "Mac");
                Check(Cell("By tool and device", 0, 2) == "Unknown", "Dictation host not combined");
                await Select(form, "Device", "Windows");
                await Select(form, "Tool", "ChatGPT");
                Check(Cell("By tool and device", 0, 2) == "Unknown", "ChatGPT records not fabricated");
                Check(Texts(form).Contains("More local speech detection coming soon."), "Future local speech coverage copy");
                Check(!Children(form).OfType<ComboBox>().SelectMany(combo => combo.Items.Cast<object>()).Any(item => item.ToString() == "TypeWhisper"), "Retired source selector removed");
                Check(NativeDashboard.DictationValue([new JsonObject { ["wordRecords"] = 1 }], "words", true) == "Unknown", "Missing dictation counter");
                sections.SelectedItem = "Sources";
                Check(!Children(form).OfType<DataGridView>().Any(grid => grid.AccessibleName == "Handoff receipt"), "Sources does not duplicate Agents");
                Check(Texts(form).Any(value => value.Contains("1 saved failures")), "Saved failure summary visible when collapsed");
                Children(form).OfType<Button>().Single(button => button.AccessibleName == "View Agents").PerformClick();
                await Task.Delay(50);
                Application.DoEvents();
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
                Check(!Children(form).OfType<CheckBox>().Single(check => check.AccessibleName == "wispr").Checked, "Existing settings default Wispr off");
                Children(form).OfType<CheckBox>().Single(check => check.AccessibleName == "wispr").Checked = true;
                Children(form).OfType<CheckBox>().Single(check => check.AccessibleName == "activity").Checked = true;
                Check(settingsCollector.ReadConfiguration()["activity"]!.GetValue<bool>() == false, "Draft is not saved early");
                await Select(form, "Settings page", "This device");
                await Select(form, "Settings page", "Sources");
                form.Reload();
                Check(Children(form).OfType<CheckBox>().Single(check => check.AccessibleName == "activity").Checked, "Draft survives navigation and reload");
                Children(form).OfType<Button>().Single(button => button.Text == "Save source settings").PerformClick();
                Check(settingsCollector.ReadConfiguration()["activity"]!.GetValue<bool>(), "Source settings saved");
                Check(settingsCollector.ReadConfiguration()["wispr"]!.GetValue<bool>(), "Wispr opt-in saved");
                Check(Snapshot.Text(settingsCollector.ReadConfiguration()["futureSetting"]) == "preserved", "Unrelated settings preserved");
                Capture(form, output, "native-settings");
                Children(form).OfType<CheckBox>().Single(check => check.AccessibleName == "quota").Checked = false;
                Children(form).OfType<Button>().Single(button => button.Text == "Save source settings").PerformClick();
                Check(settingsCollector.ReadConfiguration()["quota"]!.GetValue<bool>() && confirmations.Last() == "quota-removal", "Canceled quota removal preserves setting");
                confirmSettings = true;
                Children(form).OfType<Button>().Single(button => button.Text == "Save source settings").PerformClick();
                Check(!settingsCollector.ReadConfiguration()["quota"]!.GetValue<bool>(), "Confirmed quota opt-out saved");
                Children(form).OfType<CheckBox>().Single(check => check.AccessibleName == "wispr").Checked = false;
                confirmSettings = false;
                Children(form).OfType<Button>().Single(button => button.Text == "Reload saved settings").PerformClick();
                Check(!Children(form).OfType<CheckBox>().Single(check => check.AccessibleName == "wispr").Checked && confirmations.Last() == "discard", "Canceled discard retains draft");
                confirmSettings = true;
                Children(form).OfType<Button>().Single(button => button.Text == "Reload saved settings").PerformClick();
                Check(Children(form).OfType<CheckBox>().Single(check => check.AccessibleName == "wispr").Checked, "Confirmed discard reloads saved values");
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
                Check(networkChecks == 0, "Network readiness is not read automatically");
                ClickDevice("Check Tailscale");
                await Task.Delay(50);
                Check(networkChecks == 1 && Texts(form).Contains("Synthetic Tailscale status. Peer not checked."), "Explicit readiness result displayed");
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
                ClickDevice("Check sharing status");
                await Task.Delay(50);
                ClickDevice("Change allowance sharing");
                Check(sharingChanges == 0 && !sharingEnabled, "Cancelled sharing consent does not write");
                sharingConfirmed = true;
                ClickDevice("Change allowance sharing");
                await Task.Delay(50);
                Check(sharingEnabled && sharingChanges == 1, "Explicit sharing consent applied");
                ClickDevice("Change allowance sharing");
                await Task.Delay(50);
                Check(!sharingEnabled && sharingChanges == 2, "Sharing disable applied");
                Capture(form, output, "native-device-settings");
                var sharingButton = Children(form).OfType<Button>().Single(button => button.AccessibleName == "Change allowance sharing");
                ((ScrollableControl)sharingButton.Parent!).ScrollControlIntoView(sharingButton);
                await Task.Delay(50);
                Capture(form, output, "native-sharing-settings");
                sections.SelectedItem = "Sources";
                Check(Children(form).OfType<DataGridView>().Single().Rows.Count == 7, "Source rows");
                Capture(form, output, "native-sources");
                Children(form).OfType<Button>().Single(button => button.AccessibleName == "Refresh sources").PerformClick();
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
