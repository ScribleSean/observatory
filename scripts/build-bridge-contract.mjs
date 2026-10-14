import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const notice = '// Generated from lib/bridge-contract.json by scripts/build-bridge-contract.mjs. Do not edit.\n';

function validateContract(data) {
  const fail = () => { throw new Error('Invalid bridge contract data'); };
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const keys = (v, required, optional = []) => {
    if (!object(v) || required.some(k => !Object.hasOwn(v, k)) || Object.keys(v).some(k => !required.includes(k) && !optional.includes(k))) fail();
  };
  const positive = v => { if (!Number.isSafeInteger(v) || v < 1) fail(); };
  const strings = v => { if (!Array.isArray(v) || !v.length || v.some(s => typeof s !== 'string' || !s.length) || new Set(v).size !== v.length) fail(); };
  const bounds = v => { keys(v, ['min', 'max']); positive(v.min); positive(v.max); if (v.min > v.max) fail(); };
  keys(data, ['version', 'source', 'message', 'codes', 'limits', 'dashboardFragments', 'whiteSpace', 'address', 'values', 'actions']);
  positive(data.version); if (typeof data.source !== 'string') fail();
  keys(data.message, ['maxBytes', 'maxDepth', 'id', 'keys']);
  positive(data.message.maxBytes); positive(data.message.maxDepth); bounds(data.message.id); strings(data.message.keys);
  if (data.message.keys.length !== 3 || ['id', 'action', 'args'].some(k => !data.message.keys.includes(k))) fail();
  strings(data.codes); strings(data.dashboardFragments);
  keys(data.limits, ['queue', 'resultTimeoutSeconds', 'cacheRefreshSeconds', 'pairingPollSeconds', 'statusMaxBytes']);
  Object.values(data.limits).forEach(positive);
  if (!Array.isArray(data.whiteSpace) || !data.whiteSpace.length || new Set(data.whiteSpace).size !== data.whiteSpace.length || data.whiteSpace.some(c => !Number.isInteger(c) || c < 0 || c > 0x10ffff || (c >= 0xd800 && c <= 0xdfff))) fail();
  keys(data.address, ['maxLength', 'ipv4', 'ipv6FirstGroup']); positive(data.address.maxLength); bounds(data.address.ipv6FirstGroup);
  if (data.address.ipv6FirstGroup.max > 65535 || !Array.isArray(data.address.ipv4) || !data.address.ipv4.length) fail();
  for (const pair of data.address.ipv4) {
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || !Number.isInteger(pair[1]) || pair[1] < 0 || pair[1] > 32) fail();
    const parts = pair[0].split('.');
    if (parts.length !== 4 || parts.some(p => !/^(0|[1-9][0-9]{0,2})$/.test(p) || Number(p) > 255)) fail();
  }
  keys(data.values, ['tailscaleStatus', 'pairingState', 'transport', 'sharingReason', 'appearance']); Object.values(data.values).forEach(strings);
  if (!object(data.actions) || !Object.keys(data.actions).length) fail();
  for (const [name, action] of Object.entries(data.actions)) {
    if (!/^[a-z][a-z-]*$/.test(name)) fail();
    keys(action, ['args'], ['reserved', 'immediate', 'value']);
    for (const key of ['reserved', 'immediate', 'value']) if (Object.hasOwn(action, key) && typeof action[key] !== 'boolean') fail();
    if (!object(action.args)) fail();
    for (const [key, rule] of Object.entries(action.args)) {
      if (!/^[a-z][A-Za-z]*$/.test(key) || !object(rule)) fail();
      const fields = { boolean: [], integer: ['min', 'max'], enum: ['values'], hex64: [], skin: ['bundled', 'maxLength'], deviceName: ['nullable', 'minUtf16', 'maxUtf16', 'forbidden'], address: [], invitation: ['prefix', 'maxLength'] };
      if (!Object.hasOwn(fields, rule.type)) fail();
      keys(rule, ['type', ...fields[rule.type]], ['presentWhen']);
      if (rule.type === 'integer') bounds({ min: rule.min, max: rule.max });
      if (rule.type === 'enum') strings(rule.values);
      if (rule.type === 'skin') strings(rule.bundled);
      if (Object.hasOwn(rule, 'maxLength')) positive(rule.maxLength);
      if (rule.type === 'deviceName') {
        if (typeof rule.nullable !== 'boolean') fail();
        positive(rule.minUtf16); positive(rule.maxUtf16); strings(rule.forbidden);
        if (rule.minUtf16 > rule.maxUtf16 || rule.forbidden.some(s => [...s].length !== 1)) fail();
      }
      if (rule.type === 'invitation' && (typeof rule.prefix !== 'string' || !rule.prefix.length || [...rule.prefix].length >= rule.maxLength)) fail();
      if (Object.hasOwn(rule, 'presentWhen')) {
        keys(rule.presentWhen, ['key', 'equals']);
        if (typeof rule.presentWhen.key !== 'string' || typeof rule.presentWhen.equals !== 'boolean' || action.args[rule.presentWhen.key]?.type !== 'boolean' || key === rule.presentWhen.key) fail();
      }
    }
  }
}

