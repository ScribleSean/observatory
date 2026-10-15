namespace WorkspaceObservatory;

internal static class LaunchArguments
{
    // Validate before any dispatch. A misspelled or truncated fixture command
    // must never fall through to an ordinary application launch.
    internal static bool Valid(string[] args)
    {
        if (args.All(argument => argument is "--background" or "--native-dashboard" or "--web-panel" or "--web-dashboard" or "--panel-timing"))
            return args.Distinct(StringComparer.Ordinal).Count() == args.Length;
        if (args.Skip(1).Any(argument => string.IsNullOrWhiteSpace(argument) || argument.StartsWith("--", StringComparison.Ordinal)))
            return false;
        var count = args[0] switch
        {
            "--self-test" or "--test-pairing" or "--quit-for-update" or
                "--test-archive-bridge" or "--test-sharing-bridge" or "--test-launch-isolation" => 1,
            "--collect-once" or "--update-ready" or "--test-update-ready" or
                "--test-update-trust" or "--test-updater-lifecycle" or "--test-updater-library" or
                "--test-tls-setup-bridge" or "--test-tls-identity-bridge" or "--test-device-identity-bridge" or
                "--test-direct-pairing-window" or "--test-trusted-sync-owner" or
                "--runtime" or
                "--test-pairing-details" or "--test-web-hosts" => 2,
            "--test-update-extraction" => 3,
            "--test-installed-update-state" or "--test-update-candidate" => 5,
            "--apply-update" or "--test-update-staging" => 6,
            "--test-update-receipt-store" or "--test-update-download-preparation" or
                "--test-update-install" or "--test-update-activation" => 7,
            _ => 0
        };
        return args.Length == count;
    }

    // Installed TEST apps do not run release updates or helpers accepting an
    // arbitrary runtime path. Source-tree fixtures retain their existing modes.
    internal static bool ValidForTestInstallation(string[] args) => Valid(args) &&
        (args.Length == 0 || args[0] is "--background" or "--native-dashboard" or "--web-panel" or "--web-dashboard" or "--panel-timing" or
            "--self-test" or "--quit-for-update" or "--update-ready" or "--test-update-ready" or
            "--test-launch-isolation");
}
