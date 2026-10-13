using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

internal static class NativeHistoryRetirementTests
{
    internal const string MixedSnapshot = """
        {"schema":2,"collectedAt":"2026-09-12T12:00:00Z","tokens":[
          {"host":"Mac","status":"ok","days":[{"date":"2026-09-12","totalTokens":10}]},
          {"host":"Windows","status":"ok","days":[{"date":"2026-09-12","totalTokens":20}]},
          {"host":"Other","status":"ok","days":[{"date":"2026-09-12","totalTokens":30}]}],
         "combinedTokens":{"host":"All","status":"ok","verification":{"status":"verified"},
          "days":[{"date":"2026-09-12","totalTokens":60}]}}
        """;

    internal static void AggregateScope()
    {
        var mixed = JsonNode.Parse(MixedSnapshot)!.AsObject();
        var before = mixed.ToJsonString();
        Check(Snapshot.Latest(mixed, "tokens", "All") is null,
            "A verified aggregate that includes another device leaked into native All.");
        Check(NativeHistory.Days(mixed, "tokens", "All").Length == 0,
            "Old mixed-scope aggregate is still visible in native All history.");
        foreach (var (host, tokens) in new[] { ("Mac", 10), ("Windows", 20) })
        {
            Check(Snapshot.Number(Snapshot.Latest(mixed, "tokens", host)?["totalTokens"]) == tokens,
                "Per-device latest records were lost: " + host);
            Check(NativeHistory.Sum(NativeHistory.Days(mixed, "tokens", host), "totalTokens") == tokens,
                "Per-device history was lost: " + host);
        }
        Check(mixed.ToJsonString() == before, "Scope checking mutated the saved mixed-scope snapshot.");

        var native = mixed.DeepClone().AsObject();
        native["tokens"]!.AsArray().RemoveAt(2);
        native["combinedTokens"]!["days"]![0]!["totalTokens"] = 30;
        Check(Snapshot.Number(Snapshot.Latest(native, "tokens", "All")?["totalTokens"]) == 30 &&
            NativeHistory.Sum(NativeHistory.Days(native, "tokens", "All"), "totalTokens") == 30,
            "Verified native-only aggregates were withheld.");
        native["combinedTokens"]!["verification"]!["status"] = "overlap";
        Check(Snapshot.Latest(native, "tokens", "All") is null && NativeHistory.Days(native, "tokens", "All").Length == 0,
            "Native-only sources bypassed the collector's overlap verification.");
        native.Remove("combinedTokens");
        Check(Snapshot.Latest(native, "tokens", "All") is null && NativeHistory.Days(native, "tokens", "All").Length == 0,
            "A replacement native total was invented by adding device records.");
        Console.WriteLine("Native history aggregate scope and unchanged per-device records passed.");
    }

    internal static void AggregateProvenance()
    {
        MalformedAggregateProvenance();
        var unknownScope = JsonNode.Parse(MixedSnapshot)!.AsObject();
        unknownScope.Remove("tokens");
        Check(Snapshot.Latest(unknownScope, "tokens", "All") is null && NativeHistory.Days(unknownScope, "tokens", "All").Length == 0,
            "Aggregate-only verification was mistaken for proof of native device scope.");
        var activity = JsonNode.Parse("""
            {"activity":[{"host":"Other","status":"ok","days":[{"date":"2026-09-12","seconds":42}]}],
             "combined":{"status":"ok","days":[{"date":"2026-09-12","seconds":42}]},
             "activityHistory":[{"host":"Combined","status":"ok","days":[{"date":"2026-09-12","seconds":42}]}]}
            """)!.AsObject();
        var before = activity.ToJsonString();
        Check(Snapshot.Latest(activity, "activity", "All") is null && NativeHistory.Days(activity, "activity", "All").Length == 0,
            "Activity counters from another device leaked into native All or Combined history.");
        Check(activity.ToJsonString() == before, "Scope checking modified saved activity evidence.");
    }

