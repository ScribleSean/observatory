using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

internal sealed record SourceSettingsActions(Func<JsonObject> Read, Action<JsonObject, JsonObject> Save, Func<string, bool>? Confirm = null);

internal sealed partial class NativeDashboard
{
    private readonly SourceSettingsActions? sourceSettings;
    private string settingsPage = "Sources";
    private JsonObject? sourceOriginal, sourceDraft;

    private bool ConfirmSettings(string operation) => sourceSettings?.Confirm?.Invoke(operation) ??
        MessageBox.Show(this, operation == "quota-removal"
            ? "Turn account monitoring off and clear Observatory's retained account readings on the next collection? Saved log-token history remains."
            : "Discard unsaved source choices and reload the saved settings?",
            operation == "quota-removal" ? "Account history" : "Reload source settings",
            MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) == DialogResult.Yes;

    internal void ShowSourceSettings() { settingsPage = "Sources"; sections.SelectedItem = "Settings"; Reload(); Activate(); }

    private void SourceSettings()
    {
        var fileVersion = System.Reflection.Assembly.GetExecutingAssembly()
            .GetCustomAttributes(typeof(System.Reflection.AssemblyFileVersionAttribute), false)
            .OfType<System.Reflection.AssemblyFileVersionAttribute>().FirstOrDefault()?.Version;
        var versionLabel = Version.TryParse(fileVersion, out var version) && version.Build >= 0 && version.Revision >= 0
            ? $"Version {version.Major}.{version.Minor}.{version.Build} (build {version.Revision})" : "Version Unknown";
        Label($"Observatory · {versionLabel}");
        Label("This identifies the running app. Building or downloading an update does not change this version.");
        Choice("Settings page", ["Sources", "This device"], settingsPage, value => settingsPage = value);
        if (settingsPage == "This device") { DeviceSettings(); return; }
        if (sourceSettings is null) { Label("Source settings are unavailable in this preview session."); return; }
        try { sourceOriginal ??= sourceSettings.Read().DeepClone().AsObject(); }
        catch { Label("Source settings could not be read. Existing configuration is preserved."); return; }
        sourceDraft ??= sourceOriginal.DeepClone().AsObject();
        var original = sourceOriginal;
        var draft = sourceDraft;
        Label("Choose sources on this PC. Unsaved choices stay while navigating this window, but apply only when saved. Provider sign-ins stay in their owning applications.");
        ActivityWatchHelp();
        foreach (var (key, title) in new[] { ("activity", "ActivityWatch screen time"), ("codex", "Saved Codex usage and settings"),
            ("wispr", "Wispr Flow statistics"), ("quota", "Online Codex account limits") })
        {
            var check = new CheckBox { Text = title, AccessibleName = key, AutoSize = true, Margin = new Padding(0, 0, 0, 12),
                Checked = draft[key] is JsonValue value && value.TryGetValue<bool>(out var enabled) && enabled };
            draft[key] = check.Checked;
            check.CheckedChanged += (_, _) => draft[key] = check.Checked;
            body.Controls.Add(check);
        }
        foreach (var (key, title) in new[] { ("wslDistribution", "Additional Codex log device"), ("quotaWslDistribution", "Account client") })
        {
            var existing = Snapshot.Text(draft[key], "Windows");
            var values = new[] { "Windows", "Ubuntu", existing }.Distinct().ToArray();
            var row = new FlowLayoutPanel { Width = ContentWidth, Height = 42 };
            row.Controls.Add(new Label { Text = title, AutoSize = true, Padding = new Padding(0, 7, 8, 0) });
            var choice = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 225, AccessibleName = key };
            choice.Items.AddRange(values); choice.SelectedItem = existing;
            choice.SelectedIndexChanged += (_, _) => draft[key] = choice.SelectedItem?.ToString() == "Windows" ? null : choice.SelectedItem?.ToString();
            row.Controls.Add(choice); body.Controls.Add(row);
        }
        Label("Ubuntu options may start WSL. Log-device selection only applies while saved Codex collection is on. Account-client selection is independent. No credentials are copied and no alternate account is used automatically.");
        Label("Turning account monitoring off clears Observatory's retained account readings on the next collection. Saved log-token history remains. This does not sign Codex out.");
        var status = Label("");
        var save = new Button { Text = "Save source settings", AccessibleName = "Save source settings", Height = 36, FlatStyle = FlatStyle.Flat };
        save.Click += (_, _) =>
        {
            if (original["quota"]?.ToJsonString() == "true" && draft["quota"]?.ToJsonString() == "false" && !ConfirmSettings("quota-removal")) return;
            try
            {
                sourceSettings.Save(original, draft);
                original = draft.DeepClone().AsObject();
                sourceOriginal = original;
                status.Text = "Source settings saved. Availability is reported in Sources after collection.";
            }
            catch (InvalidOperationException error) { status.Text = error.Message; }
            catch { status.Text = "Settings could not be saved. Reload and check source configuration before retrying."; }
        };
        body.Controls.Add(save);
        var reload = new Button { Text = "Reload saved settings", AccessibleName = "Reload saved settings", Height = 36, FlatStyle = FlatStyle.Flat };
        reload.Click += (_, _) =>
        {
            if (!JsonNode.DeepEquals(sourceOriginal, sourceDraft) && !ConfirmSettings("discard")) return;
            sourceOriginal = null; sourceDraft = null; Reload();
        };
        body.Controls.Add(reload);
    }
}
