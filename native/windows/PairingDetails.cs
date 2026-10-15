using System.Text.Json;
using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

internal sealed record PairingDetails(string Node, string Script, string Runtime, bool ToolsPresent)
{
    internal static PairingDetails FromInstallation(string installation, string runtime)
    {
        var node = Path.GetFullPath(Path.Combine(installation, "Runtime", "node.exe"));
        var script = Path.GetFullPath(Path.Combine(installation, "Collector", "scripts", "peer-exchange.mjs"));
        var endpoint = Path.Combine(installation, "Collector", "scripts", "peer-setup-endpoint.mjs");
        var root = Path.GetFullPath(runtime);
        foreach (var value in new[] { node, script, root })
            if (value.Length > 1024 || value.Length < 3 || !char.IsAsciiLetter(value[0]) || value[1] != ':' ||
                value[2] is not ('\\' or '/') || value.Skip(2).Contains(':') || value.Any(c => c < 32 || c == 127))
                throw new InvalidOperationException("Unsupported installation path.");
        return new(node, script, root, File.Exists(node) && File.Exists(script) && File.Exists(endpoint) && Directory.Exists(root));
    }

    internal string Export()
    {
        if (!ToolsPresent) throw new InvalidOperationException("Bundled pairing tools are unavailable.");
        return new JsonObject { ["version"] = 1, ["kind"] = "windows-installation",
            ["remoteNode"] = Node, ["remoteScript"] = Script, ["remoteRuntime"] = Runtime }
            .ToJsonString(new JsonSerializerOptions { WriteIndented = true });
    }

    internal static void SelfTest()
    {
        var fixture = new PairingDetails("C:/Fixture/Runtime/node.exe", "C:/Fixture/Collector/scripts/peer-exchange.mjs", "C:/Fixture/Data", true);
        var parsed = JsonNode.Parse(fixture.Export())!.AsObject();
        if (parsed.Count != 5 || parsed["version"]!.GetValue<int>() != 1 ||
            parsed["kind"]!.GetValue<string>() != "windows-installation" || parsed["remoteNode"]!.GetValue<string>() != fixture.Node ||
            parsed["remoteScript"]!.GetValue<string>() != fixture.Script || parsed["remoteRuntime"]!.GetValue<string>() != fixture.Runtime)
            throw new InvalidOperationException("Pairing details contract failed.");
        var refused = false;
        try { (fixture with { ToolsPresent = false }).Export(); }
        catch (InvalidOperationException) { refused = true; }
        if (!refused) throw new InvalidOperationException("Unavailable tools must not produce copyable details.");
        var root = Path.Combine(Path.GetTempPath(), "observatory-details-" + Guid.NewGuid().ToString("N"));
        try
        {
            Directory.CreateDirectory(Path.Combine(root, "Runtime"));
            Directory.CreateDirectory(Path.Combine(root, "Collector", "scripts"));
            if (FromInstallation(root, root).ToolsPresent) throw new InvalidOperationException("Missing tools reported present.");
            foreach (var file in new[] { "Runtime/node.exe", "Collector/scripts/peer-exchange.mjs", "Collector/scripts/peer-setup-endpoint.mjs" })
                File.WriteAllText(Path.Combine(root, file), "synthetic presence check");
            var paths = FromInstallation(root, root);
            if (!paths.ToolsPresent || paths.Node != Path.Combine(root, "Runtime", "node.exe") ||
                paths.Script != Path.Combine(root, "Collector", "scripts", "peer-exchange.mjs") || paths.Runtime != root)
                throw new InvalidOperationException("Installation paths were not derived exactly.");
            if (Directory.Exists(Path.Combine(root, "private-sync"))) throw new InvalidOperationException("Details created pairing state.");
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
        Console.WriteLine("Pairing details contract passed.");
    }
}

internal sealed class PairingDetailsDialog : Form
{
    private readonly Button copy = new() { Text = "Copy Windows details", AutoSize = true };
    private readonly Label status = new() { AutoSize = true };
    private readonly Action<string> copyText;
    private readonly PairingDetails details;