    private static JsonObject NativeScopeSnapshot() => JsonNode.Parse("""
        {"schema":2,"collectedAt":"2026-09-12T12:00:00Z",
         "tokens":[{"host":"Mac","status":"ok","days":[{"date":"2026-09-12","totalTokens":10}]},
                   {"host":"Windows","status":"ok","days":[{"date":"2026-09-12","totalTokens":20}]}],
         "settings":[{"host":"Mac","status":"ok"},{"host":"Windows","status":"ok"}],
         "combinedTokens":{"status":"ok","verification":{"status":"verified"},
                           "days":[{"date":"2026-09-12","totalTokens":30}]},
         "activity":[{"host":"Mac","status":"ok","days":[{"date":"2026-09-12","seconds":600}]},
                     {"host":"Windows","status":"ok","days":[{"date":"2026-09-12","seconds":1200}]}],
         "combined":{"status":"ok","days":[{"date":"2026-09-12","seconds":1800}]},
         "activityHistory":[{"host":"Mac","status":"ok","days":[{"date":"2026-09-01","seconds":3000}]},
                            {"host":"Windows","status":"ok","days":[{"date":"2026-09-01","seconds":6000}]},
                            {"host":"Combined","status":"ok","days":[{"date":"2026-09-01","seconds":9000}]}]}
        """)!.AsObject();

    private static void MalformedAggregateProvenance()
    {
        var failures = new List<string>();
        var count = 0;
        void Verify(string name, JsonObject data, string kind, bool allowed, double? history = null)
        {
            count++;
            var before = data.ToJsonString();
            var imported = JsonNode.Parse(before)!.AsObject();
            var metric = kind == "tokens" ? "totalTokens" : "seconds";
            try
            {
                Check(Snapshot.HasNativeAggregateScope(imported, kind) == allowed, "Incorrect native scope decision.");
                var latest = Snapshot.Latest(imported, kind, "All");
                var days = NativeHistory.Days(imported, kind, "All");
                if (allowed)
                {
                    Check(Snapshot.Number(latest?[metric]) == (kind == "tokens" ? 30 : 1800), "Verified native latest total was changed.");
                    Check(Snapshot.Number(days.LastOrDefault()?[metric]) == (history ?? (kind == "tokens" ? 30 : 9000)),
                        "Verified native archive total was changed.");
                }
                else Check(latest is null && days.Length == 0, "Malformed provenance leaked into native All.");
                // The other category remains readable, including older per-device archive records.
                var other = kind == "tokens" ? "activity" : "tokens";
                var otherMetric = kind == "tokens" ? "seconds" : "totalTokens";
                Check(Snapshot.Number(NativeHistory.Days(imported, other, "Mac").LastOrDefault()?[otherMetric]) ==
                    (kind == "tokens" ? 3000 : 10), "Unrelated per-device history was lost.");
                Check(imported.ToJsonString() == before, "Scope validation rewrote imported evidence.");
            }
            catch (Exception error) { failures.Add(name + ": " + error.Message); }
        }

        foreach (var key in new[] { "tokens", "settings", "activity", "activityHistory" })
        {
            var kind = key is "tokens" or "settings" ? "tokens" : "activity";
            Verify(key + "/native", NativeScopeSnapshot(), kind, true);
            var absent = NativeScopeSnapshot(); absent.Remove(key);
            Verify(key + "/absent", absent, kind, key != "tokens", key == "activityHistory" ? 1800 : null);
            var empty = NativeScopeSnapshot(); empty[key] = new JsonArray();
            Verify(key + "/empty", empty, kind, key != "tokens", key == "activityHistory" ? 1800 : null);
            foreach (var shape in new[] { "null", "{}", "\"invalid\"", "7", "true", """{"host":"Other","status":"ok"}""" })
            {
                var malformed = NativeScopeSnapshot(); malformed[key] = JsonNode.Parse(shape);
                Verify(key + "/shape/" + shape, malformed, kind, false);
            }
            foreach (var member in new[] { "null", "\"invalid\"", "7", "true", "[]" })
            {
                var mixed = NativeScopeSnapshot(); mixed[key]!.AsArray().Add(JsonNode.Parse(member));
                Verify(key + "/mixed/" + member, mixed, kind, false);
                var retired = NativeScopeSnapshot();
                retired[key] = new JsonArray(new JsonObject { ["host"] = "Other", ["status"] = "ok" }, JsonNode.Parse(member));
                retired["combinedTokens"]!["days"]![0]!["totalTokens"] = 60;
                Verify(key + "/retired-mixed/" + member, retired, kind, false);
            }
            foreach (var explicitEmpty in new[] { false, true })
            {
                var placeholder = new JsonObject { ["host"] = "Other", ["status"] = "not-connected" };
                if (explicitEmpty) foreach (var field in new[] { "days", "profiles", "tools" }) placeholder[field] = new JsonArray();
                var data = NativeScopeSnapshot(); data[key]!.AsArray().Add(placeholder);
                Verify(key + "/empty-placeholder/" + explicitEmpty, data, kind, true);
            }
            foreach (var (field, evidence) in new[] {
                ("days", """[{"date":"2026-09-01","totalTokens":30,"seconds":30}]"""),
                ("profiles", """[{"model":"fixture","totalTokens":30}]"""),
                ("tools", """[{"tool":"Codex","totalTokens":30}]""") })
            {
                foreach (var value in new[] { evidence, "null", "{}", "\"invalid\"", "7", "true" })
                {
                    var data = NativeScopeSnapshot();
                    data[key]!.AsArray().Add(new JsonObject { ["host"] = "Other", ["status"] = "not-connected", [field] = JsonNode.Parse(value) });
                    Verify(key + "/placeholder/" + field + "/" + value, data, kind, false);
                }
            }
        }
        Console.WriteLine($"Native scope provenance fixtures: {count}, failures: {failures.Count}.");
        Check(failures.Count == 0, string.Join(Environment.NewLine, failures));
    }

