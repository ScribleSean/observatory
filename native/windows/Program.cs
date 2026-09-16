using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

internal static class Program
{
    internal static bool UseNativeDashboard(string[] args) => !args.Contains("--legacy-dashboard");
    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Contains("--test-update-trust"))
        {
            if (args.Length != 2 || args[0] != "--test-update-trust") { Environment.ExitCode = 64; return; }
            try
            {
                var trust = UpdateTrust.ReadEmbedded();
                if (args[1] == "none" ? trust is not null : trust?.PublicKey != args[1])
                    throw new IOException("Embedded update trust does not match the expected release configuration.");
                Console.WriteLine("Embedded update trust matches the expected release configuration.");
            }
            catch { Environment.ExitCode = 1; }
            return;
        }
        if (args.Contains("--test-update-receipt-store"))
        {
            if (args.Length != 7 || args[0] != "--test-update-receipt-store" ||
                !long.TryParse(args[4], System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var previousBuild))
            { Environment.ExitCode = 64; return; }
            try
            {
                var result = UpdateReceiptStore.Persist(args[1], args[2], args[3], previousBuild, args[5], args[6]).GetAwaiter().GetResult();
                Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new { envelopePath = result }));
            }
            catch (Exception error) { Console.Error.WriteLine("Installed receipt was not published. " + error.Message); Environment.ExitCode = 1; }
            return;
        }
        if (args.Contains("--test-installed-update-state"))
        {
            if (args.Length != 5 || args[0] != "--test-installed-update-state" ||
                !long.TryParse(args[4], System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var expectedBuild))
            { Environment.ExitCode = 64; return; }
            try
            {
                var result = UpdateInstalledState.Verify(args[1], args[2], args[3], expectedBuild).GetAwaiter().GetResult();
                Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(result));
            }
            catch (Exception error) { Console.Error.WriteLine("Installed update state was not verified. " + error.Message); Environment.ExitCode = 1; }
            return;
        }
        if (args.Contains("--test-update-download-preparation"))
        {
            if (args.Length != 7 || args[0] != "--test-update-download-preparation" ||
                !long.TryParse(args[5], System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var previousBuild))
            { Environment.ExitCode = 64; return; }
            try
            {
                // Preparation only. No helper, candidate or installed app runs.
                var result = UpdateDownload.Prepare(args[1], args[2], args[3], args[4], previousBuild, args[6])
                    .GetAwaiter().GetResult();
                Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(result));
            }
            catch (Exception error) { Console.Error.WriteLine("Synthetic download preparation failed. No helper was launched. " + error.Message); Environment.ExitCode = 1; }
            return;
        }
        if (args.Contains("--apply-update"))
        {
            if (args.Length != 6 || args[0] != "--apply-update" ||
                !long.TryParse(args[5], System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var previousBuild) ||
                previousBuild < 1 || previousBuild > 9007199254740991L)
            { Environment.ExitCode = 64; return; }
            try
            {
                var trust = UpdateTrust.ReadEmbedded()
                    ?? throw new IOException("Release update trust is not configured.");
                var result = UpdateInstall.ApplyAndRelaunch(args[1], args[2], args[3], args[4], trust.PublicKey, previousBuild)
                    .GetAwaiter().GetResult();
                if (!result.LaunchConfirmed) Environment.ExitCode = 1;
            }
            catch { Console.Error.WriteLine("Update did not complete. Inspect retained recovery before retrying."); Environment.ExitCode = 1; }
            return;
        }
        if (args.Contains("--test-updater-lifecycle"))
        {
            if (args.Length != 2 || args[0] != "--test-updater-lifecycle") { Environment.ExitCode = 64; return; }
            try
            {
                using var library = new WinSparkleLibrary(args[1]);
                library.CheckIsolatedLifecycle();
                Console.WriteLine("Synthetic manual-only updater initialization and retained shutdown passed. No update check requested.");
            }
            catch { Console.Error.WriteLine("Updater lifecycle test failed."); Environment.ExitCode = 1; }
            return;
        }
        if (args.Contains("--test-updater-library"))
        {
            if (args.Length != 2 || args[0] != "--test-updater-library") { Environment.ExitCode = 64; return; }
            try
            {
                using var library = new WinSparkleLibrary(args[1]);
                try
                {
                    using var duplicate = new WinSparkleLibrary(args[1]);
                    throw new IOException("Duplicate updater ownership was accepted.");
                }
                catch (InvalidOperationException) { }
                Task.Run(() =>
                {
                    try { library.Dispose(); throw new IOException("Cross-thread updater disposal was accepted."); }
                    catch (InvalidOperationException) { }
                    try { library.CheckBindings(); throw new IOException("Cross-thread updater configuration was accepted."); }
                    catch (InvalidOperationException) { }
                }).GetAwaiter().GetResult();
                library.CheckBindings();
                library.Dispose();
                try { library.CheckBindings(); throw new IOException("Disposed updater accepted configuration."); }
                catch (ObjectDisposedException) { }
                using var replacement = new WinSparkleLibrary(args[1]);
                replacement.CheckBindings();
                Console.WriteLine("Pinned updater library ownership, exports and synthetic public-key binding passed. Updater not initialized.");
            }
            catch { Console.Error.WriteLine("Updater library binding test failed."); Environment.ExitCode = 1; }
            return;
        }
        if (args.Contains("--test-update-install"))
        {
            if (Environment.GetEnvironmentVariable("GITHUB_ACTIONS") != "true" ||
                Environment.GetEnvironmentVariable("RUNNER_ENVIRONMENT") != "github-hosted" ||
                args.Length != 7 || args[0] != "--test-update-install" ||
                !long.TryParse(args[6], System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var previousBuild))
            { Environment.ExitCode = 64; return; }
            try
            {
                var result = UpdateInstall.ApplyAndRelaunch(args[1], args[2], args[3], args[4], args[5], previousBuild).GetAwaiter().GetResult();
                if (!result.LaunchConfirmed) throw new IOException("Updated application launch was not confirmed.");
                if (UpdateQuit.Request("Local\\WorkspaceObservatory", UpdateQuit.RequestName, TimeSpan.FromSeconds(30)) != UpdateQuit.Result.Stopped)
                    throw new IOException("Updated application did not quit normally.");
                Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new { status = "installed-relaunched-and-stopped", result.SourceRevision, result.Recovery }));
            }
            catch (Exception error) { Console.Error.WriteLine("Synthetic update installation test failed: " + error.Message); Environment.ExitCode = 1; }
            return;
        }
        if (args.Contains("--test-update-ready"))
        {
            Environment.ExitCode = args.Length == 2 && args[0] == "--test-update-ready" && UpdateReady.Signal(args[1]) ? 0 : 1;
            return;
        }
        string? updateReady = null;
        if (args.Contains("--update-ready"))
        {
            if (args.Length != 2 || args[0] != "--update-ready" || !UpdateReady.Valid(args[1]))
            { Environment.ExitCode = 64; return; }
            updateReady = args[1];
        }
        if (args.Contains("--test-update-activation"))
        {
            if (Environment.GetEnvironmentVariable("GITHUB_ACTIONS") != "true" ||
                Environment.GetEnvironmentVariable("RUNNER_ENVIRONMENT") != "github-hosted" ||
                args.Length != 7 || args[0] != "--test-update-activation" ||
                !long.TryParse(args[6], System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var previousBuild))
            { Environment.ExitCode = 64; return; }
            var testRegistration = @"Software\ObservatoryUpdateActivationTest-" + Guid.NewGuid().ToString("N");
            using var testHive = Microsoft.Win32.RegistryKey.OpenBaseKey(Microsoft.Win32.RegistryHive.CurrentUser, Microsoft.Win32.RegistryView.Registry64);
            try
            {
                using (var key = testHive.CreateSubKey(testRegistration))
                {
                    key.SetValue("InstallLocation", args[1]);
                    key.SetValue("UninstallString", '"' + Path.Combine(args[1], "Uninstall.exe") + '"');
                    key.SetValue("DisplayVersion", "0.0.0");
                    key.SetValue("Unrelated", 47, Microsoft.Win32.RegistryValueKind.DWord);
                }
                var result = UpdateActivation.Apply(args[1], args[2], args[3], args[4], args[5], previousBuild, testRegistration).GetAwaiter().GetResult();
                using var check = testHive.OpenSubKey(testRegistration)!;
                var version = System.Diagnostics.FileVersionInfo.GetVersionInfo(Path.Combine(args[1], "WorkspaceObservatory.exe"));
                if ((string?)check.GetValue("DisplayVersion") != $"{version.FileMajorPart}.{version.FileMinorPart}.{version.FileBuildPart}" ||
                    (int)check.GetValue("Unrelated")! != 47 || check.ValueCount != 4)
                    throw new IOException("Activation registration preservation failed.");
                Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new { status = "payload-replaced", sourceRevision = result.SourceRevision }));
            }
            catch { Console.Error.WriteLine("Update activation failed. Recovery inspection may be required."); Environment.ExitCode = 1; }
            finally { testHive.DeleteSubKeyTree(testRegistration, throwOnMissingSubKey: false); }
            return;
        }
        if (args.Contains("--test-update-staging"))
        {
            if (Environment.GetEnvironmentVariable("GITHUB_ACTIONS") != "true" ||
                Environment.GetEnvironmentVariable("RUNNER_ENVIRONMENT") != "github-hosted" ||
                args.Length != 6 || args[0] != "--test-update-staging" ||
                !long.TryParse(args[5], System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var previousBuild))
            { Environment.ExitCode = 64; return; }
            try
            {
                var result = UpdateStaging.Stage(args[1], args[2], args[3], args[4], previousBuild).GetAwaiter().GetResult();
                Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new { schema = 1, status = "payload-staged",
                    staged = result.Staged, envelopePath = result.EnvelopePath,
                    sourceRevision = result.SourceRevision, buildNumber = result.BuildNumber }));
            }
            catch { Console.Error.WriteLine("Synthetic update staging failed. No update was activated."); Environment.ExitCode = 1; }
            return;
        }
        if (args.Contains("--test-update-candidate"))
        {
            if (args.Length != 5 || args[0] != "--test-update-candidate" ||
                !long.TryParse(args[4], System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var previousBuild))
            { Environment.ExitCode = 64; return; }
            try
            {
                var identity = UpdateCandidate.Verify(args[1], args[2], args[3], previousBuild).GetAwaiter().GetResult();
                Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new { status = "verified",
                    sourceRevision = identity.SourceRevision, buildNumber = identity.BuildNumber }));
            }
            catch { Console.Error.WriteLine("Candidate verification failed."); Environment.ExitCode = 1; }
            return;
        }
        if (args.Contains("--test-update-extraction"))
        {
            if (args.Length != 3 || args[0] != "--test-update-extraction")
            { Environment.ExitCode = 64; return; }
            try { UpdateArchive.Extract(args[1], args[2]); }
            catch (Exception error) { Console.Error.WriteLine(error.Message); Environment.ExitCode = 1; }
            return;
        }
        if (args.Contains("--quit-for-update"))
        {
            if (args.Length != 1) { Environment.ExitCode = 64; return; }
            try
            {
                var result = UpdateQuit.Request("Local\\WorkspaceObservatory", UpdateQuit.RequestName, TimeSpan.FromSeconds(270));
                Environment.ExitCode = result == UpdateQuit.Result.Stopped ? 0 : result == UpdateQuit.Result.Unsupported ? 2 : 3;
            }
            catch { Environment.ExitCode = 1; }
            return;
        }
        if (args.Length == 1 && args[0] == "--test-archive-bridge")
        {
            try { QuotaArchive.BridgeSelfTest().GetAwaiter().GetResult(); }
            catch { Console.Error.WriteLine("Native archive bridge failed."); Environment.ExitCode = 1; }
            return;
        }
        if (args.Length == 2 && args[0] is "--test-tls-setup-bridge" or "--test-tls-identity-bridge")
        {
            try { TlsSetupProcess.BridgeSelfTest(args[1], args[0] == "--test-tls-identity-bridge").GetAwaiter().GetResult(); }
            catch { Console.Error.WriteLine("Native setup process bridge failed."); Environment.ExitCode = 1; }
            return;
        }
        if (args.Length == 2 && args[0] == "--test-device-identity-bridge")
        {
            try { DeviceIdentity.BridgeSelfTest(args[1]).GetAwaiter().GetResult(); }
            catch { Console.Error.WriteLine("Device identity bridge failed."); Environment.ExitCode = 1; }
            return;
        }
        if (args.Length == 1 && args[0] == "--test-sharing-bridge")
        {
            try { QuotaSharing.BridgeSelfTest().GetAwaiter().GetResult(); }
            catch { Console.Error.WriteLine("Native sharing bridge failed."); Environment.ExitCode = 1; }
            return;
        }
        if (args.Length == 2 && args[0] == "--test-direct-pairing-window")
        {
            try { DirectPairingWindow.SelfTest(args[1]); }
            catch { Console.Error.WriteLine("Direct pairing window test failed."); Environment.ExitCode = 1; }
            return;
        }
        if (args.Length == 2 && args[0] == "--test-trusted-sync-owner")
        {
            try { TrustedSyncProcess.SelfTest(args[1]).GetAwaiter().GetResult(); }
            catch { Console.Error.WriteLine("Trusted sync owner test failed."); Environment.ExitCode = 1; }
            return;
        }
        if (args.Contains("--self-test"))
        {
            try
            {
                Snapshot.SelfTest(); NativeHistory.SelfTest(); LoginStartup.SelfTest(); PairingDetails.SelfTest(); FirstRunSetup.SelfTest();
                NativeDashboard.FreshnessSelfTest();
                InstallationGate.SelfTest();
                UpdateQuit.SelfTest();
                UpdateSession.SelfTest();
                UpdateCandidate.SelfTest();
                UpdateStaging.SelfTest();
                UpdateHelper.SelfTest();
                UpdateDownload.SelfTest();
                UpdateController.SelfTest();
                UpdateTrust.SelfTest();
                UpdateInstallerCallback.SelfTest();
                WinSparkleCallbacks.SelfTest();
                UpdateRegistration.SelfTest();
                UpdateReady.SelfTest();
                UpdateInstall.SelfTest();
                UpdateActivation.SelfTest();
                UpdateArchiveTests.Run();
                OperationDrain.SelfTest();
                Collector.ShutdownSelfTest();
                PowerResumeWindow.SelfTest();
                TailscaleReadiness.SelfTest();
                QuotaArchive.SelfTest();
                DeviceIdentity.SelfTest();
                TlsSetupReply.SelfTest();
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
        if (args.Length == 2 && args[0] == "--test-archive-window")
        {
            if (!Path.IsPathFullyQualified(args[1]) || !Directory.Exists(args[1]) ||
                File.GetAttributes(args[1]).HasFlag(FileAttributes.ReparsePoint) || Directory.EnumerateFileSystemEntries(args[1]).Any())
            { Environment.ExitCode = 1; return; }
            try { QuotaArchiveWindow.DesktopTest(args[1]); }
            catch (Exception error) { Console.Error.WriteLine(error.Message); Environment.ExitCode = 1; }
            return;
        }
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
        using var updateQuit = new EventWaitHandle(false, EventResetMode.AutoReset, UpdateQuit.RequestName);
        var context = new ObservatoryContext(activation, !args.Contains("--background"), UseNativeDashboard(args), updateQuit);
        EventHandler? readyHandler = null;
        if (updateReady is not null)
        {
            readyHandler = (_, _) => { Application.Idle -= readyHandler; UpdateReady.Signal(updateReady); };
            Application.Idle += readyHandler;
        }
        try { Application.Run(context); }
        finally { if (readyHandler is not null) Application.Idle -= readyHandler; }
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
    private DirectPairingWindow? directPairing;
    private UsagePopup? usagePopup;
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 30000 };
    private bool quitting;
    private readonly UpdateController updater;
    private int updateShutdownRequested;

    internal ObservatoryContext(EventWaitHandle activation, bool show, bool nativeDashboard = true, EventWaitHandle? updateQuit = null)
    {
        this.nativeDashboard = nativeDashboard;
        Directory.CreateDirectory(runtime);
        collector = new Collector(runtime);
        updater = new UpdateController(runtime, () => !collector.Busy && !Volatile.Read(ref quitting),
            () => Interlocked.Exchange(ref updateShutdownRequested, 1));
        powerNotifications = new PowerResumeWindow(collector.RequestResumeRefresh);
        var setupPending = true;
        try { setupPending = FirstRunSetup.Prepare(runtime); }
        catch { MessageBox.Show("Setup state could not be read. Collection is paused and existing settings are preserved.", "Observatory setup"); }
        var menu = new ContextMenuStrip();
        menu.Items.Add("Open Observatory", null, (_, _) => Open());
        menu.Items.Add("Usage overview", null, (_, _) => ShowUsage());
        menu.Items.Add("Refresh sources", null, async (_, _) => await collector.Refresh());
        menu.Items.Add("Check for updates…", null, async (_, _) => await CheckForUpdates());
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
        activationTimer.Tick += async (_, _) =>
        {
            if (Interlocked.Exchange(ref updateShutdownRequested, 0) == 1 || updateQuit?.WaitOne(0) == true) await RequestQuit();
            else if (!quitting && activation.WaitOne(0)) Open();
        };
        activationTimer.Start();
        if (show || setupPending) Open();
    }

    private JsonObject? Data() => Snapshot.Read(Path.Combine(runtime, "public", "local", "usage.json"));
    private DeviceSettingsActions DeviceActions() => new(LoginStartup.Registered, LoginStartup.SetRegistered,
        ShowPairingDetails, DisconnectPairing, PreparePairingRepair, collector.Sharing, ReadNetwork: TailscaleReadiness.Read, DirectPair: ShowDirectPairing);

    private void ShowDirectPairing()
    {
        if (quitting) return;
        if (directPairing is not null) { directPairing.Activate(); return; }
        Action<bool>? release = null;
        TlsSetupProcess? bridge = null;
        try
        {
            release = collector.BeginDirectPairing();
            bridge = new TlsSetupProcess(runtime);
            directPairing = new DirectPairingWindow(bridge, release);
            directPairing.FormClosed += (_, _) => directPairing = null;
            directPairing.Show();
        }
        catch
        {
            if (bridge is null) release?.Invoke(true);
            else _ = Cleanup();
            MessageBox.Show("Pairing setup is unavailable. Wait for collection to finish or check this installation's setup tools.", "Direct device pairing");
        }
        async Task Cleanup()
        {
            try { await bridge!.DisposeAsync(); } catch { }
            finally { release?.Invoke(bridge!.ExitVerified); directPairing?.Dispose(); directPairing = null; }
        }
    }

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
            new SourceSettingsActions(collector.ReadConfiguration, (expected, desired) => { collector.UpdateConfiguration(expected, desired); collector.Start(); }), DeviceActions(),
            (request, cancellation) => QuotaArchive.Run(runtime, request, cancellation), rememberLayout: true, checkUpdates: CheckForUpdates);
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
                new SourceSettingsActions(collector.ReadConfiguration, (expected, desired) => { collector.UpdateConfiguration(expected, desired); collector.Start(); }), DeviceActions(),
                (request, cancellation) => QuotaArchive.Run(runtime, request, cancellation), rememberLayout: true, checkUpdates: CheckForUpdates) : new Dashboard(runtime);
            dashboard.FormClosed += (_, _) => dashboard = null;
        }
        dashboard.Show();
        if (dashboard.WindowState == FormWindowState.Minimized) dashboard.WindowState = FormWindowState.Normal;
        dashboard.Activate();
    }

    private async Task CheckForUpdates()
    {
        if (quitting) return;
        try { await updater.Check(); }
        catch (OperationCanceledException) { }
        catch (ObjectDisposedException) { }
        catch (IOException error) { MessageBox.Show(error.Message, "Observatory updates", MessageBoxButtons.OK, MessageBoxIcon.Information); }
        catch { MessageBox.Show("The update check could not start. This installation was not changed.", "Observatory updates", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
    }

    private async Task RequestQuit()
    {
        if (quitting) return;
        quitting = true;
        try
        {
            tray.Text = "Observatory · finishing collection before quitting";
            if (directPairing is { } pairingWindow) { await pairingWindow.Shutdown(); if (!pairingWindow.IsDisposed) pairingWindow.Close(); }
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
        updater.Dispose();
        powerNotifications.Dispose();
        activationTimer.Stop(); activationTimer.Dispose();
        timer.Stop(); timer.Dispose(); collector.Dispose(); dashboard?.Close(); usagePopup?.Close(); tray.Visible = false; tray.Dispose();
        base.ExitThreadCore();
    }
}
