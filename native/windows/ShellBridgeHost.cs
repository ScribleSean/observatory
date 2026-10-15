using System.Diagnostics;
using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

internal sealed class ShellBridgeHost(
    string runtime, Collector collector, Func<Form?> window, Func<bool> nativePairingOpen,
    Func<bool> quitting, Func<Task> checkUpdates, Action<string> openDashboard) : IBridgeHost
{
    public BridgeSettingsStore Settings { get; } = new(runtime);
    public DateTimeOffset Now => DateTimeOffset.UtcNow;
    public Version? AppVersion => BridgeSettingsStore.ReadAssemblyVersion();
    public bool CollectorBusy => quitting() || collector.Busy;
    public bool CollectionPaused => collector.CollectionPaused;
    public bool NativePairingOpen => nativePairingOpen();

    private Form Owner => window() is { IsDisposed: false, Disposing: false } owner
        ? owner : throw new InvalidOperationException("Dashboard unavailable.");

    public bool Confirm(string title, string text) => MessageBox.Show(Owner, text, title,
        MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) == DialogResult.Yes;

    public string? ChooseExportFile()
    {
        using var dialog = new SaveFileDialog
        {
            Filter = "Observatory export (*.observatory)|*.observatory", DefaultExt = "observatory",
            AddExtension = true, OverwritePrompt = false, CheckPathExists = true
        };
        if (dialog.ShowDialog(Owner) != DialogResult.OK) return null;
        var path = dialog.FileName;
        return !path.EndsWith(".observatory", StringComparison.OrdinalIgnoreCase) ||
            BridgeSettingsStore.Attributes(path) is not null ? null : path;
    }

    public void CopyInvitation(string invitation)
    {
        var owner = Owner;
        if (owner.InvokeRequired) owner.Invoke(new Action(() => Clipboard.SetText(invitation)));
        else Clipboard.SetText(invitation);
    }

    public Task RefreshAllowancesThenAll() => collector.RefreshAllowancesThenAll();
    public Task Refresh() => collector.Refresh();
    public Task CheckUpdates() => checkUpdates();
    public void OpenDashboard(string section) => openDashboard(section);
    public JsonObject ReadConfiguration() => collector.ReadConfiguration();
    public void UpdateConfiguration(JsonObject expected, JsonObject desired) => collector.UpdateConfiguration(expected, desired);
    public void StartCollector() => collector.Start();
    public bool ReadStartup() => LoginStartup.Registered();
    public void SetStartup(bool enabled) => LoginStartup.SetRegistered(enabled);
    public Task<QuotaSharingStatus> Sharing(string action, string? token, SharingChannel channel)
    {
        if (quitting()) throw new InvalidOperationException("Application is closing.");
        return collector.Sharing(action, token, channel);
    }
    public Action<bool> BeginDirectPairing() => collector.BeginDirectPairing();
    public IBridgePairingSession CreatePairingSession() => new BridgePairingSession(runtime);
    public Task DisconnectPairing() => collector.DisconnectPairing();
    public Task PreparePairingRepair() => collector.PreparePairingRepair();
    public Task<BridgeScriptResult> RunScript(ProcessStartInfo start) => BridgeProcesses.Run(start);
    public Task<string> ReadTailscaleStatus() => TailscaleReadiness.ReadStatus(runtime);
}
