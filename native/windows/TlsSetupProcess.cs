using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace WorkspaceObservatory;

internal sealed record TlsSetupReply(int Id, string Status, string? Invitation, string? PeerCertificateSha256,
    string? Address = null, int? Port = null, bool? PortAvailable = null, string? PeerAddress = null)
{
    internal static TlsSetupReply Parse(string raw)
    {
        if (Encoding.UTF8.GetByteCount(raw) > 8192 || JsonNode.Parse(raw) is not JsonObject value ||
            value["id"] is not JsonValue idValue || !idValue.TryGetValue<int>(out var id) || id < 1 ||
            value["status"]?.GetValue<string>() is not string status)
            throw new InvalidOperationException("Invalid setup reply.");
        static bool Keys(JsonObject obj, params string[] keys) => obj.Count == keys.Length && keys.All(obj.ContainsKey);
        static bool AddressValid(JsonNode? node) => node is null || node is JsonValue text &&
            text.TryGetValue<string>(out var address) && BridgeContract.Validate(new JsonObject {
                ["id"] = 1, ["action"] = "pairing-host-start", ["args"] = new JsonObject {
                    ["address"] = address, ["port"] = 43128 } }.ToJsonString()).Outcome == "accepted";
        if (status == "ready")
        {
            if (!Keys(value, "id", "status", "address", "port", "portAvailable") || !AddressValid(value["address"]) ||
                value["port"] is not JsonValue portValue || !portValue.TryGetValue<int>(out var port) || port != 43128 ||
                (value["address"] is null) != (value["portAvailable"] is null) ||
                value["portAvailable"] is not null && (value["portAvailable"] is not JsonValue available || !available.TryGetValue<bool>(out _)))
                throw new InvalidOperationException("Invalid setup defaults.");
            return new(id, status, null, null, value["address"]?.GetValue<string>(), port, value["portAvailable"]?.GetValue<bool>());
        }
        if (status is not ("idle" or "working" or "waiting" or "confirming" or "inactive" or "hosting" or "cancelled" or
                "configuration-ready" or "awaiting-confirmation" or "local-ready" or "acknowledged" or "unavailable" or
                "identity-ready" or "identity-required" or "identity-recovery-required"))
            throw new InvalidOperationException("Invalid setup reply.");
        if (value.ContainsKey("peerAddress"))
        {
            if (!Keys(value, "id", "status", "peerAddress") || !AddressValid(value["peerAddress"]))
                throw new InvalidOperationException("Invalid pending peer.");
            return new(id, status, null, null, PeerAddress: value["peerAddress"]?.GetValue<string>());
        }
        if (value.Any(field => field.Key is not ("id" or "status" or "invitation" or "peerCertificateSha256")))
            throw new InvalidOperationException("Invalid setup reply.");
        var invitation = value["invitation"]?.GetValue<string>();
        var fingerprint = value["peerCertificateSha256"]?.GetValue<string>();
        if ((status == "hosting") != (invitation is not null) ||
            invitation is not null && (Encoding.UTF8.GetByteCount(invitation) > 2048 || !invitation.StartsWith("observatory-pair:v1:", StringComparison.Ordinal)) ||
            fingerprint is not null && !Regex.IsMatch(fingerprint, "\\A[a-f0-9]{64}\\z"))
            throw new InvalidOperationException("Invalid setup reply.");
        return new(id, status, invitation, fingerprint);
    }

    internal static void SelfTest()
    {
        if (Parse("{\"id\":1,\"status\":\"idle\",\"peerCertificateSha256\":null}").Status != "idle") throw new Exception("Setup reply failed.");
        foreach (var raw in new[] { "{}", "{\"id\":true,\"status\":\"idle\"}", "{\"id\":1,\"status\":\"paired\"}",
            "{\"id\":1,\"status\":\"hosting\"}", "{\"id\":1,\"status\":\"idle\",\"key\":\"private\"}" })
        {
            var rejected = false;
            try { Parse(raw); } catch { rejected = true; }
            if (!rejected) throw new Exception("Unsafe setup reply accepted.");
        }
        foreach (var address in new string?[] { null, "100.64.0.1", "fd00::1" })
        foreach (bool available in new[] { false, true })
        {
            var defaults = new JsonObject { ["id"] = 1, ["status"] = "ready", ["address"] = address,
                ["port"] = 43128, ["portAvailable"] = address is null ? null : JsonValue.Create(available) };
            var parsed = Parse(defaults.ToJsonString());
            if (parsed.Address != address || parsed.Port != 43128 || parsed.PortAvailable != (address is null ? (bool?)null : available))
                throw new Exception("Setup defaults validation failed.");
            var pending = new JsonObject { ["id"] = 1, ["status"] = "confirming", ["peerAddress"] = address };
            if (Parse(pending.ToJsonString()).PeerAddress != address) throw new Exception("Pending peer validation failed.");
        }
        var goodDefaults = new JsonObject { ["id"] = 1, ["status"] = "ready", ["address"] = "100.64.0.1", ["port"] = 43128, ["portAvailable"] = true };
        var goodPeer = new JsonObject { ["id"] = 1, ["status"] = "confirming", ["peerAddress"] = "100.64.0.2" };
        var invalid = new List<JsonObject>();
        foreach (var good in new[] { goodDefaults, goodPeer })
        {
            foreach (var key in good.Select(p => p.Key))
            { if (good == goodPeer && key == "peerAddress") continue; var bad = good.DeepClone().AsObject(); bad.Remove(key); invalid.Add(bad); }
            var extra = good.DeepClone().AsObject(); extra["extra"] = true; invalid.Add(extra);
            var mixed = good.DeepClone().AsObject(); mixed["peerCertificateSha256"] = new string('a', 64); invalid.Add(mixed);
            foreach (var address in new JsonNode?[] { JsonValue.Create("203.0.113.1"), JsonValue.Create("100.064.0.1"), JsonValue.Create("fd00::1%3"), JsonValue.Create(true) })
            { var bad = good.DeepClone().AsObject(); bad[good == goodDefaults ? "address" : "peerAddress"] = address?.DeepClone(); invalid.Add(bad); }
        }
        foreach (var port in new JsonNode?[] { null, JsonValue.Create(43129), JsonValue.Create(1023), JsonValue.Create(65536), JsonValue.Create(43128.5), JsonValue.Create("43128"), JsonValue.Create(true) })
        { var bad = goodDefaults.DeepClone().AsObject(); bad["port"] = port; invalid.Add(bad); }
        foreach (var available in new JsonNode?[] { null, JsonValue.Create("true"), JsonValue.Create(1) })
        { var bad = goodDefaults.DeepClone().AsObject(); bad["portAvailable"] = available; invalid.Add(bad); }
        var nullAddress = goodDefaults.DeepClone().AsObject(); nullAddress["address"] = null; invalid.Add(nullAddress);
        var wrongStatus = goodDefaults.DeepClone().AsObject(); wrongStatus["status"] = "idle"; invalid.Add(wrongStatus);
        foreach (var bad in invalid)
        {
            bool refused = false;
            try { Parse(bad.ToJsonString()); } catch { refused = true; }
            if (!refused) throw new Exception("Unsafe pairing reply accepted.");
        }
        Console.WriteLine("Native setup reply validation passed.");
    }
}