    internal static void PastRecordsAndChoices()
    {
        var mixed = JsonNode.Parse(MixedSnapshot)!.AsObject();
        foreach (var source in NativeHistory.Rows(mixed["tokens"]))
            source["days"]!.AsArray().Add(new JsonObject { ["date"] = "2026-09-01", ["totalTokens"] = 7 });
        var before = mixed.ToJsonString();
        foreach (var host in new[] { "Mac", "Windows" })
        {
            var days = NativeHistory.Days(mixed, "tokens", host);
            Check(days.Select(day => Snapshot.Text(day["date"])).SequenceEqual(new[] { "2026-09-01", "2026-09-12" }),
                "Per-device past records were discarded or not ordered: " + host);
            Check(NativeHistory.Sum(NativeHistory.Select(days, "Day", "2026-09-01"), "totalTokens") == 7,
                "Per-device past date was not selectable: " + host);
        }
        Check(mixed.ToJsonString() == before, "Viewing past dates reordered the saved source rows.");
        Check(NativeHistory.Devices.SequenceEqual(new[] { "All", "Mac", "Windows" }),
            "History offers a device outside the native set.");
    }

    internal const string OtherOnlySnapshot = """
        {"schema":2,"collectedAt":"2026-09-12T12:00:00Z","tokens":[
          {"host":"Other","status":"ok","days":[{"date":"2026-09-12","totalTokens":42}]}]}
        """;

