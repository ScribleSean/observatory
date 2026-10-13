using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

// Hidden real-view regressions. No collector, preferences or device actions are supplied.
internal static class NativeSourceHealthTests
{
    internal static int Scope()
    {
        var cases = new (string name, (string? host, string? status)[] rows, string expected)[] {
            ("mixed-native-and-other", [("Windows", "ok"), ("Mac", "unavailable"), ("Other", "ok")], "1/2 native device records read"),
            ("native-only", [("Windows", "ok"), ("Mac", "ok")], "2/2 native device records read"),
            ("other-only", [("Other", "ok")], "Unknown"),
            ("empty", [], "Unknown"),
            ("disabled-native-with-other", [("Windows", "not-connected"), ("Mac", "not-connected"), ("Other", "ok")], "Unknown"),
            ("one-disabled-native", [("Windows", "not-connected"), ("Mac", "ok")], "1/1 native device records read"),
            ("unavailable-native", [("Windows", "unavailable"), ("Mac", "unavailable")], "0/2 native device records read"),
            ("unexpected-hosts", [("Windows", "ok"), ("Linux", "ok"), ("windows", "ok"), ("mac", "ok"), (" Mac", "ok"), (null, "ok")], "1/1 native device records read"),
            ("unexpected-hosts-only", [("WSL", "ok"), ("Combined", "ok"), ("Windows ", "ok"), ("", "ok"), (null, "ok")], "Unknown"),
            ("unexpected-status", [("Windows", "future-status"), ("Mac", "OK")], "0/2 native device records read"),
            ("missing-status", [("Windows", null), ("Mac", "")], "0/2 native device records read"),
            ("stale-and-partial", [("Windows", "stale"), ("Mac", "partial")], "0/2 native device records read"),
            ("disabled-literal-status", [("Windows", "disabled"), ("Mac", "ok")], "1/2 native device records read")
        };
        foreach (var (name, rows, expected) in cases)
        {
            var data = new JsonObject { ["tokens"] = new JsonArray(rows.Select(row => (JsonNode)new JsonObject {
                ["host"] = row.host, ["status"] = row.status, ["source"] = "Codex",
                ["checkedAt"] = "2026-08-01T12:00:00Z", ["days"] = new JsonArray(new JsonObject {
                    ["date"] = "2026-08-01", ["totalTokens"] = 42 }) }).ToArray()) };
            var before = data.ToJsonString();
            using var form = Open(data);
            var actual = Value(form, "Provider token sources", "Codex").Text;
            Equal(expected, actual, name);
            Equal(false, Children(form).OfType<Label>().Any(label => label.Text.Contains("Other", StringComparison.Ordinal)), name + " lists native devices only");
            Equal(before, data.ToJsonString(), name + " preserves all rows and timestamps");
            Equal(false, form.Visible, name + " stays hidden");
        }
        using (var form = Open(null)) Equal("Unknown", Value(form, "Provider token sources", "Codex").Text, "missing-snapshot");
        var other = JsonNode.Parse("""
            {"activity":[{"host":"Other","source":"ActivityWatch","status":"ok","checkedAt":"2026-08-01T11:00:00Z"}],
             "tokens":[{"host":"Other","source":"Codex","status":"ok","checkedAt":"2026-08-01T12:00:00Z","days":[{"date":"2026-08-01","totalTokens":42}]}],
             "settings":[{"host":"Other","source":"Codex tools","status":"ok","checkedAt":"2026-08-01T13:00:00Z"}],
             "dictation":[{"host":"Other","source":"Wispr Flow","status":"stale","checkedAt":"2026-08-01T14:00:00Z"}],
             "combinedTokens":{"status":"ok","days":[{"date":"2026-08-01","totalTokens":999}]}}
            """)!.AsObject();
        var otherBefore = other.ToJsonString();
        using (var form = Open(other))
        {
            Equal(0, Children(form).OfType<Label>().Count(label => label.Text.Contains("Other", StringComparison.Ordinal)), "records from another device are not listed");
            foreach (var title in new[] { "Activity", "Tokens", "Tool activity", "Dictation" })
                Equal("No source records", Value(form, title, "Status").Text, title + " shows no native source records");
            Equal(0, NativeHistory.Days(other, "tokens", "All").Length, "unverified aggregate remains withheld");
            Equal(otherBefore, other.ToJsonString(), "saved rows timestamps and totals unchanged");
        }
        Console.WriteLine($"source-health-scope: passed ({cases.Length + 2} cases)");
        return cases.Length + 2;
    }

