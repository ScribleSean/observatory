using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace WorkspaceObservatory;

internal sealed record TlsSetupReply(int Id, string Status, string? Invitation, string? PeerCertificateSha256)
{
    internal static TlsSetupReply Parse(string raw)
    {
        if (Encoding.UTF8.GetByteCount(raw) > 8192 || JsonNode.Parse(raw) is not JsonObject value ||
            value.Any(field => field.Key is not ("id" or "status" or "invitation" or "peerCertificateSha256")) ||
            value["id"] is not JsonValue idValue || !idValue.TryGetValue<int>(out var id) || id < 1 ||
            value["status"]?.GetValue<string>() is not string status ||
            status is not ("idle" or "working" or "waiting" or "confirming" or "inactive" or "hosting" or "cancelled" or
                "configuration-ready" or "awaiting-confirmation" or "local-ready" or "acknowledged" or "unavailable"))
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
    private Task? disposal;
    private int nextId, closed;
    internal bool ExitVerified { get; private set; }

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
                await process.StandardInput.WriteLineAsync(line.AsMemory(), timeout.Token);
                await process.StandardInput.FlushAsync(timeout.Token);
            }
            finally { writer.Release(); }
            return await completion.Task.WaitAsync(timeout.Token);
        }
        catch { Stop(); throw new InvalidOperationException("Setup command unavailable."); }
        finally { pending.TryRemove(id, out _); }
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
        try { if (!process.HasExited) process.Kill(entireProcessTree: true); } catch { }
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
        ExitVerified = process.HasExited;
        process.Dispose();
    }

    internal static async Task BridgeSelfTest(string node)
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
            }
            await bridge.DisposeAsync();
            if (!bridge.ExitVerified) throw new InvalidOperationException("Setup bridge exit not verified.");
            Console.WriteLine("Windows setup process bridge passed.");
        }
        finally { Directory.Delete(runtime, recursive: false); }
    }
}
