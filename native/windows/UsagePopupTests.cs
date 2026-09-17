using System.Drawing.Imaging;
using System.Security.Cryptography;
using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

internal static class UsagePopupTests
{
    // Exercise the production form with in-memory fixtures and inert callbacks.
    // Capture only this form and its chart controls, never the desktop.
    internal static void Run(string output)
    {
        var data = Fixture();
        var refreshed = 0;
        var opened = 0;
        TaskCompletionSource? pending = null;
        using var popup = new UsagePopup(() => data, () => { refreshed++; return pending?.Task ?? Task.CompletedTask; }, () => opened++);
        popup.Shown += async (_, _) =>
        {
            try
            {
                // Native progress bars animate toward their assigned values.
                await Task.Delay(1000);
                Check(popup.Visible && Screen.AllScreens.Any(screen => screen.WorkingArea.Contains(popup.Bounds)), "Popup is not fully on screen.");
                var headingFont = Descendants(popup).OfType<Label>().Single(label => label.Text == "Observatory").Font;
                for (var repeat = 0; repeat < 20; repeat++) popup.Reload();
                Check(ReferenceEquals(headingFont, Descendants(popup).OfType<Label>().Single(label => label.Text == "Observatory").Font), "Refresh should reuse its font resources.");
                var controls = Descendants(popup).ToArray();
                Check(controls.OfType<AllowanceMeter>().Count() == 2, "Expected two compact allowance bars.");
                Check(controls.OfType<AllowanceMeter>().Select(bar => bar.Value).SequenceEqual(new[] { 568, 584 }), "Allowance bar values differ from fixture.");
                Check(controls.OfType<AllowanceMeter>().All(bar => bar.AccessibilityObject.Value?.Contains("remaining") == true), "Allowance values must be accessible.");
                Check(popup.FormBorderStyle == FormBorderStyle.None, "Tray panel should not use a utility-window title bar.");
                Check(!controls.OfType<ComboBox>().Any(), "Device navigation should not use a stock dropdown.");
                Check(controls.OfType<Button>().All(button => button.FlatAppearance.BorderSize == 0), "Tray actions should not have outlined button frames.");
                Check(controls.OfType<Button>().All(button => button is DashboardButton), "Tray actions use shared pill styling.");
                Check(!controls.OfType<Label>().Any(label => label.Text.Contains("bengalfox")), "Retired allowance is visible.");
                Check(!controls.OfType<FlowLayoutPanel>().Single().AutoScroll, "Popup must not scroll.");
                Check(controls.All(control => control.Parent!.ClientRectangle.Contains(control.Bounds)), "A popup control is clipped.");
                Capture(popup, output, "popup-latest");
                var savedRemaining = data["quota"]!["windows"]![0]!["remainingPercent"]!.DeepClone();
                data["quota"]!["windows"]![0]!["remainingPercent"] = null;
                popup.Reload();
                Check(Descendants(popup).OfType<AllowanceMeter>().Count() == 1, "Unknown allowance must not paint a zero meter.");
                data["quota"]!["windows"]![0]!["remainingPercent"] = savedRemaining;
                popup.Reload();
                // Detailed charts are tested independently, not embedded in the compact tray popup.
                var quota = (JsonObject)data["quota"]!;
                var windows = ((JsonArray)quota["windows"]!).OfType<JsonObject>().Take(3).ToArray();
                using var graph = new QuotaGraph(quota, windows[0]) { Width = 360, Height = 145 };
                var hashes = new HashSet<string>();
                for (var index = 0; index < windows.Length; index++)
                {
                    graph.SelectWindow(windows[index]);
                    await Task.Delay(50);
                    hashes.Add(Capture(graph, output, "quota-window-" + index));
                    Check(graph.AccessibleDescription?.Contains("Allowance used starts at") == true, "History has no accessible value summary.");
                }
                Check(hashes.Count == 3, "Selecting a window did not change the rendered history.");
                using var daily = new DailyTokenGraph(quota) { Width = 360, Height = 125 };
                Capture(daily, output, "daily-tokens");
                Check(daily.AccessibleDescription?.Contains("tokens") == true, "Daily totals are not described accessibly.");

                data["quota"]!["status"] = "stale";
                popup.Reload();
                await Task.Delay(1000);
                Check(Descendants(popup).OfType<Label>().Any(label => label.Text.StartsWith("Saved reading")), "Saved reading is not identified.");
                Capture(popup, output, "popup-stale");

                data["quota"] = new JsonObject { ["status"] = "needs-auth", ["windows"] = new JsonArray() };
                popup.Reload();
                Check(!Descendants(popup).OfType<AllowanceMeter>().Any() && !Descendants(popup).OfType<QuotaGraph>().Any(), "Missing limits rendered as a value.");
                Check(Descendants(popup).OfType<Label>().Any(label => label.Text.Contains("Sign in through Codex")), "Missing sign-in guidance.");
                Capture(popup, output, "popup-unavailable");

                data["quota"] = new JsonObject { ["status"] = "not-connected" };
                popup.Reload();
                Capture(popup, output, "popup-limits-off");

                var buttons = Descendants(popup).OfType<Button>().ToArray();
                var layout = Descendants(popup).OfType<FlowLayoutPanel>().Single();
                var refresh = buttons.Single(button => button.Text == "Refresh sources");
                Check(layout.ClientRectangle.Contains(refresh.Bounds), "Refresh is outside the popup.");
                refresh.PerformClick();
                Check(refreshed == 1, "Refresh did not invoke its callback exactly once.");
                pending = new TaskCompletionSource();
                var failedRefresh = popup.RefreshAsync();
                Descendants(popup).OfType<Button>().Single(button => button.Text == "All").PerformClick();
                Check(Descendants(popup).OfType<Label>().Any(label => label.Text.Contains("Ubuntu contributes tokens only")), "Combined coverage is not explained.");
                Check(!Descendants(popup).OfType<Button>().Single(button => button.Text == "Refreshing sources…").Enabled, "Host changes reenabled an active refresh.");
                await popup.RefreshAsync();
                Check(refreshed == 2, "An overlapping refresh invoked the callback.");
                pending.SetException(new InvalidOperationException("PRIVATE failure details"));
                await failedRefresh;
                Check(Descendants(popup).OfType<Label>().Any(label => label.Text.StartsWith("Refresh failed.")), "Refresh failure has no recovery guidance.");
                Check(!Descendants(popup).Any(control => control.Text.Contains("PRIVATE")), "Refresh exposed internal failure details.");
                Check(Descendants(popup).OfType<Button>().Single(button => button.Text == "Refresh sources").Enabled, "Refresh did not recover after failure.");
                Check(Screen.AllScreens.Any(screen => screen.WorkingArea.Contains(popup.Bounds)), "Failure guidance moved the popup off screen.");
                Capture(popup, output, "popup-refresh-failed");
                pending = null;
                await popup.RefreshAsync();
                Check(refreshed == 3 && !Descendants(popup).OfType<Label>().Any(label => label.Text.StartsWith("Refresh failed.")), "Successful retry retained the failure.");
                var open = Descendants(popup).OfType<Button>().Single(button => button.Text == "Open Observatory");
                Check(layout.ClientRectangle.Contains(open.Bounds), "Open is outside the popup.");
                open.PerformClick();
                Check(opened == 1 && !popup.Visible, "Open did not close the popup and invoke navigation exactly once.");
                File.WriteAllText(Path.Combine(output, "result.txt"), "usage-popup: passed");
            }
            catch (Exception error)
            {
                File.WriteAllText(Path.Combine(output, "result.txt"), "usage-popup: failed: " + error.Message);
                Environment.ExitCode = 1;
            }
            finally { popup.Close(); }
        };
        popup.ShowNearTray();
        Application.Run(popup);
    }

