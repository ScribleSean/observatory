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
        // Values come from fixed lists, never from stored text.
        var script = "      root.dataset.skin = \"" + skin + "\";";
        if (theme is not null)
            script += "\n      root.dataset.theme = \"" + theme + "\";";
        else script += "\n      delete root.dataset.theme;";
        return "(() => {\n" +
            "  try {\n" +
            "    let done = false;\n" +
            "    let observer;\n" +
            "    const finish = () => {\n" +
            "      done = true;\n" +
            "      try { if (observer) observer.disconnect(); } catch { }\n" +
            "      try { document.removeEventListener(\"readystatechange\", retry); } catch { }\n" +
            "      try { document.removeEventListener(\"DOMContentLoaded\", retry); } catch { }\n" +
            "    };\n" +
            "    const apply = () => {\n" +
            "      const root = document.documentElement;\n" +
            "      if (!root) return false;\n" +
            script + "\n" +
            "      return true;\n" +
            "    };\n" +
            "    const retry = () => {\n" +
            "      try { if (done) return; if (apply()) finish(); } catch { }\n" +
            "    };\n" +
            "    if (apply()) { finish(); return; }\n" +
            "    observer = new MutationObserver(() => {\n" +
            "      try { if (done) return; if (apply()) finish(); } catch { }\n" +
            "    });\n" +
            "    observer.observe(document, {childList: true});\n" +
            "    document.addEventListener(\"readystatechange\", retry);\n" +
            "    document.addEventListener(\"DOMContentLoaded\", retry);\n" +
            "  } catch { }\n" +
            "})();";
    }

    private static string WithoutWhitespace(string script) => string.Concat(script.Where(c => !char.IsWhiteSpace(c)));

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

        var script = WithoutWhitespace(DocumentStartScript("almanac", "dark"));
        Check(script.Contains("dataset.skin=\"almanac\""), "Script must set the selected skin");
        Check(script.Contains("dataset.theme=\"dark\""), "Script must set the selected theme");
        var invalid = WithoutWhitespace(DocumentStartScript("x\"; alert(1)", "dark\""));
        Check(invalid.Contains("dataset.skin=\"sage\""), "Invalid script skin must use Sage");
        Check(!invalid.Contains("alert"), "Script must exclude stored text");
        Check(invalid.Contains("deleteroot.dataset.theme"), "Invalid theme removes the attribute");
        Check(WithoutWhitespace(DocumentStartScript("sage", "system")).Contains("deleteroot.dataset.theme"), "System theme removes the attribute");
        Check(WithoutWhitespace(DocumentStartScript("sage", null)).Contains("deleteroot.dataset.theme"), "Missing theme removes the attribute");
        Check(script.Contains("constroot=document.documentElement;") && script.Contains("if(!root)returnfalse;"), "Script must wait for the document element");
        Check(script.Contains("newMutationObserver(") && script.Contains("observe(document,{childList:true})"), "Script must observe document insertion");
        Check(script.Contains("document.addEventListener(\"readystatechange\",retry)") &&
            script.Contains("document.addEventListener(\"DOMContentLoaded\",retry)"), "Script must retry on document events");
        Check(script.Contains("document.removeEventListener(\"readystatechange\",retry)") &&
            script.Contains("document.removeEventListener(\"DOMContentLoaded\",retry)"), "Script must remove both document listeners");
        Check(script.Contains("done=true;") && script.Contains("observer.disconnect()"), "Script must finish and disconnect after success");
        Check(script.StartsWith("(()=>{try{") && script.EndsWith("}catch{}})();"), "Script must catch startup errors");
        Check(script.Contains("newMutationObserver(()=>{try{if(done)return;if(apply())finish();}catch{}") &&
            script.Contains("constretry=()=>{try{if(done)return;if(apply())finish();}catch{}"), "Callbacks must catch errors and stop after success");
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
