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
            key.SetValue(ValueName, "different installation");
            var rejected = false;
            try { Apply(key, ValueName, command, false); } catch (InvalidOperationException) { rejected = true; }
            Check(rejected && Equals(key.GetValue(ValueName), "different installation"));
        }
        finally { Registry.CurrentUser.DeleteSubKeyTree(testPath, throwOnMissingSubKey: false); }
        Console.WriteLine("Windows startup self-tests passed");
    }
}