// One native setup window owns one child. Private invitation text travels only
// through these pipes, never shell arguments, a webview or diagnostic output.
internal sealed class TlsSetupProcess : IAsyncDisposable
{
    private readonly Process process;
    private readonly ConcurrentDictionary<int, TaskCompletionSource<TlsSetupReply>> pending = new();
    private readonly SemaphoreSlim writer = new(1, 1);
    private readonly object gate = new();
    private readonly Task reader;
    private readonly Task errors;
    private readonly TaskCompletionSource<bool> forceStopCompletion = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private Task? disposal;
    private int nextId, closed;
    internal bool ExitVerified { get; private set; }
    internal int? ExitCode { get; private set; }

    internal TlsSetupProcess(string runtime) : this(runtime,
        Path.Combine(AppContext.BaseDirectory, "Runtime", "node.exe"),
        Path.Combine(AppContext.BaseDirectory, "Collector", "scripts", "peer-tls-control.mjs")) { }

    internal TlsSetupProcess(string runtime, string node, string script)
    {
        if (!Path.IsPathFullyQualified(runtime) || !Directory.Exists(runtime) ||
            File.GetAttributes(runtime).HasFlag(FileAttributes.ReparsePoint) ||
            !Path.IsPathFullyQualified(node) || !File.Exists(node) || !Path.GetFileName(node).Equals("node.exe", StringComparison.OrdinalIgnoreCase) ||
            !Path.IsPathFullyQualified(script) || !File.Exists(script))
            throw new InvalidOperationException("Setup tools unavailable.");
        var start = new ProcessStartInfo(node) { UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
            StandardInputEncoding = new UTF8Encoding(false, true), StandardOutputEncoding = new UTF8Encoding(false, true),
            WorkingDirectory = runtime };
        start.ArgumentList.Add(script); start.ArgumentList.Add("--runtime"); start.ArgumentList.Add(Path.GetFullPath(runtime));
        foreach (var key in new[] { "NODE_OPTIONS", "NODE_EXTRA_CA_CERTS", "NODE_PATH" }) start.Environment.Remove(key);
        process = new Process { StartInfo = start };
        if (!process.Start()) throw new InvalidOperationException("Setup process unavailable.");
        reader = ReadReplies();
        errors = DiscardErrors();
    }

