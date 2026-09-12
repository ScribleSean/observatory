namespace WorkspaceObservatory;

internal sealed class SetupWizard : Form
{
    private readonly Collector collector;
    private readonly string runtime;
    private readonly Dictionary<string, bool> selected = new() { ["activity"] = false, ["codex"] = false, ["wispr"] = false, ["typewhisper"] = false, ["quota"] = false, ["wsl"] = false };
    private readonly FlowLayoutPanel content = new() { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoScroll = true, Padding = new Padding(24) };
    private readonly Button next = new() { Text = "Continue", AutoSize = true };
    private readonly Button back = new() { Text = "Back", AutoSize = true };
    private int step;
    private bool ubuntuAccount;

    internal SetupWizard(string runtime, Collector collector)
    {
        this.runtime = runtime; this.collector = collector;
        Text = "Set up Observatory"; ClientSize = new Size(620, 520);
        Font = new Font("Segoe UI", 10); StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false; MinimizeBox = false;
        var footer = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 58, FlowDirection = FlowDirection.RightToLeft, Padding = new Padding(12) };
        footer.Controls.Add(next); footer.Controls.Add(back); Controls.Add(content); Controls.Add(footer);
        next.Click += (_, _) => Advance(); back.Click += (_, _) => { step--; Render(); };
        AcceptButton = next; Render();
    }
    private void Paragraph(string text, bool heading = false)
    {
        content.Controls.Add(new Label { Text = text, AutoSize = true, MaximumSize = new Size(550, 0), Margin = new Padding(0, 0, 0, 16),
            Font = heading ? new Font(Font.FontFamily, 20, FontStyle.Bold) : Font });
    }
    private void Render()
    {
        foreach (var control in content.Controls.Cast<Control>().ToArray()) control.Dispose();
        back.Visible = step > 0; next.Text = step == 2 ? "Finish on this PC" : "Continue";
        Paragraph($"Step {step + 1} of 3");
        Paragraph(new[] { "Welcome to Observatory", "Choose what to collect", "Connect your devices" }[step], true);
        if (step == 0)
        {
            Paragraph("Collection stays off until you finish setup. Choose the sources you want to read on this PC.");
            Paragraph("Dashboard snapshots exclude prompts, window titles, transcripts, audio and credentials. Provider sign-ins stay on their owning device.");
            Paragraph("This release uses direct encrypted device pairing, without an Observatory account or hosted sync service.");
        }
        else if (step == 1)
        {
            foreach (var (key, title) in new[] { ("activity", "ActivityWatch screen time"), ("codex", "Saved Codex usage and settings"), ("wispr", "Wispr Flow statistics"), ("typewhisper", "TypeWhisper aggregate statistics"), ("wsl", "Include Ubuntu WSL records with saved Codex"), ("quota", "Codex account limits online") })
            {
                var check = new CheckBox { Text = title, Tag = key, Checked = selected[key], AutoSize = true, Margin = new Padding(0, 0, 0, 8), Enabled = key != "wsl" || selected["codex"] };
                check.CheckedChanged += (_, _) =>
                {
                    selected[key] = check.Checked;
                    if (key == "codex")
                    {
                        var wsl = content.Controls.OfType<CheckBox>().FirstOrDefault(item => Equals(item.Tag, "wsl"));
                        if (wsl is not null) { wsl.Enabled = check.Checked; if (!check.Checked) wsl.Checked = false; }
                    }
                    if (key == "quota")
                    {
                        var source = content.Controls.OfType<CheckBox>().FirstOrDefault(item => Equals(item.Tag, "account"));
                        if (source is not null) source.Enabled = check.Checked;
                    }
                };
                content.Controls.Add(check);
            }
            var account = new CheckBox { Text = "Use Ubuntu's Codex account instead of Windows", Tag = "account", Checked = ubuntuAccount, AutoSize = true, Enabled = selected["quota"] };
            account.CheckedChanged += (_, _) => ubuntuAccount = account.Checked;
            content.Controls.Add(account);
            Paragraph("Sources need their installed applications and records. Ubuntu options may start WSL. Online monitoring uses that selected client's existing sign-in, with no credential copying or fallback to another account. Enabling a source does not prove it is available.");
        }
        else
        {
            Paragraph("Pair from the Mac using this PC's pairing details, available in the system-tray menu after setup. Review the destination and shared-data scope before confirming.");
            Paragraph("The current connection requires an existing SSH alias, trusted host key and key-based sign-in. Automatic discovery is not available yet. Account-limit history is not synchronized.");
            Paragraph("Finish here to use this PC alone or pair later. Finishing setup does not claim a device is connected.");
        }
    }
    private void Advance()
    {
        if (step < 2) { step++; Render(); return; }
        try
        {
            FirstRunSetup.Complete(runtime, () => collector.Configure(selected["wsl"] ? "Ubuntu" : null, selected["wispr"], selected["quota"],
                selected["quota"] && ubuntuAccount ? "Ubuntu" : null, selected["activity"], selected["codex"], selected["typewhisper"]));
            DialogResult = DialogResult.OK; Close();
        }
        catch { MessageBox.Show("Setup could not be saved. Collection remains paused. Check local storage and try again.", "Setup incomplete"); }
    }
}
