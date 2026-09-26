using System.Diagnostics;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace WorkspaceObservatory;

internal enum SharingChannel { Quota, ProviderTokens }

internal sealed record QuotaSharingStatus(bool Enabled, bool CanEnable, string Reason, string? Token);

internal static class QuotaSharing
{
    private static (string Script, string UnavailableReason) ChannelSettings(SharingChannel channel) => channel switch
    {
        SharingChannel.Quota => ("quota-sharing-control.mjs", "account-unavailable"),
        SharingChannel.ProviderTokens => ("provider-token-sharing-control.mjs", "source-unavailable"),
        _ => throw new InvalidOperationException("Invalid sharing channel.")
    };

    private static bool ValidToken(string? token) => token is { Length: 64 } && Regex.IsMatch(token, "^[a-f0-9]{64}$");

    internal static async Task BridgeSelfTest()
    {
        var runtime = Path.Combine(Path.GetTempPath(), "observatory-sharing-bridge-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(runtime);
        try
        {
            var status = await Run(runtime, "status", null, CancellationToken.None);
            if (status.Enabled || status.CanEnable || status.Reason != "pairing-unavailable")
                throw new InvalidOperationException("Unpaired sharing status failed.");
            var disabled = await Run(runtime, "disable", null, CancellationToken.None);
            if (disabled.Enabled || Directory.Exists(Path.Combine(runtime, "private-quota")))
                throw new InvalidOperationException("Disabled sharing created account state.");
            var rejected = false;
            try { await Run(runtime, "enable", new string('a', 64), CancellationToken.None); }
            catch (InvalidOperationException) { rejected = true; }
            if (!rejected) throw new InvalidOperationException("Unpaired sharing enabled.");
            Console.WriteLine("Packaged native sharing bridge passed with isolated data.");
        }
        finally { Directory.Delete(runtime, recursive: true); }
    }

    internal static QuotaSharingStatus Parse(string text, SharingChannel channel = SharingChannel.Quota)
    {
        var settings = ChannelSettings(channel);
        if (text.Length > 4096 || JsonNode.Parse(text) is not JsonObject value || value.Count != 5 ||
            value.Any(entry => entry.Key is not ("version" or "enabled" or "canEnable" or "reason" or "token")) ||
            value["version"]?.GetValue<int>() != 1 ||
            value["enabled"] is not JsonValue enabled || !enabled.TryGetValue<bool>(out var on) ||
            value["canEnable"] is not JsonValue available || !available.TryGetValue<bool>(out var canEnable))
            throw new InvalidOperationException("Invalid sharing status.");
        var reason = value["reason"]?.GetValue<string>();
        var token = value["token"]?.GetValue<string>();
        if ((reason is not ("ready" or "pairing-unavailable") && reason != settings.UnavailableReason) ||
            (canEnable ? !ValidToken(token) || reason != "ready" : token is not null))
            throw new InvalidOperationException("Invalid sharing status.");
        return new(on, canEnable, reason, token);
    }

    internal static async Task<QuotaSharingStatus> Run(string runtime, string action, string? token, CancellationToken cancellation,
        SharingChannel channel = SharingChannel.Quota)
    {
        var settings = ChannelSettings(channel);
        if (action is not ("status" or "enable" or "disable") ||
            (action == "enable" ? !ValidToken(token) : token is not null) ||
            !Path.IsPathFullyQualified(runtime) || !Directory.Exists(runtime) ||
            File.GetAttributes(runtime).HasFlag(FileAttributes.ReparsePoint)) throw new InvalidOperationException("Invalid sharing request.");
        var node = Path.Combine(AppContext.BaseDirectory, "Runtime", "node.exe");
        var script = Path.Combine(AppContext.BaseDirectory, "Collector", "scripts", settings.Script);
        if (!File.Exists(node) || !File.Exists(script)) throw new InvalidOperationException("Sharing tools are unavailable.");
        using var process = new Process { StartInfo = new(node) { UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true } };
        foreach (var arg in new[] { script, "--runtime", runtime }) process.StartInfo.ArgumentList.Add(arg);
        process.Start();
        var output = process.StandardOutput.ReadToEndAsync();
        var error = process.StandardError.ReadToEndAsync();
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        timeout.CancelAfter(TimeSpan.FromSeconds(20));
        try
        {
            var request = new JsonObject { ["action"] = action };
            if (token is not null) request["token"] = token;
            await process.StandardInput.WriteAsync(request.ToJsonString()); process.StandardInput.Close();
            await process.WaitForExitAsync(timeout.Token);
            await Task.WhenAll(output, error);
            if (process.ExitCode != 0) throw new InvalidOperationException("Sharing settings changed or are unavailable.");
            return Parse(await output, channel);
        }
        catch
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            await process.WaitForExitAsync();
            throw;
        }
    }
}
