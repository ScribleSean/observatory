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
        return true;
    }
    private static void Write(string runtime, bool completed)
    {
        CheckFile(Marker(runtime));
        var temporary = Path.Combine(runtime, "setup-state-" + Guid.NewGuid().ToString("N") + ".tmp");
        try
        {
            File.WriteAllText(temporary, new JsonObject { ["version"] = 1, ["completed"] = completed }.ToJsonString());
            File.Move(temporary, Marker(runtime), true);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
    internal static void Complete(string runtime, Action saveSources)
    {
        using var locked = new FileStream(Path.Combine(runtime, "collection.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        if (!Required(runtime)) throw new InvalidOperationException("Setup already completed.");
        saveSources();
        Write(runtime, true);
    }
    internal static void SelfTest()
    {
        var root = Path.Combine(Path.GetTempPath(), "observatory-first-run-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            if (!Prepare(root) || !Prepare(root) || AllowsCollection(root)) throw new Exception("Pending setup did not survive restart.");
            try { Complete(root, () => throw new IOException("Synthetic save failure")); } catch (IOException) { }
            if (AllowsCollection(root)) throw new Exception("Failed save enabled collection.");
            var config = Path.Combine(root, "collector.config.json");
            Complete(root, () => File.WriteAllText(config, "{\"activity\":false,\"codex\":false}"));
            if (Prepare(root) || !AllowsCollection(root)) throw new Exception("Completed setup was not retained.");
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
