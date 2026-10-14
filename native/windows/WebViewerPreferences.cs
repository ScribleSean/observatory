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

    internal static (string Skin, string? Theme) Read()
    {
        try
        {
            using var saved = Registry.CurrentUser.OpenSubKey(Key);
            if (saved is null) return ("sage", null);
            return (Skin(saved.GetValue("Skin")), Theme(saved.GetValue("Theme")));
        }
        catch { return ("sage", null); }
    }

    internal static string DocumentStartScript(string skin, string? theme)
    {
        skin = Skin(skin);
        theme = Theme(theme);
        // Values come from fixed lists, never from stored text.
        var script = "document.documentElement.dataset.skin = \"" + skin + "\";";
        if (theme is not null)
            script += "\ndocument.documentElement.dataset.theme = \"" + theme + "\";";
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
        Check(!invalid.Contains("dataset.theme"), "Invalid theme must not set an attribute");
        Check(!DocumentStartScript("sage", null).Contains("dataset.theme"), "System theme must not set an attribute");
        Console.WriteLine("Web viewer preference contracts passed.");
    }
}
