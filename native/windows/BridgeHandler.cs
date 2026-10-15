using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

// The window adapter owns UI dispatch. Calls start on the receiving UI context.
// Tests supply only temporary storage and fake operations.
internal interface IBridgeHost
{
    BridgeSettingsStore Settings { get; }
    DateTimeOffset Now { get; }
    // Use BridgeSettingsStore.ReadAssemblyVersion in the window adapter.
    Version? AppVersion { get; }
    bool CollectorBusy { get; }
    bool CollectionPaused { get; }
    bool NativePairingOpen { get; }
    bool NativeDialogOpen { get; }
    bool Confirm(string title, string text);
    // Require .observatory and do not offer replacement of an existing file.
    string? ChooseExportFile();
    void CopyInvitation(string invitation);
    Task RefreshAllowancesThenAll();
    Task Refresh();
    Task CheckUpdates();
    void OpenDashboard(string section);
    JsonObject ReadConfiguration();
    void UpdateConfiguration(JsonObject expected, JsonObject desired);
    void StartCollector();
    bool ReadStartup();
    void SetStartup(bool enabled);
    Task<QuotaSharingStatus> Sharing(string action, string? token, SharingChannel channel);
    Action<bool> BeginDirectPairing();
    IBridgePairingSession CreatePairingSession();
    Task DisconnectPairing();
    Task PreparePairingRepair();
    Task<BridgeScriptResult> RunScript(ProcessStartInfo start);
    Task<string> ReadTailscaleStatus();
}

internal interface IBridgePairingSession : IAsyncDisposable
{
    Task<TlsSetupReply> Send(JsonObject command);
    Task<TlsSetupReply> PrepareIdentity(bool consent);
    bool ExitVerified { get; }
}

internal sealed class BridgePairingSession(string runtime) : IBridgePairingSession
{
    private readonly TlsSetupProcess process = new(runtime);
    public Task<TlsSetupReply> Send(JsonObject command) => process.Send(command);
    public Task<TlsSetupReply> PrepareIdentity(bool consent) => process.PrepareIdentity(consent);
    public bool ExitVerified => process.ExitVerified;
    public ValueTask DisposeAsync() => process.DisposeAsync();
}

internal sealed record BridgeScriptResult(int ExitCode, string Output);

internal static class BridgeProcesses
{
    private static readonly string[] Scripts = ["claude-limits-consent.mjs", "observatory-file.mjs",
        "quota-sharing-control.mjs", "provider-token-sharing-control.mjs", "tailscale-status.mjs",
        "peer-revocation.mjs", "peer-repair.mjs"];

    internal static ProcessStartInfo Create(string runtime, string script, params string[] arguments)
    {
        if (!Scripts.Contains(script, StringComparer.Ordinal)) throw new ArgumentException("Unknown bundled script.");
        var start = new ProcessStartInfo(Path.Combine(AppContext.BaseDirectory, "Runtime", "node.exe"))
        {
            UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = runtime,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true
        };
        start.ArgumentList.Add(Path.Combine(AppContext.BaseDirectory, "Collector", "scripts", script));
        foreach (var argument in arguments) start.ArgumentList.Add(argument);
        foreach (var key in new[] { "NODE_OPTIONS", "NODE_PATH", "NODE_EXTRA_CA_CERTS" }) start.Environment.Remove(key);
        return start;
    }

    // The production host can delegate its script operation here.
    internal static async Task<BridgeScriptResult> Run(ProcessStartInfo start)
    {
        if (!File.Exists(start.FileName) || start.ArgumentList.Count == 0 || !File.Exists(start.ArgumentList[0]))
            throw new InvalidOperationException("Bundled tools unavailable.");
        using var process = new Process { StartInfo = start };
        process.Start();
        process.StandardInput.Close();
        var output = process.StandardOutput.ReadToEndAsync();
        var errors = DiscardErrors(process.StandardError);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(45));
        try { await process.WaitForExitAsync(timeout.Token).ConfigureAwait(false); }
        catch
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            await process.WaitForExitAsync().ConfigureAwait(false);
            await Task.WhenAll(output, errors).ConfigureAwait(false);
            throw new InvalidOperationException("Bundled operation unavailable.");
        }
        await Task.WhenAll(output, errors).ConfigureAwait(false);
        return new(process.ExitCode, await output.ConfigureAwait(false));
    }

    private static async Task DiscardErrors(StreamReader reader)
    {
        var buffer = new char[1024];
        while (await reader.ReadAsync(buffer).ConfigureAwait(false) != 0) { }
    }
}

internal sealed class BridgeSettingsStore(string runtime)
{
    internal static readonly string[] Bundled = ["sage", "almanac", "instrument", "amber-crt"];
    internal static Version? ReadAssemblyVersion()
    {
        var text = Assembly.GetExecutingAssembly().GetCustomAttribute<AssemblyFileVersionAttribute>()?.Version;
        return Version.TryParse(text, out var value) && value.Build >= 0 && value.Revision >= 0 ? value : null;
    }

    internal static FileAttributes? Attributes(string path)
    {
        try { return File.GetAttributes(path); }
        catch (FileNotFoundException) { return null; }
        catch (DirectoryNotFoundException) { return null; }
    }