    internal async Task<TlsSetupReply> Send(JsonObject command, CancellationToken cancellation = default)
    {
        int id;
        var completion = new TaskCompletionSource<TlsSetupReply>(TaskCreationOptions.RunContinuationsAsynchronously);
        lock (gate)
        {
            if (closed != 0 || pending.Count >= 8 || nextId >= 512) throw new InvalidOperationException("Setup process unavailable.");
            id = ++nextId; pending[id] = completion;
        }
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        timeout.CancelAfter(TimeSpan.FromSeconds(45));
        try
        {
            var line = new JsonObject { ["id"] = id, ["command"] = command.DeepClone() }.ToJsonString();
            if (Encoding.UTF8.GetByteCount(line) > 8192) throw new InvalidOperationException("Setup command too large.");
            await writer.WaitAsync(timeout.Token);
            try
            {
                // A command that waited for the write lock while Stop ran must never reach the helper.
                lock (gate) if (closed != 0) throw new InvalidOperationException("Setup process stopped.");
                await process.StandardInput.WriteLineAsync(line.AsMemory(), timeout.Token);
                await process.StandardInput.FlushAsync(timeout.Token);
            }
            finally { writer.Release(); }
            return await completion.Task.WaitAsync(timeout.Token);
        }
        catch { Stop(); throw new InvalidOperationException("Setup command unavailable."); }
        finally { pending.TryRemove(id, out _); }
    }

    // Caller must obtain consent after disclosing restricted-file storage.
    internal async Task<TlsSetupReply> PrepareIdentity(bool storageConsent, CancellationToken cancellation = default)
    {
        if (!storageConsent) throw new InvalidOperationException("Identity storage consent required.");
        var status = await Send(new JsonObject { ["action"] = "identity-status" }, cancellation);
        if (status.Status == "identity-ready") return status;
        if (status.Status != "identity-required") throw new InvalidOperationException("Identity recovery required.");
        var identity = DeviceIdentity.Generate();
        return await Send(new JsonObject { ["action"] = "identity-create", ["storage"] = "restricted-file",
            ["identity"] = new JsonObject { ["version"] = 1, ["key"] = identity.Key, ["cert"] = identity.Certificate } }, cancellation);
    }

    private async Task ReadReplies()
    {
        var chars = new char[1024]; var frame = new StringBuilder();
        try
        {
            int count;
            while ((count = await process.StandardOutput.ReadAsync(chars)) != 0)
                for (var i = 0; i < count; i++)
                {
                    if (chars[i] == '\n')
                    {
                        var reply = TlsSetupReply.Parse(frame.ToString()); frame.Clear();
                        if (!pending.TryRemove(reply.Id, out var completion)) throw new InvalidOperationException();
                        completion.TrySetResult(reply);
                    }
                    else { frame.Append(chars[i]); if (frame.Length > 8192) throw new InvalidOperationException(); }
                }
        }
        catch { }
        finally { Stop(); }
    }

    private async Task DiscardErrors()
    {
        var buffer = new char[1024];
        try { while (await process.StandardError.ReadAsync(buffer) != 0) { } }
        catch { }
    }

    private void Stop()
    {
        lock (gate)
        {
            if (closed != 0) return; closed = 1;
            foreach (var item in pending) item.Value.TrySetException(new InvalidOperationException("Setup process stopped."));
            pending.Clear();
        }
        _ = ForceStopAfter(TimeSpan.FromSeconds(2));
    }

    private async Task ForceStopAfter(TimeSpan grace)
    {
        try
        {
            // Wait up to 1 second for a write in progress to finish, then close input. If a write is still running,
            // the close fails and the forced kill below applies.
            var held = false;
            try
            {
                held = await writer.WaitAsync(TimeSpan.FromSeconds(1)).ConfigureAwait(false);
                process.StandardInput.Close();
            }
            catch { }
            finally { if (held) writer.Release(); }
            using var timeout = new CancellationTokenSource(grace);
            try { await process.WaitForExitAsync(timeout.Token).ConfigureAwait(false); }
            catch (OperationCanceledException) when (timeout.IsCancellationRequested)
            {
                if (!process.HasExited) process.Kill(entireProcessTree: true);
            }
        }
        catch { }
        finally { forceStopCompletion.TrySetResult(true); }
    }

    public ValueTask DisposeAsync()
    {
        lock (gate) return new ValueTask(disposal ??= DisposeCore());
    }

