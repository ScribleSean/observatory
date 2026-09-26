using System.Text.Json.Nodes;

namespace WorkspaceObservatory;

internal static class ProviderTokenSharingTests
{
    private static void Require(bool condition)
    {
        if (!condition) throw new InvalidOperationException("Provider token sharing bridge test failed.");
    }

    private static JsonObject Status(string reason, bool canEnable = false, string? token = null) => new()
    {
        ["version"] = 1, ["enabled"] = false, ["canEnable"] = canEnable, ["reason"] = reason, ["token"] = token
    };

    private static bool Rejects(string text, SharingChannel channel)
    {
        try { QuotaSharing.Parse(text, channel); return false; }
        catch { return true; }
    }

    internal static void ParseSelfTest()
    {
        var source = Status("source-unavailable").ToJsonString();
        Require(QuotaSharing.Parse(source, SharingChannel.ProviderTokens).Reason == "source-unavailable");
        Require(Rejects(source, SharingChannel.Quota));
        var account = Status("account-unavailable").ToJsonString();
        Require(QuotaSharing.Parse(account).Reason == "account-unavailable");
        Require(Rejects(account, SharingChannel.ProviderTokens));
        var token = new string('a', 64);
        var ready = Status("ready", true, token);
        var parsed = QuotaSharing.Parse(ready.ToJsonString(), SharingChannel.ProviderTokens);
        Require(parsed.CanEnable && parsed.Token == token);

        var extra = (JsonObject)ready.DeepClone(); extra["private"] = "must not pass";
        var missing = (JsonObject)ready.DeepClone(); missing.Remove("token");
        var wrongVersion = (JsonObject)ready.DeepClone(); wrongVersion["version"] = 2;
        var wrongType = (JsonObject)ready.DeepClone(); wrongType["enabled"] = "false";
        foreach (var invalid in new[] { extra, missing, wrongVersion, wrongType,
            Status("unknown"), Status("ready", true), Status("source-unavailable", true, token),
            Status("source-unavailable", false, token), Status("ready", true, token + "\n"),
            Status("ready", true, new string('A', 64)) })
            Require(Rejects(invalid.ToJsonString(), SharingChannel.ProviderTokens));
        Require(Rejects(new string(' ', 4097), SharingChannel.ProviderTokens));
        Require(Rejects(source, (SharingChannel)999));
    }

    // The executable's packaged resources are reused, but all mutable data is
    // confined to a new unpaired runtime instead of the user's runtime.
    internal static async Task BridgeSelfTest()
    {
        ParseSelfTest();
        var runtime = Path.Combine(Path.GetTempPath(), "observatory-provider-token-bridge-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(runtime);
        try
        {
            var current = await QuotaSharing.Run(runtime, "status", null, CancellationToken.None, SharingChannel.ProviderTokens);
            Require(!current.Enabled && !current.CanEnable && current.Reason == "pairing-unavailable" && current.Token is null);
            var disabled = await QuotaSharing.Run(runtime, "disable", null, CancellationToken.None, SharingChannel.ProviderTokens);
            Require(!disabled.Enabled && !disabled.CanEnable && disabled.Reason == "pairing-unavailable");
            var rejected = false;
            try { await QuotaSharing.Run(runtime, "enable", new string('a', 64), CancellationToken.None, SharingChannel.ProviderTokens); }
            catch (InvalidOperationException) { rejected = true; }
            Require(rejected);
            Require(!File.Exists(Path.Combine(runtime, "private-sync", "provider-tokens.sqlite")));
            Require(!Directory.Exists(Path.Combine(runtime, "private-quota")));
        }
        finally { Directory.Delete(runtime, recursive: true); }
    }
}
