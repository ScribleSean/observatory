using System.Drawing.Imaging;
using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

internal static class NativeDashboardTests
{
    internal static void Run(string output)
    {
        foreach (var section in new[] { "Allowances", "Activity", "Tokens", "Dictation", "Agents", "Sources", "Settings" })
        foreach (var size in new[] { 22, 44 })
        {
            using var bitmap = new Bitmap(size + 8, size + 8);
            using var graphics = Graphics.FromImage(bitmap);
            graphics.Clear(Color.Black);
            Check(DashboardNavigationIcons.Draw(graphics, section, new RectangleF(4, 4, size, size), Color.White), "Every sidebar destination has an icon");
            var painted = 0;
            for (var y = 0; y < bitmap.Height; y++)
            for (var x = 0; x < bitmap.Width; x++)
                if (bitmap.GetPixel(x, y).R > 0)
                {
                    painted++;
                    Check(x >= 4 && y >= 4 && x < size + 4 && y < size + 4, "Sidebar icon stays within its allocated bounds");
                }
            Check(painted > 20, "Sidebar icon paints at normal and double scale");
        }
        foreach (var fraction in new[] { 0.0, 1.0 })
        {
            using var meter = new DashboardMeter(fraction, "Synthetic boundary") { Size = new Size(120, 10) };
            using var bitmap = new Bitmap(120, 10);
            meter.DrawToBitmap(bitmap, new Rectangle(Point.Empty, bitmap.Size));
            var expectedColor = fraction == 0 ? DashboardMeter.TrackColor : DashboardMeter.FillColor;
            Check(bitmap.GetPixel(60, 5).ToArgb() == expectedColor.ToArgb(), "Meter zero and full boundaries render accurately");
        }
        foreach (var invalid in new[] { double.NaN, double.PositiveInfinity, -0.1, 1.1 })
        {
            var rejected = false;
            try { using var meter = new DashboardMeter(invalid, "Invalid synthetic fraction"); }
            catch (ArgumentOutOfRangeException) { rejected = true; }
            Check(rejected, "Meter rejects invalid fractions instead of inventing a zero");
        }
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
                Check(form.Font.Name.StartsWith("Inter", StringComparison.Ordinal), "Bundled dashboard typography");
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
                Check(Children(form).OfType<Button>().Any(button => button.AccessibleName == "Pairing details for Mac"), "Devices opens connection controls");
                sections.SelectedItem = "Agents";
                Children(form).OfType<Button>().Single(button => button.Text == "Review collection settings").PerformClick();
                Check(sections.SelectedItem?.ToString() == "Settings", "Agents collection settings route");
                Check(Children(form).OfType<CheckBox>().Any(check => check.AccessibleName == "activity"), "Agents opens collection controls after Devices");
                Check(ReferenceEquals(persistentRefresh, Children(form).OfType<Button>().Single(button => button.AccessibleName == "Refresh sources")), "Refresh survives navigation");
                sections.SelectedItem = "Activity";
                Check(Children(form).OfType<DataGridView>().All(grid => grid.Parent is DashboardCard), "Data tables use shared cards");
                Check(Texts(form).Contains("30 min"), "Day total");
                await Select(form, "Period", "Week");
                Check(Texts(form).Contains("50 min"), "Calendar week total");
                await Select(form, "Period", "All retained");
                Check(Texts(form).Contains("60 min"), "Retained total");
                Check(Children(form).OfType<DashboardHistoryChart>().Single().RecordedCount == 3, "Missing dates not fabricated");
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
                var accountCard = Children(form).OfType<DashboardCard>().Single(card => card.AccessibleName == "Account usage card");
                Check(Children(accountCard).OfType<QuotaGraph>().Count() == 1, "Allowance history grouped with account reading");
                Check(Children(accountCard).OfType<DashboardMeter>().Single(bar => bar.AccessibleName == "Allowance remaining").Fraction == 0.65, "Saved remaining reading preserved");
                var savedQuota = data["quota"]!.DeepClone();
                var freshAt = DateTimeOffset.UtcNow.ToString("O");
                data["quota"]!["status"] = "ok";
                data["quota"]!["checkedAt"] = freshAt;
                data["quota"]!["windows"]![0]!["resetsAt"] = DateTimeOffset.UtcNow.AddHours(4).ToString("O");
                const string paceSummary = "20.0% of allowance/hour over 60 min. Approximately 2h 30m left at this pace (at last check). Reset in 4h 0m. Estimated allowance covers 63% of the time until reset (at last check).";
                data["quota"]!["pace"] = new JsonArray(new JsonObject { ["bucket"] = "codex", ["window"] = "primary", ["asOf"] = freshAt, ["summary"] = paceSummary, ["status"] = "projected", ["coverageFraction"] = 0.625 });
                form.Reload();
                Check(Texts(form).Contains(paceSummary), "Fresh pace rendered in allowance page");
                var coverageBar = Children(form).OfType<DashboardMeter>().Single(bar => bar.AccessibleName == "Estimated time coverage until reset, at last check");
                Check(coverageBar.Fraction == 0.625 && coverageBar.Visible && coverageBar.Width > 0, "Reset coverage bar rendered at expected ratio");
                Check(coverageBar.AccessibilityObject.Role == AccessibleRole.ProgressBar && coverageBar.AccessibilityObject.Value == "62.5%", "Meter exposes its observed fraction accessibly");
                using (var meterImage = new Bitmap(coverageBar.Width, coverageBar.Height))
                {
                    coverageBar.DrawToBitmap(meterImage, new Rectangle(Point.Empty, meterImage.Size));
                    Check(meterImage.GetPixel(coverageBar.Width / 4, coverageBar.Height / 2).ToArgb() == DashboardMeter.FillColor.ToArgb(), "Sage meter fill is painted");
                    Check(meterImage.GetPixel(coverageBar.Width * 3 / 4, coverageBar.Height / 2).ToArgb() == DashboardMeter.TrackColor.ToArgb(), "Unfilled meter track is painted");
                }
                Check(Texts(form).Contains("Reset (at last check)"), "Reset endpoint labelled");
                Capture(form, output, "native-allowance-pace");
                data["quota"]!["checkedAt"] = DateTimeOffset.UtcNow.AddMinutes(-11).ToString("O");
                form.Reload();
                Check(!Texts(form).Contains(paceSummary) && Texts(form).Contains("Estimate unavailable until a fresh reading."), "Stale rendered pace withheld");
                Check(!Children(form).OfType<DashboardMeter>().Any(bar => bar.AccessibleName == "Estimated time coverage until reset, at last check"), "Stale reset coverage bar withheld");
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
                string Cell(string table, int row, int column)
                {
                    if (table == "By tool and device")
                    {
                        var card = Children(form).OfType<DashboardValueCard>().ElementAt(row);
                        var field = new[] { "", "", "Records", "Words", "Recorded audio minutes", "Status", "Last checked" }[column];
                        return Children(card).OfType<Label>().Single(label => label.AccessibleName == field + " value").Text;
                    }
                    return Children(form).OfType<DataGridView>().Single(grid => grid.AccessibleName == table).Rows[row].Cells[column].Value?.ToString() ?? "";
                }
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
                string AgentValue(string name, string field) => Children(Children(form).OfType<DashboardValueCard>().First(card => card.AccessibleName == name))
                    .OfType<Label>().Single(label => label.AccessibleName == field + " value").Text;
                Check(AgentValue("Handoff receipt", "Reported tokens") == "Unknown", "Failed receipt tokens withheld");
                Check(!Children(form).OfType<ComboBox>().Any(combo => combo.AccessibleName == "Record type"), "All agent record categories share one page");
                Check(Texts(form).Contains("Failure: Synthetic failure"), "Receipt failure detail");
                Capture(form, output, "native-agents");
                var receiptDetails = Children(form).OfType<DashboardValueCard>().Single(card => card.AccessibleName == "Handoff receipt");
                var disclosure = Children(form).OfType<Button>().Single(button => button.AccessibleName == "Handoff receipt details");
                var collapsedHeight = receiptDetails.Parent!.Height;
                Check(!receiptDetails.Visible && disclosure.AccessibleDescription!.StartsWith("Collapsed"), "Agent details start collapsed");
                disclosure.PerformClick();
                Check(receiptDetails.Visible && receiptDetails.Parent.Height > collapsedHeight && disclosure.AccessibleDescription!.StartsWith("Expanded"), "Agent details expand accessibly");
                Check(AgentValue("Handoff receipt", "Reported tokens") == "Unknown", "Expanded failed receipt remains Unknown");
                Capture(form, output, "native-agent-expanded");
                disclosure.PerformClick();
                Check(!receiptDetails.Visible && receiptDetails.Parent.Height == collapsedHeight, "Agent details collapse without leaving empty space");
                data["agents"]![0]!["status"] = "ok";
                form.Reload();
                Check(AgentValue("Handoff receipt", "Reported tokens") == "99", "Successful reported counter");
                Check(AgentValue("Local benchmark", "Input tokens") == "12", "Local benchmark input");
                Check(AgentValue("Local benchmark", "Time to first token seconds") == "Unknown", "Missing local timing");
                Check(AgentValue("Tool requests", "Tool") == "functions.exec", "Exact tool name");
                Check(AgentValue("Tool requests", "Namespace") == "functions", "Exact namespace");
                Capture(form, output, "native-tools");
                ((JsonArray)data["settings"]!).Add(new JsonObject { ["host"] = "Mac", ["status"] = "not-connected" });
                form.Reload();
                Check(Texts(form).Contains("Tool records unavailable."), "Unavailable tool host");
                sections.SelectedItem = "Settings";
                Check(!Children(form).OfType<CheckBox>().Single(check => check.AccessibleName == "activity").Checked, "Settings loaded existing disabled source");
                Check(!Children(form).OfType<CheckBox>().Single(check => check.AccessibleName == "wispr").Checked, "Existing settings default Wispr off");
                Children(form).OfType<CheckBox>().Single(check => check.AccessibleName == "wispr").Checked = true;
                Children(form).OfType<CheckBox>().Single(check => check.AccessibleName == "activity").Checked = true;
                Check(settingsCollector.ReadConfiguration()["activity"]!.GetValue<bool>() == false, "Draft is not saved early");
                sections.SelectedItem = "Sources";
                sections.SelectedItem = "Settings";
                form.Reload();
                Check(Children(form).OfType<CheckBox>().Single(check => check.AccessibleName == "activity").Checked, "Draft survives navigation and reload");
                Children(form).OfType<Button>().Single(button => button.Text == "Save source settings").PerformClick();
                Check(settingsCollector.ReadConfiguration()["activity"]!.GetValue<bool>(), "Source settings saved");
                Check(settingsCollector.ReadConfiguration()["wispr"]!.GetValue<bool>(), "Wispr opt-in saved");
                Check(Snapshot.Text(settingsCollector.ReadConfiguration()["futureSetting"]) == "preserved", "Unrelated settings preserved");
                Capture(form, output, "native-settings");
                var appearance = Children(form).OfType<Button>().Single(button => button.AccessibleName == "Toggle appearance");
                var sourceSwitch = Children(form).OfType<CheckBox>().Single(check => check.AccessibleName == "wispr");
                appearance.PerformClick();
                Check(form.BackColor == DashboardPalette.Background(true) && form.ForeColor == DashboardPalette.Text(true), "Light palette applied to dashboard");
                Check(ReferenceEquals(sourceSwitch, Children(form).OfType<CheckBox>().Single(check => check.AccessibleName == "wispr")) && sourceSwitch.Checked,
                    "Appearance changes preserve existing settings controls and values");
                using (var switchImage = new Bitmap(sourceSwitch.Width, sourceSwitch.Height))
                {
                    sourceSwitch.DrawToBitmap(switchImage, new Rectangle(Point.Empty, switchImage.Size));
                    Check(switchImage.GetPixel(4, 4).ToArgb() == DashboardPalette.Surface(true).ToArgb(), "Light switches paint a light surface behind their labels");
                }
                foreach (var destination in sections.Items.Cast<string>().ToArray())
                {
                    sections.SelectedItem = destination;
                    if (destination is "Activity" or "Tokens") await Select(form, "Device", "Windows");
                    Check(form.BackColor == DashboardPalette.Background(true), "Light appearance survives navigation");
                    Capture(form, output, "native-light-" + destination.ToLowerInvariant());
                }
                sections.SelectedItem = "Settings";
                appearance.PerformClick();
                Check(form.BackColor == DashboardPalette.Background(false), "Dark appearance restored");
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
                Check(!Children(form).OfType<ComboBox>().Any(choice => choice.AccessibleName == "Settings page"), "Settings is one continuous page");
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
                Check(Children(form).OfType<DashboardValueCard>().Count() == 7, "Source health cards");
                Check(!Texts(form).Any(value => value.Contains("TypeWhisper", StringComparison.OrdinalIgnoreCase)), "Retired voice source is absent from Sources");
                Check(Texts(form).Any(value => value.Contains("Wispr Flow")), "Supported voice source remains visible");
                Check(Texts(form).Any(value => value.StartsWith("Newest receipt: Updated ")), "Newest receipt uses relative freshness");
                Capture(form, output, "native-sources");
                Children(form).OfType<Button>().Single(button => button.AccessibleName == "Refresh sources").PerformClick();
                Check(refreshes == 1, "Refresh callback");
                for (var i = 0; i < 20; i++) form.Reload();
                var savedAppearance = false;
                var appearanceWrites = 0;
                var appearanceStore = new DashboardAppearancePreferences(() => savedAppearance, value => { savedAppearance = value; appearanceWrites++; });
                using (var first = new NativeDashboard(() => data, () => Task.CompletedTask, appearancePreferences: appearanceStore))
                {
                    first.Show();
                    Check(appearanceWrites == 0, "Opening a dashboard does not rewrite appearance preferences");
                    Children(first).OfType<Button>().Single(button => button.AccessibleName == "Toggle appearance").PerformClick();
                    Check(savedAppearance && appearanceWrites == 1, "Appearance selection is persisted immediately");
                    first.Close();
                }
                using (var reopened = new NativeDashboard(() => data, () => Task.CompletedTask, appearancePreferences: appearanceStore))
                {
                    reopened.Show();
                    Check(reopened.BackColor == DashboardPalette.Background(true), "Reopened dashboard restores light appearance");
                    var appearanceButton = Children(reopened).OfType<Button>().Single(button => button.AccessibleName == "Toggle appearance");
                    Check(appearanceButton.Text == "Dark mode", "Restored appearance action names the destination theme");
                    appearanceButton.PerformClick();
                    Check(!savedAppearance && appearanceWrites == 2, "Dark appearance can also be persisted");
                    reopened.Close();
                }
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
        var chips = Children(parent).OfType<DashboardFilters>().SingleOrDefault(choice => choice.AccessibleName == name);
        if (chips is not null) Children(chips).OfType<Button>().Single(button => button.Text == value).PerformClick();
        else Children(parent).OfType<ComboBox>().Single(choice => choice.AccessibleName == name).SelectedItem = value;
        await Task.Delay(100);
    }
    private static void Check(bool value, string name) { if (!value) throw new InvalidOperationException(name); }
    private static void Capture(Form form, string output, string name)
    {
        // Render the actual dashboard controls without hosted-desktop window limits.
        // Mac captures are also content-only. Normal app window behavior is unchanged.
        var viewport = new Size(1280, 800);
        using var surface = new Panel { Size = viewport, Font = form.Font, BackColor = form.BackColor, ForeColor = form.ForeColor };
        var controls = form.Controls.Cast<Control>().ToArray();
        try
        {
            surface.Controls.AddRange(controls);
            surface.CreateControl();
            surface.PerformLayout();
            using var bitmap = new Bitmap(viewport.Width, viewport.Height);
            surface.DrawToBitmap(bitmap, new Rectangle(Point.Empty, viewport));
            bitmap.Save(Path.Combine(output, name + ".png"), ImageFormat.Png);
            using var saved = Image.FromFile(Path.Combine(output, name + ".png"));
            Check(saved.Size == viewport, "Saved screenshot is exactly 1280 by 800");
        }
        finally
        {
            form.Controls.AddRange(controls);
            form.PerformLayout();
        }
    }
}
