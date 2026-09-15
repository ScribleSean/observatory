using Microsoft.Win32;
using System.Text.RegularExpressions;

namespace WorkspaceObservatory;

internal static class UpdateRegistration
{
    internal const string KeyPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\WorkspaceObservatorySetup";
    internal sealed record Snapshot(string Path, string Installed, string Version);

    internal static Snapshot Capture(string installed, string keyPath = KeyPath)
    {
        if (!System.IO.Path.IsPathFullyQualified(installed)) throw new IOException("Absolute installation path required.");
        using var hive = RegistryKey.OpenBaseKey(RegistryHive.CurrentUser, RegistryView.Registry64);
        using var key = hive.OpenSubKey(keyPath) ?? throw new IOException("Installed registration is missing.");
        string Text(string name)
        {
            if (key.GetValue(name, null, RegistryValueOptions.DoNotExpandEnvironmentNames) is not string text ||
                key.GetValueKind(name) != RegistryValueKind.String) throw new IOException("Unexpected registration value type.");
            return text;
        }
        if (!string.Equals(Text("InstallLocation"), installed, StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(Text("UninstallString"), '"' + System.IO.Path.Combine(installed, "Uninstall.exe") + '"', StringComparison.OrdinalIgnoreCase))
            throw new IOException("Registration belongs to a different installation.");
        return new(keyPath, installed, Text("DisplayVersion"));
    }

    // Caller holds the update session and invokes this only after payload verification.
    // Never rewrite startup, shortcut, consent or unrelated registry values.
    internal static void SetVersion(Snapshot expected, string version)
    {
        if (!Regex.IsMatch(version, @"^\d+\.\d+\.\d+$") || version.Length > 32)
            throw new IOException("Invalid release version.");
        if (Capture(expected.Installed, expected.Path) != expected)
            throw new IOException("Registration changed during the update.");
        using var hive = RegistryKey.OpenBaseKey(RegistryHive.CurrentUser, RegistryView.Registry64);
        using var key = hive.OpenSubKey(expected.Path, writable: true)
            ?? throw new IOException("Installed registration disappeared.");
        key.SetValue("DisplayVersion", version, RegistryValueKind.String);
        key.Flush();
        if (Capture(expected.Installed, expected.Path).Version != version)
            throw new IOException("Registration update requires inspection.");
    }

    internal static void SelfTest()
    {
        var testKey = @"Software\ObservatoryUpdateRegistrationTest-" + Guid.NewGuid().ToString("N");
        var installed = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "Synthetic Observatory");
        using var hive = RegistryKey.OpenBaseKey(RegistryHive.CurrentUser, RegistryView.Registry64);
        try
        {
            using (var key = hive.CreateSubKey(testKey))
            {
                key.SetValue("InstallLocation", installed);
                key.SetValue("UninstallString", '"' + System.IO.Path.Combine(installed, "Uninstall.exe") + '"');
                key.SetValue("DisplayVersion", "0.3.11");
                key.SetValue("Unrelated", 42, RegistryValueKind.DWord);
            }
            var before = Capture(installed, testKey);
            SetVersion(before, "0.3.12");
            using var check = hive.OpenSubKey(testKey)!;
            if (Capture(installed, testKey).Version != "0.3.12" || (int)check.GetValue("Unrelated")! != 42 ||
                check.GetValueKind("Unrelated") != RegistryValueKind.DWord || check.ValueCount != 4)
                throw new Exception("Registration preservation failed.");
            var rejected = false;
            try { SetVersion(before, "0.3.13"); } catch (IOException) { rejected = true; }
            if (!rejected) throw new Exception("Stale registration was overwritten.");
            rejected = false;
            try { Capture(installed + "-other", testKey); } catch (IOException) { rejected = true; }
            if (!rejected) throw new Exception("Other installation registration accepted.");
        }
        finally { hive.DeleteSubKeyTree(testKey, throwOnMissingSubKey: false); }
        Console.WriteLine("Update registration preserves unrelated values and refuses changed ownership or stale snapshots.");
    }
}