    internal PairingDetailsDialog(PairingDetails details, Action<string>? copyText = null)
    {
        this.details = details;
        this.copyText = copyText ?? Clipboard.SetText;
        Text = "Windows pairing details";
        ClientSize = new Size(690, 360);
        MinimumSize = new Size(560, 370);
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi;
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(16), ColumnCount = 1, RowCount = 9 };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        var help = new Label { AutoSize = true, Text = "On your Mac, choose Pair with Windows and Paste Windows details. Enter an existing SSH alias separately. Copying these paths does not enable SSH, sources or pairing." };
        layout.Controls.Add(help, 0, 0);
        var values = new[] { ("Bundled Node executable", details.Node), ("Exchange script", details.Script), ("App data directory", details.Runtime) };
        for (var i = 0; i < values.Length; i++)
        {
            layout.Controls.Add(new Label { Text = values[i].Item1, AutoSize = true, Margin = new Padding(0, 10, 0, 3) }, 0, 1 + i * 2);
            layout.Controls.Add(new TextBox { Text = values[i].Item2, ReadOnly = true, Dock = DockStyle.Top, AccessibleName = values[i].Item1 }, 0, 2 + i * 2);
        }
        status.Text = details.ToolsPresent ? "Copied paths may include your Windows username. No keys or usage records are included."
            : "Bundled pairing tools or the app data directory are missing. Update the app before pairing.";
        status.Margin = new Padding(0, 12, 0, 8);
        layout.Controls.Add(status, 0, 7);
        var actions = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.RightToLeft, Dock = DockStyle.Fill };
        var close = new Button { Text = "Close", AutoSize = true, DialogResult = DialogResult.Cancel };
        copy.Enabled = details.ToolsPresent;
        copy.Click += (_, _) => CopyDetails();
        actions.Controls.Add(close);
        actions.Controls.Add(copy);
        layout.Controls.Add(actions, 0, 8);
        layout.SizeChanged += (_, _) => { help.MaximumSize = new Size(Math.Max(100, layout.ClientSize.Width - 38), 0); status.MaximumSize = help.MaximumSize; };
        AcceptButton = close;
        CancelButton = close;
        Controls.Add(layout);
    }

    private void CopyDetails()
    {
        try { copyText(details.Export()); status.Text = "Copied. Transfer the text to your Mac using a method you trust, then choose Paste Windows details."; }
        catch { status.Text = "Could not copy details. The clipboard may be busy. Try again. No pairing was requested."; }
    }

    internal static void RunDialogTest(string testRuntime)
    {
        var fixture = new PairingDetails("C:/Fixture/Runtime/node.exe", "C:/Fixture/Collector/scripts/peer-exchange.mjs", "C:/Fixture/Data", true);
        string? copied = null;
        using var dialog = new PairingDetailsDialog(fixture, value => copied = value);
        using var unavailable = new PairingDetailsDialog(fixture with { ToolsPresent = false }, _ => throw new InvalidOperationException());
        if (unavailable.copy.Enabled) throw new InvalidOperationException("Copy is enabled without pairing tools.");
        if (copied != null) throw new InvalidOperationException("Opening details copied unexpectedly.");
        dialog.Shown += (_, _) => dialog.BeginInvoke((Action)(() =>
        {
            try
            {
                dialog.copy.PerformClick();
                if (copied != fixture.Export()) throw new InvalidOperationException("Explicit copy did not export the expected details.");
                dialog.PerformLayout();
                using var capture = new Bitmap(dialog.Width, dialog.Height);
                dialog.DrawToBitmap(capture, new Rectangle(0, 0, dialog.Width, dialog.Height));
                capture.Save(Path.Combine(testRuntime, "pairing-details.png"));
                File.WriteAllText(Path.Combine(testRuntime, "windows-details.json"), copied);
                Console.WriteLine("Pairing details dialog passed with a synthetic clipboard.");
            }
            catch { Environment.ExitCode = 1; }
            finally { dialog.Close(); }
        }));
        Application.Run(dialog);
    }
}
