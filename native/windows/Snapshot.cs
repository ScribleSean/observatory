using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

internal static class Snapshot
{
    internal const int MaxBytes = 16_000_000;

    internal static string? DashboardFile(string runtime, string name)
    {
        if (name is not ("usage.json" or "collector.json")) return null;
        return UnlinkedFile(runtime, "public/local/" + name);
    }

    internal static string? UnlinkedFile(string root, string relative)
    {
        try
        {
            var components = relative.Split(new[] { '/', '\\' }, StringSplitOptions.RemoveEmptyEntries);
            if (Path.IsPathRooted(relative) || relative.Contains(':') || components.Any(part => part is "." or "..")) return null;
            var file = Path.GetFullPath(root);
            if (File.GetAttributes(file).HasFlag(FileAttributes.ReparsePoint)) return null;
            foreach (var component in components)
            {
                file = Path.Combine(file, component);
                var entry = file;
                if (File.GetAttributes(entry).HasFlag(FileAttributes.ReparsePoint)) return null;
            }
            return file;
        }
        catch { return null; }
    }

    internal static JsonObject? Read(string file)
    {
        try
        {
            var info = new FileInfo(file);
            if (!info.Exists || info.Length > MaxBytes || info.Attributes.HasFlag(FileAttributes.ReparsePoint)) return null;
            return JsonNode.Parse(File.ReadAllText(file)) as JsonObject;
        }
        catch { return null; }
    }

    internal static string Text(JsonNode? value, string fallback = "Unknown") =>
        value is JsonValue item && item.TryGetValue<string>(out var result) ? result : fallback;

    internal static double? Number(JsonNode? value)
    {
        if (value is not JsonValue item || item.GetValueKind() != System.Text.Json.JsonValueKind.Number) return null;
        try
        {
            var number = double.Parse(item.ToJsonString(), System.Globalization.CultureInfo.InvariantCulture);
            return double.IsFinite(number) && number >= 0 ? number : null;
        }
        catch { return null; }
    }

    internal static bool HasNativeAggregateScope(JsonObject? snapshot, string kind)
    {
        if (kind is not ("activity" or "tokens")) return false;
        var keys = kind == "tokens" ? new[] { "tokens", "settings" } : new[] { "activity", "activityHistory" };
        // Missing optional sources are valid. Present malformed sources cannot prove scope.
        JsonObject[]? ScopeRows(string key)
        {
            if (snapshot is null || !snapshot.TryGetPropertyValue(key, out var value)) return [];
            if (value is not JsonArray array || array.Any(row => row is not JsonObject)) return null;
            return array.Cast<JsonObject>().ToArray();
        }
        var sources = ScopeRows(keys[0]);
        var siblings = ScopeRows(keys[1]);
        if (sources is null || siblings is null) return false;
        if (sources.Concat(siblings).Any(row =>
            Text(row["host"]) is not ("Mac" or "Windows") && !(kind == "activity" && Text(row["host"]) == "Combined") &&
            (Text(row["status"]) != "not-connected" || new[] { "days", "profiles", "tools" }.Any(key =>
                row.TryGetPropertyValue(key, out var value) && value is not JsonArray { Count: 0 })))) return false;
        // Activity's collector contract is native-only. Legacy token verification
        // can cover another device too, so require the original native source set as well.
        if (kind == "activity") return true;
        return new[] { "Mac", "Windows" }.All(host =>
        {
            var matches = sources.Where(row => Text(row["host"]) == host).ToArray();
            return matches.Length == 1 && Text(matches[0]["status"]) == "ok" && matches[0]["days"] is JsonArray;
        });
    }

