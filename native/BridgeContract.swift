// Generated from lib/bridge-contract.json by scripts/build-bridge-contract.mjs. Do not edit.
import Foundation

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
    init(_ units: [UInt16], maxDepth: Int) { self.units = units; self.maxDepth = maxDepth }
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
    static let data = {
        let value0: BridgeNode = BridgeNode(entries: [("min", BridgeNode("number", "1")), ("max", BridgeNode("number", "2147483647"))])
        let value1: BridgeNode = BridgeNode(items: [BridgeNode("string", "id"), BridgeNode("string", "action"), BridgeNode("string", "args")])
        let value2: BridgeNode = BridgeNode(entries: [("maxBytes", BridgeNode("number", "4096")), ("maxDepth", BridgeNode("number", "16")), ("id", value0), ("keys", value1)])
        let value3: BridgeNode = BridgeNode(items: [BridgeNode("string", "done"), BridgeNode("string", "refused"), BridgeNode("string", "busy"), BridgeNode("string", "cancelled"), BridgeNode("string", "unavailable"), BridgeNode("string", "expired")])
        let value4: BridgeNode = BridgeNode(entries: [("queue", BridgeNode("number", "4")), ("resultTimeoutSeconds", BridgeNode("number", "60")), ("cacheRefreshSeconds", BridgeNode("number", "5")), ("pairingPollSeconds", BridgeNode("number", "2"))])
        let value5: BridgeNode = BridgeNode(items: [BridgeNode("string", "version"), BridgeNode("string", "app"), BridgeNode("string", "sources"), BridgeNode("string", "skin"), BridgeNode("string", "deviceName"), BridgeNode("string", "startup"), BridgeNode("string", "appearance"), BridgeNode("string", "limitsConsent"), BridgeNode("string", "collectionPaused"), BridgeNode("string", "pairing"), BridgeNode("string", "sharingChoice"), BridgeNode("string", "sharing")])
        let value6: BridgeNode = BridgeNode(entries: [("version", BridgeNode("number", "1")), ("maxBytes", BridgeNode("number", "16384")), ("appVersionMaxLength", BridgeNode("number", "32")), ("customSkinsMax", BridgeNode("number", "32")), ("fields", value5)])
        let value7: BridgeNode = BridgeNode(items: [BridgeNode("string", "limits"), BridgeNode("string", "activity"), BridgeNode("string", "tokens"), BridgeNode("string", "dictation"), BridgeNode("string", "sources"), BridgeNode("string", "settings"), BridgeNode("string", "setup")])
        let value8: BridgeNode = BridgeNode(items: [BridgeNode("number", "9"), BridgeNode("number", "10"), BridgeNode("number", "11"), BridgeNode("number", "12"), BridgeNode("number", "13"), BridgeNode("number", "32"), BridgeNode("number", "133"), BridgeNode("number", "160"), BridgeNode("number", "5760"), BridgeNode("number", "8192"), BridgeNode("number", "8193"), BridgeNode("number", "8194"), BridgeNode("number", "8195"), BridgeNode("number", "8196"), BridgeNode("number", "8197"), BridgeNode("number", "8198"), BridgeNode("number", "8199"), BridgeNode("number", "8200"), BridgeNode("number", "8201"), BridgeNode("number", "8202"), BridgeNode("number", "8232"), BridgeNode("number", "8233"), BridgeNode("number", "8239"), BridgeNode("number", "8287"), BridgeNode("number", "12288")])
        let value9: BridgeNode = BridgeNode(items: [BridgeNode("string", "10.0.0.0"), BridgeNode("number", "8")])
        let value10: BridgeNode = BridgeNode(items: [BridgeNode("string", "172.16.0.0"), BridgeNode("number", "12")])
        let value11: BridgeNode = BridgeNode(items: [BridgeNode("string", "192.168.0.0"), BridgeNode("number", "16")])
        let value12: BridgeNode = BridgeNode(items: [BridgeNode("string", "100.64.0.0"), BridgeNode("number", "10")])
        let value13: BridgeNode = BridgeNode(items: [value9, value10, value11, value12])
        let value14: BridgeNode = BridgeNode(entries: [("min", BridgeNode("number", "64512")), ("max", BridgeNode("number", "65023"))])
        let value15: BridgeNode = BridgeNode(entries: [("maxLength", BridgeNode("number", "39")), ("ipv4", value13), ("ipv6FirstGroup", value14)])
        let value16: BridgeNode = BridgeNode(items: [BridgeNode("string", "running"), BridgeNode("string", "offline"), BridgeNode("string", "needs-login"), BridgeNode("string", "needs-device-approval"), BridgeNode("string", "stopped"), BridgeNode("string", "starting"), BridgeNode("string", "other-user"), BridgeNode("string", "not-installed"), BridgeNode("string", "unsupported"), BridgeNode("string", "unavailable")])
        let value17: BridgeNode = BridgeNode(items: [BridgeNode("string", "idle"), BridgeNode("string", "identity-ready"), BridgeNode("string", "identity-required"), BridgeNode("string", "identity-recovery-required"), BridgeNode("string", "inactive"), BridgeNode("string", "waiting"), BridgeNode("string", "confirming"), BridgeNode("string", "awaiting-confirmation"), BridgeNode("string", "local-ready"), BridgeNode("string", "acknowledged"), BridgeNode("string", "configuration-ready"), BridgeNode("string", "working"), BridgeNode("string", "cancelled"), BridgeNode("string", "paired"), BridgeNode("string", "unpaired"), BridgeNode("string", "unavailable"), BridgeNode("string", "establishing-trust"), BridgeNode("string", "active-sync"), BridgeNode("string", "sync-stale"), BridgeNode("string", "revoked")])
        let value18: BridgeNode = BridgeNode(items: [BridgeNode("string", "none"), BridgeNode("string", "ssh"), BridgeNode("string", "tls")])
        let value19: BridgeNode = BridgeNode(items: [BridgeNode("string", "on"), BridgeNode("string", "waiting-for-reading"), BridgeNode("string", "off"), BridgeNode("string", "unavailable")])
        let value20: BridgeNode = BridgeNode(items: [BridgeNode("string", "ready"), BridgeNode("string", "pairing-unavailable"), BridgeNode("string", "account-unavailable"), BridgeNode("string", "source-unavailable")])
        let value21: BridgeNode = BridgeNode(items: [BridgeNode("string", "system"), BridgeNode("string", "light"), BridgeNode("string", "dark")])
        let value22: BridgeNode = BridgeNode(entries: [("tailscaleStatus", value16), ("pairingState", value17), ("transport", value18), ("sharingChoiceState", value19), ("sharingReason", value20), ("appearance", value21)])
        let value23: BridgeNode = BridgeNode(entries: [])
        let value24: BridgeNode = BridgeNode(entries: [("args", value23)])
        let value25: BridgeNode = BridgeNode(entries: [])
        let value26: BridgeNode = BridgeNode(entries: [("args", value25)])
        let value27: BridgeNode = BridgeNode(items: [BridgeNode("string", "limits"), BridgeNode("string", "activity"), BridgeNode("string", "tokens"), BridgeNode("string", "dictation"), BridgeNode("string", "sources"), BridgeNode("string", "settings")])
        let value28: BridgeNode = BridgeNode(entries: [("type", BridgeNode("string", "enum")), ("values", value27)])
        let value29: BridgeNode = BridgeNode(entries: [("section", value28)])
        let value30: BridgeNode = BridgeNode(entries: [("args", value29)])
        let value31: BridgeNode = BridgeNode(entries: [])
        let value32: BridgeNode = BridgeNode(entries: [("args", value31)])
        let value33: BridgeNode = BridgeNode(items: [BridgeNode("string", "activity"), BridgeNode("string", "codex"), BridgeNode("string", "claude"), BridgeNode("string", "wispr"), BridgeNode("string", "quota")])
        let value34: BridgeNode = BridgeNode(entries: [("type", BridgeNode("string", "enum")), ("values", value33)])
        let value35: BridgeNode = BridgeNode(entries: [("type", BridgeNode("string", "boolean"))])
        let value36: BridgeNode = BridgeNode(entries: [("source", value34), ("enabled", value35)])
        let value37: BridgeNode = BridgeNode(entries: [("args", value36)])
        let value38: BridgeNode = BridgeNode(items: [BridgeNode("string", "sage"), BridgeNode("string", "almanac"), BridgeNode("string", "instrument"), BridgeNode("string", "amber-crt")])
        let value39: BridgeNode = BridgeNode(entries: [("type", BridgeNode("string", "skin")), ("bundled", value38), ("maxLength", BridgeNode("number", "32"))])
        let value40: BridgeNode = BridgeNode(entries: [("skin", value39)])
        let value41: BridgeNode = BridgeNode(entries: [("args", value40)])
        let value42: BridgeNode = BridgeNode(items: [BridgeNode("string", "/"), BridgeNode("string", "\\"), BridgeNode("string", ":")])
        let value43: BridgeNode = BridgeNode(entries: [("type", BridgeNode("string", "deviceName")), ("nullable", BridgeNode("boolean", "true")), ("minUtf16", BridgeNode("number", "1")), ("maxUtf16", BridgeNode("number", "32")), ("forbidden", value42)])
        let value44: BridgeNode = BridgeNode(entries: [("name", value43)])
        let value45: BridgeNode = BridgeNode(entries: [("args", value44)])
        let value46: BridgeNode = BridgeNode(entries: [("type", BridgeNode("string", "boolean"))])
        let value47: BridgeNode = BridgeNode(entries: [("enabled", value46)])
        let value48: BridgeNode = BridgeNode(entries: [("args", value47)])
        let value49: BridgeNode = BridgeNode(items: [BridgeNode("string", "system"), BridgeNode("string", "light"), BridgeNode("string", "dark")])
        let value50: BridgeNode = BridgeNode(entries: [("type", BridgeNode("string", "enum")), ("values", value49)])
        let value51: BridgeNode = BridgeNode(entries: [("mode", value50)])
        let value52: BridgeNode = BridgeNode(entries: [("args", value51)])
        let value53: BridgeNode = BridgeNode(entries: [("type", BridgeNode("string", "boolean"))])
        let value54: BridgeNode = BridgeNode(entries: [("enabled", value53)])
        let value55: BridgeNode = BridgeNode(entries: [("args", value54)])
        let value56: BridgeNode = BridgeNode(entries: [("type", BridgeNode("string", "boolean"))])
        let value57: BridgeNode = BridgeNode(entries: [("enabled", value56)])
        let value58: BridgeNode = BridgeNode(entries: [("args", value57)])
        let value59: BridgeNode = BridgeNode(items: [BridgeNode("string", "codex-limits"), BridgeNode("string", "claude-code-tokens")])
        let value60: BridgeNode = BridgeNode(entries: [("type", BridgeNode("string", "enum")), ("values", value59)])
        let value61: BridgeNode = BridgeNode(entries: [("type", BridgeNode("string", "boolean"))])
        let value62: BridgeNode = BridgeNode(entries: [("key", BridgeNode("string", "enabled")), ("equals", BridgeNode("boolean", "true"))])
        let value63: BridgeNode = BridgeNode(entries: [("type", BridgeNode("string", "hex64")), ("presentWhen", value62)])
        let value64: BridgeNode = BridgeNode(entries: [("channel", value60), ("enabled", value61), ("token", value63)])
        let value65: BridgeNode = BridgeNode(entries: [("args", value64)])
        let value66: BridgeNode = BridgeNode(entries: [])
        let value67: BridgeNode = BridgeNode(entries: [("args", value66)])
        let value68: BridgeNode = BridgeNode(entries: [("type", BridgeNode("string", "address"))])
        let value69: BridgeNode = BridgeNode(entries: [("type", BridgeNode("string", "integer")), ("min", BridgeNode("number", "1024")), ("max", BridgeNode("number", "65535"))])
        let value70: BridgeNode = BridgeNode(entries: [("address", value68), ("port", value69)])
        let value71: BridgeNode = BridgeNode(entries: [("args", value70), ("value", BridgeNode("boolean", "true"))])
        let value72: BridgeNode = BridgeNode(entries: [])
        let value73: BridgeNode = BridgeNode(entries: [("args", value72), ("value", BridgeNode("boolean", "true"))])
        let value74: BridgeNode = BridgeNode(entries: [])
        let value75: BridgeNode = BridgeNode(entries: [("args", value74), ("immediate", BridgeNode("boolean", "true")), ("value", BridgeNode("boolean", "true"))])
        let value76: BridgeNode = BridgeNode(entries: [])
        let value77: BridgeNode = BridgeNode(entries: [("args", value76)])
        let value78: BridgeNode = BridgeNode(entries: [("type", BridgeNode("string", "hex64"))])
        let value79: BridgeNode = BridgeNode(entries: [("type", BridgeNode("string", "address"))])
        let value80: BridgeNode = BridgeNode(entries: [("type", BridgeNode("string", "integer")), ("min", BridgeNode("number", "1024")), ("max", BridgeNode("number", "65535"))])
        let value81: BridgeNode = BridgeNode(entries: [("type", BridgeNode("string", "boolean"))])
        let value82: BridgeNode = BridgeNode(entries: [("fingerprint", value78), ("peerAddress", value79), ("peerPort", value80), ("sharing", value81)])
        let value83: BridgeNode = BridgeNode(entries: [("args", value82)])
        let value84: BridgeNode = BridgeNode(entries: [("type", BridgeNode("string", "invitation")), ("prefix", BridgeNode("string", "observatory-pair:v1:")), ("maxLength", BridgeNode("number", "2048"))])
        let value85: BridgeNode = BridgeNode(entries: [("invitation", value84)])
        let value86: BridgeNode = BridgeNode(entries: [("args", value85)])
        let value87: BridgeNode = BridgeNode(entries: [("type", BridgeNode("string", "boolean"))])
        let value88: BridgeNode = BridgeNode(entries: [("sharing", value87)])
        let value89: BridgeNode = BridgeNode(entries: [("args", value88)])
        let value90: BridgeNode = BridgeNode(entries: [])
        let value91: BridgeNode = BridgeNode(entries: [("args", value90), ("immediate", BridgeNode("boolean", "true"))])
        let value92: BridgeNode = BridgeNode(entries: [])
        let value93: BridgeNode = BridgeNode(entries: [("args", value92)])
        let value94: BridgeNode = BridgeNode(entries: [])
        let value95: BridgeNode = BridgeNode(entries: [("args", value94)])
        let value96: BridgeNode = BridgeNode(entries: [])
        let value97: BridgeNode = BridgeNode(entries: [("args", value96), ("value", BridgeNode("boolean", "true"))])
        let value98: BridgeNode = BridgeNode(entries: [])
        let value99: BridgeNode = BridgeNode(entries: [("args", value98)])
        let value100: BridgeNode = BridgeNode(entries: [])
        let value101: BridgeNode = BridgeNode(entries: [("args", value100), ("immediate", BridgeNode("boolean", "true")), ("value", BridgeNode("boolean", "true"))])
        let value102: BridgeNode = BridgeNode(entries: [])
        let value103: BridgeNode = BridgeNode(entries: [("args", value102)])
        let value104: BridgeNode = BridgeNode(entries: [("refresh", value24), ("check-updates", value26), ("open-dashboard", value30), ("open-settings", value32), ("set-source", value37), ("set-skin", value41), ("set-device-name", value45), ("set-startup", value48), ("set-appearance", value52), ("set-limits-consent", value55), ("set-sharing-choice", value58), ("set-sharing", value65), ("pairing-identity-create", value67), ("pairing-host-start", value71), ("pairing-host-defaults", value73), ("pairing-peer-address", value75), ("pairing-copy-invitation", value77), ("pairing-host-confirm", value83), ("pairing-join-claim", value86), ("pairing-join-confirm", value89), ("pairing-cancel", value91), ("pairing-disconnect", value93), ("pairing-repair-prepare", value95), ("tailscale-check", value97), ("export-data", value99), ("status", value101), ("complete-setup", value103)])
        let value105: BridgeNode = BridgeNode(entries: [("version", BridgeNode("number", "1")), ("source", BridgeNode("string", "docs/DESIGN.md, Settings bridge contract")), ("message", value2), ("codes", value3), ("limits", value4), ("status", value6), ("dashboardFragments", value7), ("whiteSpace", value8), ("address", value15), ("values", value22), ("actions", value104)])
        return value105
    }()
    static let message = data["message"]
    static let actions = data["actions"]
    static let limits = data["limits"]
    static let status = data["status"]
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
        validate(utf16: Array(text.utf16))
    }
    /// The Mac shell casts WKScriptMessage.body with message.body as? NSString and never bridges it to String first.
    static func validate(_ text: NSString) -> BridgeValidation {
        // Every UTF-16 unit is at least one UTF-8 byte, so a longer string is ignored before it is copied.
        guard text.length <= message["maxBytes"].number else { return .ignore }
        let units = (0..<text.length).map { text.character(at: $0) }
        return validate(utf16: units)
    }
    static func validate(utf16 units: [UInt16]) -> BridgeValidation {
        var bytes = 0
        var at = 0
        while at < units.count {
            let unit = units[at]
            if unit < 0x80 { bytes += 1 }
            else if unit < 0x800 { bytes += 2 }
            else if unit >= 0xd800 && unit <= 0xdbff && at + 1 < units.count && units[at + 1] >= 0xdc00 && units[at + 1] <= 0xdfff {
                bytes += 4
                at += 1
            } else { bytes += 3 }
            guard bytes <= message["maxBytes"].number else { return .ignore }
            at += 1
        }
        let parser = BridgeParser(units, maxDepth: message["maxDepth"].number)
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
