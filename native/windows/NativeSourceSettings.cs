using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

internal sealed record SourceSettingsActions(Func<JsonObject> Read, Action<JsonObject, JsonObject> Save);

internal sealed partial class NativeDashboard
{
    private readonly SourceSettingsActions? sourceSettings;

    internal void ShowSourceSettings() { sections.SelectedItem = "Settings"; Activate(); }

    private void SourceSettings()
    {
        if (sourceSettings is null) { Label("Source settings are unavailable in this preview session."); return; }
        JsonObject original;
        try { original = sourceSettings.Read().DeepClone().AsObject(); }
        catch { Label("Source settings could not be read. Existing configuration is preserved."); return; }
        var draft = original.DeepClone().AsObject();
        Label("Choose sources on this PC. Changes apply only when saved. Provider sign-ins stay in their owning applications.");
        foreach (var (key, title) in new[] { ("activity", "ActivityWatch screen time"), ("codex", "Saved Codex usage and settings"),
            ("wispr", "Wispr Flow statistics"), ("quota", "Online Codex account limits") })
        {
            var check = new CheckBox { Text = title, AccessibleName = key, AutoSize = true, Margin = new Padding(0, 0, 0, 12),
                Checked = original[key] is JsonValue value && value.TryGetValue<bool>(out var enabled) && enabled };
            draft[key] = check.Checked;
            check.CheckedChanged += (_, _) => draft[key] = check.Checked;
            body.Controls.Add(check);
        }
        foreach (var (key, title) in new[] { ("wslDistribution", "Additional Codex log device"), ("quotaWslDistribution", "Account client") })
        {
            var existing = Snapshot.Text(original[key], "Windows");
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
            if (original["quota"]?.ToJsonString() == "true" && draft["quota"]?.ToJsonString() == "false" &&
                MessageBox.Show(this, "Turn account monitoring off and clear Observatory's retained account readings on the next collection? Saved log-token history remains.",
                    "Account history", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) != DialogResult.Yes) return;
            try
            {
                sourceSettings.Save(original, draft);
                original = draft.DeepClone().AsObject();
                status.Text = "Source settings saved. Availability is reported in Sources after collection.";
            }
            catch (InvalidOperationException error) { status.Text = error.Message; }
            catch { status.Text = "Settings could not be saved. Reload and check source configuration before retrying."; }
        };
        body.Controls.Add(save);
    }
}