    internal static JsonObject? Latest(JsonObject? snapshot, string kind, string host)
    {
        JsonObject? source;
        if (host == "All")
        {
            source = snapshot?[kind == "activity" ? "combined" : "combinedTokens"] as JsonObject;
            if (kind is not ("activity" or "tokens")) return null;
            if (!HasNativeAggregateScope(snapshot, kind)) return null;
            if (kind == "tokens" && Text(source?["verification"]?["status"]) != "verified") return null;
        }
        else
        {
            source = (snapshot?[kind] as JsonArray)?.OfType<JsonObject>().FirstOrDefault(row =>
                Text(row["host"]) == host && (kind != "dictation" || Text(row["source"]) == "Wispr Flow"));
        }
        if (Text(source?["status"]) != "ok") return null;
        return (source?["days"] as JsonArray)?.OfType<JsonObject>()
            .OrderBy(row => Text(row["date"]), StringComparer.Ordinal).LastOrDefault();
    }

    internal static string Format(double? value) => value?.ToString("N0") ?? "Unknown";
    internal static string Duration(double? seconds) => seconds is null || !double.IsFinite(seconds.Value) || seconds < 0 ? "Unknown" :
        seconds >= 86400 ? $"{Math.Floor(seconds.Value / 86400):0}d {Math.Floor(seconds.Value % 86400 / 3600):0}h {Math.Floor(seconds.Value % 3600 / 60):0}m" :
        seconds >= 3600 ? $"{Math.Floor(seconds.Value / 3600):0}h {Math.Floor(seconds.Value % 3600 / 60):0}m" : $"{seconds / 60:0.#} min";

    internal static void SelfTest()
    {
        void Check(bool value) { if (!value) throw new InvalidOperationException("Snapshot contract failed"); }
        Check(Duration(86400) == "1d 0h 0m" && Duration(90060) == "1d 1h 1m");
        Check(Duration(double.NaN) == "Unknown");
        Check(Number(JsonValue.Create(true)) is null);
        Check(Number(JsonValue.Create(-1)) is null);
        Check(Number(JsonValue.Create("1")) is null);
        Check(Number(JsonValue.Create(0)) == 0);
        var data = JsonNode.Parse("""
            {"tokens":[{"host":"Mac","status":"ok","days":[]},{"host":"Windows","status":"ok","days":[]}],
             "combined":{"status":"ok","days":[{"date":"2026-09-08","seconds":90}]},
             "combinedTokens":{"status":"ok","verification":{"status":"verified"},
             "days":[{"date":"2026-09-08","totalTokens":600}]}}
            """)!.AsObject();
        Check(Number(Latest(data, "activity", "All")?["seconds"]) == 90);
        Check(Number(Latest(data, "tokens", "All")?["totalTokens"]) == 600);
        data["combinedTokens"]!["verification"]!["status"] = "overlap";
        Check(Latest(data, "tokens", "All") is null);
        Check(Latest(data, "dictation", "All") is null);
        Check(Latest(data, "tokens", "Windows") is null);
        Check(Format(null) == "Unknown");
        AggregateScope();
        AggregateProvenance();
        Console.WriteLine("Windows snapshot self-tests passed");
    }

    private const string MixedSnapshot = """
        {"schema":2,"collectedAt":"2026-09-12T12:00:00Z","tokens":[
          {"host":"Mac","status":"ok","days":[{"date":"2026-09-12","totalTokens":10}]},
          {"host":"Windows","status":"ok","days":[{"date":"2026-09-12","totalTokens":20}]},
          {"host":"Other","status":"ok","days":[{"date":"2026-09-12","totalTokens":30}]}],
         "combinedTokens":{"host":"All","status":"ok","verification":{"status":"verified"},
          "days":[{"date":"2026-09-12","totalTokens":60}]}}
        """;

