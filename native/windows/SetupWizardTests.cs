using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

internal static class SetupWizardTests
{
    private static IEnumerable<Control> Descendants(Control root) => root.Controls.Cast<Control>().SelectMany(c => new[] { c }.Concat(Descendants(c)));
    private static void Check(bool value, string message) { if (!value) throw new InvalidOperationException(message); }
    internal static void Run(string output)
    {
        var runtime = Path.Combine(Path.GetTempPath(), "observatory-setup-ui-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(runtime);
        try
        {
            FirstRunSetup.Prepare(runtime);
            using var collector = new Collector(runtime);
            // Even enabled configuration cannot bypass the pending setup gate.
            collector.Configure(null, quota: true);
            collector.Refresh().GetAwaiter().GetResult();
            Check(!File.Exists(Path.Combine(runtime, "public/local/collector.json")), "Pending setup started collection.");
            using var form = new SetupWizard(runtime, collector);
            Exception? failure = null;
            void Capture(string name)
            {
                Check(Screen.FromControl(form).WorkingArea.Contains(form.Bounds), "Wizard is outside the screen.");
                foreach (var button in Descendants(form).OfType<Button>().Where(b => b.Visible))
                    Check(form.ClientRectangle.Contains(form.RectangleToClient(button.RectangleToScreen(button.ClientRectangle))), "Wizard navigation is outside its window.");
                using var bitmap = new Bitmap(form.Width, form.Height);
                form.DrawToBitmap(bitmap, new Rectangle(Point.Empty, form.Size));
                bitmap.Save(Path.Combine(output, name + ".png"));
            }
            Button Button(string title) => Descendants(form).OfType<Button>().Single(b => b.Text == title);
            CheckBox Option(string tag) => Descendants(form).OfType<CheckBox>().Single(c => Equals(c.Tag, tag));
            form.Shown += (_, _) => form.BeginInvoke(() =>
            {
                try
                {
                    Capture("setup-welcome");
                    Button("Continue").PerformClick();
                    Check(Descendants(form).OfType<CheckBox>().All(c => !c.Checked), "A source was enabled by default.");
                    Check(!Option("wsl").Enabled && !Option("account").Enabled, "Dependent choices were enabled without their source.");
                    Option("codex").Checked = true; Option("wsl").Checked = true;
                    Option("codex").Checked = false;
                    Check(!Option("wsl").Enabled && !Option("wsl").Checked, "Ubuntu log choice survived disabling Codex.");
                    Option("quota").Checked = true;
                    Check(Option("account").Enabled, "Account selection did not enable.");
                    Option("account").Checked = true;
                    Capture("setup-sources");
                    Button("Continue").PerformClick(); Button("Back").PerformClick();
                    Check(Option("quota").Checked && Option("account").Checked, "Back lost source choices.");
                    Button("Continue").PerformClick(); Capture("setup-devices");
                    Button("Finish on this PC").PerformClick();
                }
                catch (Exception error) { failure = error; form.Close(); }
            });
            form.ShowDialog();
            if (failure is not null) throw failure;
            Check(form.DialogResult == DialogResult.OK && FirstRunSetup.AllowsCollection(runtime), "Setup did not complete.");
            var config = JsonNode.Parse(File.ReadAllText(Path.Combine(runtime, "collector.config.json")))!;
            Check(config["quota"]!.GetValue<bool>() && config["quotaWslDistribution"]!.GetValue<string>() == "Ubuntu", "Selected account source was not saved.");
            Check(!config["activity"]!.GetValue<bool>() && !config["codex"]!.GetValue<bool>() && config["wslDistribution"] is null, "Unselected sources were enabled.");
            Check(!File.Exists(Path.Combine(runtime, "public/local/usage.json")), "Synthetic setup read real sources.");
            File.WriteAllText(Path.Combine(output, "setup-result.txt"), "setup-wizard: passed");
        }
        finally { Directory.Delete(runtime, true); }
    }
}
