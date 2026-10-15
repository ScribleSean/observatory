using Microsoft.Win32;

namespace WorkspaceObservatory;

internal static class WebViewerPreferences
{
    internal static readonly string[] Skins = ["sage", "almanac", "amber-crt", "instrument"];
    private static string Key => AppIdentity.Current.IsTest ? @"Software\WorkspaceObservatoryInstallerTest\Dashboard" : @"Software\Observatory\Dashboard";

    internal static string Skin(object? stored)
    {
        if (stored is string value)
            foreach (var skin in Skins)
                if (string.Equals(value, skin, StringComparison.Ordinal)) return skin;
        return "sage";
    }

    internal static string? Theme(object? stored) => stored is string value && (value == "light" || value == "dark") ? value : null;

    internal static (string Skin, string? Theme) Read(string runtime) => Read(runtime, Key);

    private static (string Skin, string? Theme) Read(string runtime, string registryKey)
    {
        var store = new BridgeSettingsStore(runtime);
        try
        {
            if (!store.ViewerExists)
            {
                using var saved = Registry.CurrentUser.OpenSubKey(registryKey, writable: true);
                if (saved is not null)
                {
                    var skin = saved.GetValue("Skin") as string;
                    var theme = saved.GetValue("Theme") as string;
                    if ((skin is not null && Skins.Contains(skin, StringComparer.Ordinal)) || theme is "light" or "dark" or "system")
                    {
                        store.WriteViewer(Skin(skin), Theme(theme) ?? "system", replace: false);
                        saved.DeleteValue("Skin", throwOnMissingValue: false);
                        saved.DeleteValue("Theme", throwOnMissingValue: false);
                    }
                }
            }
        }
        catch { }
        var value = store.ReadViewer();
        return (value.Skin, Theme(value.Appearance));
    }

    internal static string DocumentStartScript(string skin, string? theme)
    {
        skin = Skin(skin);
        theme = Theme(theme);
        var script = "document.documentElement.dataset.skin = \"" + skin + "\";";
        if (theme is not null)
            script += "\ndocument.documentElement.dataset.theme = \"" + theme + "\";";
        else script += "\ndelete document.documentElement.dataset.theme;";
        return "(() => {\n" + script + "\n})();";
    }

    internal static void SelfTest()
    {
        static void Check(bool passed, string message)
        {
            if (!passed) throw new InvalidOperationException("Web viewer preference contract failed: " + message);
        }

        Check(Skin(null) == "sage", "Missing skin must use Sage");
        Check(Theme(null) is null, "Missing theme must follow the system");
        foreach (var skin in Skins)
            Check(Skin(skin) == skin, "Bundled skin must be retained");
        foreach (var skin in new object[] { "", "Sage", "almanac ", "custom", "x\"; alert(1)", 1 })
            Check(Skin(skin) == "sage", "Invalid skin must use Sage");
        foreach (var theme in new[] { "light", "dark" })
            Check(Theme(theme) == theme, "Explicit theme must be retained");
        foreach (var theme in new object[] { "", "Dark", "system", "auto", "dark\"", 0 })
            Check(Theme(theme) is null, "Invalid theme must follow the system");

        var script = DocumentStartScript("almanac", "dark");
        Check(script.Contains("dataset.skin = \"almanac\""), "Script must set the selected skin");
        Check(script.Contains("dataset.theme = \"dark\""), "Script must set the selected theme");
        var invalid = DocumentStartScript("x\"; alert(1)", "dark\"");
        Check(invalid.Contains("dataset.skin = \"sage\""), "Invalid script skin must use Sage");
        Check(!invalid.Contains("alert"), "Script must exclude stored text");
        Check(invalid.Contains("delete document.documentElement.dataset.theme"), "Invalid theme removes the attribute");
        Check(DocumentStartScript("sage", "system").Contains("delete document.documentElement.dataset.theme"), "System theme removes the attribute");
        Check(DocumentStartScript("sage", null).Contains("delete document.documentElement.dataset.theme"), "Missing theme removes the attribute");
        var runtime = Path.Combine(Path.GetTempPath(), "observatory-viewer-test-" + Guid.NewGuid().ToString("N"));
        var registryKey = @"Software\WorkspaceObservatoryTests\Viewer-" + Guid.NewGuid().ToString("N");
        Directory.CreateDirectory(runtime);
        try
        {
            using (var saved = Registry.CurrentUser.CreateSubKey(registryKey))
            {
                saved.SetValue("Skin", "almanac"); saved.SetValue("Theme", "dark"); saved.SetValue("Keep", "synthetic");
            }
            Check(Read(runtime, registryKey) == ("almanac", "dark"), "Migration reads old choices");
            using (var saved = Registry.CurrentUser.OpenSubKey(registryKey, writable: true))
            {
                Check(saved is not null && saved.GetValue("Skin") is null && saved.GetValue("Theme") is null &&
                    (string?)saved.GetValue("Keep") == "synthetic", "Migration removes only its values");
                saved!.SetValue("Skin", "instrument");
            }
            Check(Read(runtime, registryKey) == ("almanac", "dark"), "Existing file wins");
            File.WriteAllText(Path.Combine(runtime, "viewer.json"), "{}");
            Check(Read(runtime, registryKey) == ("sage", null), "Invalid existing file does not migrate");
            File.Delete(Path.Combine(runtime, "viewer.json"));
            Check(Read(runtime, registryKey) == ("instrument", null), "Missing theme uses system");
        }
        finally { Registry.CurrentUser.DeleteSubKeyTree(registryKey, throwOnMissingSubKey: false); Directory.Delete(runtime, recursive: true); }
        Console.WriteLine("Web viewer preference contracts passed.");
    }
}