    internal static int Receipts()
    {
        var cases = new (int receipts, int failures, string expected)[] {
            (1, 1, "1 handoff receipt · 1 saved failure. Not a live agent monitor."),
            (0, 0, "0 handoff receipts · 0 saved failures. Not a live agent monitor."),
            (1, 0, "1 handoff receipt · 0 saved failures. Not a live agent monitor."),
            (3, 0, "3 handoff receipts · 0 saved failures. Not a live agent monitor."),
            (3, 1, "3 handoff receipts · 1 saved failure. Not a live agent monitor."),
            (3, 2, "3 handoff receipts · 2 saved failures. Not a live agent monitor."),
            (3, 3, "3 handoff receipts · 3 saved failures. Not a live agent monitor.")
        };
        foreach (var (receipts, failures, expected) in cases)
        {
            var data = new JsonObject { ["agents"] = new JsonArray(Enumerable.Range(0, receipts).Select(index => (JsonNode)new JsonObject {
                ["status"] = index < failures ? "failed" : "ok", ["total"] = 99,
                ["recordedAt"] = "2026-08-01T12:00:00Z" }).ToArray()) };
            var before = data.ToJsonString();
            using var form = Open(data);
            var summary = Children(form).OfType<Label>().Single(label => label.Text.EndsWith("Not a live agent monitor.", StringComparison.Ordinal));
            Equal(expected, summary.Text, $"receipt-count-{receipts}-failure-count-{failures}");
            Equal(expected, summary.AccessibilityObject.Name, "receipt caption accessible name");
            var newest = Children(form).OfType<Label>().Single(label => label.Text.StartsWith("Newest receipt:", StringComparison.Ordinal));
            Equal(receipts == 0 ? "Unknown" : "2026-08-01T12:00:00.0000000+00:00", newest.AccessibleDescription, "receipt observation timestamp preserved");
            Equal(before, data.ToJsonString(), "receipt statuses counters and timestamps unchanged");
            Equal(false, form.Visible, "receipt fixture stays hidden");
        }
        Console.WriteLine($"source-health-receipts: passed ({cases.Length} cases)");
        return cases.Length;
    }

    private static NativeDashboard Open(JsonObject? data)
    {
        var form = new NativeDashboard(() => data, () => throw new InvalidOperationException("Unexpected collection"),
            readArchive: (_, _) => throw new InvalidOperationException("Unexpected private archive read"), rememberLayout: false,
            appearancePreferences: new DashboardAppearancePreferences(() => false, _ => throw new InvalidOperationException("Unexpected preference write")));
        _ = form.Handle;
        Children(form).OfType<ListBox>().Single().SelectedItem = "Source health";
        form.PerformLayout();
        Equal(false, form.Visible, "real Source health form is hidden");
        return form;
    }

    private static Label Value(Control form, string title, string name) => Children(Children(form).OfType<DashboardValueCard>().Single(card => card.Title == title))
        .OfType<Label>().Single(label => label.AccessibleName == name + " value");

    private static IEnumerable<Control> Children(Control root) => root.Controls.Cast<Control>()
        .SelectMany(child => new[] { child }.Concat(Children(child)));

    private static void Equal<T>(T expected, T actual, string name)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
            throw new InvalidOperationException($"{name}: expected=[{expected}], actual=[{actual}]");
        Console.WriteLine("PASS: " + name);
    }
}