const quote = JSON.stringify;
function nativeData(value, language) {
  const swift = language === 'swift';
  if (value === null) return swift ? 'BridgeNode("null")' : 'new BridgeNode("null")';
  if (typeof value === 'string') {
    const literal = swift ? quote(value).replace(/\\u([0-9a-f]{4})/gi, '\\u{$1}') : quote(value);
    return swift ? `BridgeNode("string", ${literal})` : `new BridgeNode("string", ${literal})`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return `${swift ? '' : 'new '}BridgeNode(${quote(typeof value === 'number' ? 'number' : 'boolean')}, ${quote(String(value))})`;
  if (Array.isArray(value)) return swift ? `BridgeNode(items: [${value.map(v => nativeData(v, language)).join(', ')}])` : `new BridgeNode(new List<BridgeNode> { ${value.map(v => nativeData(v, language)).join(', ')} })`;
  const entries = Object.entries(value).map(([k, v]) => swift ? `(${quote(k)}, ${nativeData(v, language)})` : `new KeyValuePair<string, BridgeNode>(${quote(k)}, ${nativeData(v, language)})`);
  return swift ? `BridgeNode(entries: [${entries.length ? entries.join(', ') : ''}])` : `new BridgeNode(new List<KeyValuePair<string, BridgeNode>> { ${entries.join(', ')} })`;
}

function swiftData(data) {
  const declarations = [];
  let serial = 0;
  const visit = value => {
    if (value === null || typeof value !== 'object') return nativeData(value, 'swift');
    const expression = Array.isArray(value)
      ? `BridgeNode(items: [${value.map(visit).join(', ')}])`
      : `BridgeNode(entries: [${Object.entries(value).map(([key, child]) => `(${quote(key)}, ${visit(child)})`).join(', ')}])`;
    const name = `value${serial++}`;
    declarations.push(`        let ${name}: BridgeNode = ${expression}`);
    return name;
  };
  const result = visit(data);
  return `{\n${declarations.join('\n')}\n        return ${result}\n    }()`;
}

export function generatedBridgeContract() {
  const data = JSON.parse(readFileSync(new URL('lib/bridge-contract.json', root), 'utf8'));
  validateContract(data);
  const actions = Object.entries(data.actions).filter(([, rule]) => !rule.reserved);
  const type = rule => ({ boolean: 'boolean', integer: 'number', enum: rule.values?.map(quote).join(' | '), deviceName: rule.nullable ? 'string | null' : 'string' })[rule.type] ?? 'string';
  const ts = `${notice}export const BRIDGE_CONTRACT = ${JSON.stringify(data, null, 2)} as const;\n\nexport type BridgeAction = ${actions.map(([name]) => quote(name)).join(' | ')};\nexport type BridgeArgs = {\n${actions.map(([name, rule]) => `  ${quote(name)}: ${Object.keys(rule.args).length ? `{ ${Object.entries(rule.args).map(([key, r]) => `${quote(key)}${r.presentWhen ? '?' : ''}: ${type(r)}`).join('; ')} }` : 'Record<string, never>'};`).join('\n')}\n};\nexport type BridgeCode = ${data.codes.map(quote).join(' | ')};\nexport type BridgeResultDetail = { id: number; ok: boolean; code: BridgeCode; value?: unknown };\n`;
  return new Map([
    ['lib/bridge-contract.generated.ts', ts],
    ['native/BridgeContract.swift', notice + swiftTemplate.replace('BRIDGE_DATA', swiftData(data))],
    ['native/windows/BridgeContract.cs', notice + csTemplate.replace('BRIDGE_DATA', nativeData(data, 'cs'))]
  ]);
}

const swiftTemplate = String.raw`import Foundation

enum BridgeValue: Equatable {
    case bool(Bool), integer(Int), string(String), null
}
enum BridgeValidation {
    case ignore
    case refused(id: Int)
    case accepted(id: Int, action: String, args: [String: BridgeValue])
}

// Nodes preserve number spelling and object entry order.
final class BridgeNode {
    let kind: String
    let text: String
    let valid: Bool
    let entries: [(String, BridgeNode)]
    let items: [BridgeNode]
    init(_ kind: String, _ text: String = "", valid: Bool = true) {
        self.kind = kind
        self.text = text
        self.valid = valid
        entries = []
        items = []
    }
    init(entries: [(String, BridgeNode)]) {
        kind = "object"
        text = ""
        valid = true
        self.entries = entries
        items = []
    }
    init(items: [BridgeNode]) {
        kind = "array"
        text = ""
        valid = true
        entries = []
        self.items = items
    }
    subscript(_ key: String) -> BridgeNode {
        entries.first { BridgeContract.same($0.0, key) }?.1 ?? BridgeNode("missing")
    }
    var number: Int { Int(text) ?? 0 }
    var strings: [String] { items.map { $0.text } }
}

enum BridgeParseError: Error { case invalid }
final class BridgeParser {
    let units: [UInt16]
    let maxDepth: Int
    var at = 0
    var duplicate = false
    init(_ text: String, maxDepth: Int) { units = Array(text.utf16); self.maxDepth = maxDepth }
    var current: UInt16 { at < units.count ? units[at] : 0xffff }
    func take(_ c: UInt16) -> Bool {
        guard current == c else { return false }
        at += 1
        return true
    }
    func space() { while [9, 10, 13, 32].contains(current) { at += 1 } }
    func string() throws -> BridgeNode {
        guard take(34) else { throw BridgeParseError.invalid }
        var result: [UInt16] = []
        while at < units.count {
            let c = current
            at += 1
            if c == 34 {
                var i = 0
                var valid = true
                while i < result.count {
                    let u = result[i]
                    if u >= 0xd800 && u <= 0xdbff {
                        if i + 1 < result.count && result[i + 1] >= 0xdc00 && result[i + 1] <= 0xdfff { i += 2; continue }
                        valid = false
                    } else if u >= 0xdc00 && u <= 0xdfff { valid = false }
                    i += 1
                }
                return BridgeNode("string", String(decoding: result, as: UTF16.self), valid: valid)
            }
            guard c >= 32 else { throw BridgeParseError.invalid }
            if c != 92 { result.append(c); continue }
            let e = current
            at += 1
            switch e {
            case 34, 92, 47: result.append(e)
            case 98: result.append(8)
            case 102: result.append(12)
            case 110: result.append(10)
            case 114: result.append(13)
            case 116: result.append(9)
            case 117:
                var n: UInt16 = 0
                for _ in 0..<4 {
                    guard let h = BridgeContract.hex(current) else { throw BridgeParseError.invalid }
                    n = n * 16 + UInt16(h)
                    at += 1
                }
                result.append(n)
            default: throw BridgeParseError.invalid
            }
        }
        throw BridgeParseError.invalid
    }
    func value(_ depth: Int = 0) throws -> BridgeNode {
        space()
        if current == 123 || current == 91 {
            guard depth < maxDepth else { throw BridgeParseError.invalid }
            let object = current == 123
            let end: UInt16 = object ? 125 : 93
            at += 1
            var entries: [(String, BridgeNode)] = []
            var items: [BridgeNode] = []
            var keys = Set<[UInt16]>()
            space()
            if take(end) { return object ? BridgeNode(entries: entries) : BridgeNode(items: items) }
            while true {
                space()
                var key = ""
                if object {
                    let node = try string()
                    key = node.text
                    if !keys.insert(Array(key.utf16)).inserted { duplicate = true }
                    space()
                    guard take(58) else { throw BridgeParseError.invalid }
                }
                let node = try value(depth + 1)
                if object { entries.append((key, node)) } else { items.append(node) }
                space()
                if take(end) { break }
                guard take(44) else { throw BridgeParseError.invalid }
            }
            return object ? BridgeNode(entries: entries) : BridgeNode(items: items)
        }
        if current == 34 { return try string() }
        for word in ["true", "false", "null"] {
            let chars = Array(word.utf16)
            if at + chars.count <= units.count && Array(units[at..<(at + chars.count)]) == chars {
                at += chars.count
                return BridgeNode(word == "null" ? "null" : "boolean", word)
            }
        }
        let start = at
        _ = take(45)
        if !take(48) {
            guard current >= 49 && current <= 57 else { throw BridgeParseError.invalid }
            while BridgeContract.digit(current) { at += 1 }
        }
        if take(46) {
            guard BridgeContract.digit(current) else { throw BridgeParseError.invalid }
            while BridgeContract.digit(current) { at += 1 }
        }
        if take(101) || take(69) {
            if !take(43) { _ = take(45) }
            guard BridgeContract.digit(current) else { throw BridgeParseError.invalid }
            while BridgeContract.digit(current) { at += 1 }
        }
        return BridgeNode("number", String(decoding: units[start..<at], as: UTF16.self))
    }
    func parse() throws -> BridgeNode {
        let node = try value()
        space()
        guard at == units.count else { throw BridgeParseError.invalid }
        return node
    }
}

enum BridgeContract {
    static let data = BRIDGE_DATA
    static let message = data["message"]
    static let actions = data["actions"]
    static let limits = data["limits"]
    static let codes = data["codes"].strings
    static let dashboardFragments = data["dashboardFragments"].strings
    static let whiteSpace = Set(data["whiteSpace"].items.map { UInt32($0.number) })
    static let addressGrammar = data["address"]
    static let values = data["values"]

    static func same(_ a: String, _ b: String) -> Bool { a.utf16.elementsEqual(b.utf16) }
    static func separated(_ units: [UInt16], by separator: [UInt16]) -> [[UInt16]] {
        var parts: [[UInt16]] = []
        var start = 0
        var at = 0
        while at + separator.count <= units.count {
            if units[at..<(at + separator.count)].elementsEqual(separator) {
                parts.append(Array(units[start..<at]))
                at += separator.count
                start = at
            } else {
                at += 1
            }
        }
        parts.append(Array(units[start...]))
        return parts
    }
    static func digit(_ c: UInt16) -> Bool { c >= 48 && c <= 57 }
    static func letter(_ c: UInt16) -> Bool { (c >= 65 && c <= 90) || (c >= 97 && c <= 122) }
    static func hex(_ c: UInt16) -> Int? {
        if digit(c) { return Int(c - 48) }
        if c >= 65 && c <= 70 { return Int(c - 55) }
        if c >= 97 && c <= 102 { return Int(c - 87) }
        return nil
    }
    static func integer(_ node: BridgeNode, _ min: Int, _ max: Int) -> Int? {
        guard node.kind == "number", !same(node.text, "-0"),
              node.text.utf8.count <= Swift.max(String(min).utf8.count, String(max).utf8.count) else { return nil }
        let chars = Array(node.text.utf16)
        let digits = chars.first == 45 ? Array(chars.dropFirst()) : chars
        guard !digits.isEmpty, digits.allSatisfy({ digit($0) }),
              let n = Int(node.text), n >= min, n <= max else { return nil }
        return n
    }
    static func clean(_ node: BridgeNode) -> Bool {
        node.valid && node.text.unicodeScalars.allSatisfy { $0.value >= 32 && !($0.value >= 127 && $0.value <= 159) }
    }
    static func ipv4(_ text: String) -> UInt64? {
        let parts = separated(Array(text.utf16), by: [46])
        guard parts.count == 4 else { return nil }
        var result: UInt64 = 0
        for part in parts {
            let chars = part
            guard (1...3).contains(chars.count), chars.allSatisfy({ digit($0) }),
                  !(chars.count > 1 && chars[0] == 48), let n = UInt64(String(decoding: part, as: UTF16.self)), n <= 255 else { return nil }
            result = result * 256 + n
        }
        return result
    }
    static func address(_ text: String) -> Bool {
        guard text.unicodeScalars.count <= addressGrammar["maxLength"].number else { return false }
        let units = Array(text.utf16)
        if !units.contains(58) {
            guard let n = ipv4(text) else { return false }
            return addressGrammar["ipv4"].items.contains { pair in
                guard let base = ipv4(pair.items[0].text) else { return false }
                let shift = 32 - pair.items[1].number
                return n >> shift == base >> shift
            }
        }
        guard units.first != 58, !units.contains(37), !units.contains(46) else { return false }
        let halves = separated(units, by: [58, 58])
        guard halves.count <= 2 else { return false }
        let groups = halves.flatMap { $0.isEmpty ? [[UInt16]]() : separated($0, by: [58]) }
        guard (halves.count == 2 ? (2...7).contains(groups.count) : groups.count == 8) else { return false }
        var numbers: [Int] = []
        for group in groups {
            let chars = group
            guard (1...4).contains(chars.count), chars.allSatisfy({ hex($0) != nil }) else { return false }
            numbers.append(chars.reduce(0) { $0 * 16 + hex($1)! })
        }
        return numbers[0] >= addressGrammar["ipv6FirstGroup"]["min"].number && numbers[0] <= addressGrammar["ipv6FirstGroup"]["max"].number
    }
    static func checked(_ rule: BridgeNode, _ node: BridgeNode) -> BridgeValue? {
        let type = rule["type"].text
        if type == "boolean" { return node.kind == "boolean" ? .bool(same(node.text, "true")) : nil }
        if type == "integer" { return integer(node, rule["min"].number, rule["max"].number).map { .integer($0) } }
        if type == "deviceName" && same(rule["nullable"].text, "true") && node.kind == "null" { return .null }
        guard node.kind == "string", clean(node) else { return nil }
        var text = node.text
        let chars = Array(text.utf16)
        switch type {
        case "enum": if !rule["values"].strings.contains(where: { same($0, text) }) { return nil }
        case "hex64":
            if chars.count != 64 || !chars.allSatisfy({ digit($0) || ($0 >= 97 && $0 <= 102) }) { return nil }
        case "skin":
            if !rule["bundled"].strings.contains(where: { same($0, text) }) {
                guard !chars.isEmpty, text.unicodeScalars.count <= rule["maxLength"].number else { return nil }
                for (i, c) in chars.enumerated() { if !letter(c) && !digit(c) && !(i > 0 && (c == 32 || c == 45)) { return nil } }
            }
        case "deviceName":
            var scalars = Array(text.unicodeScalars)
            while let first = scalars.first, whiteSpace.contains(first.value) { scalars.removeFirst() }
            while let last = scalars.last, whiteSpace.contains(last.value) { scalars.removeLast() }
            text = String(String.UnicodeScalarView(scalars))
            guard text.utf16.count >= rule["minUtf16"].number, text.utf16.count <= rule["maxUtf16"].number,
                  !scalars.contains(where: { $0.properties.generalCategory == .control || $0.properties.generalCategory == .format }),
                  !rule["forbidden"].strings.contains(where: { forbidden in
                      scalars.contains(where: { scalar in forbidden.unicodeScalars.contains(where: { $0.value == scalar.value }) })
                  }) else { return nil }
        case "address": if !address(text) { return nil }
        case "invitation":
            let prefix = rule["prefix"].text
            guard text.unicodeScalars.count <= rule["maxLength"].number, chars.prefix(prefix.utf16.count).elementsEqual(prefix.utf16), chars.count > prefix.utf16.count else { return nil }
            if !chars.dropFirst(prefix.utf16.count).allSatisfy({ letter($0) || digit($0) || $0 == 45 || $0 == 95 }) { return nil }
        default: return nil
        }
        return .string(text)
    }
    static func validate(_ text: String) -> BridgeValidation {
        guard text.utf8.count <= message["maxBytes"].number else { return .ignore }
        let parser = BridgeParser(text, maxDepth: message["maxDepth"].number)
        guard let node = try? parser.parse(), node.kind == "object" else { return .ignore }
        let ids = node.entries.filter { same($0.0, "id") }
        guard ids.count == 1, let id = integer(ids[0].1, message["id"]["min"].number, message["id"]["max"].number) else { return .ignore }
        let refused = BridgeValidation.refused(id: id)
        guard !parser.duplicate, node.entries.count == message["keys"].items.count,
              node.entries.allSatisfy({ entry in message["keys"].strings.contains(where: { same($0, entry.0) }) }), node["action"].kind == "string" else { return refused }
        let action = node["action"].text
        let spec = actions[action]
        let args = node["args"]
        guard spec.kind == "object", !same(spec["reserved"].text, "true"), args.kind == "object" else { return refused }
        let rules = spec["args"]
        guard args.entries.allSatisfy({ rules[$0.0].kind != "missing" }) else { return refused }
        var result: [String: BridgeValue] = [:]
        for (key, rule) in rules.entries {
            let when = rule["presentWhen"]
            let required = when.kind == "missing" || (args[when["key"].text].kind == "boolean" && same(args[when["key"].text].text, when["equals"].text))
            let value = args[key]
            guard (value.kind != "missing") == required else { return refused }
            if !required { continue }
            guard let checkedValue = checked(rule, value) else { return refused }
            result[key] = checkedValue
        }
        return .accepted(id: id, action: action, args: result)
    }
}
`;

const csTemplate = String.raw`using System;
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
    internal static readonly BridgeNode Data = BRIDGE_DATA;
    internal static readonly BridgeNode Message = Data["message"];
    internal static readonly BridgeNode Actions = Data["actions"];
    internal static readonly BridgeNode Limits = Data["limits"];
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
`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const [path, content] of generatedBridgeContract()) {
    const file = new URL(path, root);
    if (process.argv.includes('--check')) {
      let existing;
      try { existing = readFileSync(file, 'utf8').replace(/\r\n/g, '\n'); } catch { existing = null; }
      if (existing !== content) throw new Error(`${path} needs regeneration`);
    } else if (!existsSync(file) || readFileSync(file, 'utf8') !== content) writeFileSync(file, content);
  }
}