    private static void Check(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }

    private static IEnumerable<Control> Descendants(Control parent)
    {
        foreach (Control child in parent.Controls)
        {
            yield return child;
            foreach (var descendant in Descendants(child)) yield return descendant;
        }
    }

    private static string Capture(Control control, string output, string name)
    {
        control.PerformLayout();
        using var image = new Bitmap(control.Width, control.Height);
        control.DrawToBitmap(image, new Rectangle(Point.Empty, image.Size));
        using var bytes = new MemoryStream();
        image.Save(bytes, ImageFormat.Png);
        var payload = bytes.ToArray();
        File.WriteAllBytes(Path.Combine(output, name + ".png"), payload);
        return Convert.ToHexString(SHA256.HashData(payload));
    }

    private static JsonObject Fixture()
    {
        var now = DateTimeOffset.UtcNow;
        JsonArray Windows(int sample) => new(
            new JsonObject { ["bucket"] = "codex", ["window"] = "primary", ["durationMinutes"] = 300,
                ["remainingPercent"] = sample < 144 ? 100 - sample * 0.4 : 100 - (sample - 144) * 0.3,
                ["resetsAt"] = (sample < 144 ? now.AddHours(-12) : now.AddHours(1)).ToString("O") },
            new JsonObject { ["bucket"] = "codex", ["window"] = "secondary", ["durationMinutes"] = 10080,
                ["remainingPercent"] = 70 - sample * 0.04, ["resetsAt"] = now.AddDays(3).ToString("O") },
            new JsonObject { ["bucket"] = "example", ["window"] = "primary", ["durationMinutes"] = 300,
                ["remainingPercent"] = 20 - sample * 0.02, ["resetsAt"] = now.AddHours(2).ToString("O") },
            new JsonObject { ["bucket"] = "codex_bengalfox", ["window"] = "primary", ["durationMinutes"] = 300,
                ["remainingPercent"] = 100 });
        var history = new JsonArray();
        for (var index = 0; index <= 288; index++)
            if (index <= 50 || index >= 56)
                history.Add(new JsonObject { ["checkedAt"] = now.AddMinutes((index - 288) * 5).ToString("O"), ["windows"] = Windows(index) });
        var daily = new JsonArray();
        for (var index = 0; index < 14; index++)
            daily.Add(new JsonObject { ["startDate"] = now.AddDays(index - 13).ToString("yyyy-MM-dd"), ["tokens"] = 120000 + index * 17000 });
        return new JsonObject { ["schema"] = 2, ["collectedAt"] = now.ToString("O"),
            ["quota"] = new JsonObject { ["status"] = "ok", ["checkedAt"] = now.ToString("O"), ["windows"] = Windows(288),
                ["history"] = history, ["dailyUsageBuckets"] = daily },
            ["activity"] = new JsonArray(new JsonObject { ["host"] = "Windows", ["status"] = "ok", ["days"] = new JsonArray(new JsonObject { ["date"] = "2026-09-12", ["seconds"] = 2160 }) }),
            ["tokens"] = new JsonArray(new JsonObject { ["host"] = "Windows", ["status"] = "ok", ["days"] = new JsonArray(new JsonObject { ["date"] = "2026-09-12", ["totalTokens"] = 18000 }) }) };
    }
}
