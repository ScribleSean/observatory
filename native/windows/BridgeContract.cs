// Generated from lib/bridge-contract.json by scripts/build-bridge-contract.mjs. Do not edit.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace WorkspaceObservatory;

internal sealed record BridgeValue(string Kind, bool Boolean = false, int Integer = 0, string? Text = null);
internal sealed record BridgeValidation(string Outcome, int? Id = null, string? Action = null, Dictionary<string, BridgeValue>? Args = null);

internal sealed class BridgeNode
{
    internal string Kind { get; }
    internal string Text { get; }
    internal List<KeyValuePair<string, BridgeNode>> Entries { get; } = new();
    internal List<BridgeNode> Items { get; } = new();
    internal BridgeNode(string kind, string text = "") { Kind = kind; Text = text; }
    internal BridgeNode(List<KeyValuePair<string, BridgeNode>> entries) { Kind = "object"; Text = ""; Entries = entries; }
    internal BridgeNode(List<BridgeNode> items) { Kind = "array"; Text = ""; Items = items; }
    internal BridgeNode this[string key]
    {
        get
        {
            foreach (var entry in Entries) if (entry.Key == key) return entry.Value;
            return new BridgeNode("missing");
        }
    }
    internal int Number => int.Parse(Text, CultureInfo.InvariantCulture);
    internal bool Contains(string text)
    {
        foreach (var item in Items) if (item.Text == text) return true;
        return false;
    }
}

internal sealed class BridgeParser
{
    private readonly string text;
    private readonly int maxDepth;
    private int at;
    internal bool Duplicate { get; private set; }
    internal BridgeParser(string text, int maxDepth) { this.text = text; this.maxDepth = maxDepth; }
    private char Current => at < text.Length ? text[at] : '\uffff';
    private bool Take(char c) { if (Current != c) return false; at++; return true; }
    private void Space() { while (Current == ' ' || Current == '\t' || Current == '\r' || Current == '\n') at++; }
    private string ReadString()
    {
        if (!Take('"')) throw new FormatException();
        var result = new StringBuilder();
        while (at < text.Length)
        {
            char c = text[at++];
            if (c == '"') return result.ToString();
            if (c < 32) throw new FormatException();
            if (c != '\\') { result.Append(c); continue; }
            char e = Current;
            at++;
            switch (e)
            {
                case '"': case '\\': case '/': result.Append(e); break;
                case 'b': result.Append('\b'); break;
                case 'f': result.Append('\f'); break;
                case 'n': result.Append('\n'); break;
                case 'r': result.Append('\r'); break;
                case 't': result.Append('\t'); break;
                case 'u':
                    int n = 0;
                    for (int i = 0; i < 4; i++)
                    {
                        int h = BridgeContract.Hex(Current);
                        if (h < 0) throw new FormatException();
                        n = n * 16 + h;
                        at++;
                    }
                    result.Append((char)n);
                    break;
                default: throw new FormatException();
            }
        }
        throw new FormatException();
    }
    private BridgeNode Value(int depth = 0)
    {
        Space();
        if (Current == '{' || Current == '[')
        {
            if (depth >= maxDepth) throw new FormatException();
            bool obj = Current == '{';
            char end = obj ? '}' : ']';
            at++;
            var entries = new List<KeyValuePair<string, BridgeNode>>();
            var items = new List<BridgeNode>();
            var keys = new HashSet<string>(StringComparer.Ordinal);
            Space();
            if (Take(end)) return obj ? new BridgeNode(entries) : new BridgeNode(items);
            while (true)
            {
                Space();
                string key = "";
                if (obj)
                {
                    key = ReadString();
                    if (!keys.Add(key)) Duplicate = true;
                    Space();
                    if (!Take(':')) throw new FormatException();
                }
                var node = Value(depth + 1);
                if (obj) entries.Add(new KeyValuePair<string, BridgeNode>(key, node));
                else items.Add(node);
                Space();
                if (Take(end)) break;
                if (!Take(',')) throw new FormatException();
            }
            return obj ? new BridgeNode(entries) : new BridgeNode(items);
        }
        if (Current == '"') return new BridgeNode("string", ReadString());
        foreach (string word in new[] { "true", "false", "null" })
        {
            if (at + word.Length <= text.Length && string.CompareOrdinal(text, at, word, 0, word.Length) == 0)
            {
                at += word.Length;
                return new BridgeNode(word == "null" ? "null" : "boolean", word);
            }
        }
        int start = at;
        Take('-');
        if (!Take('0'))
        {
            if (Current < '1' || Current > '9') throw new FormatException();
            while (BridgeContract.Digit(Current)) at++;
        }
        if (Take('.'))
        {
            if (!BridgeContract.Digit(Current)) throw new FormatException();
            while (BridgeContract.Digit(Current)) at++;
        }
        if (Take('e') || Take('E'))
        {
            if (!Take('+')) Take('-');
            if (!BridgeContract.Digit(Current)) throw new FormatException();
            while (BridgeContract.Digit(Current)) at++;
        }
        return new BridgeNode("number", text.Substring(start, at - start));
    }
    internal BridgeNode Parse()
    {
        var node = Value();
        Space();
        if (at != text.Length) throw new FormatException();
        return node;
    }
}