    private static void PlainFolder(string path)
    {
        var attributes = Attributes(path);
        if (attributes is null || (attributes.Value & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != FileAttributes.Directory)
            throw new IOException("Settings folder unavailable.");
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FileInformation
    {
        internal uint Attributes;
        internal System.Runtime.InteropServices.ComTypes.FILETIME CreationTime, AccessTime, WriteTime;
        internal uint VolumeSerialNumber, SizeHigh, SizeLow, NumberOfLinks, IndexHigh, IndexLow;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInformation information);

    private static void RefuseHardLink(string path)
    {
        using var handle = File.OpenHandle(path, FileMode.Open, FileAccess.Read,
            FileShare.ReadWrite | FileShare.Delete, FileOptions.None);
        if (!GetFileInformationByHandle(handle, out var information) || information.NumberOfLinks > 1)
            throw new IOException("Settings file unavailable.");
    }

    internal bool ViewerExists => Attributes(Path.Combine(runtime, "viewer.json")) is not null;

    private JsonObject ReadObject(string name, int cap)
    {
        PlainFolder(runtime);
        var path = Path.Combine(runtime, name);
        if (Path.GetDirectoryName(path) is { } parent) PlainFolder(parent);
        var attributes = Attributes(path);
        if (attributes is null || (attributes.Value & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0)
            throw new IOException("Settings file unavailable.");
        RefuseHardLink(path);
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (stream.Length > cap) throw new IOException("Settings file too large.");
        var bytes = new byte[cap + 1];
        int count = 0, read;
        while (count < bytes.Length && (read = stream.Read(bytes, count, bytes.Length - count)) != 0) count += read;
        if (count > cap) throw new IOException("Settings file too large.");
        using var doc = JsonDocument.Parse(bytes.AsMemory(0, count));
        if (doc.RootElement.ValueKind != JsonValueKind.Object) throw new IOException("Invalid settings.");
        var keys = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in doc.RootElement.EnumerateObject())
            if (!keys.Add(property.Name)) throw new IOException("Invalid settings.");
        return JsonNode.Parse(doc.RootElement.GetRawText())!.AsObject();
    }

    internal (string Skin, string Appearance) ReadViewer(bool strict = false)
    {
        try
        {
            if (Attributes(Path.Combine(runtime, "viewer.json")) is null) return ("sage", "system");
            var value = ReadObject("viewer.json", 1024);
            var skin = value["skin"]?.GetValue<string>();
            var appearance = value["appearance"]?.GetValue<string>();
            if (value.Count == 2 && skin is not null && Bundled.Contains(skin, StringComparer.Ordinal) &&
                appearance is "system" or "light" or "dark") return (skin, appearance);
            if (strict) throw new IOException("Invalid viewer settings.");
        }
        catch when (!strict) { }
        return ("sage", "system");
    }

    internal void WriteViewer(string skin, string appearance, bool replace = true)
    {
        if (!Bundled.Contains(skin, StringComparer.Ordinal) || appearance is not ("system" or "light" or "dark"))
            throw new ArgumentException("Invalid viewer settings.");
        Write("viewer.json", new JsonObject { ["skin"] = skin, ["appearance"] = appearance }, replace);
    }

    private void GuardWrite(string path, bool allowOversized = false)
    {
        PlainFolder(runtime);
        var attributes = Attributes(path);
        if (attributes is not null && ((attributes.Value & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0 || (!allowOversized && new FileInfo(path).Length > 1024)))
            throw new IOException("Settings file unavailable.");
        if (attributes is not null) RefuseHardLink(path);
    }

    private void Write(string name, JsonObject value, bool replace = true)
    {
        var path = Path.Combine(runtime, name);
        bool replaceViewer = name == "viewer.json" && replace;
        GuardWrite(path, replaceViewer);
        var bytes = JsonSerializer.SerializeToUtf8Bytes(value);
        if (bytes.Length > 1024) throw new IOException("Settings file too large.");
        var temporary = Path.Combine(runtime, ".viewer-" + Guid.NewGuid().ToString("N") + ".tmp");
        try
        {
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None)) stream.Write(bytes);
            GuardWrite(path, replaceViewer);
            if (replaceViewer && File.Exists(path) && new FileInfo(path).Length > 1024)
            {
                var backup = path + ".bak";
                GuardWrite(backup, allowOversized: true);
                File.Move(path, backup, overwrite: true);
            }
            File.Move(temporary, path, replace);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    internal void WriteDevice(string? name)
    {
        if (name is null)
        {
            var path = Path.Combine(runtime, "device.json");
            PlainFolder(runtime);
            var attributes = Attributes(path);
            if (attributes is not null && (attributes.Value & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0)
                throw new IOException("Settings file unavailable.");
            if (attributes is not null) RefuseHardLink(path);
            File.Delete(path);
            return;
        }
        var checkedName = BridgeContract.Validate(new JsonObject { ["id"] = 1, ["action"] = "set-device-name",
            ["args"] = new JsonObject { ["name"] = name } }.ToJsonString());
        if (checkedName.Outcome != "accepted") throw new ArgumentException("Invalid device name.");
        Write("device.json", new JsonObject { ["name"] = checkedName.Args!["name"].Text });
    }

    internal string? ReadDevice(bool strict = false)
    {
        try
        {
            if (Attributes(Path.Combine(runtime, "device.json")) is null) return null;
            var value = ReadObject("device.json", 1024);
            if (value.Count != 1 || value["name"] is null) throw new IOException("Invalid device settings.");
            var check = BridgeContract.Validate(new JsonObject { ["id"] = 1, ["action"] = "set-device-name", ["args"] = value }.ToJsonString());
            if (check.Outcome != "accepted") throw new IOException("Invalid device settings.");
            return check.Args!["name"].Text;
        }
        catch when (!strict) { return null; }
    }

    internal bool ReadLimitsConsent(bool strict = false)
    {
        try
        {
            if (Attributes(Path.Combine(runtime, "claude-limits", "consent.json")) is null) return false;
            return ReadObject(Path.Combine("claude-limits", "consent.json"), 4096)["consent"]?.GetValue<bool>()
                ?? throw new IOException("Invalid consent settings.");
        }
        catch when (!strict) { return false; }
    }

    internal (string State, string Transport) ReadPairing(bool strict = false)
    {
        try
        {
            PlainFolder(runtime);
            var root = Path.Combine(runtime, "private-sync");
            if (Attributes(root) is null) return ("unpaired", "none");
            PlainFolder(root);
            // Check every relevant path before accepting any one of them.
            var paths = new[] { "revoked", "tls-trust.json", "pairing.json" };
            var present = new bool[paths.Length];
            for (int i = 0; i < paths.Length; i++)
            {
                var path = Path.Combine(root, paths[i]);
                var attributes = Attributes(path);
                if (attributes is null) continue;
                if ((attributes.Value & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0) throw new IOException();
                present[i] = true;
            }
            if (present[0]) return ("unpaired", "none");
            if (present[1]) return ("paired", "tls");
            if (present[2]) return ("paired", "ssh");
            return ("unpaired", "none");
        }
        catch when (!strict) { return ("unavailable", "none"); }
    }
}

internal sealed class BridgeHandler : IDisposable
{
    private sealed record Request(int Id, string Action, Dictionary<string, BridgeValue> Args, long Document, long Epoch, Action<string> Post);
    private sealed record Result(string Code, JsonObject? Value = null);
    private readonly IBridgeHost host;
    private readonly string runtime;
    private readonly object gate = new();
    private readonly Queue<Request> queue = new();
    private readonly HashSet<(long Epoch, int Id)> ids = new();
    private readonly HashSet<string> actions = new(StringComparer.Ordinal);
    private long? document;
    private long epoch;
    private bool running, dialog, closed, working, polling;
    private string? activeAction;
    private Task drain = Task.CompletedTask;
    private Task ending = Task.CompletedTask;
    private Task cacheWork = Task.CompletedTask;
    private static readonly object ownerGate = new();
    private static BridgeHandler? pairingOwner;
    private IBridgePairingSession? session;
    private Action<bool>? release;
    private long sessionGeneration;
    private DateTimeOffset began;
    private string pairingState = "idle";
    private string? identityState;
    private string? fingerprint, invitation;
    private JsonObject? endpoint;
    private System.Windows.Forms.Timer? timer;
    private string tailscale = "unavailable";
    private DateTimeOffset? tailscaleRead;
    private bool tailscaleReading;
    private readonly DateTimeOffset?[] sharingRead = new DateTimeOffset?[2];
    private readonly bool[] sharingReading = new bool[2];
    private readonly long[] sharingRevision = new long[2];
    // This is the not yet read state. The contract has no unknown sharing value.
    private readonly QuotaSharingStatus[] sharing = [new(false, false, "pairing-unavailable", null), new(false, false, "pairing-unavailable", null)];

    private sealed record FileStatus((string Skin, string Appearance) Viewer, string? Device,
        bool LimitsConsent, JsonObject Sources, bool Startup, (string State, string Transport) Pairing);
    private FileStatus files = new(("sage", "system"), null, false, Sources(new()), false, ("unavailable", "none"));
    private DateTimeOffset? filesRead;
    private bool filesReading;
    private long filesRevision;

    private readonly Action<string>? probe;
    internal event Action<string, string>? ViewerChanged;
    internal int ReceivedCount { get; private set; }
    internal static bool PairingOpen { get { lock (ownerGate) return pairingOwner is not null; } }

    internal BridgeHandler(IBridgeHost host, string runtime, Action<string>? probe = null)
    { this.host = host; this.runtime = runtime; this.probe = probe; RefreshFilesNow(); }

    private static bool Sender(string? source) => Uri.TryCreate(source, UriKind.Absolute, out var uri) &&
        uri.Scheme == "https" && uri.Host == "observatory.invalid" && uri.IsDefaultPort && uri.UserInfo.Length == 0 &&
        uri.AbsolutePath == "/dashboard.html" && uri.Query.Length == 0 && !source!.Split('#')[0].Contains('?');

    internal void Receive(string? text, string? source, long document, Action<string> post)
    {
        if (!Sender(source)) return;
        ReceivedCount++;
        var validation = BridgeContract.Validate(text);
        probe?.Invoke(validation.Outcome == "accepted" ? "accepted action=" + validation.Action : "refused");
        if (validation.Outcome == "ignore" || validation.Id is not int id) return;
        // Work that may open a native dialog starts after the lock is released.
        Request? cancel = null;
        bool start = false;
        lock (gate)
        {
            if (closed) return;
            if (this.document is null)
            {
                try { post(new JsonObject { ["bridgeResult"] = new JsonObject { ["id"] = id, ["ok"] = false, ["code"] = "refused" } }.ToJsonString()); }
                catch { }
                return;
            }
            if (this.document != document) return;
            var request = new Request(id, validation.Action ?? "", validation.Args ?? new(), document, epoch, post);
            if (validation.Outcome == "refused" || ids.Contains((epoch, id))) { Post(request, new("refused")); return; }
            if (probe is not null)
            {
                Post(request, request.Action == "status" ? Status() : request.Action == "tailscale-check"
                    ? new("done", new JsonObject { ["status"] = tailscale }) : new("cancelled"));
                return;
            }
            if (request.Action == "status")
            {
                ids.Add((epoch, id));
                try { Post(request, Status()); }
                finally { ids.Remove((request.Epoch, id)); }
                ScheduleCache();
                return;
            }
            if (request.Action == "pairing-cancel")
            {
                ids.Add((epoch, id));
                cancel = request;
            }
            else if (dialog || host.NativeDialogOpen || CollectorBlocked(request.Action) || actions.Contains(request.Action) || (running && queue.Count >= BridgeContract.Limits["queue"].Number) || PairingBusy(request.Action))
            { Post(request, new("busy")); return; }
            else
            {
                ids.Add((epoch, id)); actions.Add(request.Action); queue.Enqueue(request);
                if (!running) { running = true; start = true; }
            }
        }
        if (cancel is not null) _ = Cancel(cancel);
        if (start) drain = Drain();
    }

    private bool CollectorBlocked(string action) => (action is "refresh" or "set-source") && (host.CollectorBusy || host.CollectionPaused);

    private static bool Exclusive(string action) => action is "refresh" or "set-sharing" or "pairing-disconnect" or "pairing-repair-prepare";
    private bool PairingBusy(string action) =>
        (Exclusive(action) && (session is not null || !ending.IsCompleted)) ||
        (action.StartsWith("pairing-", StringComparison.Ordinal) &&
            (host.NativePairingOpen || (activeAction is not null && Exclusive(activeAction)) || !ending.IsCompleted));

    private void Post(Request request, Result result)
    {
        if (closed || request.Epoch != epoch || request.Document != document) return;
        var detail = new JsonObject { ["id"] = request.Id, ["ok"] = result.Code == "done", ["code"] = result.Code };
        if (result.Value is not null && request.Action is "status" or "tailscale-check" or "pairing-host-start") detail["value"] = result.Value;
        try { request.Post(new JsonObject { ["bridgeResult"] = detail }.ToJsonString()); } catch { }
    }

    private async Task Drain()
    {
        while (true)
        {
            Request request;
            lock (gate)
            {
                if (queue.Count == 0) { running = false; activeAction = null; return; }
                request = queue.Dequeue();
                activeAction = request.Action;
            }
            Result result;
            try
            {
                lock (gate)
                {
                    if (closed || request.Epoch != epoch) { Finish(request); continue; }
                }
                bool refreshFiles = false;
                try { result = await Execute(request); refreshFiles = result.Code is "done" or "unavailable"; }
                catch { refreshFiles = true; throw; }
                finally
                {
                    if (refreshFiles && request.Action is ("set-source" or "set-skin" or "set-appearance" or "set-device-name" or
                        "set-startup" or "set-limits-consent" or "pairing-disconnect" or "pairing-repair-prepare"))
                        RefreshFilesNow();
                }
            }
            catch
            {
                if (request.Action.StartsWith("pairing-", StringComparison.Ordinal)) await EndSession();
                result = new("unavailable");
            }
            lock (gate) { Post(request, result); Finish(request); }
        }
    }

    private void Finish(Request request) { ids.Remove((request.Epoch, request.Id)); actions.Remove(request.Action); activeAction = null; }
    private bool Current(Request request)
    { lock (gate) return !closed && request.Epoch == epoch && request.Document == document; }

    private bool Confirm(Request request, string title, string text)
    {
        lock (gate) dialog = true;
        try { var accepted = host.Confirm(title, text); return Current(request) && accepted; }
        finally { lock (gate) dialog = false; }
    }

    private async Task<Result> Execute(Request request)
    {
        string Text(string key) => request.Args[key].Text!;
        bool Enabled() => request.Args["enabled"].Boolean;
        lock (gate)
        {
            // The active action must not reject itself.
            var saved = activeAction; activeAction = null;
            bool busy = PairingBusy(request.Action); activeAction = saved;
            if (busy || dialog || host.NativeDialogOpen || CollectorBlocked(request.Action)) return new("busy");
        }
        switch (request.Action)
        {
            case "refresh": await host.RefreshAllowancesThenAll(); break;
            case "check-updates":
                lock (gate) dialog = true;
                try { await host.CheckUpdates(); }
                finally { lock (gate) dialog = false; }
                break;
            case "open-dashboard": host.OpenDashboard(Text("section")); break;
            case "open-settings": host.OpenDashboard("settings"); break;
            case "set-source":
                var expected = host.ReadConfiguration();
                var desired = Sources(expected);
                if (Text("source") == "quota" && desired["quota"]!.GetValue<bool>() && !Enabled() &&
                    !Confirm(request, "Account history", "Turn account monitoring off and clear Observatory's retained account readings on the next collection? Saved log-token history remains.")) return new("cancelled");
                desired[Text("source")] = Enabled();
                host.UpdateConfiguration(expected, desired); host.StartCollector(); break;
            case "set-skin":
                if (!BridgeSettingsStore.Bundled.Contains(Text("skin"), StringComparer.Ordinal)) return new("refused");
                host.Settings.WriteViewer(Text("skin"), host.Settings.ReadViewer().Appearance); ApplyViewer(); break;
            case "set-appearance": host.Settings.WriteViewer(host.Settings.ReadViewer().Skin, Text("mode")); ApplyViewer(); break;
            case "set-device-name": host.Settings.WriteDevice(request.Args["name"].Text); break;
            case "set-startup": host.SetStartup(Enabled()); break;
            case "set-limits-consent":
                if (Enabled() && !Confirm(request, "Claude Code limits", "Claude Code hides most of its footer keyboard hints while any custom status line is configured. Turn on Claude Code limits?")) return new("cancelled");
                var consentArgs = Enabled() ? new[] { "set", "--runtime", runtime, "--consent" } : new[] { "clear", "--runtime", runtime };
                return await Script("claude-limits-consent.mjs", consentArgs);
            case "set-sharing":
                var index = Text("channel") == "codex-limits" ? 0 : 1;
                var title = index == 0 ? "Codex limits" : "Claude Code tokens";
                if (Enabled() && !Confirm(request, "Share " + title + "?", "Share these usage records with the paired device? Enable sharing there separately. Credentials stay on their owning device.")) return new("cancelled");
                var status = await host.Sharing(Enabled() ? "enable" : "disable", Enabled() ? Text("token") : null, Channel(index));
                lock (gate) { sharing[index] = CheckedSharing(status, index); sharingRead[index] = host.Now; sharingRevision[index]++; }
                break;
            case "tailscale-check":
                Result cached;
                lock (gate) cached = new("done", new JsonObject { ["status"] = tailscale });
                ScheduleCache(); return cached;
            case "export-data":
                string? file;
                lock (gate) dialog = true;
                try { file = host.ChooseExportFile(); }
                finally { lock (gate) dialog = false; }
                if (!Current(request)) return new("cancelled");
                return file is null ? new("cancelled") : await Script("observatory-file.mjs", "export", "--runtime", runtime, "--out", file);
            case "pairing-disconnect": case "pairing-repair-prepare":
                if (host.CollectorBusy) return new("busy");
                var repair = request.Action == "pairing-repair-prepare";
                if (!Confirm(request, repair ? "Prepare pairing repair" : "Disconnect paired device", repair
                    ? "If this PC has pairing state, disable it and retain a private backup? Otherwise, confirm this PC is ready for repair. Nothing is deleted or sent. A transfer already in flight may finish. Confirm Prepare pairing repair on the Mac separately, then use Pair with Windows there to create fresh credentials. Retirement cannot be undone by this action."
                    : "Disable pairing on this Windows PC only? Local collection continues and saved data is retained. A transfer already in flight may finish. Disconnect the other device separately. To reconnect, prepare pairing repair on both devices and pair again from the Mac.")) return new("cancelled");
                lock (gate) working = true;
                try
                {
                    // Always enter the collector so its busy race also preserves the pause.
                    try { if (repair) await host.PreparePairingRepair(); else await host.DisconnectPairing(); }
                    catch { return new(host.CollectorBusy ? "busy" : "unavailable"); }
                    await host.Refresh();
                }
                finally { lock (gate) working = false; }
                break;
            // First-run completion is implemented with O1-2. Until then it changes nothing.
            case "complete-setup": return new("unavailable");
            default: return await Pairing(request);
        }
        return new("done");
    }

    private void ApplyViewer()
    {
        var viewer = host.Settings.ReadViewer();
        ViewerChanged?.Invoke(viewer.Skin, viewer.Appearance);
    }

    private async Task<Result> Script(string name, params string[] arguments) =>
        new((await host.RunScript(BridgeProcesses.Create(runtime, name, arguments))).ExitCode == 0 ? "done" : "unavailable");

    private static JsonObject Sources(JsonObject configuration)
    {
        var result = new JsonObject();
        foreach (var key in new[] { "activity", "codex", "claude", "wispr", "quota" })
            result[key] = configuration[key] is JsonValue value && value.TryGetValue<bool>(out var enabled) && enabled;
        return result;
    }

    private Result Status()
    {
        try
        {
            var version = host.AppVersion;
            if (version is null || version.Build < 0 || version.Revision < 0) return new("unavailable");
            var versionText = $"{version.Major}.{version.Minor}.{version.Build}";
            if (versionText.Length > 32) return new("unavailable");
            var viewer = files.Viewer;
            var pair = files.Pairing;
            var state = working ? "working" : session is not null ? pairingState : identityState is not null ? identityState : host.CollectionPaused ? "unavailable" : pair.State;
            var value = new JsonObject
            {
                ["version"] = 1, ["app"] = new JsonObject { ["version"] = versionText, ["build"] = version.Revision },
                ["sources"] = files.Sources.DeepClone(),
                ["skin"] = new JsonObject { ["current"] = viewer.Skin,
                    ["bundled"] = new JsonArray(BridgeSettingsStore.Bundled.Select(s => (JsonNode?)JsonValue.Create(s)).ToArray()), ["custom"] = new JsonArray() },
                ["deviceName"] = files.Device, ["startup"] = files.Startup, ["appearance"] = viewer.Appearance,
                ["limitsConsent"] = files.LimitsConsent,
                // Held while a pairing session reserves collection, while disconnect or repair runs,
                // and while collection stays paused after unverified pairing work.
                ["collectionPaused"] = session is not null || working || host.CollectionPaused,
                ["pairing"] = new JsonObject { ["state"] = state, ["peerFingerprint"] = state == "confirming" ? fingerprint : null,
                    ["transport"] = session is not null || identityState is not null || working || host.CollectionPaused ? "none" : pair.Transport, ["invitationKept"] = invitation is not null },
                ["sharing"] = new JsonObject { ["codex-limits"] = SharingValue(sharing[0]), ["claude-code-tokens"] = SharingValue(sharing[1]) }
            };
            return Encoding.UTF8.GetByteCount(value.ToJsonString()) <= 16384 ? new("done", value) : new("unavailable");
        }
        catch { return new("unavailable"); }
    }

    private static SharingChannel Channel(int index) => index == 0 ? SharingChannel.Quota : SharingChannel.ProviderTokens;
    private static JsonObject SharingValue(QuotaSharingStatus value) => new()
        { ["enabled"] = value.Enabled, ["canEnable"] = value.CanEnable, ["reason"] = value.Reason, ["token"] = value.Token };
    private static QuotaSharingStatus CheckedSharing(QuotaSharingStatus value, int index)
    {
        var json = SharingValue(value); json["version"] = 1;
        return QuotaSharing.Parse(json.ToJsonString(), Channel(index));
    }

    private FileStatus ReadFiles(FileStatus previous)
    {
        var value = previous;
        try { value = value with { Viewer = host.Settings.ReadViewer(strict: true) }; } catch { }
        try { value = value with { Device = host.Settings.ReadDevice(strict: true) }; } catch { }
        try { value = value with { LimitsConsent = host.Settings.ReadLimitsConsent(strict: true) }; } catch { }
        try { value = value with { Sources = Sources(host.ReadConfiguration()) }; } catch { }
        try { value = value with { Startup = host.ReadStartup() }; } catch { }
        try { value = value with { Pairing = host.Settings.ReadPairing(strict: true) }; } catch { }
        return value;
    }

    private void RefreshFilesNow()
    {
        FileStatus previous;
        long revision;
        lock (gate) { previous = files; revision = ++filesRevision; filesRead = host.Now; }
        var value = ReadFiles(previous);
        lock (gate) if (revision == filesRevision) files = value;
    }

    private async Task RefreshFiles(FileStatus previous, long revision)
    {
        try
        {
            var value = await Task.Run(() => ReadFiles(previous));
            lock (gate) if (!closed && revision == filesRevision) files = value;
        }
        finally { lock (gate) filesReading = false; }
    }

    private void ScheduleCache()
    {
        lock (gate)
        {
            if (closed) return;
            var pending = new List<Task>();
            if (!cacheWork.IsCompleted) pending.Add(cacheWork);
            if (!filesReading && Due(filesRead))
            {
                filesReading = true; filesRead = host.Now;
                pending.Add(RefreshFiles(files, filesRevision));
            }
            var channels = new List<int>();
            if (!tailscaleReading && Due(tailscaleRead))
            { tailscaleReading = true; tailscaleRead = host.Now; pending.Add(RefreshTailscale()); }
            for (int i = 0; i < 2; i++)
                if (!host.CollectorBusy && session is null && !sharingReading[i] && Due(sharingRead[i]))
                { sharingReading[i] = true; sharingRead[i] = host.Now; channels.Add(i); }
            if (channels.Count != 0) pending.Add(RefreshSharingChannels(channels));
            cacheWork = Task.WhenAll(pending);
        }
    }

    private bool Due(DateTimeOffset? last) => last is null || host.Now - last.Value >= TimeSpan.FromSeconds(BridgeContract.Limits["cacheRefreshSeconds"].Number);
    private async Task RefreshTailscale()
    {
        await Task.Yield();
        try
        {
            lock (gate) if (closed) return;
            var value = await host.ReadTailscaleStatus();
            lock (gate) if (BridgeContract.Data["values"]["tailscaleStatus"].Contains(value)) tailscale = value;
        }
        catch { }
        finally { lock (gate) tailscaleReading = false; }
    }

    private async Task RefreshSharingChannels(List<int> channels)
    {
        await Task.Yield();
        foreach (var index in channels) await RefreshSharing(index);
    }

    private async Task RefreshSharing(int index)
    {
        long revision;
        lock (gate) revision = sharingRevision[index];
        try
        {
            lock (gate) if (closed || host.CollectorBusy || session is not null) return;
            var value = CheckedSharing(await host.Sharing("status", null, Channel(index)), index);
            lock (gate) if (sharingRevision[index] == revision) sharing[index] = value;
        }
        catch { }
        finally { lock (gate) sharingReading[index] = false; }
    }

    private bool BeginSession()
    {
        lock (gate)
        {
            if (session is not null) return true;
            if (closed || host.NativePairingOpen || !ending.IsCompleted) return false;
            lock (ownerGate)
            {
                if (pairingOwner is not null) return false;
                pairingOwner = this;
            }
            try { release = host.BeginDirectPairing(); }
            catch { lock (ownerGate) pairingOwner = null; return false; }
            try
            {
                session = host.CreatePairingSession(); began = host.Now; sessionGeneration++;
                pairingState = "idle"; identityState = null;
                if (SynchronizationContext.Current is System.Windows.Forms.WindowsFormsSynchronizationContext)
                {
                    timer = new System.Windows.Forms.Timer { Interval = BridgeContract.Limits["pairingPollSeconds"].Number * 1000 };
                    timer.Tick += async (_, _) => await PollAsync(); timer.Start();
                }
                return true;
            }
            catch
            {
                if (session is not null) _ = EndSession();
                else
                {
                    release?.Invoke(false); release = null;
                    lock (ownerGate) pairingOwner = null;
                }
                throw;
            }
        }
    }

    private void Apply(TlsSetupReply reply)
    {
        pairingState = reply.Status == "hosting" ? "waiting" : BridgeContract.Data["values"]["pairingState"].Contains(reply.Status) ? reply.Status : "unavailable";
        fingerprint = pairingState == "confirming" && reply.PeerCertificateSha256 is { Length: 64 } hex &&
            hex.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f') ? reply.PeerCertificateSha256 : null;
    }

    private async Task<Result> Pairing(Request request)
    {
        var action = request.Action;
        if (action == "pairing-copy-invitation")
        {
            string? kept;
            lock (gate) kept = invitation;
            if (kept is null) return new("unavailable");
            try { host.CopyInvitation(kept); }
            catch { return new("unavailable"); }
            return new("done");
        }
        bool temporary = false;
        if (action == "pairing-identity-create")
        {
            if (!Confirm(request, "Device identity", "Allow a device identity stored in a permission-restricted file? The key is not stored using DPAPI or encrypted separately by Observatory. A valid existing identity is reused.")) return new("cancelled");
            lock (gate) temporary = session is null;
        }
        if (action is "pairing-host-start" or "pairing-join-claim" or "pairing-identity-create")
        {
            lock (gate)
            {
                if (request.Epoch != epoch || closed) return new("unavailable");
                if (session is not null && action != "pairing-identity-create") return new("busy");
            }
            if (!BeginSession()) return new("busy");
        }
        IBridgePairingSession current;
        long generation;
        lock (gate)
        {
            if (session is null) return new("unavailable");
            current = session; generation = sessionGeneration;
        }
        bool Current() { lock (gate) return session == current && sessionGeneration == generation && request.Epoch == epoch && !closed; }
        try
        {
            TlsSetupReply reply;
            switch (action)
            {
                case "pairing-identity-create": reply = await current.PrepareIdentity(true); break;
                case "pairing-host-start": case "pairing-join-claim":
                    var identity = await current.Send(new JsonObject { ["action"] = "identity-status" });
                    if (!Current()) return new("unavailable");
                    if (identity.Status != "identity-ready")
                    {
                        lock (gate) identityState = identity.Status is "identity-required" or "identity-recovery-required" ? identity.Status : null;
                        await EndSession(current);
                        return new("unavailable");
                    }
                    reply = await current.Send(action == "pairing-host-start"
                        ? new JsonObject { ["action"] = "host-start", ["address"] = request.Args["address"].Text, ["port"] = 0 }
                        : new JsonObject { ["action"] = "join-claim", ["invitation"] = request.Args["invitation"].Text });
                    break;
                case "pairing-host-confirm":
                    JsonObject? local;
                    lock (gate) local = endpoint?.DeepClone().AsObject();
                    if (local is null) { await EndSession(current); return new("unavailable"); }
                    reply = await current.Send(DirectPairingWindow.HostConfirmCommand(request.Args["fingerprint"].Text!, local,
                        new JsonObject { ["kind"] = "tls", ["address"] = request.Args["peerAddress"].Text, ["port"] = request.Args["peerPort"].Integer }));
                    break;
                case "pairing-join-confirm": reply = await current.Send(DirectPairingWindow.JoinConfirmCommand()); break;
                default: return new("refused");
            }
            if (!Current()) return new("unavailable");
            lock (gate) Apply(reply);
            if (action == "pairing-host-start" && reply.Status == "hosting" && reply.Invitation is not null)
            {
                lock (gate)
                {
                    invitation = reply.Invitation;
                    endpoint = new JsonObject { ["kind"] = "tls", ["address"] = request.Args["address"].Text, ["port"] = request.Args["port"].Integer };
                }
                return new("done", new JsonObject { ["invitation"] = reply.Invitation });
            }
            if (action == "pairing-join-claim" && reply.Status == "awaiting-confirmation") return new("done");
            if (action == "pairing-join-confirm" && reply.Status == "local-ready") return new("unavailable");
            if (action == "pairing-identity-create" && reply.Status == "identity-ready")
            { lock (gate) identityState = null; return new("done"); }
            bool finished = (action == "pairing-host-confirm" && reply.Status is "configuration-ready" or "acknowledged") ||
                (action == "pairing-join-confirm" && reply.Status == "acknowledged");
            await EndSession();
            return new(finished ? "done" : "unavailable");
        }
        finally { if (temporary) await EndSession(); }
    }

    internal async Task PollAsync()
    {
        IBridgePairingSession current;
        long generation;
        lock (gate)
        {
            if (session is null || polling) return;
            current = session; generation = sessionGeneration; polling = true;
        }
        try
        {
            if (host.Now - began >= TimeSpan.FromMinutes(10)) { await EndPolledSession(current); return; }
            var reply = await current.Send(new JsonObject { ["action"] = "status" });
            lock (gate)
            {
                if (current != session || generation != sessionGeneration) return;
                Apply(reply);
            }
            if (reply.Status is "acknowledged" or "configuration-ready" or "unavailable" or "cancelled" || pairingState == "unavailable") await EndPolledSession(current);
        }
        catch { await EndPolledSession(current); }
        finally { lock (gate) polling = false; }
    }

    private Task EndPolledSession(IBridgePairingSession current)
    {
        lock (gate)
            return activeAction?.StartsWith("pairing-", StringComparison.Ordinal) == true
                ? Task.CompletedTask : EndSession(current);
    }

    private async Task Cancel(Request request)
    {
        IBridgePairingSession? current;
        lock (gate) { current = session; sessionGeneration++; }
        try { if (current is not null) await current.Send(new JsonObject { ["action"] = "cancel" }); }
        catch { }
        finally
        {
            if (current is not null) await EndSession(current);
            lock (gate) { Post(request, new("done")); ids.Remove((request.Epoch, request.Id)); }
        }
    }

    private Task EndSession(IBridgePairingSession? expected = null)
    {
        lock (gate)
        {
            if (expected is not null && session != expected) return Task.CompletedTask;
            if (session is null) return ending;
            var current = session; var callback = release;
            session = null; release = null; sessionGeneration++;
            invitation = null; endpoint = null; fingerprint = null; pairingState = "idle";
            timer?.Stop(); timer?.Dispose(); timer = null;
            ending = DisposeSession(current, callback);
            return ending;
        }
    }

    private async Task DisposeSession(IBridgePairingSession current, Action<bool>? callback)
    {
        try { await current.DisposeAsync(); }
        catch { }
        finally
        {
            try { callback?.Invoke(current.ExitVerified); }
            finally
            {
                lock (ownerGate) if (pairingOwner == this) pairingOwner = null;
                RefreshFilesNow();
            }
        }
    }

    private void Replace()
    {
        epoch++;
        while (queue.TryDequeue(out var request)) { ids.Remove((request.Epoch, request.Id)); actions.Remove(request.Action); }
        _ = EndSession();
    }
    internal Task EndPairingAsync() => EndSession();
    internal Task WhenIdle => drain;
    internal void DocumentReplaced(long next) { lock (gate) { Replace(); document = next; } }
    internal Task CloseAsync() { lock (gate) { if (!closed) { closed = true; Replace(); } return ending; } }
    public void Dispose() { lock (gate) { if (!closed) _ = CloseAsync(); } }

    internal static void SelfTest()
    {
        var context = SynchronizationContext.Current;
        try { SynchronizationContext.SetSynchronizationContext(null); RunSelfTest().GetAwaiter().GetResult(); }
        catch (Exception error) when (error is not InvalidOperationException)
        { throw new InvalidOperationException("Settings bridge self-test failed."); }
        finally { SynchronizationContext.SetSynchronizationContext(context); }
    }

    private sealed class TestSession : IBridgePairingSession
    {
        internal readonly List<JsonObject> Commands = new();
        internal string PollState = "hosting", JoinState = "acknowledged", IdentityState = "identity-ready";
        internal bool VerifyExit = true;
        internal TaskCompletionSource<TlsSetupReply>? HeldConfirm;
        internal TaskCompletionSource<TlsSetupReply>? HeldStatus;
        internal TaskCompletionSource<TlsSetupReply>? Held;
        internal bool Disposed;
        public bool ExitVerified { get; private set; }
        public Task<TlsSetupReply> Send(JsonObject command)
        {
            Commands.Add(command.DeepClone().AsObject());
            Check(!command.ContainsKey("id"), "Page id entered control command");
            var action = command["action"]!.GetValue<string>();
            if (action == "host-confirm" && HeldConfirm is not null) return HeldConfirm.Task;
            if (action == "host-start" && Held is not null) return Held.Task;
            if (action == "status" && HeldStatus is not null) return HeldStatus.Task;
            var state = action switch
            {
                "identity-status" => IdentityState, "host-start" => "hosting", "join-claim" => "awaiting-confirmation",
                "host-confirm" => "configuration-ready", "join-confirm" => JoinState, "cancel" => "cancelled", "status" => PollState,
                _ => "unavailable"
            };
            return Task.FromResult(new TlsSetupReply(1, state, state == "hosting" ? "observatory-pair:v1:c3ludGhldGlj" : null,
                state == "confirming" ? new string('a', 64) : null));
        }
        public Task<TlsSetupReply> PrepareIdentity(bool consent)
        {
            Check(consent, "Identity consent missing");
            Commands.Add(new JsonObject { ["action"] = "identity-create" });
            return Task.FromResult(new TlsSetupReply(1, "identity-ready", null, null));
        }
        public ValueTask DisposeAsync() { Disposed = true; ExitVerified = VerifyExit; return ValueTask.CompletedTask; }
    }

    private sealed class TestHost(string runtime) : IBridgeHost
    {
        private readonly BridgeSettingsStore settings = new(runtime);
        internal readonly System.Collections.Concurrent.ConcurrentQueue<string> Calls = new();
        internal readonly List<ProcessStartInfo> Scripts = new();
        internal JsonObject Configuration = new() { ["activity"] = true, ["codex"] = true, ["claude"] = false, ["wispr"] = false, ["quota"] = true };
        internal bool Consent = true, Startup, Reserved, FailReads;
        internal int Dialogs, Releases;
        internal Action? InDialog;
        internal string? ExportFile;
        internal TaskCompletionSource<bool>? RefreshWait, UpdateWait;
        internal TestSession? Session;
        internal Func<TestSession>? MakeSession;
        internal int ScriptExit;
        public BridgeSettingsStore Settings { get { Calls.Enqueue("settings"); return settings; } }
        public DateTimeOffset Now { get; set; } = new(2026, 10, 14, 12, 0, 0, TimeSpan.Zero);
        public Version? AppVersion { get; set; } = new(1, 2, 3, 4);
        public bool CollectorBusy { get; set; }
        public bool CollectionPaused { get; set; }
        public bool NativePairingOpen { get; set; }
        public bool NativeDialogOpen { get; set; }
        internal bool CopyThrows, ScriptThrows;
        public bool Confirm(string title, string text) { Calls.Enqueue("confirm:" + title); Dialogs++; InDialog?.Invoke(); return Consent; }
        public string? ChooseExportFile() { Calls.Enqueue("export"); InDialog?.Invoke(); return ExportFile; }
        public void CopyInvitation(string value) { if (CopyThrows) throw new InvalidOperationException("Synthetic clipboard failure"); Check(value.StartsWith("observatory-pair:v1:", StringComparison.Ordinal), "Clipboard value"); Calls.Enqueue("copy"); }
        public Task RefreshAllowancesThenAll() { Calls.Enqueue("refresh-all"); return (Task?)RefreshWait?.Task ?? Task.CompletedTask; }
        public Task Refresh() { Calls.Enqueue("refresh"); return Task.CompletedTask; }
        public Task CheckUpdates() { Calls.Enqueue("updates"); InDialog?.Invoke(); return (Task?)UpdateWait?.Task ?? Task.CompletedTask; }
        public void OpenDashboard(string section) => Calls.Enqueue("open:" + section);
        public JsonObject ReadConfiguration() { Calls.Enqueue("config-read"); if (FailReads) throw new IOException("Synthetic read failure"); return Configuration.DeepClone().AsObject(); }
        public void UpdateConfiguration(JsonObject expected, JsonObject desired)
        {
            Check(JsonNode.DeepEquals(expected, Configuration) && desired.Count == 5, "Configuration fence");
            Configuration = desired.DeepClone().AsObject(); Calls.Enqueue("config-write");
        }
        public void StartCollector() => Calls.Enqueue("start");
        public bool ReadStartup() { Calls.Enqueue("startup-read"); if (FailReads) throw new IOException("Synthetic read failure"); return Startup; }
        public void SetStartup(bool enabled) { Startup = enabled; Calls.Enqueue("startup-write"); }
        public Task<QuotaSharingStatus> Sharing(string action, string? token, SharingChannel channel)
        {
            Calls.Enqueue("sharing:" + action + ":" + channel);
            return Task.FromResult(new QuotaSharingStatus(action == "enable", true, "ready", new string('a', 64)));
        }
        public Action<bool> BeginDirectPairing()
        {
            if (CollectorBusy || Reserved) throw new InvalidOperationException("Reserved");
            Calls.Enqueue("reserve"); Reserved = true;
            return verified => { Reserved = false; Releases++; CollectionPaused = !verified; Calls.Enqueue("release"); };
        }
        public IBridgePairingSession CreatePairingSession() { Calls.Enqueue("session"); return Session = MakeSession?.Invoke() ?? new(); }
        public Task DisconnectPairing() { Calls.Enqueue("disconnect"); return Maintenance(); }
        public Task PreparePairingRepair() { Calls.Enqueue("repair"); return Maintenance(); }
        private Task Maintenance()
        {
            CollectionPaused = true;
            if (CollectorBusy) throw new InvalidOperationException("Busy");
            CollectionPaused = false; return Task.CompletedTask;
        }
        public Task<BridgeScriptResult> RunScript(ProcessStartInfo start)
        {
            if (ScriptThrows) throw new InvalidOperationException("Synthetic missing script");
            Calls.Enqueue("script:" + Path.GetFileName(start.ArgumentList[0])); Scripts.Add(start);
            return Task.FromResult(new BridgeScriptResult(ScriptExit, "Synthetic output must stay private"));
        }
        public Task<string> ReadTailscaleStatus() { Calls.Enqueue("tailscale"); return Task.FromResult("running"); }
    }

    private static void Check(bool passed, string reason)
    {
        if (!passed) throw new InvalidOperationException(reason);
    }

    private static readonly HashSet<string> TestedActions = new(StringComparer.Ordinal);

    private static async Task RunSelfTest()
    {
        var runtime = Path.Combine(Path.GetTempPath(), "observatory-settings-bridge-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(runtime);
        try
        {
            TestedActions.Clear();
            using (var initial = new BridgeHandler(new TestHost(runtime), runtime))
            {
                var refusedPosts = new List<string>();
                initial.Receive("{\"id\":1,\"action\":\"refresh\",\"args\":{}}", TestDriver.Origin, 1, refusedPosts.Add);
                Check(refusedPosts.Count == 1 && JsonNode.Parse(refusedPosts[0])!["bridgeResult"]!["code"]!.GetValue<string>() == "refused", "Message before document");
            }
            var probeHost = new TestHost(runtime);
            var lines = new List<string>();
            var posts = new List<string>();
            using (var probeHandler = new BridgeHandler(probeHost, runtime, lines.Add))
            {
                probeHost.Calls.Clear();
                probeHandler.DocumentReplaced(1);
                probeHandler.Receive("{\"id\":1,\"action\":\"refresh\",\"args\":{}}", TestDriver.Origin, 1, posts.Add);
                Check(probeHost.Calls.IsEmpty && posts.Single().Contains("\"code\":\"cancelled\"") &&
                    lines.SequenceEqual(new[] { "accepted action=refresh" }), "Probe action isolation");
                probeHandler.Receive("{\"id\":2,\"action\":\"status\",\"args\":{}}", TestDriver.Origin, 1, posts.Add);
                Check(JsonNode.Parse(posts.Last())!["bridgeResult"]!["value"]!["version"]!.GetValue<int>() == 1,
                    "Probe status");
                probeHandler.Receive("{\"id\":3,\"action\":\"tailscale-check\",\"args\":{}}", TestDriver.Origin, 1, posts.Add);
                Check(!probeHost.Calls.Contains("tailscale") && !probeHost.Calls.Any(c => c.StartsWith("sharing:")), "Probe cache isolation");
            }
            await TestMessages(runtime);
            await TestCache(runtime);
            await TestQueue(runtime);
            await TestConsent(runtime);
            await TestDialogReload(runtime);
            await TestPairing(runtime);
            await TestStorageAndProcesses(runtime);
            Check(BridgeContract.Actions.Entries.All(a => TestedActions.Contains(a.Key)), "Missing action coverage");
            Console.WriteLine("Settings bridge contracts passed.");
        }
        finally { Directory.Delete(runtime, recursive: true); }
    }

    private sealed class TestDriver : IDisposable
    {
        internal readonly TestHost Host;
        internal readonly BridgeHandler Handler;
        internal readonly List<string> Posts = new();
        private readonly Dictionary<int, string> requests = new();
        internal int NextId;
        internal long Document = 1;
        internal const string Origin = "https://observatory.invalid/dashboard.html#settings";
        internal TestDriver(string runtime) { Host = new(runtime); Handler = new(Host, runtime); Handler.DocumentReplaced(1); }
        internal int Send(string action, JsonObject? args = null, int? id = null)
        {
            int number = id ?? ++NextId;
            requests[number] = action; TestedActions.Add(action);
            Handler.Receive(new JsonObject { ["id"] = number, ["action"] = action, ["args"] = args ?? new() }.ToJsonString(), Origin, Document, Posts.Add);
            return number;
        }
        internal async Task<JsonObject> Run(string action, JsonObject? args = null, string code = "done")
        {
            int id = Send(action, args);
            await Handler.drain;
            var value = Result(id);
            Check(value["code"]!.GetValue<string>() == code, "Action result: " + action);
            return value;
        }
        internal JsonObject Result(int id)
        {
            var result = Posts.Select(p => JsonNode.Parse(p)!["bridgeResult"]!.AsObject()).Last(p => p["id"]!.GetValue<int>() == id);
            bool valueAction = result.ContainsKey("value");
            var keys = valueAction ? new[] { "id", "ok", "code", "value" } : new[] { "id", "ok", "code" };
            Check(result.Select(p => p.Key).Order().SequenceEqual(keys.Order()), "Result shape");
            Check(!valueAction || requests[id] is "status" or "tailscale-check" or "pairing-host-start", "Unexpected result value");
            if (result["code"]!.GetValue<string>() == "done" && requests[id] is "status" or "tailscale-check" or "pairing-host-start")
                Check(valueAction, "Missing result value");
            Check(result["ok"]!.GetValue<bool>() == (result["code"]!.GetValue<string>() == "done"), "Result success flag");
            return result;
        }
        public void Dispose() { Handler.CloseAsync().GetAwaiter().GetResult(); Handler.cacheWork.GetAwaiter().GetResult(); }
    }

    private static JsonObject HostArgs() => new() { ["address"] = "192.168.1.2", ["port"] = 43128 };
    private static JsonObject ShareArgs(bool enabled) => enabled
        ? new() { ["channel"] = "codex-limits", ["enabled"] = true, ["token"] = new string('a', 64) }
        : new() { ["channel"] = "codex-limits", ["enabled"] = false };

    private static async Task TestMessages(string runtime)
    {
        using var test = new TestDriver(runtime);
        string valid = "{\"id\":1,\"action\":\"status\",\"args\":{}}";
        foreach (var source in new[] { "https://observatory.invalid/panel.html", "https://observatory.invalid/dashboard.html?demo",
            "https://example.invalid/dashboard.html", "http://observatory.invalid/dashboard.html", "https://observatory.invalid:444/dashboard.html",
            "https://user@observatory.invalid/dashboard.html", "https://observatory.invalid/dashboard.html?" })
            test.Handler.Receive(valid, source, 1, test.Posts.Add);
        foreach (var text in new string?[] { null, "{", new string(' ', 4097), "[]" })
            test.Handler.Receive(text, TestDriver.Origin, 1, test.Posts.Add);
        Check(test.Posts.Count == 0, "Ignored messages posted");
        foreach (var text in new[] { "{\"id\":7,\"action\":\"unknown\",\"args\":{}}",
            "{\"id\":7,\"action\":\"status\",\"args\":{},\"extra\":true}",
            "{\"id\":7,\"action\":\"set-startup\",\"args\":{\"enabled\":true,\"enabled\":false}}" })
        {
            test.Handler.Receive(text, TestDriver.Origin, 1, test.Posts.Add);
            Check(test.Posts[^1] == "{\"bridgeResult\":{\"id\":7,\"ok\":false,\"code\":\"refused\"}}", "Refused envelope");
        }
        test.Host.CollectorBusy = true;
        var status = (await test.Run("status"))["value"]!.AsObject();
        Check(status.Select(p => p.Key).Order().SequenceEqual(new[] { "version", "app", "sources", "skin", "deviceName", "startup", "appearance", "limitsConsent", "collectionPaused", "pairing", "sharing" }.Order()), "Status keys");
        Check(BridgeContract.Data["status"]["fields"].Items.Select(i => i.Text).Order().SequenceEqual(status.Select(p => p.Key).Order()), "Status keys match the contract");
        Check(!status["collectionPaused"]!.GetValue<bool>(), "Collection not paused at rest");
        Check(Encoding.UTF8.GetByteCount(status.ToJsonString()) <= 16384 && !status.ToJsonString().Contains("\"invitation\""), "Status privacy");
        foreach (var channel in new[] { "codex-limits", "claude-code-tokens" })
            Check(status["sharing"]![channel]!.ToJsonString() == "{\"enabled\":false,\"canEnable\":false,\"reason\":\"pairing-unavailable\",\"token\":null}", "Unread sharing state");
        Check(!test.Host.Calls.Any(c => c.StartsWith("sharing:", StringComparison.Ordinal)), "Busy collector read sharing");
        await test.Handler.cacheWork;
        Check((await test.Run("tailscale-check"))["value"]!["status"]!.GetValue<string>() == "running", "Tailscale cache");
        var count = test.Host.Calls.Count(c => c == "tailscale");
        await test.Run("status"); await test.Handler.cacheWork;
        Check(test.Host.Calls.Count(c => c == "tailscale") == count, "Cache throttle");
        test.Host.Now += TimeSpan.FromSeconds(6); test.Host.CollectorBusy = false;
        await test.Run("status"); await test.Handler.cacheWork;
        Check(test.Host.Calls.Contains("sharing:status:Quota") && test.Host.Calls.Contains("sharing:status:ProviderTokens"), "Channel cache reads");
        test.Host.AppVersion = null;
        await test.Run("status", code: "unavailable");
        test.Host.AppVersion = new(1, 2, 3, 4);
        await test.Run("refresh"); await test.Run("check-updates");
        await test.Run("open-dashboard", new() { ["section"] = "tokens" }); await test.Run("open-settings");
        await test.Run("set-source", new() { ["source"] = "claude", ["enabled"] = true });
        await test.Run("set-startup", new() { ["enabled"] = true });
        await test.Run("set-skin", new() { ["skin"] = "almanac" });
        await test.Run("set-appearance", new() { ["mode"] = "dark" });
        await test.Run("set-device-name", new() { ["name"] = "  Fictional PC\u3000" });
        Check(test.Host.Settings.ReadViewer() == ("almanac", "dark") && test.Host.Settings.ReadDevice() == "Fictional PC", "Settings actions");
        await test.Run("set-device-name", new() { ["name"] = null });
        await test.Run("set-limits-consent", new() { ["enabled"] = true });
        await test.Run("set-limits-consent", new() { ["enabled"] = false });
        Check(test.Host.Scripts[0].ArgumentList.Skip(1).SequenceEqual(new[] { "set", "--runtime", runtime, "--consent" }) &&
            test.Host.Scripts[1].ArgumentList.Skip(1).SequenceEqual(new[] { "clear", "--runtime", runtime }), "Consent arguments");
        await test.Run("set-sharing", ShareArgs(true)); await test.Run("set-sharing", ShareArgs(false));
        var provider = ShareArgs(true); provider["channel"] = "claude-code-tokens";
        await test.Run("set-sharing", provider);
        Check(test.Host.Calls.Contains("sharing:enable:ProviderTokens"), "Provider sharing channel");
        await test.Run("export-data", code: "cancelled");
        test.Host.ExportFile = Path.Combine(runtime, "synthetic.observatory");
        await test.Run("export-data");
        Check(test.Host.Scripts[^1].ArgumentList.Skip(1).SequenceEqual(new[] { "export", "--runtime", runtime, "--out", test.Host.ExportFile }), "Export arguments");
        Check(test.Posts.All(p => !p.Contains(runtime) && !p.Contains("Synthetic output")), "Export privacy");
        test.Host.ScriptExit = 1;
        await test.Run("export-data", code: "unavailable");
        await test.Run("set-skin", new() { ["skin"] = "custom" }, "refused");
        await test.Run("complete-setup", code: "unavailable");
        foreach (var call in new[] { "refresh-all", "updates", "open:tokens", "open:settings", "config-write", "start", "startup-write", "settings",
            "script:claude-limits-consent.mjs", "script:observatory-file.mjs", "sharing:enable:Quota", "sharing:disable:Quota" })
            Check(test.Host.Calls.Contains(call), "Missing host action " + call);
    }

    private static async Task TestCache(string runtime)
    {
        using var test = new TestDriver(runtime);
        var first = await test.Run("tailscale-check");
        Check(first["value"]!["status"]!.GetValue<string>() == "unavailable", "Unread Tailscale state");
        await test.Handler.cacheWork;
        var cached = await test.Run("status");
        Check(cached["value"]!["sharing"]!["codex-limits"]!["canEnable"]!.GetValue<bool>(), "Sharing cache success");
        Check(test.Host.Calls.Count(c => c == "tailscale") == 1 && test.Host.Calls.Count(c => c.StartsWith("sharing:status:", StringComparison.Ordinal)) == 2, "Cache single refresh");
        var root = Path.Combine(runtime, "cache");
        Directory.CreateDirectory(Path.Combine(root, "claude-limits"));
        Directory.CreateDirectory(Path.Combine(root, "private-sync"));
        var store = new BridgeSettingsStore(root);
        store.WriteViewer("instrument", "dark");
        store.WriteDevice("Fictional PC");
        var consent = Path.Combine(root, "claude-limits", "consent.json");
        var pairing = Path.Combine(root, "private-sync", "pairing.json");
        File.WriteAllText(consent, "{\"consent\":true}");
        File.WriteAllText(pairing, "{}");
        using var local = new TestDriver(root);
        var initial = (await local.Run("status"))["value"]!;
        await local.Handler.cacheWork;
        Check(initial["skin"]!["current"]!.GetValue<string>() == "instrument" &&
            initial["deviceName"]!.GetValue<string>() == "Fictional PC" && initial["limitsConsent"]!.GetValue<bool>() &&
            initial["pairing"]!["transport"]!.GetValue<string>() == "ssh", "Initial file cache");
        local.Host.Calls.Clear();
        store.WriteViewer("almanac", "light");
        store.WriteDevice("Updated PC");
        File.WriteAllText(consent, "{\"consent\":false}");
        File.WriteAllText(Path.Combine(root, "private-sync", "revoked"), "");
        local.Host.Startup = true;
        local.Host.Configuration["claude"] = true;
        var old = (await local.Run("status"))["value"]!;
        Check(local.Host.Calls.IsEmpty && JsonNode.DeepEquals(old, (await local.Run("status"))["value"]),
            "Status performed file or registry reads");
        Check(old["deviceName"]!.GetValue<string>() == "Fictional PC", "File cache throttle");
        local.Host.Now += TimeSpan.FromSeconds(5);
        await local.Run("status"); await local.Handler.cacheWork;
        var updated = (await local.Run("status"))["value"]!;
        Check(updated["skin"]!["current"]!.GetValue<string>() == "almanac" &&
            updated["appearance"]!.GetValue<string>() == "light" && updated["deviceName"]!.GetValue<string>() == "Updated PC" &&
            !updated["limitsConsent"]!.GetValue<bool>() && updated["startup"]!.GetValue<bool>() &&
            updated["sources"]!["claude"]!.GetValue<bool>() && updated["pairing"]!["state"]!.GetValue<string>() == "unpaired",
            "Background file cache refresh");
        File.WriteAllText(Path.Combine(root, "viewer.json"), "{");
        File.WriteAllText(Path.Combine(root, "device.json"), "{");
        File.WriteAllText(consent, "{");
        File.Delete(pairing); Directory.CreateDirectory(pairing);
        local.Host.FailReads = true;
        local.Host.Now += TimeSpan.FromSeconds(5);
        await local.Run("status"); await local.Handler.cacheWork;
        Check(JsonNode.DeepEquals(updated, (await local.Run("status"))["value"]), "Failed refresh lost cached values");
        local.Host.FailReads = false;
        await local.Run("set-device-name", new() { ["name"] = "Immediate PC" });
        await local.Run("set-startup", new() { ["enabled"] = false });
        await local.Run("set-source", new() { ["source"] = "claude", ["enabled"] = false });
        await local.Run("set-skin", new() { ["skin"] = "amber-crt" });
        await local.Run("set-appearance", new() { ["mode"] = "dark" });
        var immediate = (await local.Run("status"))["value"]!;
        Check(immediate["deviceName"]!.GetValue<string>() == "Immediate PC" && !immediate["startup"]!.GetValue<bool>() &&
            !immediate["sources"]!["claude"]!.GetValue<bool>() && immediate["skin"]!["current"]!.GetValue<string>() == "amber-crt" &&
            immediate["appearance"]!.GetValue<string>() == "dark", "Action did not refresh file cache");

    }

    private static async Task TestQueue(string runtime)
    {
        using var test = new TestDriver(runtime);
        test.Host.RefreshWait = new(TaskCreationOptions.RunContinuationsAsynchronously);
        int first = test.Send("refresh");
        test.Send("refresh", id: first);
        Check(test.Result(first)["code"]!.GetValue<string>() == "refused", "Duplicate id");
        int repeat = test.Send("refresh");
        Check(test.Result(repeat)["code"]!.GetValue<string>() == "busy", "Duplicate action");
        test.Send("check-updates"); test.Send("open-settings"); test.Send("set-startup", new() { ["enabled"] = true });
        test.Send("open-dashboard", new() { ["section"] = "limits" });
        int overflow = test.Send("set-appearance", new() { ["mode"] = "system" });
        Check(test.Result(overflow)["code"]!.GetValue<string>() == "busy", "Queue bound");
        int status = test.Send("status"); int cancel = test.Send("pairing-cancel");
        Check(test.Result(status)["code"]!.GetValue<string>() == "done" && test.Result(cancel)["code"]!.GetValue<string>() == "done", "Immediate actions");
        int pairing = test.Send("pairing-host-start", HostArgs());
        Check(test.Result(pairing)["code"]!.GetValue<string>() == "busy", "Pairing during refresh");
        test.Host.RefreshWait.SetResult(true); await test.Handler.drain;
        var ordered = test.Host.Calls.Where(c => c is "refresh-all" or "updates" or "open:settings" or "startup-write" or "open:limits").ToArray();
        Check(ordered.SequenceEqual(new[] { "refresh-all", "updates", "open:settings", "startup-write", "open:limits" }), "Queue FIFO");
        test.Host.InDialog = () =>
        {
            int busy = test.Send("open-settings");
            Check(test.Result(busy)["code"]!.GetValue<string>() == "busy", "Dialog busy");
            int read = test.Send("status"); int stop = test.Send("pairing-cancel");
            Check(test.Result(read)["code"]!.GetValue<string>() != "busy" && test.Result(stop)["code"]!.GetValue<string>() != "busy", "Dialog immediate");
        };
        await test.Run("set-limits-consent", new() { ["enabled"] = true });
        await test.Run("export-data", code: "cancelled");
        await test.Run("check-updates");
        test.Host.InDialog = null;
        test.Host.NativeDialogOpen = true;
        await test.Run("refresh", code: "busy");
        await test.Run("status");
        await test.Run("pairing-cancel");
        test.Host.NativeDialogOpen = false;
        foreach (var paused in new[] { false, true })
        {
            test.Host.CollectorBusy = !paused;
            test.Host.CollectionPaused = paused;
            int calls = test.Host.Calls.Count;
            await test.Run("refresh", code: "busy");
            await test.Run("set-source", new() { ["source"] = "quota", ["enabled"] = false }, "busy");
            Check(test.Host.Calls.Count == calls, "Busy collector side effects");
        }
        test.Host.CollectorBusy = test.Host.CollectionPaused = false;
        test.Host.UpdateWait = new(TaskCreationOptions.RunContinuationsAsynchronously);
        int old = test.Send("check-updates"); test.Handler.DocumentReplaced(2);
        test.Host.UpdateWait.SetResult(true); await test.Handler.drain;
        Check(!test.Posts.Any(p => JsonNode.Parse(p)!["bridgeResult"]!["id"]!.GetValue<int>() == old), "Replaced document result");
        int count = test.Posts.Count;
        test.Send("status");
        Check(test.Posts.Count == count, "Old document message");
        test.Document = 4;
        test.Send("status");
        Check(test.Posts.Count == count, "Future document message");
        test.Document = 2; test.Host.UpdateWait = new(TaskCreationOptions.RunContinuationsAsynchronously);
        old = test.Send("check-updates"); test.Handler.DocumentReplaced(3); test.Document = 3; test.Send("status");
        test.Host.UpdateWait.SetResult(true); await test.Handler.drain;
        Check(!test.Posts.Any(p => JsonNode.Parse(p)!["bridgeResult"]!["id"]!.GetValue<int>() == old), "Different document result");
    }

    private static async Task TestConsent(string runtime)
    {
        using var test = new TestDriver(runtime);
        test.Host.ScriptThrows = true;
        await test.Run("set-limits-consent", new() { ["enabled"] = true }, "unavailable");
        test.Host.ScriptThrows = false;
        test.Host.Dialogs = 0;
        test.Host.Consent = false;
        await test.Run("set-source", new() { ["source"] = "quota", ["enabled"] = false }, "cancelled");
        await test.Run("set-sharing", ShareArgs(true), "cancelled");
        await test.Run("pairing-identity-create", code: "cancelled");
        await test.Run("set-limits-consent", new() { ["enabled"] = true }, "cancelled");
        await test.Run("pairing-disconnect", code: "cancelled");
        await test.Run("pairing-repair-prepare", code: "cancelled");
        Check(test.Host.Dialogs == 6 && !test.Host.Calls.Any(c => c is "config-write" or "reserve" or "disconnect" or "repair" ||
            c.StartsWith("sharing:", StringComparison.Ordinal) || c.StartsWith("script:", StringComparison.Ordinal)), "Declined consent changed state");
        int dialogs = test.Host.Dialogs;
        await test.Run("set-source", new() { ["source"] = "quota", ["enabled"] = true });
        await test.Run("set-sharing", ShareArgs(false));
        Check(test.Host.Dialogs == dialogs, "Unneeded consent");
        test.Host.Consent = true;
        await test.Run("pairing-disconnect"); await test.Run("pairing-repair-prepare");
        Check(test.Host.Calls.Contains("disconnect") && test.Host.Calls.Contains("repair") && test.Host.Calls.Count(c => c == "refresh") == 2, "Maintenance calls");
        test.Host.InDialog = () => test.Host.CollectorBusy = true;
        await test.Run("pairing-disconnect", code: "busy");
        Check(test.Host.CollectionPaused, "Busy maintenance lost pause");
        var paused = (await test.Run("status"))["value"]!;
        Check(paused["pairing"]!["state"]!.GetValue<string>() == "unavailable" && paused["collectionPaused"]!.GetValue<bool>(), "Pause status");
    }

    private static async Task TestDialogReload(string runtime)
    {
        foreach (var action in new[] { "set-source", "set-sharing", "pairing-disconnect", "export-data",
            "set-limits-consent", "pairing-repair-prepare", "pairing-identity-create" })
        {
            using var test = new TestDriver(runtime);
            test.Host.ExportFile = Path.Combine(runtime, "synthetic.observatory");
            test.Host.InDialog = () => test.Handler.DocumentReplaced(2);
            test.Send(action, action switch
            {
                "set-source" => new JsonObject { ["source"] = "quota", ["enabled"] = false },
                "set-sharing" => ShareArgs(true),
                "set-limits-consent" => new JsonObject { ["enabled"] = true },
                _ => null
            });
            await test.Handler.drain;
            Check(test.Host.Dialogs == 1 || action == "export-data", "Reload dialog not exercised");
            Check(!test.Host.Calls.Any(c => c is "config-write" or "start" or "disconnect" or "repair" or "reserve" ||
                c.StartsWith("sharing:", StringComparison.Ordinal) || c.StartsWith("script:", StringComparison.Ordinal)),
                "Reloaded dialog changed state: " + action);
            Check(test.Posts.Count == 0, "Reloaded dialog posted to stale document");
        }
    }

    private static async Task TestPairing(string runtime)
    {
        using var test = new TestDriver(runtime);
        await test.Run("pairing-copy-invitation", code: "unavailable");
        await test.Run("pairing-identity-create");
        Check(test.Host.Session!.Disposed && test.Host.Releases == 1 && !test.Host.Reserved &&
            test.Host.Session.Commands.Any(c => c["action"]!.GetValue<string>() == "identity-create"), "Identity reservation");
        var start = await test.Run("pairing-host-start", HostArgs());
        Check(start["value"]!["invitation"]!.GetValue<string>() == "observatory-pair:v1:c3ludGhldGlj", "Invitation result");
        var session = test.Host.Session!;
        Check(session.Commands.Count == 2 && session.Commands[0]["action"]!.GetValue<string>() == "identity-status" &&
            session.Commands[1]["port"]!.GetValue<int>() == 0, "Identity before hosting");
        test.Host.CopyThrows = true;
        await test.Run("pairing-copy-invitation", code: "unavailable");
        Check(!session.Disposed && test.Host.Reserved && (await test.Run("status"))["value"]!["pairing"]!["state"]!.GetValue<string>() == "waiting", "Clipboard failure preserves hosting");
        test.Host.CopyThrows = false;
        await test.Run("pairing-copy-invitation"); Check(test.Host.Calls.Contains("copy"), "Clipboard host call");
        var state = (await test.Run("status"))["value"]!;
        Check(state["pairing"]!["state"]!.GetValue<string>() == "waiting" && !state.ToJsonString().Contains("observatory-pair:"), "Hosting status privacy");
        Check(state["collectionPaused"]!.GetValue<bool>(), "Hosting holds collection");
        foreach (var action in new[] { "refresh", "set-sharing", "pairing-disconnect", "pairing-repair-prepare" })
            await test.Run(action, action == "set-sharing" ? ShareArgs(false) : null, "busy");
        session.PollState = "confirming"; await test.Handler.PollAsync();
        Check((await test.Run("status"))["value"]!["pairing"]!["peerFingerprint"]!.GetValue<string>() == new string('a', 64), "Poll fingerprint");
        session.HeldConfirm = new(TaskCreationOptions.RunContinuationsAsynchronously);
        int confirming = test.Send("pairing-host-confirm", new() { ["fingerprint"] = new string('a', 64), ["peerAddress"] = "192.168.1.3", ["peerPort"] = 43129 });
        session.PollState = "configuration-ready";
        await test.Handler.PollAsync();
        Check(!session.Disposed && test.Host.Reserved, "Poll ended active confirmation");
        session.HeldConfirm.SetResult(new(1, "configuration-ready", null, null));
        await test.Handler.drain;
        Check(test.Result(confirming)["code"]!.GetValue<string>() == "done", "Active confirmation result");
        var command = session.Commands.Last(c => c["action"]!.GetValue<string>() == "host-confirm");
        Check(command.Count == 4 && command["localEndpoint"]!.ToJsonString() == "{\"kind\":\"tls\",\"address\":\"192.168.1.2\",\"port\":43128}" && session.Disposed && !test.Host.Reserved, "Host confirmation endpoint");
        await test.Run("pairing-join-claim", new() { ["invitation"] = "observatory-pair:v1:c3ludGhldGlj" });
        session = test.Host.Session!; session.JoinState = "local-ready";
        await test.Run("pairing-join-confirm", code: "unavailable"); Check(!session.Disposed, "Join retry ended session");
        session.JoinState = "acknowledged"; await test.Run("pairing-join-confirm");
        Check(session.Disposed && session.Commands.Last().Count == 1, "Join completion");
        await test.Run("pairing-host-start", HostArgs());
        session = test.Host.Session!; await test.Run("pairing-cancel");
        Check(session.Disposed && !test.Host.Reserved && session.Commands.Last()["action"]!.GetValue<string>() == "cancel", "Cancel reservation");
        await test.Run("pairing-copy-invitation", code: "unavailable");
        await test.Run("pairing-host-start", HostArgs());
        test.Host.Now += TimeSpan.FromMinutes(10); await test.Handler.PollAsync();
        Check(test.Host.Session!.Disposed && !test.Host.Reserved, "Session deadline");
        test.Host.NativePairingOpen = true;
        await test.Run("pairing-host-start", HostArgs(), "busy"); await test.Run("pairing-cancel");
        test.Host.NativePairingOpen = false;
        test.Host.MakeSession = () => new TestSession { Held = new(TaskCreationOptions.RunContinuationsAsynchronously) };
        int pending = test.Send("pairing-host-start", HostArgs());
        session = test.Host.Session!;
        int cancelled = test.Send("pairing-cancel");
        Check(test.Result(cancelled)["code"]!.GetValue<string>() == "done" && session.Disposed, "Cancel concurrent command");
        session.Held!.SetResult(new(1, "hosting", "observatory-pair:v1:c3ludGhldGlj", null));
        await test.Handler.drain;
        Check(test.Result(pending)["code"]!.GetValue<string>() == "unavailable" && test.Handler.invitation is null, "Cancelled command revived invitation");
        foreach (var identityState in new[] { "identity-required", "identity-recovery-required" })
        foreach (var action in new[] { "pairing-host-start", "pairing-join-claim" })
        {
            test.Host.MakeSession = () => new TestSession { IdentityState = identityState };
            await test.Run(action, action == "pairing-host-start" ? HostArgs() : new() { ["invitation"] = "observatory-pair:v1:c3ludGhldGlj" }, "unavailable");
            Check(test.Host.Session!.Disposed && test.Host.Session.Commands.Count == 1, "Missing identity created automatically");
            var identityStatus = (await test.Run("status"))["value"]!["pairing"]!;
            Check(identityStatus["state"]!.GetValue<string>() == identityState && identityStatus["transport"]!.GetValue<string>() == "none", "Identity status retained");
            await test.Run("pairing-cancel");
            Check((await test.Run("status"))["value"]!["pairing"]!["state"]!.GetValue<string>() == identityState, "Identity status survives cancel");
            await test.Run("pairing-identity-create");
            Check((await test.Run("status"))["value"]!["pairing"]!["state"]!.GetValue<string>() != identityState, "Identity ready clears state");
            await test.Run(action, action == "pairing-host-start" ? HostArgs() : new() { ["invitation"] = "observatory-pair:v1:c3ludGhldGlj" }, "unavailable");
            test.Host.MakeSession = null;
            await test.Run("pairing-host-start", HostArgs());
            Check(test.Handler.identityState is null && (await test.Run("status"))["value"]!["pairing"]!["state"]!.GetValue<string>() == "waiting", "New session clears identity state");
            await test.Run("pairing-cancel");
        }
        test.Host.MakeSession = () => new TestSession { VerifyExit = false };
        await test.Run("pairing-host-start", HostArgs()); await test.Run("pairing-cancel");
        Check(test.Host.CollectionPaused && (await test.Run("status"))["value"]!["pairing"]!["state"]!.GetValue<string>() == "unavailable", "Unverified exit pause");
        test.Host.CollectionPaused = false;
        test.Host.MakeSession = null;
        await test.Run("pairing-host-start", HostArgs());
        session = test.Host.Session!;
        session.HeldStatus = new(TaskCreationOptions.RunContinuationsAsynchronously);
        var oldPoll = test.Handler.PollAsync();
        await test.Run("pairing-cancel"); await test.Run("pairing-host-start", HostArgs());
        session.HeldStatus.SetException(new InvalidOperationException("Synthetic poll failure"));
        await oldPoll;
        Check(!test.Host.Session!.Disposed && test.Host.Reserved, "Old poll ended new session");
        await test.Run("pairing-cancel");
        await test.Run("pairing-host-start", HostArgs()); test.Handler.DocumentReplaced(2); await test.Handler.ending;
        Check(test.Host.Session!.Disposed && !test.Host.Reserved, "Document pairing cleanup");
        test.Document++; await test.Run("pairing-host-start", HostArgs()); await test.Handler.CloseAsync();
        Check(test.Host.Session!.Disposed && !test.Host.Reserved, "Close pairing cleanup");
    }

    // Creating a symbolic link needs Developer Mode or an elevated account on Windows.
    private static bool TryLink(string path, string target)
    {
        try { File.CreateSymbolicLink(path, target); return true; }
        catch (Exception error) when (error is UnauthorizedAccessException or IOException)
        {
            Console.WriteLine("Settings bridge linked-file checks skipped: this account cannot create symbolic links.");
            return false;
        }
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateHardLink(string fileName, string existingFileName, IntPtr securityAttributes);

    private static bool TryHardLink(string path, string target)
    {
        if (CreateHardLink(path, target, IntPtr.Zero)) return true;
        Console.WriteLine("Settings bridge hard-link checks skipped: this filesystem cannot create hard links.");
        return false;
    }

    private static void TestHardLinks(string runtime)
    {
        var root = Path.Combine(runtime, "hard-links");
        Directory.CreateDirectory(root);
        var store = new BridgeSettingsStore(root);
        var target = Path.Combine(root, "target.json");
        var viewer = Path.Combine(root, "viewer.json");
        var device = Path.Combine(root, "device.json");
        var backup = viewer + ".bak";
        File.WriteAllText(target, "known synthetic bytes");
        if (!TryHardLink(backup, target)) return;
        void Refused(Action write)
        {
            bool refused = false;
            try { write(); } catch (IOException) { refused = true; }
            Check(refused, "Hard-linked settings write allowed");
        }
        var bytes = File.ReadAllBytes(target);
        File.WriteAllText(viewer, new string(' ', 2048));
        Refused(() => store.WriteViewer("almanac", "dark"));
        Check(File.ReadAllBytes(target).SequenceEqual(bytes) && new FileInfo(viewer).Length == 2048,
            "Hard-linked backup changed target");
        File.Delete(backup);
        File.Delete(viewer);
        File.WriteAllText(target, "{\"skin\":\"almanac\",\"appearance\":\"dark\"}");
        bytes = File.ReadAllBytes(target);
        if (!TryHardLink(viewer, target)) return;
        Refused(() => store.WriteViewer("instrument", "light"));
        Check(store.ReadViewer() == ("sage", "system") && File.ReadAllBytes(target).SequenceEqual(bytes), "Hard-linked viewer read or mutation");
        File.Delete(viewer);
        File.WriteAllText(target, "{\"name\":\"Fictional PC\"}");
        bytes = File.ReadAllBytes(target);
        if (!TryHardLink(device, target)) return;
        Refused(() => store.WriteDevice("Synthetic"));
        Refused(() => store.WriteDevice(null));
        Check(store.ReadDevice() is null && File.ReadAllBytes(target).SequenceEqual(bytes), "Hard-linked device read or mutation");
    }

    private static async Task TestStorageAndProcesses(string runtime)
    {
        TestHardLinks(runtime);
        var store = new BridgeSettingsStore(runtime);
        store.WriteViewer("instrument", "light"); Check(store.ReadViewer() == ("instrument", "light"), "Viewer round trip");
        var viewer = Path.Combine(runtime, "viewer.json");
        Check(JsonNode.Parse(File.ReadAllText(viewer))!.AsObject().Count == 2, "Viewer exact shape");
        foreach (var invalid in new[] { "{}", "{", "{\"skin\":\"sage\",\"appearance\":\"dark\",\"extra\":true}",
            "{\"skin\":\"sage\",\"skin\":\"almanac\",\"appearance\":\"dark\"}", "{\"skin\":\"custom\",\"appearance\":\"dark\"}",
            "{\"skin\":\"sage\",\"appearance\":\"auto\"}", new string(' ', 1025) })
        { File.WriteAllText(viewer, invalid); Check(store.ReadViewer() == ("sage", "system"), "Invalid viewer default"); }
        var oldViewer = File.ReadAllBytes(viewer);
        bool refused = false;
        try { store.WriteViewer("sage", "system", replace: false); } catch (IOException) { refused = true; }
        Check(refused && File.ReadAllBytes(viewer).SequenceEqual(oldViewer), "Oversized viewer migration refusal");
        File.WriteAllText(viewer + ".bak", "older synthetic backup");
        store.WriteViewer("sage", "system");
        Check(store.ReadViewer() == ("sage", "system") && File.ReadAllBytes(viewer + ".bak").SequenceEqual(oldViewer), "Oversized viewer write");
        File.Delete(viewer);
        store.WriteDevice("\u3000Fictional PC\u00a0");
        var device = Path.Combine(runtime, "device.json");
        Check(File.ReadAllText(device) == "{\"name\":\"Fictional PC\"}" && store.ReadDevice() == "Fictional PC", "Device exact shape and trimming");
        store.WriteDevice(null); Check(!File.Exists(device), "Device clear");
        File.WriteAllText(device, new string(' ', 1025)); store.WriteDevice(null);
        Check(!File.Exists(device), "Plain oversized device clear");
        var target = Path.Combine(runtime, "synthetic-link-target.json"); File.WriteAllText(target, "{}");
        foreach (var path in new[] { viewer, device })
        {
            if (!TryLink(path, target)) break;
            try
            {
                refused = false;
                try { if (path == viewer) store.WriteViewer("sage", "system"); else store.WriteDevice(null); } catch (IOException) { refused = true; }
                Check(refused && File.ReadAllText(target) == "{}", "Linked settings refusal");
                Check(path != viewer || store.ReadViewer() == ("sage", "system"), "Linked viewer read");
            }
            finally { File.Delete(path); }
        }
        File.Delete(viewer + ".bak");
        File.WriteAllBytes(viewer, oldViewer);
        if (TryLink(viewer + ".bak", target))
        {
            try
            {
                refused = false;
                try { store.WriteViewer("sage", "system"); } catch (IOException) { refused = true; }
                Check(refused && File.ReadAllBytes(viewer).SequenceEqual(oldViewer) && File.ReadAllText(target) == "{}", "Linked viewer backup refusal");
            }
            finally { File.Delete(viewer + ".bak"); }
        }
        Directory.CreateDirectory(viewer + ".bak");
        refused = false;
        try { store.WriteViewer("sage", "system"); } catch (IOException) { refused = true; }
        Check(refused && File.ReadAllBytes(viewer).SequenceEqual(oldViewer), "Viewer backup folder refusal");
        Directory.Delete(viewer + ".bak");
        File.Delete(viewer);
        Directory.CreateDirectory(viewer);
        refused = false;
        try { store.WriteViewer("sage", "system"); } catch (IOException) { refused = true; }
        Check(refused, "Viewer folder refusal");
        Directory.Delete(viewer);
        var consentFolder = Path.Combine(runtime, "claude-limits"); Directory.CreateDirectory(consentFolder);
        var consent = Path.Combine(consentFolder, "consent.json");
        foreach (var text in new[] { "{\"consent\":false}", "{\"consent\":\"true\"}", new string(' ', 4097) })
        { File.WriteAllText(consent, text); Check(!store.ReadLimitsConsent(), "Invalid consent"); }
        File.WriteAllText(consent, "{\"consent\":true}"); Check(store.ReadLimitsConsent(), "Stored consent");
        File.Delete(consent);
        if (TryLink(consent, target)) { Check(!store.ReadLimitsConsent(), "Linked consent"); File.Delete(consent); }
        var sync = Path.Combine(runtime, "private-sync"); Directory.CreateDirectory(sync);
        File.WriteAllText(Path.Combine(sync, "pairing.json"), "{}"); Check(store.ReadPairing() == ("paired", "ssh"), "SSH status");
        File.WriteAllText(Path.Combine(sync, "tls-trust.json"), "{}"); Check(store.ReadPairing() == ("paired", "tls"), "TLS status");
        using (var locked = new FileStream(Path.Combine(sync, "tls-trust.json"), FileMode.Open, FileAccess.ReadWrite, FileShare.None))
            Check(store.ReadPairing() == ("paired", "tls"), "Pairing status opened file contents");
        File.WriteAllText(Path.Combine(sync, "revoked"), ""); Check(store.ReadPairing() == ("unpaired", "none"), "Revoked status");
        File.Delete(Path.Combine(sync, "revoked"));
        if (TryLink(Path.Combine(sync, "revoked"), target))
        { Check(store.ReadPairing() == ("unavailable", "none"), "Linked pairing"); File.Delete(Path.Combine(sync, "revoked")); }
        var variables = new[] { "NODE_OPTIONS", "NODE_PATH", "NODE_EXTRA_CA_CERTS" };
        var old = variables.Select(Environment.GetEnvironmentVariable).ToArray();
        try
        {
            foreach (var variable in variables) Environment.SetEnvironmentVariable(variable, "synthetic");
            var start = BridgeProcesses.Create(runtime, "observatory-file.mjs", "export", "--runtime", runtime, "--out", target);
            Check(start.ArgumentList.SequenceEqual(new[] { Path.Combine(AppContext.BaseDirectory, "Collector", "scripts", "observatory-file.mjs"), "export", "--runtime", runtime, "--out", target }) &&
                start.FileName == Path.Combine(AppContext.BaseDirectory, "Runtime", "node.exe") && start.WorkingDirectory == runtime &&
                !start.UseShellExecute && start.CreateNoWindow && start.Arguments == "" && variables.All(v => !start.Environment.ContainsKey(v)), "Process argument and environment contract");
            refused = false;
            try { BridgeProcesses.Create(runtime, "unknown.mjs"); } catch (ArgumentException) { refused = true; }
            Check(refused, "Script allowlist");
        }
        finally { for (int i = 0; i < variables.Length; i++) Environment.SetEnvironmentVariable(variables[i], old[i]); }
        using var test = new TestDriver(runtime);
        await test.Run("set-device-name", new() { ["name"] = "Synthetic" });
        Check(test.Host.Calls.Contains("settings"), "Storage host boundary");
    }
}
