using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

internal sealed record SourceSettingsActions(Func<JsonObject> Read, Action<JsonObject, JsonObject> Save, Func<string, bool>? Confirm = null);

internal sealed partial class NativeDashboard
{
    private readonly SourceSettingsActions? sourceSettings;
    private JsonObject? sourceOriginal, sourceDraft;

    private bool ConfirmSettings(string operation) => sourceSettings?.Confirm?.Invoke(operation) ??
        MessageBox.Show(this, operation == "quota-removal"
            ? "Turn account monitoring off and clear Observatory's retained account readings on the next collection? Saved log-token history remains."
            : "Discard unsaved source choices and reload the saved settings?",
            operation == "quota-removal" ? "Account history" : "Reload source settings",
            MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) == DialogResult.Yes;

    internal void ShowSourceSettings() { sections.SelectedItem = "Settings"; Reload(); Activate(); }

    private void SourceSettings()
    {
        DeviceConnectionCard();
        var aboutStart = body.Controls.Count;
        var fileVersion = System.Reflection.Assembly.GetExecutingAssembly()
            .GetCustomAttributes(typeof(System.Reflection.AssemblyFileVersionAttribute), false)
            .OfType<System.Reflection.AssemblyFileVersionAttribute>().FirstOrDefault()?.Version;
        var versionLabel = Version.TryParse(fileVersion, out var version) && version.Build >= 0 && version.Revision >= 0
            ? $"Version {version.Major}.{version.Minor}.{version.Build} (build {version.Revision})" : "Version Unknown";
        Label("About Observatory").Font = brand;
        Label(versionLabel);
        var update = new DashboardButton { Text = "Check for updates", AccessibleName = "Check for updates", Width = 190, Height = 40,
            Enabled = checkUpdates is not null };
        update.Click += async (_, _) =>
        {
            if (checkUpdates is null) return;
            update.Enabled = false;
            try { await checkUpdates(); }
            finally { if (!update.IsDisposed) update.Enabled = true; }
        };
        body.Controls.Add(update);
        GroupAccountRows(aboutStart, "About Observatory");
        if (sourceSettings is null) { Label("Source settings are unavailable in this preview session."); return; }
        try { sourceOriginal ??= sourceSettings.Read().DeepClone().AsObject(); }
        catch { Label("Source settings could not be read. Existing configuration is preserved."); return; }
        sourceDraft ??= sourceOriginal.DeepClone().AsObject();
        var original = sourceOriginal;
        var draft = sourceDraft;
        Label("Choose what this PC collects. Provider sign-ins stay in their own apps.").ForeColor = Color.Silver;
        Label("Collection").Font = brand;
        var collection = new FlowLayoutPanel { FlowDirection = FlowDirection.TopDown, WrapContents = false, Height = 280, Width = ContentWidth - 32, BackColor = DashboardCard.Surface };
        collection.ClientSizeChanged += (_, _) => { foreach (Control toggle in collection.Controls) toggle.Width = collection.ClientSize.Width; };
        foreach (var (key, title) in new[] { ("activity", "ActivityWatch screen time"), ("codex", "Saved Codex usage and settings"), ("claude", "Recorded Claude Code requests"),
            ("wispr", "Wispr Flow statistics"), ("quota", "Online Codex account limits"), ("antigravity", "Online Antigravity account limits") })
        {
            var check = new DashboardToggle { Text = title, AccessibleName = key, Width = collection.Width,
                Checked = draft[key] is JsonValue value && value.TryGetValue<bool>(out var enabled) && enabled };
            draft[key] = check.Checked;
            check.CheckedChanged += (_, _) => draft[key] = check.Checked;
            collection.Controls.Add(check);
        }
        AddCard(collection, "Collection");
        Label("Claude Code reads local recorded request metadata only. It does not sign in, copy credentials, or report account billing.").ForeColor = Color.Silver;
        Label("Antigravity allowance reading is currently supported on Mac. Enabling it here shows Unknown without starting the CLI.").ForeColor = Color.Silver;
        var detailsStart = body.Controls.Count;
        Label("Source details").Font = brand;
        ActivityWatchHelp();
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
        Label("Ubuntu options may start WSL. No credentials are copied or switched.").ForeColor = Color.Silver;
        Label("Turning off account monitoring clears retained account readings on the next collection. Saved log-token history remains.").ForeColor = Color.Silver;
        GroupAccountRows(detailsStart, "Source details");
        var saveStart = body.Controls.Count;
        Label("Save changes").Font = brand;
        var status = Label("");
        var actions = new FlowLayoutPanel { Height = 48, WrapContents = true };
        var save = new DashboardButton { Text = "Save source settings", AccessibleName = "Save source settings", Width = 190 };
        save.Click += (_, _) =>
        {
            if (original["quota"]?.ToJsonString() == "true" && draft["quota"]?.ToJsonString() == "false" && !ConfirmSettings("quota-removal")) return;
            try
            {
                sourceSettings.Save(original, draft);
                original = draft.DeepClone().AsObject();
                sourceOriginal = original;
                status.Text = "Source settings saved. Availability is reported in Source health after collection.";
            }
            catch (InvalidOperationException error) { status.Text = error.Message; }
            catch { status.Text = "Settings could not be saved. Reload and check source configuration before retrying."; }
        };
        actions.Controls.Add(save);
        var reload = new DashboardButton { Text = "Reload saved settings", AccessibleName = "Reload saved settings", Width = 190 };
        reload.Click += (_, _) =>
        {
            if (!JsonNode.DeepEquals(sourceOriginal, sourceDraft) && !ConfirmSettings("discard")) return;
            sourceOriginal = null; sourceDraft = null; Reload();
        };
        actions.Controls.Add(reload);
        body.Controls.Add(actions);
        GroupAccountRows(saveStart, "Save changes");
        DeviceSettings();
    }
}
