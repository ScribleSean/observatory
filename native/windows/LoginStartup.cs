using Microsoft.Win32;

namespace WorkspaceObservatory;

internal static class LoginStartup
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private static string ValueName => AppIdentity.Current.StartupName;
    private static string Executable => Path.Combine(AppContext.BaseDirectory, "WorkspaceObservatory.exe");

    internal static string Command(string executable)
    {
        if (!Path.IsPathFullyQualified(executable) || executable.IndexOfAny(['"', '\r', '\n', '\0']) >= 0 ||
            !string.Equals(Path.GetExtension(executable), ".exe", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("An absolute executable path is required.");
        var command = $"\"{executable}\" --background";
        if (command.Length > 260) throw new ArgumentException("The startup executable path is too long.");
        return command;
    }

    internal static bool Registered()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey);
        return key?.GetValue(ValueName) is string saved && saved == Command(Executable);
    }

    internal static void SetRegistered(bool enabled)
    {
        if (enabled && !File.Exists(Executable)) throw new InvalidOperationException("The application executable is missing.");
        using var key = Registry.CurrentUser.CreateSubKey(RunKey, writable: true);
        Apply(key, ValueName, Command(Executable), enabled);
    }

    private static void Apply(RegistryKey key, string name, string command, bool enabled)
    {
        var existing = key.GetValue(name);
        if (existing is not null && !Equals(existing, command))
            throw new InvalidOperationException("Another Observatory installation owns this startup entry. Disable it there first.");
        if (enabled) key.SetValue(name, command, RegistryValueKind.String);
        else key.DeleteValue(name, throwOnMissingValue: false);
    }

    internal static void RestoreMigration()
    {
        if (AppIdentity.Current.IsTest || AppIdentity.RuntimeOverride is not null) return;
        RestoreMigration(AppIdentity.Current.DefaultRuntime, () => SetRegistered(true));
    }

    private static void RestoreMigration(string runtime, Action enable)
    {
        var restored = Path.Combine(runtime, "login-restored.json");
        var created = false;
        try
        {
            var receipt = Path.Combine(runtime, "observatory-migration.json");
            if (Path.Exists(restored)) return;
            using var input = new FileStream(receipt, FileMode.Open, FileAccess.Read, FileShare.Read);
            if ((File.GetAttributes(receipt) & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0 || input.Length >= 65536) return;
            using var document = System.Text.Json.JsonDocument.Parse(input);
            var root = document.RootElement;
            if (root.GetProperty("schema").GetInt32() != 1 || !root.GetProperty("loginWasOn").GetBoolean()) return;
            enable();
            var bytes = System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(new { schema = 1, restoredAt = DateTimeOffset.UtcNow });
            using var output = new FileStream(restored, FileMode.CreateNew, FileAccess.Write, FileShare.None);
            created = true;
            output.Write(bytes);
            output.Flush(true);
        }
        catch
        {
            // A failed marker write must allow a later startup to retry.
            if (created) { try { File.Delete(restored); } catch { } }
        }
    }

    internal static void SelfTest()
    {
        void Check(bool value) { if (!value) throw new InvalidOperationException("Startup contract failed."); }
        Check(Command(@"C:\Program Files\Observatory\WorkspaceObservatory.exe") == "\"C:\\Program Files\\Observatory\\WorkspaceObservatory.exe\" --background");
        foreach (var invalid in new[] { "relative.exe", "C:\\bad\"name.exe", "C:\\script.cmd", "C:\\" + new string('a', 260) + ".exe" })
        {
            var rejected = false;
            try { Command(invalid); } catch (ArgumentException) { rejected = true; }
            Check(rejected);
        }
        // Use a unique test key, never the real login-startup key.
        var testPath = @"Software\WorkspaceObservatoryTests\" + Guid.NewGuid().ToString("N");
        var folder = Path.Combine(Path.GetTempPath(), "ObservatoryLoginTest-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        try
        {
            using var key = Registry.CurrentUser.CreateSubKey(testPath, writable: true);
            var command = Command(@"C:\Test\WorkspaceObservatory.exe");
            key.SetValue("Unrelated", "preserved");
            Apply(key, ValueName, command, true);
            Check(Equals(key.GetValue(ValueName), command));
            Apply(key, ValueName, command, false);
            Check(key.GetValue(ValueName) is null);
            Check(Equals(key.GetValue("Unrelated"), "preserved"));
            var migration = Path.Combine(folder, "observatory-migration.json");
            foreach (var invalid in new[] { "invalid", "{\"schema\":2,\"loginWasOn\":true}", "{\"schema\":1,\"loginWasOn\":false}", new string(' ', 65536) })
            {
                File.WriteAllText(migration, invalid);
                RestoreMigration(folder, () => Apply(key, ValueName, command, true));
                Check(key.GetValue(ValueName) is null && !File.Exists(Path.Combine(folder, "login-restored.json")));
            }
            File.WriteAllText(migration, "{\"schema\":1,\"loginWasOn\":true}");
            RestoreMigration(folder, () => throw new IOException("Synthetic startup failure."));
            Check(!File.Exists(Path.Combine(folder, "login-restored.json")));
            RestoreMigration(folder, () => Apply(key, ValueName, command, true));
            Check(Equals(key.GetValue(ValueName), command) && File.Exists(Path.Combine(folder, "login-restored.json")));
            Apply(key, ValueName, command, false);
            RestoreMigration(folder, () => Apply(key, ValueName, command, true));
            Check(key.GetValue(ValueName) is null);
            key.SetValue(ValueName, "different installation");
            var rejected = false;
            try { Apply(key, ValueName, command, false); } catch (InvalidOperationException) { rejected = true; }
            Check(rejected && Equals(key.GetValue(ValueName), "different installation"));
        }
        finally { Registry.CurrentUser.DeleteSubKeyTree(testPath, throwOnMissingSubKey: false); Directory.Delete(folder, recursive: true); }
        Console.WriteLine("Windows startup self-tests passed");
    }
}