internal static class BridgeContract
{
    internal static readonly BridgeNode Data = new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("version", new BridgeNode("number", "1")), new KeyValuePair<string, BridgeNode>("source", new BridgeNode("string", "docs/DESIGN.md, Settings bridge contract")), new KeyValuePair<string, BridgeNode>("message", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("maxBytes", new BridgeNode("number", "4096")), new KeyValuePair<string, BridgeNode>("maxDepth", new BridgeNode("number", "16")), new KeyValuePair<string, BridgeNode>("id", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("min", new BridgeNode("number", "1")), new KeyValuePair<string, BridgeNode>("max", new BridgeNode("number", "2147483647")) })), new KeyValuePair<string, BridgeNode>("keys", new BridgeNode(new List<BridgeNode> { new BridgeNode("string", "id"), new BridgeNode("string", "action"), new BridgeNode("string", "args") })) })), new KeyValuePair<string, BridgeNode>("codes", new BridgeNode(new List<BridgeNode> { new BridgeNode("string", "done"), new BridgeNode("string", "refused"), new BridgeNode("string", "busy"), new BridgeNode("string", "cancelled"), new BridgeNode("string", "unavailable"), new BridgeNode("string", "expired") })), new KeyValuePair<string, BridgeNode>("limits", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("queue", new BridgeNode("number", "4")), new KeyValuePair<string, BridgeNode>("resultTimeoutSeconds", new BridgeNode("number", "60")), new KeyValuePair<string, BridgeNode>("cacheRefreshSeconds", new BridgeNode("number", "5")), new KeyValuePair<string, BridgeNode>("pairingPollSeconds", new BridgeNode("number", "2")) })), new KeyValuePair<string, BridgeNode>("status", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("version", new BridgeNode("number", "1")), new KeyValuePair<string, BridgeNode>("maxBytes", new BridgeNode("number", "16384")), new KeyValuePair<string, BridgeNode>("appVersionMaxLength", new BridgeNode("number", "32")), new KeyValuePair<string, BridgeNode>("customSkinsMax", new BridgeNode("number", "32")) })), new KeyValuePair<string, BridgeNode>("dashboardFragments", new BridgeNode(new List<BridgeNode> { new BridgeNode("string", "limits"), new BridgeNode("string", "activity"), new BridgeNode("string", "tokens"), new BridgeNode("string", "dictation"), new BridgeNode("string", "sources"), new BridgeNode("string", "settings"), new BridgeNode("string", "setup") })), new KeyValuePair<string, BridgeNode>("whiteSpace", new BridgeNode(new List<BridgeNode> { new BridgeNode("number", "9"), new BridgeNode("number", "10"), new BridgeNode("number", "11"), new BridgeNode("number", "12"), new BridgeNode("number", "13"), new BridgeNode("number", "32"), new BridgeNode("number", "133"), new BridgeNode("number", "160"), new BridgeNode("number", "5760"), new BridgeNode("number", "8192"), new BridgeNode("number", "8193"), new BridgeNode("number", "8194"), new BridgeNode("number", "8195"), new BridgeNode("number", "8196"), new BridgeNode("number", "8197"), new BridgeNode("number", "8198"), new BridgeNode("number", "8199"), new BridgeNode("number", "8200"), new BridgeNode("number", "8201"), new BridgeNode("number", "8202"), new BridgeNode("number", "8232"), new BridgeNode("number", "8233"), new BridgeNode("number", "8239"), new BridgeNode("number", "8287"), new BridgeNode("number", "12288") })), new KeyValuePair<string, BridgeNode>("address", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("maxLength", new BridgeNode("number", "39")), new KeyValuePair<string, BridgeNode>("ipv4", new BridgeNode(new List<BridgeNode> { new BridgeNode(new List<BridgeNode> { new BridgeNode("string", "10.0.0.0"), new BridgeNode("number", "8") }), new BridgeNode(new List<BridgeNode> { new BridgeNode("string", "172.16.0.0"), new BridgeNode("number", "12") }), new BridgeNode(new List<BridgeNode> { new BridgeNode("string", "192.168.0.0"), new BridgeNode("number", "16") }), new BridgeNode(new List<BridgeNode> { new BridgeNode("string", "100.64.0.0"), new BridgeNode("number", "10") }) })), new KeyValuePair<string, BridgeNode>("ipv6FirstGroup", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("min", new BridgeNode("number", "64512")), new KeyValuePair<string, BridgeNode>("max", new BridgeNode("number", "65023")) })) })), new KeyValuePair<string, BridgeNode>("values", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("tailscaleStatus", new BridgeNode(new List<BridgeNode> { new BridgeNode("string", "running"), new BridgeNode("string", "offline"), new BridgeNode("string", "needs-login"), new BridgeNode("string", "needs-device-approval"), new BridgeNode("string", "stopped"), new BridgeNode("string", "starting"), new BridgeNode("string", "other-user"), new BridgeNode("string", "not-installed"), new BridgeNode("string", "unsupported"), new BridgeNode("string", "unavailable") })), new KeyValuePair<string, BridgeNode>("pairingState", new BridgeNode(new List<BridgeNode> { new BridgeNode("string", "idle"), new BridgeNode("string", "identity-ready"), new BridgeNode("string", "identity-required"), new BridgeNode("string", "identity-recovery-required"), new BridgeNode("string", "inactive"), new BridgeNode("string", "waiting"), new BridgeNode("string", "confirming"), new BridgeNode("string", "awaiting-confirmation"), new BridgeNode("string", "local-ready"), new BridgeNode("string", "acknowledged"), new BridgeNode("string", "configuration-ready"), new BridgeNode("string", "working"), new BridgeNode("string", "cancelled"), new BridgeNode("string", "paired"), new BridgeNode("string", "unpaired"), new BridgeNode("string", "unavailable") })), new KeyValuePair<string, BridgeNode>("transport", new BridgeNode(new List<BridgeNode> { new BridgeNode("string", "none"), new BridgeNode("string", "ssh"), new BridgeNode("string", "tls") })), new KeyValuePair<string, BridgeNode>("sharingReason", new BridgeNode(new List<BridgeNode> { new BridgeNode("string", "ready"), new BridgeNode("string", "pairing-unavailable"), new BridgeNode("string", "account-unavailable"), new BridgeNode("string", "source-unavailable") })), new KeyValuePair<string, BridgeNode>("appearance", new BridgeNode(new List<BridgeNode> { new BridgeNode("string", "system"), new BridgeNode("string", "light"), new BridgeNode("string", "dark") })) })), new KeyValuePair<string, BridgeNode>("actions", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("refresh", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("args", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> {  })) })), new KeyValuePair<string, BridgeNode>("check-updates", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("args", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> {  })) })), new KeyValuePair<string, BridgeNode>("open-dashboard", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("args", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("section", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("type", new BridgeNode("string", "enum")), new KeyValuePair<string, BridgeNode>("values", new BridgeNode(new List<BridgeNode> { new BridgeNode("string", "limits"), new BridgeNode("string", "activity"), new BridgeNode("string", "tokens"), new BridgeNode("string", "dictation"), new BridgeNode("string", "sources"), new BridgeNode("string", "settings") })) })) })) })), new KeyValuePair<string, BridgeNode>("open-settings", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("args", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> {  })) })), new KeyValuePair<string, BridgeNode>("set-source", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("args", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("source", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("type", new BridgeNode("string", "enum")), new KeyValuePair<string, BridgeNode>("values", new BridgeNode(new List<BridgeNode> { new BridgeNode("string", "activity"), new BridgeNode("string", "codex"), new BridgeNode("string", "claude"), new BridgeNode("string", "wispr"), new BridgeNode("string", "quota") })) })), new KeyValuePair<string, BridgeNode>("enabled", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("type", new BridgeNode("string", "boolean")) })) })) })), new KeyValuePair<string, BridgeNode>("set-skin", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("args", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("skin", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("type", new BridgeNode("string", "skin")), new KeyValuePair<string, BridgeNode>("bundled", new BridgeNode(new List<BridgeNode> { new BridgeNode("string", "sage"), new BridgeNode("string", "almanac"), new BridgeNode("string", "instrument"), new BridgeNode("string", "amber-crt") })), new KeyValuePair<string, BridgeNode>("maxLength", new BridgeNode("number", "32")) })) })) })), new KeyValuePair<string, BridgeNode>("set-device-name", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("args", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("name", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("type", new BridgeNode("string", "deviceName")), new KeyValuePair<string, BridgeNode>("nullable", new BridgeNode("boolean", "true")), new KeyValuePair<string, BridgeNode>("minUtf16", new BridgeNode("number", "1")), new KeyValuePair<string, BridgeNode>("maxUtf16", new BridgeNode("number", "32")), new KeyValuePair<string, BridgeNode>("forbidden", new BridgeNode(new List<BridgeNode> { new BridgeNode("string", "/"), new BridgeNode("string", "\\"), new BridgeNode("string", ":") })) })) })) })), new KeyValuePair<string, BridgeNode>("set-startup", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("args", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("enabled", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("type", new BridgeNode("string", "boolean")) })) })) })), new KeyValuePair<string, BridgeNode>("set-appearance", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("args", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("mode", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("type", new BridgeNode("string", "enum")), new KeyValuePair<string, BridgeNode>("values", new BridgeNode(new List<BridgeNode> { new BridgeNode("string", "system"), new BridgeNode("string", "light"), new BridgeNode("string", "dark") })) })) })) })), new KeyValuePair<string, BridgeNode>("set-limits-consent", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("args", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("enabled", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("type", new BridgeNode("string", "boolean")) })) })) })), new KeyValuePair<string, BridgeNode>("set-sharing", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("args", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("channel", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("type", new BridgeNode("string", "enum")), new KeyValuePair<string, BridgeNode>("values", new BridgeNode(new List<BridgeNode> { new BridgeNode("string", "codex-limits"), new BridgeNode("string", "claude-code-tokens") })) })), new KeyValuePair<string, BridgeNode>("enabled", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("type", new BridgeNode("string", "boolean")) })), new KeyValuePair<string, BridgeNode>("token", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("type", new BridgeNode("string", "hex64")), new KeyValuePair<string, BridgeNode>("presentWhen", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("key", new BridgeNode("string", "enabled")), new KeyValuePair<string, BridgeNode>("equals", new BridgeNode("boolean", "true")) })) })) })) })), new KeyValuePair<string, BridgeNode>("pairing-identity-create", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("args", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> {  })) })), new KeyValuePair<string, BridgeNode>("pairing-host-start", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("args", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("address", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("type", new BridgeNode("string", "address")) })), new KeyValuePair<string, BridgeNode>("port", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("type", new BridgeNode("string", "integer")), new KeyValuePair<string, BridgeNode>("min", new BridgeNode("number", "1024")), new KeyValuePair<string, BridgeNode>("max", new BridgeNode("number", "65535")) })) })), new KeyValuePair<string, BridgeNode>("value", new BridgeNode("boolean", "true")) })), new KeyValuePair<string, BridgeNode>("pairing-copy-invitation", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("args", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> {  })) })), new KeyValuePair<string, BridgeNode>("pairing-host-confirm", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("args", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("fingerprint", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("type", new BridgeNode("string", "hex64")) })), new KeyValuePair<string, BridgeNode>("peerAddress", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("type", new BridgeNode("string", "address")) })), new KeyValuePair<string, BridgeNode>("peerPort", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("type", new BridgeNode("string", "integer")), new KeyValuePair<string, BridgeNode>("min", new BridgeNode("number", "1024")), new KeyValuePair<string, BridgeNode>("max", new BridgeNode("number", "65535")) })) })) })), new KeyValuePair<string, BridgeNode>("pairing-join-claim", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("args", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("invitation", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("type", new BridgeNode("string", "invitation")), new KeyValuePair<string, BridgeNode>("prefix", new BridgeNode("string", "observatory-pair:v1:")), new KeyValuePair<string, BridgeNode>("maxLength", new BridgeNode("number", "2048")) })) })) })), new KeyValuePair<string, BridgeNode>("pairing-join-confirm", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("args", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> {  })) })), new KeyValuePair<string, BridgeNode>("pairing-cancel", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("args", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> {  })), new KeyValuePair<string, BridgeNode>("immediate", new BridgeNode("boolean", "true")) })), new KeyValuePair<string, BridgeNode>("pairing-disconnect", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("args", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> {  })) })), new KeyValuePair<string, BridgeNode>("pairing-repair-prepare", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("args", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> {  })) })), new KeyValuePair<string, BridgeNode>("tailscale-check", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("args", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> {  })), new KeyValuePair<string, BridgeNode>("value", new BridgeNode("boolean", "true")) })), new KeyValuePair<string, BridgeNode>("export-data", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("args", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> {  })) })), new KeyValuePair<string, BridgeNode>("status", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("args", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> {  })), new KeyValuePair<string, BridgeNode>("immediate", new BridgeNode("boolean", "true")), new KeyValuePair<string, BridgeNode>("value", new BridgeNode("boolean", "true")) })), new KeyValuePair<string, BridgeNode>("complete-setup", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { new KeyValuePair<string, BridgeNode>("args", new BridgeNode(new List<KeyValuePair<string, BridgeNode>> {  })), new KeyValuePair<string, BridgeNode>("reserved", new BridgeNode("boolean", "true")) })) })) });
    internal static readonly BridgeNode Message = Data["message"];
    internal static readonly BridgeNode Actions = Data["actions"];
    internal static readonly BridgeNode Limits = Data["limits"];
    internal static readonly int StatusVersion = Data["status"]["version"].Number;
    internal static readonly int StatusMaxBytes = Data["status"]["maxBytes"].Number;
    internal static readonly int StatusAppVersionMaxLength = Data["status"]["appVersionMaxLength"].Number;
    internal static readonly int StatusCustomSkinsMax = Data["status"]["customSkinsMax"].Number;
    internal static readonly BridgeNode Codes = Data["codes"];
    internal static readonly BridgeNode DashboardFragments = Data["dashboardFragments"];
    internal static readonly BridgeNode WhiteSpace = Data["whiteSpace"];
    internal static readonly BridgeNode AddressGrammar = Data["address"];
    internal static readonly BridgeNode Values = Data["values"];
    internal static bool Digit(char c) => c >= '0' && c <= '9';
    private static bool Letter(char c) => (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z');
    internal static int Hex(char c)
    {
        if (Digit(c)) return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        return -1;
    }
    private static int? Integer(BridgeNode node, int min, int max)
    {
        string text = node.Text;
        if (node.Kind != "number" || text == "-0" || text.Length == 0 ||
            text.Length > Math.Max(min.ToString(CultureInfo.InvariantCulture).Length, max.ToString(CultureInfo.InvariantCulture).Length)) return null;
        int start = text[0] == '-' ? 1 : 0;
        if (start == text.Length) return null;
        for (int i = start; i < text.Length; i++) if (!Digit(text[i])) return null;
        return int.TryParse(text, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out int n) && n >= min && n <= max ? n : null;
    }
    private static bool Clean(string text)
    {
        for (int i = 0; i < text.Length; i++)
        {
            char c = text[i];
            if (c < 32 || (c >= 127 && c <= 159)) return false;
            if (char.IsHighSurrogate(c))
            {
                if (i + 1 >= text.Length || !char.IsLowSurrogate(text[i + 1])) return false;
                i++;
            }
            else if (char.IsLowSurrogate(c)) return false;
        }
        return true;
    }
    private static int ScalarCount(string text)
    {
        int count = 0;
        for (int i = 0; i < text.Length; i++) { if (char.IsHighSurrogate(text[i])) i++; count++; }
        return count;
    }
    private static bool IsWhiteSpace(char c)
    {
        foreach (var item in WhiteSpace.Items) if (item.Number == c) return true;
        return false;
    }
    private static ulong? Ipv4(string text)
    {
        string[] parts = text.Split('.');
        if (parts.Length != 4) return null;
        ulong result = 0;
        foreach (string part in parts)
        {
            if (part.Length < 1 || part.Length > 3 || (part.Length > 1 && part[0] == '0')) return null;
            int n = 0;
            foreach (char c in part) { if (!Digit(c)) return null; n = n * 10 + c - '0'; }
            if (n > 255) return null;
            result = result * 256 + (ulong)n;
        }
        return result;
    }
    private static bool Address(string text)
    {
        if (ScalarCount(text) > AddressGrammar["maxLength"].Number) return false;
        if (!text.Contains(':'))
        {
            ulong? n = Ipv4(text);
            if (!n.HasValue) return false;
            foreach (var pair in AddressGrammar["ipv4"].Items)
            {
                ulong? basis = Ipv4(pair.Items[0].Text);
                int shift = 32 - pair.Items[1].Number;
                if (basis.HasValue && (n.Value >> shift) == (basis.Value >> shift)) return true;
            }
            return false;
        }
        if (text.StartsWith(":", StringComparison.Ordinal) || text.Contains('%') || text.Contains('.')) return false;
        string[] halves = text.Split(new[] { "::" }, StringSplitOptions.None);
        if (halves.Length > 2) return false;
        var groups = new List<string>();
        foreach (string half in halves) if (half.Length != 0) groups.AddRange(half.Split(':'));
        if (halves.Length == 2 ? groups.Count < 2 || groups.Count > 7 : groups.Count != 8) return false;
        int first = -1;
        foreach (string group in groups)
        {
            if (group.Length < 1 || group.Length > 4) return false;
            int n = 0;
            foreach (char c in group) { int h = Hex(c); if (h < 0) return false; n = n * 16 + h; }
            if (first < 0) first = n;
        }
        return first >= AddressGrammar["ipv6FirstGroup"]["min"].Number && first <= AddressGrammar["ipv6FirstGroup"]["max"].Number;
    }
    private static BridgeValue? Checked(BridgeNode rule, BridgeNode node)
    {
        string type = rule["type"].Text;
        if (type == "boolean") return node.Kind == "boolean" ? new BridgeValue("bool", Boolean: node.Text == "true") : null;
        if (type == "integer")
        {
            int? n = Integer(node, rule["min"].Number, rule["max"].Number);
            return n.HasValue ? new BridgeValue("integer", Integer: n.Value) : null;
        }
        if (type == "deviceName" && rule["nullable"].Text == "true" && node.Kind == "null") return new BridgeValue("null");
        if (node.Kind != "string" || !Clean(node.Text)) return null;
        string text = node.Text;
        switch (type)
        {
            case "enum": if (!rule["values"].Contains(text)) return null; break;
            case "hex64":
                if (text.Length != 64) return null;
                foreach (char c in text) if (!Digit(c) && !(c >= 'a' && c <= 'f')) return null;
                break;
            case "skin":
                if (!rule["bundled"].Contains(text))
                {
                    if (text.Length == 0 || ScalarCount(text) > rule["maxLength"].Number) return null;
                    for (int i = 0; i < text.Length; i++)
                        if (!Letter(text[i]) && !Digit(text[i]) && !(i > 0 && (text[i] == ' ' || text[i] == '-'))) return null;
                }
                break;
            case "deviceName":
                int start = 0, end = text.Length;
                while (start < end && IsWhiteSpace(text[start])) start++;
                while (end > start && IsWhiteSpace(text[end - 1])) end--;
                text = text.Substring(start, end - start);
                if (text.Length < rule["minUtf16"].Number || text.Length > rule["maxUtf16"].Number) return null;
                for (int i = 0; i < text.Length; i++)
                {
                    int cp = char.ConvertToUtf32(text, i);
                    if (cp > 0xffff) i++;
                    UnicodeCategory category = CharUnicodeInfo.GetUnicodeCategory(cp);
                    if (category == UnicodeCategory.Control || category == UnicodeCategory.Format) return null;
                }
                foreach (var forbidden in rule["forbidden"].Items) if (text.Contains(forbidden.Text, StringComparison.Ordinal)) return null;
                break;
            case "address": if (!Address(text)) return null; break;
            case "invitation":
                string prefix = rule["prefix"].Text;
                if (ScalarCount(text) > rule["maxLength"].Number || !text.StartsWith(prefix, StringComparison.Ordinal) || text.Length == prefix.Length) return null;
                for (int i = prefix.Length; i < text.Length; i++) if (!Letter(text[i]) && !Digit(text[i]) && text[i] != '-' && text[i] != '_') return null;
                break;
            default: return null;
        }
        return new BridgeValue("string", Text: text);
    }
    internal static BridgeValidation Validate(string? text)
    {
        var ignore = new BridgeValidation("ignore");
        if (text is null || Encoding.UTF8.GetByteCount(text) > Message["maxBytes"].Number) return ignore;
        var parser = new BridgeParser(text, Message["maxDepth"].Number);
        BridgeNode node;
        try { node = parser.Parse(); } catch (FormatException) { return ignore; }
        if (node.Kind != "object") return ignore;
        int idCount = 0;
        foreach (var entry in node.Entries) if (entry.Key == "id") idCount++;
        int? id = Integer(node["id"], Message["id"]["min"].Number, Message["id"]["max"].Number);
        if (idCount != 1 || !id.HasValue) return ignore;
        var refused = new BridgeValidation("refused", id);
        if (parser.Duplicate || node.Entries.Count != Message["keys"].Items.Count || node["action"].Kind != "string") return refused;
        foreach (var entry in node.Entries) if (!Message["keys"].Contains(entry.Key)) return refused;
        string action = node["action"].Text;
        var spec = Actions[action];
        var args = node["args"];
        if (spec.Kind != "object" || spec["reserved"].Text == "true" || args.Kind != "object") return refused;
        var rules = spec["args"];
        foreach (var entry in args.Entries) if (rules[entry.Key].Kind == "missing") return refused;
        var result = new Dictionary<string, BridgeValue>(StringComparer.Ordinal);
        foreach (var entry in rules.Entries)
        {
            var rule = entry.Value;
            var when = rule["presentWhen"];
            bool required = when.Kind == "missing" || (args[when["key"].Text].Kind == "boolean" && args[when["key"].Text].Text == when["equals"].Text);
            var value = args[entry.Key];
            if ((value.Kind != "missing") != required) return refused;
            if (!required) continue;
            var checkedValue = Checked(rule, value);
            if (checkedValue is null) return refused;
            result.Add(entry.Key, checkedValue);
        }
        return new BridgeValidation("accepted", id, action, result);
    }
}
