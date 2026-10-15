using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

internal static class FirstRunSetup
{
    private static string Marker(string runtime) => Path.Combine(runtime, "setup-state.json");
    private static void CheckFile(string file)
    {
        var info = new FileInfo(file);
        if (Directory.Exists(file)) throw new IOException("Setup state must be a regular file.");
        if (info.LinkTarget is not null || (info.Exists && (info.Attributes.HasFlag(FileAttributes.ReparsePoint) || info.Length > 4096)))
            throw new IOException("Unsafe setup file.");
        if (info.Exists) BridgeSettingsStore.RefuseHardLink(file);
    }
    internal static bool Required(string runtime)
    {
        if (!Path.IsPathFullyQualified(runtime) || !Directory.Exists(runtime) || File.GetAttributes(runtime).HasFlag(FileAttributes.ReparsePoint))
            throw new IOException("Invalid setup runtime.");
        var marker = Marker(runtime);
        CheckFile(marker);
        if (!File.Exists(marker))
        {
            var config = Path.Combine(runtime, "collector.config.json");
            CheckFile(config);
            return !File.Exists(config);
        }
        var state = JsonNode.Parse(File.ReadAllText(marker)) as JsonObject;
        if (state is null || state.Count != 2 || state["version"]?.GetValue<int>() != 1 || state["completed"] is not JsonValue value || !value.TryGetValue<bool>(out var completed))
            throw new IOException("Invalid setup state.");
        return !completed;
    }
    internal static bool AllowsCollection(string runtime)
    {
        try { return !Required(runtime); } catch { return false; }
    }
    internal static bool Prepare(string runtime)
    {
        Directory.CreateDirectory(runtime);
        if (File.GetAttributes(runtime).HasFlag(FileAttributes.ReparsePoint)) throw new IOException("Invalid setup directory.");
        if (!Required(runtime)) return false;
        if (!File.Exists(Marker(runtime))) Write(runtime, false);
        var config = Path.Combine(runtime, "collector.config.json");
        CheckFile(config);
        if (!File.Exists(config))
        {
            var sources = new JsonObject();
            foreach (var key in new[] { "activity", "codex", "claude", "wispr", "quota" }) sources[key] = false;
            WriteFile(config, sources);
        }
        return true;
    }
    private static void Write(string runtime, bool completed)
    {
        WriteFile(Marker(runtime), new JsonObject { ["version"] = 1, ["completed"] = completed });
    }
    private static void WriteFile(string file, JsonObject value)
    {
        CheckFile(file);
        var temporary = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                System.Text.Json.JsonSerializer.Serialize(stream, value);
            CheckFile(file);
            File.Move(temporary, file, true);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
    internal static bool MarkComplete(string runtime)
    {
        using var locked = new FileStream(Path.Combine(runtime, "collection.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        if (!Required(runtime)) return false;
        var config = Path.Combine(runtime, "collector.config.json");
        CheckFile(config);
        var sources = JsonNode.Parse(File.ReadAllText(config)) as JsonObject;
        foreach (var key in new[] { "activity", "codex", "claude", "wispr", "quota" })
            if (sources?[key] is not JsonValue value || !value.TryGetValue<bool>(out _))
                throw new IOException("Invalid source settings.");
        Write(runtime, true);
        return true;
    }
    internal static void SelfTest()
    {
        var root = Path.Combine(Path.GetTempPath(), "observatory-first-run-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            if (!Prepare(root) || !Prepare(root) || AllowsCollection(root)) throw new Exception("Pending setup did not survive restart.");
            var config = Path.Combine(root, "collector.config.json");
            var sources = JsonNode.Parse(File.ReadAllText(config))!.AsObject();
            if (sources.Count != 5 || sources.Any(p => p.Value!.GetValue<bool>())) throw new Exception("Sources were enabled by default.");
            sources["activity"] = true;
            File.WriteAllText(config, sources.ToJsonString());
            var saved = File.ReadAllText(config);
            Prepare(root);
            if (File.ReadAllText(config) != saved) throw new Exception("Prepare changed source choices.");
            File.WriteAllText(config, "{}");
            var pending = File.ReadAllText(Marker(root));
            try { MarkComplete(root); throw new Exception("Invalid config accepted."); } catch (IOException) { }
            if (File.ReadAllText(Marker(root)) != pending || AllowsCollection(root)) throw new Exception("Failed completion changed consent.");
            File.WriteAllText(config, saved);
            if (!MarkComplete(root) || Prepare(root) || !AllowsCollection(root)) throw new Exception("Completed setup was not retained.");
            var completed = File.ReadAllBytes(Marker(root));
            if (MarkComplete(root) || !completed.SequenceEqual(File.ReadAllBytes(Marker(root)))) throw new Exception("Completion was not idempotent.");
            File.WriteAllText(Marker(root), "invalid");
            if (AllowsCollection(root)) throw new Exception("Corrupt setup enabled collection.");
            File.Delete(Marker(root));
            var before = File.ReadAllText(config);
            if (Prepare(root) || File.Exists(Marker(root)) || File.ReadAllText(config) != before) throw new Exception("Existing installation was modified.");
            Directory.CreateDirectory(Marker(root));
            if (AllowsCollection(root)) throw new Exception("A directory was accepted as setup state.");
        }
        finally { Directory.Delete(root, true); }
        Console.WriteLine("First-run consent state passed.");
    }
}
