using System.Diagnostics;
using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

internal static class TailscaleReadiness
{
    internal static readonly Dictionary<string, string> Messages = new()
    {
        ["not-installed"] = "Tailscale was not found. Install it only if you want the optional VPN connection path.",
        ["needs-login"] = "Sign in through Tailscale, then check again.",
        ["needs-device-approval"] = "This device needs approval from its Tailscale network administrator.",
        ["stopped"] = "Tailscale is stopped. Connect through Tailscale, then check again.",
        ["starting"] = "Tailscale is starting. Check again shortly.",
        ["other-user"] = "Tailscale is in use by another system user.",
        ["running"] = "Tailscale is running. Observatory peer reachability has not been checked.",
        ["offline"] = "Tailscale reports this device offline. Check its connection.",
        ["unavailable"] = "Tailscale status could not be read. No network settings were changed.",
        ["unsupported"] = "This platform is not supported by the readiness check."
    };

    internal static string Parse(string raw)
    {
        if (raw.Length > 4096 || JsonNode.Parse(raw) is not JsonObject value || value.Count != 3 ||
            value["version"] is not JsonValue version || !version.TryGetValue<int>(out var number) || number != 1 ||
            value["peerReachability"]?.GetValue<string>() != "not-checked" ||
            value["status"]?.GetValue<string>() is not string status || !Messages.TryGetValue(status, out var message))
            throw new InvalidOperationException("Invalid network readiness response.");
        return message;
    }

    internal static async Task<string> Read()
    {
        var node = Path.Combine(AppContext.BaseDirectory, "Runtime", "node.exe");
        var script = Path.Combine(AppContext.BaseDirectory, "Collector", "scripts", "tailscale-status.mjs");
        if (!File.Exists(node) || !File.Exists(script)) throw new InvalidOperationException("Readiness tools unavailable.");
        using var process = new Process { StartInfo = new(node) { UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true, RedirectStandardInput = true,
            WorkingDirectory = AppContext.BaseDirectory } };
        process.StartInfo.ArgumentList.Add(script);
        process.Start(); process.StandardInput.Close();
        var output = process.StandardOutput.ReadToEndAsync();
        var error = process.StandardError.ReadToEndAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(12));
        try { await process.WaitForExitAsync(timeout.Token); }
        catch { if (!process.HasExited) process.Kill(entireProcessTree: true); await process.WaitForExitAsync(); throw; }
        await Task.WhenAll(output, error);
        if (process.ExitCode != 0) throw new InvalidOperationException("Readiness check failed.");
        return Parse(await output);
    }

    internal static void SelfTest()
    {
        foreach (var (status, message) in Messages)
            if (Parse(new JsonObject { ["version"] = 1, ["status"] = status, ["peerReachability"] = "not-checked" }.ToJsonString()) != message)
                throw new Exception("Readiness message failed.");
        foreach (var raw in new[] { "{}", "{\"version\":true,\"status\":\"running\",\"peerReachability\":\"not-checked\"}",
            "{\"version\":1,\"status\":\"running\",\"peerReachability\":\"connected\"}" })
        {
            var rejected = false;
            try { Parse(raw); } catch { rejected = true; }
            if (!rejected) throw new Exception("Invalid readiness response accepted.");
        }
        Console.WriteLine("Native Tailscale readiness response validation passed.");
    }
}