    private async Task DisposeCore()
    {
        Stop();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        await process.WaitForExitAsync(timeout.Token);
        await Task.WhenAll(reader, errors).WaitAsync(timeout.Token);
        // Stop can already be running on another caller after setting closed.
        await forceStopCompletion.Task.WaitAsync(timeout.Token);
        if (process.HasExited) ExitCode = process.ExitCode;
        ExitVerified = process.HasExited;
        process.Dispose();
    }

    internal static async Task BridgeSelfTest(string node, bool identitySetup = false)
    {
        var runtime = Path.Combine(Path.GetTempPath(), "observatory-native-control-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(runtime);
        try
        {
            var bridge = new TlsSetupProcess(runtime, node, Path.Combine(AppContext.BaseDirectory, "Collector", "scripts", "peer-tls-control.mjs"));
            await using (bridge)
            {
                if ((await bridge.Send(new JsonObject { ["action"] = "status" })).Status != "idle" ||
                    (await bridge.Send(new JsonObject { ["action"] = "cancel" })).Status != "cancelled")
                    throw new InvalidOperationException("Setup bridge status failed.");
                var replies = await Task.WhenAll(Enumerable.Range(0, 4).Select(_ => bridge.Send(new JsonObject { ["action"] = "status" })));
                if (replies.Any(reply => reply.Status != "idle") || replies.Select(reply => reply.Id).Distinct().Count() != 4)
                    throw new InvalidOperationException("Setup request correlation failed.");
                if (identitySetup)
                {
                    var refused = false;
                    try { await bridge.PrepareIdentity(false); } catch { refused = true; }
                    if (!refused || (await bridge.Send(new JsonObject { ["action"] = "identity-status" })).Status != "identity-required" ||
                        (await bridge.PrepareIdentity(true)).Status != "identity-ready" ||
                        (await bridge.PrepareIdentity(true)).Status != "identity-ready")
                        throw new InvalidOperationException("Explicit identity setup failed.");
                }
            }
            await bridge.DisposeAsync();
            if (!bridge.ExitVerified || bridge.ExitCode != 0) throw new InvalidOperationException("Setup bridge graceful exit not verified.");

            // The stub lives outside the control runtime so the final non-recursive delete still proves the control script left nothing behind.
            var stubFolder = Path.Combine(Path.GetTempPath(), "observatory-native-stub-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(stubFolder);
            try
            {
                var stubbornScript = Path.Combine(stubFolder, "ignore-input-end.mjs");
                await File.WriteAllTextAsync(stubbornScript,
                    "process.stdin.resume()\nprocess.stdin.on('end', () => {})\nsetInterval(() => {}, 1000)\n");
                var stubborn = new TlsSetupProcess(stubFolder, node, stubbornScript);
                var watch = Stopwatch.StartNew();
                await using (stubborn) { await stubborn.DisposeAsync(); }
                watch.Stop();
                if (!stubborn.ExitVerified || watch.Elapsed < TimeSpan.FromSeconds(1.5) || watch.Elapsed >= TimeSpan.FromSeconds(7))
                    throw new InvalidOperationException("Setup bridge forced exit not verified.");
            }
            finally { Directory.Delete(stubFolder, recursive: true); }

            // A command queued behind the write lock when Stop runs is refused and never reaches the helper.
            var recorderFolder = Path.Combine(Path.GetTempPath(), "observatory-native-recorder-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(recorderFolder);
            try
            {
                var recorderScript = Path.Combine(recorderFolder, "record-input.mjs");
                var received = Path.Combine(recorderFolder, "received.txt");
                await File.WriteAllTextAsync(recorderScript,
                    "import fs from 'node:fs'\nimport path from 'node:path'\nconst file = path.join(process.argv[3], 'received.txt')\n" +
                    "process.stdin.on('data', chunk => fs.appendFileSync(file, chunk))\nprocess.stdin.on('end', () => process.exit(0))\n");
                var recorder = new TlsSetupProcess(recorderFolder, node, recorderScript);
                await using (recorder)
                {
                    await recorder.writer.WaitAsync();
                    var late = recorder.Send(new JsonObject { ["action"] = "status" });
                    recorder.Stop();
                    recorder.writer.Release();
                    var refused = false;
                    try { await late; } catch (InvalidOperationException) { refused = true; }
                    await recorder.DisposeAsync();
                    if (!refused || !recorder.ExitVerified || recorder.ExitCode != 0 || File.Exists(received) && new FileInfo(received).Length != 0)
                        throw new InvalidOperationException("Setup bridge wrote a command after stop.");
                }
            }
            finally { Directory.Delete(recorderFolder, recursive: true); }
            Console.WriteLine("Windows setup process bridge passed.");
        }
        finally { Directory.Delete(runtime, recursive: identitySetup); }
    }
}
