using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

internal static class Program
{
    internal static bool UseNativeDashboard(string[] args) => !args.Contains("--legacy-dashboard");
    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--test-sharing-bridge")
        {
            try { QuotaSharing.BridgeSelfTest().GetAwaiter().GetResult(); }
            catch { Console.Error.WriteLine("Native sharing bridge failed."); Environment.ExitCode = 1; }
            return;
        }
        if (args.Contains("--self-test"))
        {
            try
            {
                Snapshot.SelfTest(); NativeHistory.SelfTest(); LoginStartup.SelfTest(); PairingDetails.SelfTest(); FirstRunSetup.SelfTest();
                InstallationGate.SelfTest();
                OperationDrain.SelfTest();
                Collector.ShutdownSelfTest();
                PowerResumeWindow.SelfTest();
                TailscaleReadiness.SelfTest();
                if (!UseNativeDashboard([]) || !UseNativeDashboard(["--background"]) || UseNativeDashboard(["--legacy-dashboard"]) ||
                    UseNativeDashboard(["--native-dashboard", "--legacy-dashboard"])) throw new InvalidOperationException("Dashboard launch mode contract failed.");
                Console.WriteLine("Native dashboard default and legacy fallback passed.");
            }
            catch (Exception error) { Console.Error.WriteLine(error.Message); Environment.ExitCode = 1; }
            return;
        }
        if (args.Contains("--test-pairing"))
        {
            try { PairingMaintenance.SelfTest(); }
            catch { Console.Error.WriteLine("Native pairing revocation self-test failed."); Environment.ExitCode = 1; }
            return;
        }
        if (args.Length == 2 && args[0] == "--collect-once")
        {
            if (!Path.IsPathFullyQualified(args[1]) || !Directory.Exists(args[1])) { Environment.ExitCode = 1; return; }
            using var installation = TryEnterInstallation();
            if (installation is null) { Environment.ExitCode = 1; return; }
            using var collector = new Collector(args[1]);
            collector.Refresh().GetAwaiter().GetResult();
            var state = Snapshot.Text(Snapshot.Read(Path.Combine(args[1], "public", "local", "collector.json"))?["state"]);
            Console.WriteLine(state);
            Environment.ExitCode = state is "ok" or "partial" ? 0 : 1;
            return;
        }
        ApplicationConfiguration.Initialize();
        if (args.Length == 2 && args[0] == "--test-native-dashboard")
        {
            if (!Path.IsPathFullyQualified(args[1]) || !Directory.Exists(args[1]) ||
                File.GetAttributes(args[1]).HasFlag(FileAttributes.ReparsePoint) || Directory.EnumerateFileSystemEntries(args[1]).Any())
            { Environment.ExitCode = 1; return; }
            NativeDashboardTests.Run(args[1]);
            return;
        }
        if (args.Length == 2 && args[0] == "--test-setup-wizard")
        {
            if (!Path.IsPathFullyQualified(args[1]) || !Directory.Exists(args[1]) ||
                File.GetAttributes(args[1]).HasFlag(FileAttributes.ReparsePoint)) { Environment.ExitCode = 1; return; }
            try { SetupWizardTests.Run(args[1]); }
            catch (Exception error) { Console.Error.WriteLine(error.Message); Environment.ExitCode = 1; }
            return;
        }
        if (args.Length == 2 && args[0] == "--test-usage-popup")
        {
            if (!Path.IsPathFullyQualified(args[1]) || !Directory.Exists(args[1]) ||
                File.GetAttributes(args[1]).HasFlag(FileAttributes.ReparsePoint) || Directory.EnumerateFileSystemEntries(args[1]).Any())
            { Environment.ExitCode = 1; return; }
            UsagePopupTests.Run(args[1]);
            return;
        }
        if (args.Length == 2 && args[0] == "--test-pairing-details")
        {
            if (!Path.IsPathFullyQualified(args[1]) || !Directory.Exists(args[1])) { Environment.ExitCode = 1; return; }
            try { PairingDetailsDialog.RunDialogTest(args[1]); }
            catch { Console.Error.WriteLine("Pairing details dialog failed."); Environment.ExitCode = 1; }
            return;
        }
        if (args.Length == 2 && args[0] is "--test-web" or "--test-first-run")
        {
            if (!Path.IsPathFullyQualified(args[1]) || !Directory.Exists(args[1])) { Environment.ExitCode = 1; return; }
            Application.Run(new Dashboard(args[1], smokeTest: true, firstRunTest: args[0] == "--test-first-run"));
            return;
        }
        using var installationGate = TryEnterInstallation();
        if (installationGate is null)
        {
            if (!args.Contains("--background")) MessageBox.Show("An installation or update is running, or its lock is unavailable. Try opening Observatory again when it finishes.", "Observatory update");
            Environment.ExitCode = 1;
            return;
        }
        using var singleton = new Mutex(true, "Local\\WorkspaceObservatory", out var first);
        // The singleton now prevents an installer from modifying this process's
        // files. Release the startup gate so existing-instance activation works.
        installationGate.Dispose();
        using var activation = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\WorkspaceObservatory.Open");
        if (!first)
        {
            if (!args.Contains("--background")) activation.Set();
            return;
        }
        Application.Run(new ObservatoryContext(activation, !args.Contains("--background"), UseNativeDashboard(args)));
    }

    private static InstallationGate? TryEnterInstallation()
    {
        try { return InstallationGate.TryEnter(); }
        catch (Exception error) when (error is UnauthorizedAccessException or IOException or WaitHandleCannotBeOpenedException)
        { return null; }
    }
}