    private static void AggregateScope()
    {
        var mixed = JsonNode.Parse(MixedSnapshot)!.AsObject();
        var before = mixed.ToJsonString();
        CheckRetirement(Snapshot.Latest(mixed, "tokens", "All") is null,
            "A verified aggregate that includes another device leaked into native All.");
        foreach (var (host, tokens) in new[] { ("Mac", 10), ("Windows", 20) })
        {
            CheckRetirement(Snapshot.Number(Snapshot.Latest(mixed, "tokens", host)?["totalTokens"]) == tokens,
                "Per-device latest records were lost: " + host);
        }
        CheckRetirement(mixed.ToJsonString() == before, "Scope checking mutated the saved mixed-scope snapshot.");

        var native = mixed.DeepClone().AsObject();
        native["tokens"]!.AsArray().RemoveAt(2);
        native["combinedTokens"]!["days"]![0]!["totalTokens"] = 30;
        CheckRetirement(Snapshot.Number(Snapshot.Latest(native, "tokens", "All")?["totalTokens"]) == 30,
            "Verified native-only aggregates were withheld.");
        native["combinedTokens"]!["verification"]!["status"] = "overlap";
        CheckRetirement(Snapshot.Latest(native, "tokens", "All") is null,
            "Native-only sources bypassed the collector's overlap verification.");
        native.Remove("combinedTokens");
        CheckRetirement(Snapshot.Latest(native, "tokens", "All") is null,
            "A replacement native total was invented by adding device records.");
        Console.WriteLine("Native history aggregate scope and unchanged per-device records passed.");
    }

    private static void AggregateProvenance()
    {
        MalformedAggregateProvenance();
        var unknownScope = JsonNode.Parse(MixedSnapshot)!.AsObject();
        unknownScope.Remove("tokens");
        CheckRetirement(Snapshot.Latest(unknownScope, "tokens", "All") is null,
            "Aggregate-only verification was mistaken for proof of native device scope.");
        var activity = JsonNode.Parse("""
            {"activity":[{"host":"Other","status":"ok","days":[{"date":"2026-09-12","seconds":42}]}],
             "combined":{"status":"ok","days":[{"date":"2026-09-12","seconds":42}]},
             "activityHistory":[{"host":"Combined","status":"ok","days":[{"date":"2026-09-12","seconds":42}]}]}
            """)!.AsObject();
        var before = activity.ToJsonString();
        CheckRetirement(Snapshot.Latest(activity, "activity", "All") is null,
            "Activity counters from another device leaked into native All or Combined history.");
        CheckRetirement(activity.ToJsonString() == before, "Scope checking modified saved activity evidence.");
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
        void Verify(string name, JsonObject data, string kind, bool allowed)
        {
            count++;
            var before = data.ToJsonString();
            var imported = JsonNode.Parse(before)!.AsObject();
            var metric = kind == "tokens" ? "totalTokens" : "seconds";
            try
            {
                CheckRetirement(Snapshot.HasNativeAggregateScope(imported, kind) == allowed, "Incorrect native scope decision.");
                var latest = Snapshot.Latest(imported, kind, "All");
                if (allowed)
                {
                    CheckRetirement(Snapshot.Number(latest?[metric]) == (kind == "tokens" ? 30 : 1800), "Verified native latest total was changed.");
                }
                else CheckRetirement(latest is null, "Malformed provenance leaked into native All.");
                CheckRetirement(imported.ToJsonString() == before, "Scope validation rewrote imported evidence.");
            }
            catch (Exception error) { failures.Add(name + ": " + error.Message); }
        }

        foreach (var key in new[] { "tokens", "settings", "activity", "activityHistory" })
        {
            var kind = key is "tokens" or "settings" ? "tokens" : "activity";
            Verify(key + "/native", NativeScopeSnapshot(), kind, true);
            var absent = NativeScopeSnapshot(); absent.Remove(key);
            Verify(key + "/absent", absent, kind, key != "tokens");
            var empty = NativeScopeSnapshot(); empty[key] = new JsonArray();
            Verify(key + "/empty", empty, kind, key != "tokens");
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
        CheckRetirement(failures.Count == 0, string.Join(Environment.NewLine, failures));
    }

    private static void CheckRetirement(bool value, string message)
    {
        if (!value) throw new InvalidOperationException(message);
    }
}
