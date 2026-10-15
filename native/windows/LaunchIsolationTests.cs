namespace WorkspaceObservatory;

// Pure identity and dispatch checks. The dedicated command never starts a UI,
// collector, installer or startup registration. It does not query known folders.
internal static class LaunchIsolationTests
{
    internal static void Run()
    {
        void Check(bool condition) { if (!condition) throw new IOException("Launch isolation contract failed."); }
        var revision = new string('a', 40);
        var ordinaryOwner = "[Owner]\nProduct=WorkspaceObservatorySetup\nRevision=" + revision + "\n";
        var testOwner = ordinaryOwner.Replace("WorkspaceObservatorySetup", AppIdentity.TestId);
        var ordinary = AppIdentity.Select("source-build", null);
        var test = AppIdentity.Select(AppIdentity.TestName, testOwner);
        Check(!ordinary.IsTest && AppIdentity.Select("installed", ordinaryOwner) == ordinary);
        Check(test.IsTest && AppIdentity.Select("relocated-test", testOwner) == test);
        Check(AppIdentity.Select(AppIdentity.TestName.ToUpperInvariant(), testOwner.Replace("\n", "\r\n")) == test);
        Check(ordinary.DataName == "Observatory" && ordinary.StartupName == "WorkspaceObservatory");
        Check(ordinary.SingletonName == @"Local\WorkspaceObservatory" && ordinary.SetupName == InstallationGate.Name);
        Check(ordinary.QuitName == UpdateQuit.RequestName && ordinary.ActivationName == @"Local\WorkspaceObservatory.Open");
        Check(test.DataName == AppIdentity.TestName && test.StartupName == AppIdentity.TestId);
        Check(test.SingletonName == @"Local\WorkspaceObservatoryInstallerTest.App" && test.SetupName == @"Local\WorkspaceObservatoryInstallerTest");
        Check(test.ActivationName == test.SingletonName + ".Open" && test.QuitName == test.SingletonName + ".QuitForUpdate");
        Check(new[] { ordinary.SingletonName, ordinary.SetupName, ordinary.ActivationName, ordinary.QuitName,
            test.SingletonName, test.SetupName, test.ActivationName, test.QuitName }.Distinct().Count() == 8);
        foreach (var invalid in new string?[] { null, "", ordinaryOwner, testOwner + "Product=WorkspaceObservatorySetup\n",
            testOwner.Replace(revision, "invalid"), testOwner.Replace(AppIdentity.TestId, "Unknown"),
            testOwner.Replace("[Owner]", "[Other]"), testOwner.Replace("Revision=", "revision=") })
        {
            var rejected = false;
            try { AppIdentity.Select(AppIdentity.TestName, invalid); } catch (IOException) { rejected = true; }
            Check(rejected);
        }
        foreach (var args in new string[][] { [], ["--background"], ["--native-dashboard"], ["--self-test"], ["--test-launch-isolation"],
            ["--quit-for-update"], ["--test-update-ready", "fixture-event"], ["--web-panel"], ["--background", "--web-panel", "--panel-timing"],
            ["--panel-timing"], ["--panel-timing", "--background"], ["--web-dashboard"], ["--web-dashboard", "--web-panel"] })
            Check(LaunchArguments.Valid(args) && LaunchArguments.ValidForTestInstallation(args));
        foreach (var args in new string[][] { ["--legacy-dashboard", "--background"],
            ["--native-dashboard", "--legacy-dashboard"],
            ["--native-viewer"],
            ["--native-viewer", "--background"],
            ["--native-viewer", "--panel-timing"],
            ["--legacy-dashboard"],
            ["--test-native-dashboard", "fixture-runtime"],
            ["--test-usage-popup", "fixture-runtime"],
            ["--test-web", "fixture-runtime"],
            ["--test-first-run", "fixture-runtime"],
            ["--test-setup-wizard", "fixture-runtime"],
            ["--runtime"], ["--runtime", "--background"], ["--runtime", "x", "--background"],
            ["--test-archive-window", "fixture-runtime"],
            ["--test-native-dashboard"], ["--test-native-dashboard", "x", "extra"],
            ["--test-web-hosts"], ["--test-web-hosts", "x", "extra"], ["--test-web-hosts", "--background"],
            ["--self-test", "extra"], ["--background", "--self-test"], ["--test-first-run", "--background"],
            ["--test-unknown"], ["--test-identity"], ["--SELF-TEST"], ["--self-test=1"], ["--test-web", ""],
            ["--background", "--background"], ["--collect-once"], ["--apply-update"], ["unknown"], ["--web-panel", "--web-panel"],
            ["--web-panel", "panel.html"], ["--web-panel=1"], ["--self-test", "--web-panel"], ["--web-dashboard", "--web-dashboard"],
            ["--web-dashboard", "dashboard.html"], ["--native-viewer", "--native-viewer"],
            ["--native-viewer", "--legacy-dashboard"], ["--native-viewer", "--web-panel"],
            ["--native-viewer", "--web-dashboard"], ["--native-viewer", "x"], ["--native-viewer=1"] })
            Check(!LaunchArguments.Valid(args) && !LaunchArguments.ValidForTestInstallation(args));
        foreach (var args in new string[][] { ["--collect-once", "fixture-runtime"], ["--runtime", "fixture-runtime"],
            ["--test-web-hosts", "fixture-runtime"],
            ["--apply-update", "installed", "staged", "receipt", "envelope", "7"],
            ["--test-update-install", "installed", "staged", "receipt", "envelope", "key", "7"] })
            Check(LaunchArguments.Valid(args) && !LaunchArguments.ValidForTestInstallation(args));
        Check(ordinary.InUseName == @"Local\WorkspaceObservatory.InUse");
        Check(test.InUseName == @"Local\WorkspaceObservatoryInstallerTest.App.InUse");
        Check(ordinary.InUseName == ordinary.SingletonName + ".InUse" && test.InUseName == test.SingletonName + ".InUse");
        var current = AppIdentity.Current;
        Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new { schema = 1, status = "launch-isolation-passed",
            testIdentity = current.IsTest, dataName = current.DataName, startupName = current.StartupName,
            singletonName = current.SingletonName, setupName = current.SetupName,
            activationName = current.ActivationName, quitName = current.QuitName }));
    }
}