    internal static async Task Dashboard(string output)
    {
        var data = JsonNode.Parse(MixedSnapshot)!.AsObject();
        var before = data.ToJsonString();
        var saved = Path.Combine(output, "other-only-history.json");
        File.WriteAllText(saved, OtherOnlySnapshot);
        var refreshes = 0;
        using var form = new NativeDashboard(() => data, () => { refreshes++; return Task.CompletedTask; },
            readArchive: (_, _) => throw new InvalidOperationException("Device selection invoked an archive reader."));
        form.Show();
        try
        {
            var sections = Children(form).OfType<ListBox>().Single();
            sections.SelectedItem = "Tokens";
            var devices = Children(form).OfType<DashboardFilters>().Single(choice => choice.AccessibleName == "Device");
            Check(Children(devices).OfType<Button>().Select(button => button.Text).SequenceEqual(new[] { "All", "Mac", "Windows" }),
                "History offers a device outside the native set.");
            await Device(form, "All");
            Check(!Texts(form).Contains("60 tokens") && !Texts(form).Contains("30 tokens") &&
                !Children(form).OfType<DashboardHistoryChart>().Any(), "Mixed-scope history showed or recomputed a native All total.");
            Check(Texts(form).Any(value => value.Contains("All") && value.Contains("scope")), "Withheld aggregate has no historical scope explanation.");
            foreach (var (label, expected) in new[] { ("Mac", "10 tokens"), ("Windows", "20 tokens") })
            {
                await Device(form, label);
                Check(Texts(form).Contains(expected), "Per-device historical value is not navigable: " + label);
            }
            Check(Children(form).OfType<Button>().Single(button => button.AccessibleName == "Refresh sources").Enabled,
                "Native history lost its refresh action.");
            Check(data.ToJsonString() == before, "Navigating history mutated source rows.");

            foreach (var key in new[] { "tokens", "settings", "activity", "activityHistory" })
            {
                data = NativeScopeSnapshot();
                data[key]!.AsArray().Add((JsonNode?)null);
                var malformedBefore = data.ToJsonString();
                sections.SelectedItem = key is "tokens" or "settings" ? "Tokens" : "Activity";
                await Device(form, "All");
                form.Reload();
                Check(Texts(form).Contains(NativeHistory.ScopeNotice) && !Children(form).OfType<DashboardHistoryChart>().Any(),
                    "Malformed " + key + " provenance still renders a native All total.");
                Check(data.ToJsonString() == malformedBefore, "Viewing malformed scope rewrote source evidence.");
            }
            data = NativeScopeSnapshot();
            sections.SelectedItem = "Tokens";
            form.Reload();
            Check(Texts(form).Contains("30 tokens") && Children(form).OfType<DashboardHistoryChart>().Any(),
                "A valid native aggregate did not recover after malformed scope.");

            data = Snapshot.Read(saved)!;
            var otherBefore = data.ToJsonString();
            form.Reload();
            foreach (var label in new[] { "Mac", "Windows", "All" })
            {
                await Device(form, label);
                Check(!Texts(form).Contains("42 tokens") && !Children(form).OfType<DashboardHistoryChart>().Any(),
                    "Records from another device leaked into " + label + " history.");
            }
            Check(data.ToJsonString() == otherBefore && File.ReadAllText(saved) == OtherOnlySnapshot,
                "Viewing history changed original saved rows or bytes.");
            data = new JsonObject();
            form.Reload();
            await Device(form, "Windows");
            Check(Children(form).OfType<Button>().Single(button => button.Text == "Windows").AccessibleDescription == "Selected",
                "History lost its device selection when no records remained.");
            Check(refreshes == 0, "History navigation started collection.");
        }
        finally { form.Close(); }
    }

    private static IEnumerable<Control> Children(Control parent)
    {
        foreach (Control child in parent.Controls)
        {
            yield return child;
            foreach (var nested in Children(child)) yield return nested;
        }
    }
    private static string[] Texts(Control form) => Children(form).OfType<Label>().Select(label => label.Text).ToArray();
    private static async Task Device(Control form, string label)
    {
        var devices = Children(form).OfType<DashboardFilters>().Single(choice => choice.AccessibleName == "Device");
        Children(devices).OfType<Button>().Single(button => button.Text == label).PerformClick();
        await Task.Delay(30);
    }

    private static void Check(bool value, string message)
    {
        if (!value) throw new InvalidOperationException(message);
    }
}
