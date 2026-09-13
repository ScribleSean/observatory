using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

// This window owns the setup helper and the collector reservation together.
internal sealed class DirectPairingWindow : Form
{
    private readonly TlsSetupProcess bridge;
    private readonly Action<bool> release;
    private readonly System.Windows.Forms.Timer poll = new() { Interval = 2000 };
    private readonly FlowLayoutPanel content = new() { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoScroll = true, Padding = new Padding(18) };
    private readonly TextBox address = new(), peerAddress = new(), port = new() { Text = "43128" }, peerPort = new() { Text = "43128" };
    private readonly TextBox invitation = new() { MaxLength = 2048 };
    private readonly CheckBox consent = new() { Text = "Allow a device identity stored in a permission-restricted file", AutoSize = true };
    private readonly CheckBox ubuntu = new() { Text = "Include Ubuntu Codex records on this PC", AutoSize = true };
    private readonly Label status = new() { AutoSize = true, MaximumSize = new Size(540, 0) };
    private readonly Label fingerprint = new() { AutoSize = true, MaximumSize = new Size(540, 0) };
    private readonly List<Button> actions = [];
    private string? pendingFingerprint;
    private bool busy, hosting, joining, polling, closing, closed;
    private int generation;
    private Task? shutdown;

    internal DirectPairingWindow(TlsSetupProcess bridge, Action<bool> release)
    {
        this.bridge = bridge; this.release = release;
        Text = "Direct device pairing"; ClientSize = new Size(620, 720); MinimumSize = new Size(580, 640);
        StartPosition = FormStartPosition.CenterScreen;
        Controls.Add(content);
        Note("Choose Host on one device and Join on the other. Use a local network or trusted VPN. Provider sign-in and allowance sharing remain separate.");
        content.Controls.Add(consent);
        Note("The key is not stored using DPAPI or encrypted separately by Observatory. A valid existing identity is reused.");
        Field("This PC's numeric private IP", address); Field("This PC's sync port", port);
        Field("Mac numeric private IP", peerAddress); Field("Mac sync port", peerPort);
        content.Controls.Add(ubuntu);
        ActionButton("Create invitation", Host);
        ActionButton("Confirm this device", ConfirmHost);
        Field("Private invitation", invitation);
        ActionButton("Copy invitation", () =>
        {
            if (hosting && invitation.Text.Length > 0) Clipboard.SetText(invitation.Text);
            return Task.CompletedTask;
        });
        Note("Share invitations privately. They expire within ten minutes. Clipboard managers may retain copied invitations.");
        ActionButton("Join with invitation", Join);
        ActionButton("Finish joining", () => joining ? Send(new() { ["action"] = "join-confirm", ["includeUbuntu"] = ubuntu.Checked }) : Task.CompletedTask);
        content.Controls.Add(fingerprint); content.Controls.Add(status);
        var cancel = new Button { Text = "Cancel setup", AutoSize = true };
        cancel.Click += async (_, _) =>
        {
            if (closing) return;
            var token = ++generation; busy = true; EnableActions();
            try { var reply = await bridge.Send(new() { ["action"] = "cancel" }); if (Current(token)) ApplyReply(reply); }
            catch { if (Current(token)) Failed(); }
            finally { if (Current(token)) { busy = false; EnableActions(); } }
        };
        content.Controls.Add(cancel);
        poll.Tick += async (_, _) =>
        {
            if (closing || busy || polling || !hosting) return;
            polling = true; var token = generation;
            try { var reply = await bridge.Send(new() { ["action"] = "status" }); if (Current(token)) ApplyReply(reply); }
            catch { if (Current(token)) Failed(); }
            finally { polling = false; }
        };
        poll.Start();
        FormClosing += async (_, e) =>
        {
            if (closed) return;
            e.Cancel = true;
            await Shutdown();
            if (!IsDisposed) Close();
        };
    }

    private void Note(string text) => content.Controls.Add(new Label { Text = text, AutoSize = true, MaximumSize = new Size(540, 0) });
    private void Field(string label, TextBox field)
    {
        Note(label); field.Width = 520; field.AccessibleName = label; content.Controls.Add(field);
    }
    private void ActionButton(string text, Func<Task> action)
    {
        var button = new Button { Text = text, AccessibleName = text, AutoSize = true };
        button.Click += async (_, _) => { if (busy || closing) return; try { await action(); } catch { if (!closing) Failed(); } };
        actions.Add(button); content.Controls.Add(button);
    }
    private bool Current(int token) => !closing && !IsDisposed && token == generation;
    private void EnableActions() { foreach (var button in actions) button.Enabled = !busy && !closing; }
    private void Failed() => status.Text = "Setup could not be verified. Close this window before retrying. Saved state was retained.";
    private static int ReadPort(TextBox field) => int.TryParse(field.Text, out var value) && value is >= 1024 and <= 65535 ? value : throw new ArgumentException("Invalid port.");

