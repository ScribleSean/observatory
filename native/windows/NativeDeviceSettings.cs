namespace WorkspaceObservatory;

internal sealed record DeviceSettingsActions(Func<bool> ReadStartup, Action<bool> SetStartup,
    Action PairingDetails, Func<Task> Disconnect, Func<Task> Repair);

internal sealed partial class NativeDashboard
{
    private readonly DeviceSettingsActions? deviceSettings;
    private bool deviceOperation;

    private void DeviceSettings()
    {
        if (deviceSettings is null) { Label("Device settings are unavailable in this preview session."); return; }
        Label("Start at login");
        var startupStatus = Label("");
        var startup = new Button { Height = 36, FlatStyle = FlatStyle.Flat, AccessibleName = "Toggle login startup" };
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
        Label("Registration is not proof of a successful login launch. Windows or organizational policy may disable startup.");
        Label("Direct device pairing");
        Label("Review Windows pairing details, then pair from the Mac using an existing trusted SSH connection. These controls do not enable SSH or automatically discover devices. Account-limit history is not synchronized yet.");
        var operationStatus = Label("");
        foreach (var (name, action) in new (string, Func<Task>)[] {
            ("Pairing details for Mac", () => { deviceSettings.PairingDetails(); return Task.CompletedTask; }),
            ("Disconnect paired device", deviceSettings.Disconnect),
            ("Prepare pairing repair", deviceSettings.Repair) })
        {
            var button = new Button { Text = name, AccessibleName = name, Height = 36, FlatStyle = FlatStyle.Flat, Enabled = !deviceOperation };
            button.Click += async (_, _) =>
            {
                if (deviceOperation) return;
                deviceOperation = true; button.Enabled = false;
                try { await action(); }
                catch { if (!operationStatus.IsDisposed) operationStatus.Text = "The operation could not be verified. Saved records were not deleted by this view."; }
                finally { deviceOperation = false; if (!button.IsDisposed) button.Enabled = true; }
            };
            body.Controls.Add(button);
        }
        Label("Disconnect and repair retain their confirmation steps. They act on this PC only. Review the result before changing the other device. Saved usage data is retained.");
    }
}
