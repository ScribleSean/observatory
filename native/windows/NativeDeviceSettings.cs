namespace WorkspaceObservatory;

internal sealed record DeviceSettingsActions(Func<bool> ReadStartup, Action<bool> SetStartup,
    Action PairingDetails, Func<Task> Disconnect, Func<Task> Repair,
    Func<string, string?, Task<QuotaSharingStatus>>? Sharing = null, Func<bool>? ConfirmSharing = null,
    Func<Task<string>>? ReadNetwork = null, Action? DirectPair = null);

internal sealed partial class NativeDashboard
{
    private readonly DeviceSettingsActions? deviceSettings;
    private bool deviceOperation;

    private void DeviceConnectionCard()
    {
        var content = new Panel { Height = 140, BackColor = DashboardCard.Surface };
        var title = new Label { Text = "Device connection", Dock = DockStyle.Top, Height = 28 };
        var explanation = new Label { Text = "Review pairing details, then pair from the Mac over an existing trusted SSH connection. Credentials stay on their owning device.",
            AutoSize = true, MaximumSize = new Size(Math.Max(100, ContentWidth - 32), 0), Dock = DockStyle.Top };
        var actions = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 42, WrapContents = true };
        var status = new Label { Dock = DockStyle.Fill };
        if (deviceSettings is not null)
        {
            foreach (var (label, name, action) in new (string, string, Func<Task>)[] {
                ("Pairing details", "Pairing details for Mac", () => { deviceSettings.PairingDetails(); return Task.CompletedTask; }),
                ("Disconnect…", "Disconnect paired device", deviceSettings.Disconnect),
                ("Repair…", "Prepare pairing repair", deviceSettings.Repair) })
            {
                var button = new DashboardButton { Text = label, AccessibleName = name, Width = 130, Height = 40, Enabled = !deviceOperation };
                button.FlatAppearance.BorderSize = 0;
                button.Click += async (_, _) =>
                {
                    if (deviceOperation) return;
                    deviceOperation = true; button.Enabled = false;
                    try { await action(); }
                    catch { if (!status.IsDisposed) status.Text = "Operation not verified. Saved records were not deleted by this view."; }
                    finally { deviceOperation = false; if (!button.IsDisposed) button.Enabled = true; }
                };
                actions.Controls.Add(button);
            }
        }
        else status.Text = "Device controls are unavailable in this preview.";
        content.Controls.Add(status); content.Controls.Add(actions); content.Controls.Add(explanation); content.Controls.Add(title);
        content.ClientSizeChanged += (_, _) =>
        {
            explanation.MaximumSize = new Size(Math.Max(100, content.ClientSize.Width), 0);
            var textHeight = TextRenderer.MeasureText(explanation.Text, explanation.Font,
                new Size(Math.Max(100, content.ClientSize.Width), int.MaxValue), TextFormatFlags.WordBreak).Height + 8;
            explanation.Height = Math.Max(40, textHeight);
            if (content.Parent is DashboardCard card) card.Height = 32 + title.Height + explanation.Height + actions.Height + 30;
        };
        AddCard(content, "Device connection");
    }

    private void DeviceSettings()
    {
        if (deviceSettings is null) { Label("Device settings are unavailable in this preview session."); return; }
        var groupStart = body.Controls.Count;
        Label("Start at login").Font = brand;
        var startupStatus = Label("");
        var startup = new DashboardButton { Height = 40, AccessibleName = "Toggle login startup" };
        void ReadStartup()
        {
            try
            {
                var registered = deviceSettings.ReadStartup();
                startupStatus.Text = registered ? "This installation is registered to start in the system tray at login." : "This installation is not registered to start at login.";
                startup.Text = registered ? "Disable start at login" : "Enable start at login";
                startup.Enabled = true;
            }
            catch { startupStatus.Text = "Startup registration is unknown. No change was made."; startup.Text = "Startup unavailable"; startup.Enabled = false; }
        }
        ReadStartup();
        startup.Click += (_, _) =>
        {
            try { deviceSettings.SetStartup(!deviceSettings.ReadStartup()); ReadStartup(); }
            catch { startupStatus.Text = "Startup could not be updated. Check Windows permissions or another installation's registration."; }
        };
        body.Controls.Add(startup);
        Label("Registration is not proof of a successful login launch. Windows or organizational policy may disable startup.").ForeColor = Color.Silver;
        GroupAccountRows(groupStart, "Start at login");
        groupStart = body.Controls.Count;
        Label("Direct device pairing").Font = brand;
        if (deviceSettings.DirectPair is not null)
        {
            var pair = new DashboardButton { Text = "Direct device pairing…", AccessibleName = "Direct device pairing", Height = 40 };
            pair.Click += (_, _) => deviceSettings.DirectPair();
            body.Controls.Add(pair);
        }
        if (deviceSettings.ReadNetwork is not null)
        {
            var networkStatus = Label("Optional VPN connection. Tailscale has not been checked.");
            var networkCheck = new DashboardButton { Text = "Check Tailscale", AccessibleName = "Check Tailscale", Height = 40 };
            networkCheck.Click += async (_, _) =>
            {
                networkCheck.Enabled = false;
                try { var message = await deviceSettings.ReadNetwork(); if (!networkStatus.IsDisposed) networkStatus.Text = message; }
                catch { if (!networkStatus.IsDisposed) networkStatus.Text = TailscaleReadiness.Messages["unavailable"]; }
                finally { if (!networkCheck.IsDisposed) networkCheck.Enabled = true; }
            };
            body.Controls.Add(networkCheck);
            var guide = new LinkLabel { Text = "Tailscale setup guide", AutoSize = true, AccessibleName = "Open official Tailscale setup guide",
                LinkColor = Color.LightSkyBlue, ActiveLinkColor = Color.White, VisitedLinkColor = Color.LightSkyBlue };
            guide.LinkClicked += (_, _) =>
            {
                try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("https://tailscale.com/docs/install") { UseShellExecute = true }); }
                catch { if (!networkStatus.IsDisposed) networkStatus.Text = "The setup guide could not be opened. Visit tailscale.com/docs/install in your browser."; }
            };
            body.Controls.Add(guide);
            Label("Sign in through Tailscale. This check does not pair devices, enable SSH or change sharing consent. Use Direct device pairing to exchange an invitation.").ForeColor = Color.Silver;
        }
        Label("Disconnect and repair retain their confirmation steps. They act on this PC only. Review the result before changing the other device. Saved usage data is retained.").ForeColor = Color.Silver;
        GroupAccountRows(groupStart, "Direct device pairing");
        SharingSettings();
    }

    private void SharingSettings()
    {
        if (deviceSettings?.Sharing is null) return;
        var groupStart = body.Controls.Count;
        Label("Allowance history sharing").Font = brand;
        Label("Optional. Both devices must enable sharing. Exchanges include allowance percentages, observation times and dated account token totals, not sign-in credentials. Accounts on different devices are not assumed to be the same.").ForeColor = Color.Silver;
        var status = Label("Check sharing status to review this device's consent.");
        var check = new DashboardButton { Text = "Check sharing status", AccessibleName = "Check sharing status", Height = 40 };
        var toggle = new DashboardButton { Text = "Sharing unavailable", AccessibleName = "Change allowance sharing", Height = 40, Enabled = false };
        QuotaSharingStatus? current = null;
        void Show(QuotaSharingStatus next)
        {
            if (status.IsDisposed || toggle.IsDisposed) return;
            current = next;
            status.Text = next.Enabled ? "Sharing is enabled for this account and paired device. This is consent, not proof of a completed exchange." :
                next.Reason == "pairing-unavailable" ? "Sharing is off. Pair this device first." :
                next.CanEnable ? "Sharing is off. A recent account reading is available." : "Sharing is off. Enable account monitoring and refresh the account before sharing.";
            toggle.Text = next.Enabled ? "Disable allowance sharing" : "Enable allowance sharing";
            toggle.Enabled = next.Enabled || next.CanEnable;
        }
        async Task Run(string action, string? token)
        {
            if (deviceOperation) return;
            deviceOperation = true; check.Enabled = false; toggle.Enabled = false;
            try { Show(await deviceSettings.Sharing(action, token)); }
            catch
            {
                current = null;
                if (!status.IsDisposed) status.Text = "Sharing could not be verified. Refresh status before retrying. A setting change may already have completed.";
            }
            finally { deviceOperation = false; if (!check.IsDisposed) check.Enabled = true; }
        }
        check.Click += async (_, _) => await Run("status", null);
        toggle.Click += async (_, _) =>
        {
            if (deviceOperation || current is null) return;
            if (!current.Enabled)
            {
                var confirmed = deviceSettings.ConfirmSharing?.Invoke() ?? MessageBox.Show(this,
                    "Share this account's allowance history and dated token totals with the paired device? Credentials stay here. Enable sharing on the other device separately. Account changes revoke this consent.",
                    "Enable allowance sharing", MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) == DialogResult.Yes;
                if (!confirmed) return;
            }
            await Run(current.Enabled ? "disable" : "enable", current.Enabled ? null : current.Token);
        };
        body.Controls.Add(check); body.Controls.Add(toggle);
        GroupAccountRows(groupStart, "Allowance history sharing");
    }
}