    private async Task Send(JsonObject command, bool identity = false)
    {
        if (busy || closing) return;
        busy = true; var token = ++generation; EnableActions();
        try
        {
            if (identity)
            {
                var ready = await bridge.Send(new() { ["action"] = "identity-status" });
                if (!Current(token)) return;
                if (ready.Status == "identity-required" && consent.Checked)
                    ready = await bridge.PrepareIdentity(true);
                if (!Current(token)) return;
                if (ready.Status != "identity-ready")
                {
                    status.Text = ready.Status == "identity-required" ? "Review and accept the identity storage policy first." : "Identity recovery is required. Existing files will not be replaced.";
                    return;
                }
            }
            var reply = await bridge.Send(command);
            if (Current(token)) ApplyReply(reply);
        }
        catch { if (Current(token)) Failed(); }
        finally { if (Current(token)) { busy = false; EnableActions(); } }
    }
    private Task Host()
    {
        if (hosting || joining) return Task.CompletedTask;
        _ = ReadPort(port);
        return Send(new() { ["action"] = "host-start", ["address"] = address.Text.Trim(), ["port"] = 0 }, true);
    }
    private Task ConfirmHost()
    {
        if (!hosting || pendingFingerprint is null) { status.Text = "Wait for the other device to claim this invitation."; return Task.CompletedTask; }
        return Send(new() { ["action"] = "host-confirm", ["peerCertificateSha256"] = pendingFingerprint,
            ["localEndpoint"] = new JsonObject { ["kind"] = "tls", ["address"] = address.Text.Trim(), ["port"] = ReadPort(port) },
            ["peerEndpoint"] = new JsonObject { ["kind"] = "tls", ["address"] = peerAddress.Text.Trim(), ["port"] = ReadPort(peerPort) },
            ["includeUbuntu"] = ubuntu.Checked });
    }
    private Task Join()
    {
        if (hosting || joining) return Task.CompletedTask;
        return Send(new() { ["action"] = "join-claim", ["invitation"] = invitation.Text.Trim() }, true);
    }
    private void ApplyReply(TlsSetupReply reply)
    {
        switch (reply.Status)
        {
            case "hosting": hosting = true; invitation.Text = reply.Invitation; status.Text = "Share the invitation privately with your Mac."; break;
            case "confirming": pendingFingerprint = reply.PeerCertificateSha256; status.Text = "A device claimed the invitation. Confirm only if you are pairing that device now."; break;
            case "awaiting-confirmation": joining = true; status.Text = "Confirm on the host, then choose Finish joining."; break;
            case "configuration-ready": pendingFingerprint = null; status.Text = "Configuration saved. Waiting for the other device to finish joining."; break;
            case "local-ready": status.Text = "Saved locally. Acknowledgement was not verified. Retry Finish joining."; break;
            case "acknowledged": pendingFingerprint = null; status.Text = "Setup acknowledged. Live data sync and source availability are not yet verified."; break;
            case "cancelled": hosting = joining = false; pendingFingerprint = null; invitation.Clear(); status.Text = "Setup cancelled. Saved state was retained."; break;
            case "inactive": status.Text = "Invitation inactive. Close and reopen setup to retry."; break;
            case "unavailable": status.Text = "Setup unavailable. Check addresses, source scope and existing pairing state."; break;
        }
        fingerprint.Text = pendingFingerprint is null ? "" : "Peer certificate: " + pendingFingerprint;
    }

    internal Task Shutdown() => shutdown ??= Stop();

    internal static void SelfTest(string node)
    {
        var runtime = Path.Combine(Path.GetTempPath(), "observatory-pairing-window-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(runtime);
        Exception? failure = null;
        try
        {
            using var collector = new Collector(runtime);
            collector.Configure(null, activity: false, codex: false);
            var release = collector.BeginDirectPairing();
            var bridge = new TlsSetupProcess(runtime, node, Path.Combine(AppContext.BaseDirectory, "Collector", "scripts", "peer-tls-control.mjs"));
            using var window = new DirectPairingWindow(bridge, release) { Opacity = 0, ShowInTaskbar = false };
            window.Shown += async (_, _) =>
            {
                try
                {
                    if (!collector.Busy || window.consent.Checked || window.hosting || window.joining)
                        throw new Exception("Opening setup changed consent or failed to reserve collection.");
                    await window.Send(new() { ["action"] = "host-start", ["address"] = "192.168.1.2", ["port"] = 0 }, true);
                    if (window.hosting || Directory.Exists(Path.Combine(runtime, "private-device-identity")))
                        throw new Exception("Setup created an identity without consent.");
                    await window.Shutdown(); await window.Shutdown();
                    if (!bridge.ExitVerified || collector.Busy) throw new Exception("Window cleanup did not stop its helper and release collection.");
                }
                catch (Exception error) { failure = error; }
                finally { await window.Shutdown(); window.Close(); }
            };
            Application.Run(window);
            if (failure is not null) throw failure;
        }
        finally { Directory.Delete(runtime, true); }
        Console.WriteLine("Native pairing window consent rejection, helper cleanup and collector release passed.");
    }

    private async Task Stop()
    {
        closing = true; generation++; poll.Stop(); poll.Dispose(); EnableActions();
        try { await bridge.DisposeAsync(); }
        catch { /* Preserve the pause when helper exit cannot be verified. */ }
        finally { release(bridge.ExitVerified); closed = true; }
    }
}