internal sealed class ObservatoryContext : ApplicationContext
{
    private readonly string runtime = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Workspace Observatory");
    private readonly NotifyIcon tray;
    private readonly Collector collector;
    private readonly PowerResumeWindow powerNotifications;
    private readonly System.Windows.Forms.Timer activationTimer = new() { Interval = 200 };
    private Form? dashboard;
    private readonly bool nativeDashboard;
    private SetupWizard? setupWizard;
    private UsagePopup? usagePopup;
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 30000 };
    private bool quitting;

    internal ObservatoryContext(EventWaitHandle activation, bool show, bool nativeDashboard = true)
    {
        this.nativeDashboard = nativeDashboard;
        Directory.CreateDirectory(runtime);
        collector = new Collector(runtime);
        powerNotifications = new PowerResumeWindow(collector.RequestResumeRefresh);
        var setupPending = true;
        try { setupPending = FirstRunSetup.Prepare(runtime); }
        catch { MessageBox.Show("Setup state could not be read. Collection is paused and existing settings are preserved.", "Observatory setup"); }
        var menu = new ContextMenuStrip();
        menu.Items.Add("Open Observatory", null, (_, _) => Open());
        menu.Items.Add("Usage overview", null, (_, _) => ShowUsage());
        menu.Items.Add("Refresh sources", null, async (_, _) => await collector.Refresh());
        menu.Items.Add("Configure local collection", null, (_, _) => Configure());
        menu.Items.Add("Pairing details for Mac…", null, (_, _) => ShowPairingDetails());
        menu.Items.Add("Disconnect paired device…", null, async (_, _) => await DisconnectPairing());
        menu.Items.Add("Prepare pairing repair…", null, async (_, _) => await PreparePairingRepair());
        var startup = new ToolStripMenuItem("Register start at login");
        menu.Items.Add(startup);
        menu.Opening += (_, _) =>
        {
            try { startup.Checked = LoginStartup.Registered(); startup.Enabled = true; }
            catch { startup.Checked = false; startup.Enabled = false; }
        };
        startup.Click += (_, _) =>
        {
            try
            {
                LoginStartup.SetRegistered(!LoginStartup.Registered());
                startup.Checked = LoginStartup.Registered();
            }
            catch (Exception error) when (error is InvalidOperationException or ArgumentException)
            { MessageBox.Show(error.Message, "Login startup", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
            catch { MessageBox.Show("Windows could not update startup registration. Check your account permissions.", "Login startup", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
        };
        var totals = new ToolStripMenuItem("Latest recorded totals");
        foreach (var host in new[] { "All", "Mac", "Windows", "Ubuntu" })
            totals.DropDownItems.Add(host, null, (_, _) => ShowTotals(host));
        menu.Items.Add(totals);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Quit Observatory", null, async (_, _) => await RequestQuit());
        tray = new NotifyIcon { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application,
            Text = "Observatory", ContextMenuStrip = menu, Visible = true };
        tray.DoubleClick += (_, _) => Open();
        tray.MouseClick += (_, args) => { if (args.Button == MouseButtons.Left) ShowUsage(); };
        timer.Tick += (_, _) => RefreshStatus();
        timer.Start();
        RefreshStatus();
        collector.Changed += RefreshStatus;
        if (collector.Configured && !setupPending) collector.Start();
        activationTimer.Tick += (_, _) => { if (activation.WaitOne(0)) Open(); };
        activationTimer.Start();
        if (show || setupPending) Open();
    }

    private JsonObject? Data() => Snapshot.Read(Path.Combine(runtime, "public", "local", "usage.json"));
    private DeviceSettingsActions DeviceActions() => new(LoginStartup.Registered, LoginStartup.SetRegistered,
        ShowPairingDetails, DisconnectPairing, PreparePairingRepair, collector.Sharing, ReadNetwork: TailscaleReadiness.Read);

    private void ShowUsage()
    {
        if (usagePopup is not null && !usagePopup.IsDisposed) { usagePopup.Close(); return; }
        usagePopup = new UsagePopup(Data, collector.Refresh, Open);
        usagePopup.FormClosed += (_, _) => usagePopup = null;
        usagePopup.ShowNearTray();
    }

    private void ShowPairingDetails()
    {
        try
        {
            using var dialog = new PairingDetailsDialog(PairingDetails.FromInstallation(AppContext.BaseDirectory, runtime));
            dialog.ShowDialog();
        }
        catch { MessageBox.Show("Pairing details are unavailable for this installation. No settings were changed.", "Windows pairing details"); }
    }

    private async Task DisconnectPairing()
    {
        if (collector.Busy)
        {
            MessageBox.Show("A local operation is running. Try again when it finishes.", "Disconnect paired device");
            return;
        }
        if (!Directory.Exists(Path.Combine(runtime, "private-sync")))
        {
            MessageBox.Show("No private pairing state was found for this installation.", "Disconnect paired device");
            return;
        }
        var answer = MessageBox.Show("Disable pairing on this Windows PC only? Local collection continues and saved data is retained. A transfer already in flight may finish. Disconnect the other device separately. To reconnect, prepare pairing repair on both devices and pair again from the Mac.",
            "Disconnect paired device", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2);
        if (answer != DialogResult.Yes) return;
        try
        {
            await collector.DisconnectPairing();
            MessageBox.Show("Pairing is disabled on this PC. Saved data remains. The dashboard returns to local-only data after the next successful collection. Disconnect the other device separately; SSH access is unchanged.", "Pairing disabled");
            await collector.Refresh();
        }
        catch
        {
            MessageBox.Show("Disconnection could not be verified. Collection is paused for this session. Private state was not deleted, and pairing may already be disabled. Retry disconnection or quit the app until the pairing state can be inspected.",
                "Pairing needs attention", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    private async Task PreparePairingRepair()
    {
        if (collector.Busy)
        {
            MessageBox.Show("A local operation is running. Try again when it finishes.", "Prepare pairing repair");
            return;
        }
        var answer = MessageBox.Show("If this PC has pairing state, disable it and retain a private backup? Otherwise, confirm this PC is ready for repair. Nothing is deleted or sent. A transfer already in flight may finish. Confirm Prepare pairing repair on the Mac separately, then use Pair with Windows there to create fresh credentials. Retirement cannot be undone by this action.",
            "Prepare pairing repair", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2);
        if (answer != DialogResult.Yes) return;
        try
        {
            await collector.PreparePairingRepair();
            MessageBox.Show("This PC is ready for a new pairing. Any retired state remains in a disabled private backup. Prepare repair on the Mac separately, then choose Pair with Windows there. Local collection can continue. This action has not enabled a new pairing.", "Repair prepared");
            await collector.Refresh();
        }
        catch
        {
            MessageBox.Show("Repair preparation could not be verified. Collection is paused for this session. Saved state was not deleted, but it may already be retired. Retry or quit until this installation can be inspected. Do not restore old pairing files over a new pairing.",
                "Pairing needs attention", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    private void Configure()
    {
        if (!FirstRunSetup.AllowsCollection(runtime)) { Open(); return; }
        if (collector.Busy) { MessageBox.Show("Wait for the current collection to finish before changing sources.", "Source settings"); return; }
        if (dashboard is NativeDashboard existing) { existing.ShowSourceSettings(); return; }
        using var settings = new NativeDashboard(Data, collector.Refresh,
            new SourceSettingsActions(collector.ReadConfiguration, (expected, desired) => { collector.UpdateConfiguration(expected, desired); collector.Start(); }), DeviceActions());
        settings.ShowSourceSettings();
        settings.ShowDialog();
    }

    private void RefreshStatus()
    {
        usagePopup?.Reload();
        var stamp = Snapshot.Text(Data()?["collectedAt"], "");
        tray.Text = DateTimeOffset.TryParse(stamp, out var at)
            ? $"Observatory · updated {Math.Max(0, (int)(DateTimeOffset.UtcNow - at).TotalMinutes)}m ago"
            : "Observatory · waiting for first snapshot";
    }

    private void ShowTotals(string host)
    {
        var data = Data();
        var activity = Snapshot.Latest(data, "activity", host);
        var tokens = Snapshot.Latest(data, "tokens", host);
        var message = $"Active time: {Snapshot.Duration(Snapshot.Number(activity?["seconds"]))}\n" +
            $"Recorded date: {Snapshot.Text(activity?["date"])}\n\n" +
            $"Tokens: {Snapshot.Format(Snapshot.Number(tokens?["totalTokens"]))}\n" +
            $"Recorded date: {Snapshot.Text(tokens?["date"])}";
        if (host == "All") message += "\n\nOnly verified combined totals are shown. WSL screen time is part of Windows.";
        MessageBox.Show(message, $"Observatory · {host}", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    private void Open()
    {
        usagePopup?.Close();
        if (setupWizard is not null && !setupWizard.IsDisposed) { setupWizard.Activate(); return; }
        try
        {
            if (FirstRunSetup.Required(runtime))
            {
                using var setup = new SetupWizard(runtime, collector);
                setupWizard = setup;
                DialogResult result;
                try { result = setup.ShowDialog(); } finally { setupWizard = null; }
                if (result != DialogResult.OK) return;
                collector.Start();
            }
        }
        catch { MessageBox.Show("Setup state is unavailable. Collection remains paused.", "Observatory setup"); return; }
        if (dashboard is null || dashboard.IsDisposed)
        {
            dashboard = nativeDashboard ? new NativeDashboard(Data, collector.Refresh,
                new SourceSettingsActions(collector.ReadConfiguration, (expected, desired) => { collector.UpdateConfiguration(expected, desired); collector.Start(); }), DeviceActions()) : new Dashboard(runtime);
            dashboard.FormClosed += (_, _) => dashboard = null;
        }
        dashboard.Show();
        if (dashboard.WindowState == FormWindowState.Minimized) dashboard.WindowState = FormWindowState.Normal;
        dashboard.Activate();
    }

    private async Task RequestQuit()
    {
        if (quitting) return;
        quitting = true;
        try
        {
            tray.Text = "Observatory · finishing collection before quitting";
            if (!await collector.StopGracefully(TimeSpan.FromSeconds(260)))
            {
                MessageBox.Show("The current operation has not finished. Observatory stayed open and collection was not interrupted. Try quitting again after it finishes.", "Observatory is still working");
                return;
            }
            ExitThread();
        }
        finally { quitting = false; }
    }

    protected override void ExitThreadCore()
    {
        powerNotifications.Dispose();
        activationTimer.Stop(); activationTimer.Dispose();
        timer.Stop(); timer.Dispose(); collector.Dispose(); dashboard?.Close(); usagePopup?.Close(); tray.Visible = false; tray.Dispose();
        base.ExitThreadCore();
    }
}
