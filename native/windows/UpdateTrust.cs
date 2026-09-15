using System.Text.Json;

namespace WorkspaceObservatory;

// Only release-controlled configuration embedded in the installed application
// may establish update trust. Never read a replacement key from a feed or download.
internal sealed class UpdateTrust
{
    internal const string Feed = "https://scriblesean.github.io/observatory/updates/windows-x64.xml";
    internal string PublicKey { get; }
    private UpdateTrust(string publicKey) { PublicKey = publicKey; }

    internal static UpdateTrust Parse(ReadOnlyMemory<byte> json)
    {
        if (json.Length is 0 or > 4096) throw new IOException("Invalid update trust configuration size.");
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object || root.EnumerateObject().Count() != 4 ||
            root.EnumerateObject().Select(p => p.Name).Distinct().Count() != 4 ||
            root.GetProperty("schema").GetInt32() != 1 ||
            root.GetProperty("platform").GetString() != "windows-x64" ||
            root.GetProperty("feedUrl").GetString() != Feed)
            throw new IOException("Invalid update trust configuration.");
        var key = root.GetProperty("publicKey").GetString() ?? "";
        var bytes = Convert.FromBase64String(key);
        if (bytes.Length != 32 || Convert.ToBase64String(bytes) != key || bytes.All(b => b == 0))
            throw new IOException("Invalid update public key.");
        return new UpdateTrust(key);
    }

    internal static UpdateTrust? ReadEmbedded()
    {
        using var stream = typeof(UpdateTrust).Assembly.GetManifestResourceStream("WorkspaceObservatory.UpdateTrust.json");
        if (stream is null) return null;
        var bytes = new byte[4097];
        var count = 0;
        while (count < bytes.Length)
        {
            var read = stream.Read(bytes, count, bytes.Length - count);
            if (read == 0) break;
            count += read;
        }
        return Parse(bytes.AsMemory(0, count));
    }

    internal static void SelfTest()
    {
        var key = Convert.ToBase64String(Convert.FromHexString("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"));
        var good = JsonSerializer.Serialize(new { schema = 1, platform = "windows-x64", feedUrl = Feed, publicKey = key });
        if (Parse(System.Text.Encoding.UTF8.GetBytes(good)).PublicKey != key) throw new Exception("Public key was lost.");
        foreach (var bad in new[] { "{}", "null", good + good, new string('x', 4097),
            good.Replace("\"schema\":1", "\"schema\":1,\"schema\":1"),
            good.Replace("windows-x64", "macos-arm64"), good.Replace("https:", "http:"),
            good.Replace("scriblesean.github.io", "example.invalid"), good.Replace(".xml", ".xml?token=private"),
            good.Replace(key, ""), good.Replace(key, Convert.ToBase64String(new byte[32])),
            good.Replace(key, key + " "), good.Replace("\"schema\":1", "\"schema\":2") })
        {
            var refused = false;
            try { Parse(System.Text.Encoding.UTF8.GetBytes(bad)); } catch { refused = true; }
            if (!refused) throw new Exception("Unsafe update trust configuration accepted.");
        }
        Console.WriteLine("Update trust requires exact release feed, platform and canonical public key.");
    }
}
