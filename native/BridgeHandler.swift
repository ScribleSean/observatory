import AppKit
import Foundation
import Darwin
import WebKit

enum BridgeCode: String { case done, refused, busy, cancelled, unavailable }

struct BridgeResult {
    let id: Int
    let code: BridgeCode
    let value: Any?
    var detail: [String: Any] {
        var result: [String: Any] = ["id": id, "ok": code == .done, "code": code.rawValue]
        if let value { result["value"] = value }
        return result
    }
}

@MainActor
final class BridgeAdmission {
    private final class Entry {
        let ticket = UUID()
        let document: UUID
        let id: Int
        let action: String
        let run: (@escaping (BridgeCode, Any?) -> Void) -> Void
        let reply: (BridgeResult) -> Void
        var ended = false
        init(document: UUID, id: Int, action: String,
             run: @escaping (@escaping (BridgeCode, Any?) -> Void) -> Void, reply: @escaping (BridgeResult) -> Void) {
            self.document = document
            self.id = id
            self.action = action
            self.run = run
            self.reply = reply
        }
    }
    var dialogOpen = false
    private let modalOpen: @MainActor () -> Bool
    private let state: () -> (sessionOpen: Bool, pairingBlocked: Bool)
    private var running: Entry?
    private var waiting: [Entry] = []
    private var immediate: [UUID: Entry] = [:]

    init(modalOpen: @escaping @MainActor () -> Bool = { NSApp.modalWindow != nil },
         state: @escaping () -> (sessionOpen: Bool, pairingBlocked: Bool)) {
        self.modalOpen = modalOpen
        self.state = state
    }

    private func busy(_ action: String) -> Bool {
        let state = state()
        return dialogOpen || modalOpen() || (state.sessionOpen && ["refresh", "set-sharing", "pairing-disconnect", "pairing-repair-prepare"].contains(action)) ||
            (state.pairingBlocked && ["pairing-identity-create", "pairing-host-start", "pairing-host-confirm", "pairing-join-claim", "pairing-join-confirm"].contains(action))
    }

    func submit(id: Int, action: String, document: UUID,
                run: @escaping (@escaping (BridgeCode, Any?) -> Void) -> Void,
                reply: @escaping (BridgeResult) -> Void) {
        let entries = waiting + Array(immediate.values) + (running.map { [$0] } ?? [])
        if entries.contains(where: { !$0.ended && $0.document == document && $0.id == id }) {
            reply(BridgeResult(id: id, code: .refused, value: nil))
            return
        }
        let entry = Entry(document: document, id: id, action: action, run: run, reply: reply)
        if action == "status" || action == "pairing-cancel" {
            immediate[entry.ticket] = entry
            start(entry)
            return
        }
        guard !entries.contains(where: { $0.action == action }), !busy(action),
              running == nil || waiting.count < BridgeContract.limits["queue"].number else {
            reply(BridgeResult(id: id, code: .busy, value: nil))
            return
        }
        if running == nil { running = entry; start(entry) } else { waiting.append(entry) }
    }

    private func start(_ entry: Entry) {
        entry.run { [weak self] code, value in self?.finish(ticket: entry.ticket, code: code, value: value) }
    }

    func finish(ticket: UUID, code: BridgeCode, value: Any? = nil) {
        if let entry = immediate.removeValue(forKey: ticket) {
            if !entry.ended { entry.reply(BridgeResult(id: entry.id, code: code, value: value)) }
            return
        }
        guard let entry = running, entry.ticket == ticket else { return }
        running = nil
        if !entry.ended { entry.reply(BridgeResult(id: entry.id, code: code, value: value)) }
        drain()
    }

    private func drain() {
        while running == nil && !waiting.isEmpty {
            let entry = waiting.removeFirst()
            if busy(entry.action) { entry.reply(BridgeResult(id: entry.id, code: .busy, value: nil)); continue }
            running = entry
            start(entry)
        }
    }

    func drop(document: UUID) {
        waiting.removeAll { $0.document == document }
        if running?.document == document { running?.ended = true }
        for entry in immediate.values where entry.document == document { entry.ended = true }
    }
}

@MainActor
protocol BridgeHost: AnyObject {
    var sessionOpen: Bool { get }
    var pairingBlocked: Bool { get }
    func perform(action: String, args: [String: BridgeValue], completion: @escaping (BridgeCode, Any?) -> Void)
    func documentEnded()
}

@MainActor
final class BridgeHandler: NSObject, WKScriptMessageHandler {
    weak var host: BridgeHost?
    private weak var web: DashboardWebView?
    private var document = UUID()
    private lazy var admission = BridgeAdmission { [weak self] in
        (self?.host?.sessionOpen ?? false, self?.host?.pairingBlocked ?? false)
    }
    init(host: BridgeHost? = nil) { self.host = host }
    func beginNativeDialog() { admission.dialogOpen = true }
    func endNativeDialog() { admission.dialogOpen = false }
    func documentReplaced() {
        admission.drop(document: document)
        document = UUID()
        host?.documentEnded()
    }
    func dashboardClosed() {
        web?.documentGeneration += 1
        documentReplaced()
        web = nil
    }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame, origin.protocol == "observatory", origin.host == "app",
              let sender = message.webView as? DashboardWebView, let url = sender.url,
              url.scheme == "observatory", url.host == "app", url.path(percentEncoded: true) == "/dashboard.html", url.query == nil,
              let text = message.body as? NSString else { return }
        web = sender
        let generation = sender.documentGeneration
        let reply: (BridgeResult) -> Void = { [weak sender] result in
            guard let sender, sender.documentGeneration == generation else { return }
            sender.callAsyncJavaScript("window.dispatchEvent(new CustomEvent('observatory:bridge-result', {detail}));",
                                       arguments: ["detail": result.detail], in: nil, in: .page)
        }
        switch BridgeContract.validate(text) {
        case .ignore: return
        case .refused(let id): reply(BridgeResult(id: id, code: .refused, value: nil))
        case .accepted(let id, let action, let args):
            guard host != nil else { reply(BridgeResult(id: id, code: .unavailable, value: nil)); return }
            admission.submit(id: id, action: action, document: document, run: { [weak self] completion in
                guard let host = self?.host else { completion(.unavailable, nil); return }
                host.perform(action: action, args: args, completion: completion)
            }, reply: reply)
        }
    }
}

private enum BridgeSettingsFile {
    static func exists(_ file: URL) -> Bool {
        var info = stat()
        return lstat(file.path, &info) == 0
    }
    static func regular(_ file: URL) -> Bool {
        var info = stat()
        return lstat(file.path, &info) == 0 && (info.st_mode & S_IFMT) == S_IFREG
    }
    static func read(_ file: URL) -> [String: Any]? {
        let descriptor = open(file.path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
        guard descriptor >= 0 else { return nil }
        var closed = false
        defer { if !closed { _ = Darwin.close(descriptor) } }
        var info = stat()
        guard fstat(descriptor, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG,
              info.st_size >= 0, info.st_size <= 1024 else { return nil }
        var bytes = [UInt8](repeating: 0, count: 1025)
        var offset = 0
        while offset < bytes.count {
            let count = bytes.withUnsafeMutableBytes {
                Darwin.read(descriptor, $0.baseAddress!.advanced(by: offset), $0.count - offset)
            }
            if count < 0 && errno == EINTR { continue }
            guard count >= 0 else { return nil }
            if count == 0 { break }
            offset += count
        }
        let result = Darwin.close(descriptor)
        closed = true
        guard result == 0, offset <= 1024 else { return nil }
        return (try? JSONSerialization.jsonObject(with: Data(bytes.prefix(offset)))) as? [String: Any]
    }

    static func write(_ object: [String: Any], to file: URL) throws {
        guard !exists(file) || regular(file) else { throw CocoaError(.fileWriteNoPermission) }
        let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        guard data.count <= 1024 else { throw CocoaError(.fileWriteInvalidFileName) }
        let temporary = file.deletingLastPathComponent().appendingPathComponent(".\(file.lastPathComponent).\(UUID().uuidString).tmp")
        let descriptor = open(temporary.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
        guard descriptor >= 0 else { throw CocoaError(.fileWriteUnknown) }
        var closed = false
        var renamed = false
        defer {
            if !closed { _ = Darwin.close(descriptor) }
            if !renamed { _ = unlink(temporary.path) }
        }
        try data.withUnsafeBytes { bytes in
            var offset = 0
            while offset < bytes.count {
                let count = Darwin.write(descriptor, bytes.baseAddress!.advanced(by: offset), bytes.count - offset)
                if count < 0 && errno == EINTR { continue }
                guard count > 0 else { throw CocoaError(.fileWriteUnknown) }
                offset += count
            }
        }
        guard fsync(descriptor) == 0 else { throw CocoaError(.fileWriteUnknown) }
        let result = Darwin.close(descriptor)
        closed = true
        guard result == 0 else { throw CocoaError(.fileWriteUnknown) }
        guard rename(temporary.path, file.path) == 0 else { throw CocoaError(.fileWriteUnknown) }
        renamed = true
    }
}

enum ViewerSettingsFile {
    static let bundled = BridgeContract.actions["set-skin"]["args"]["skin"]["bundled"].strings
    static func validSkin(_ skin: String, customSkins: [String]) -> Bool {
        bundled.contains(skin) || (customSkins.contains(skin) &&
            BridgeContract.checked(BridgeContract.actions["set-skin"]["args"]["skin"], BridgeNode("string", skin)) == .string(skin) &&
            !bundled.contains { $0.lowercased() == skin.lowercased() })
    }
    static func read(runtime: URL, customSkins: [String] = []) -> (skin: String, appearance: String) {
        guard let object = BridgeSettingsFile.read(runtime.appendingPathComponent("viewer.json")),
              Set(object.keys) == ["skin", "appearance"], let skin = object["skin"] as? String,
              validSkin(skin, customSkins: customSkins), let appearance = object["appearance"] as? String,
              BridgeContract.values["appearance"].strings.contains(appearance) else { return ("sage", "system") }
        return (skin, appearance)
    }
    static func write(runtime: URL, skin: String, appearance: String, customSkins: [String] = []) throws {
        guard validSkin(skin, customSkins: customSkins), BridgeContract.values["appearance"].strings.contains(appearance) else {
            throw CocoaError(.fileWriteInvalidFileName)
        }
        try BridgeSettingsFile.write(["appearance": appearance, "skin": skin], to: runtime.appendingPathComponent("viewer.json"))
    }
    static func migrate(runtime: URL, storedSkin: String?, storedAppearance: String?) -> Bool {
        if BridgeSettingsFile.exists(runtime.appendingPathComponent("viewer.json")) { return true }
        guard storedSkin != nil || storedAppearance != nil else { return true }
        do {
            try write(runtime: runtime, skin: WebViewerPreferences.skin(stored: storedSkin),
                      appearance: WebViewerPreferences.theme(stored: storedAppearance) ?? "system")
            return true
        } catch { return false }
    }
}

enum DeviceNameFile {
    static func valid(_ name: String) -> Bool {
        BridgeContract.checked(BridgeContract.actions["set-device-name"]["args"]["name"], BridgeNode("string", name)) == .string(name)
    }
    static func read(runtime: URL) -> String? {
        guard let object = BridgeSettingsFile.read(runtime.appendingPathComponent("device.json")),
              Set(object.keys) == ["name"], let name = object["name"] as? String, valid(name) else { return nil }
        return name
    }
    static func write(runtime: URL, name: String?) throws {
        let file = runtime.appendingPathComponent("device.json")
        if let name {
            guard valid(name) else { throw CocoaError(.fileWriteInvalidFileName) }
            try BridgeSettingsFile.write(["name": name], to: file)
        } else if BridgeSettingsFile.exists(file) {
            guard BridgeSettingsFile.regular(file) else { throw CocoaError(.fileWriteNoPermission) }
            guard unlink(file.path) == 0 else { throw CocoaError(.fileWriteNoPermission) }
        }
    }
}

@MainActor
func applyViewerPreferences(_ web: WKWebView, skin: String, theme: String?) {
    let skin = WebViewerPreferences.skin(stored: skin)
    let theme = WebViewerPreferences.theme(stored: theme)
    let controller = web.configuration.userContentController
    controller.removeAllUserScripts()
    controller.addUserScript(WKUserScript(source: WebViewerPreferences.documentStartScript(skin: skin, theme: theme),
                                         injectionTime: .atDocumentStart, forMainFrameOnly: true))
    controller.addUserScript(WKUserScript(source: snapshotFetchScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    web.callAsyncJavaScript("document.documentElement.dataset.skin = skin; if (theme) document.documentElement.dataset.theme = theme; else delete document.documentElement.dataset.theme;",
                           arguments: ["skin": skin, "theme": theme as Any? ?? NSNull()], in: nil, in: .page)
}

struct BridgeStatusInput {
    var appVersion: String
    var appBuild: Int
    var sources: [String: Bool]
    var skin: String
    var customSkins: [String]
    var deviceName: String?
    var startup: Bool
    var appearance: String
    var limitsConsent: Bool
    var collectionPaused: Bool
    var pairingState: String
    var peerFingerprint: String?
    var transport: String
    var invitationKept: Bool
    var sharing: [String: QuotaSharingStatus]

    static func pairingState(controlStatus: String) -> String {
        if controlStatus == "hosting" { return "waiting" }
        return BridgeContract.values["pairingState"].strings.contains(controlStatus) ? controlStatus : "unavailable"
    }
    static func bridgeStatusValue(_ input: BridgeStatusInput) -> [String: Any]? {
        func hex(_ value: String) -> Bool {
            BridgeContract.checked(BridgeContract.actions["set-sharing"]["args"]["token"], BridgeNode("string", value)) == .string(value)
        }
        guard input.appVersion.unicodeScalars.count <= BridgeContract.status["appVersionMaxLength"].number,
              !input.appVersion.isEmpty, input.appVersion.utf8.allSatisfy({ (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || [32, 46, 43, 45].contains($0) }),
              let first = input.appVersion.utf8.first, (48...57).contains(first) || (65...90).contains(first) || (97...122).contains(first),
              input.appBuild >= 0, Set(input.sources.keys) == ["activity", "codex", "claude", "wispr", "quota"],
              input.customSkins.count <= BridgeContract.status["customSkinsMax"].number,
              input.customSkins.allSatisfy({ name in ViewerSettingsFile.validSkin(name, customSkins: input.customSkins) && !ViewerSettingsFile.bundled.contains { $0.lowercased() == name.lowercased() } }) else { return nil }
        guard ViewerSettingsFile.validSkin(input.skin, customSkins: input.customSkins),
              input.deviceName.map(DeviceNameFile.valid) ?? true,
              BridgeContract.values["appearance"].strings.contains(input.appearance),
              BridgeContract.values["pairingState"].strings.contains(input.pairingState),
              BridgeContract.values["transport"].strings.contains(input.transport),
              input.peerFingerprint.map({ input.pairingState == "confirming" && hex($0) }) ?? true,
              Set(input.sharing.keys) == ["codex-limits", "claude-code-tokens"] else { return nil }
        var sharing: [String: Any] = [:]
        for (channel, status) in input.sharing {
            guard status.version == 1, BridgeContract.values["sharingReason"].strings.contains(status.reason),
                  status.reason != (channel == "codex-limits" ? "source-unavailable" : "account-unavailable"),
                  status.canEnable ? status.reason == "ready" && status.token.map(hex) == true : status.token == nil else { return nil }
            sharing[channel] = ["enabled": status.enabled, "canEnable": status.canEnable, "reason": status.reason,
                                "token": status.token as Any? ?? NSNull()]
        }
        let result: [String: Any] = ["version": 1, "app": ["version": input.appVersion, "build": input.appBuild],
            "sources": input.sources, "skin": ["current": input.skin, "bundled": ViewerSettingsFile.bundled, "custom": input.customSkins],
            "deviceName": input.deviceName as Any? ?? NSNull(), "startup": input.startup, "appearance": input.appearance,
            "limitsConsent": input.limitsConsent, "collectionPaused": input.collectionPaused, "pairing": ["state": input.pairingState,
                "peerFingerprint": input.peerFingerprint as Any? ?? NSNull(), "transport": input.transport, "invitationKept": input.invitationKept],
            "sharing": sharing]
        guard let data = try? JSONSerialization.data(withJSONObject: result), data.count <= BridgeContract.status["maxBytes"].number else { return nil }
        return result
    }
}

func bridgeSyntheticStatusShapes() -> [[String: Any]] {
    let unavailable = QuotaSharingStatus(version: 1, enabled: false, canEnable: false, reason: "pairing-unavailable", token: nil)
    return ["confirming", "awaiting-confirmation", "local-ready", "acknowledged"].map { state in
        BridgeStatusInput.bridgeStatusValue(BridgeStatusInput(appVersion: "1.0-test", appBuild: 1,
            sources: ["activity": true, "codex": true, "claude": false, "wispr": false, "quota": false],
            skin: "sage", customSkins: [], deviceName: "Synthetic Mac", startup: false, appearance: "system",
            limitsConsent: false, collectionPaused: true, pairingState: state,
            peerFingerprint: state == "confirming" ? String(repeating: "a", count: 64) : nil,
            transport: "none", invitationKept: state == "confirming",
            sharing: ["codex-limits": unavailable, "claude-code-tokens": unavailable]))!
    }
}

func runBridgeSelfTests() {
    let expectedShapes = #"""
    [{"app":{"build":1,"version":"1.0-test"},"appearance":"system","collectionPaused":true,"deviceName":"Synthetic Mac","limitsConsent":false,"pairing":{"invitationKept":true,"peerFingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","state":"confirming","transport":"none"},"sharing":{"claude-code-tokens":{"canEnable":false,"enabled":false,"reason":"pairing-unavailable","token":null},"codex-limits":{"canEnable":false,"enabled":false,"reason":"pairing-unavailable","token":null}},"skin":{"bundled":["sage","almanac","instrument","amber-crt"],"current":"sage","custom":[]},"sources":{"activity":true,"claude":false,"codex":true,"quota":false,"wispr":false},"startup":false,"version":1},{"app":{"build":1,"version":"1.0-test"},"appearance":"system","collectionPaused":true,"deviceName":"Synthetic Mac","limitsConsent":false,"pairing":{"invitationKept":false,"peerFingerprint":null,"state":"awaiting-confirmation","transport":"none"},"sharing":{"claude-code-tokens":{"canEnable":false,"enabled":false,"reason":"pairing-unavailable","token":null},"codex-limits":{"canEnable":false,"enabled":false,"reason":"pairing-unavailable","token":null}},"skin":{"bundled":["sage","almanac","instrument","amber-crt"],"current":"sage","custom":[]},"sources":{"activity":true,"claude":false,"codex":true,"quota":false,"wispr":false},"startup":false,"version":1},{"app":{"build":1,"version":"1.0-test"},"appearance":"system","collectionPaused":true,"deviceName":"Synthetic Mac","limitsConsent":false,"pairing":{"invitationKept":false,"peerFingerprint":null,"state":"local-ready","transport":"none"},"sharing":{"claude-code-tokens":{"canEnable":false,"enabled":false,"reason":"pairing-unavailable","token":null},"codex-limits":{"canEnable":false,"enabled":false,"reason":"pairing-unavailable","token":null}},"skin":{"bundled":["sage","almanac","instrument","amber-crt"],"current":"sage","custom":[]},"sources":{"activity":true,"claude":false,"codex":true,"quota":false,"wispr":false},"startup":false,"version":1},{"app":{"build":1,"version":"1.0-test"},"appearance":"system","collectionPaused":true,"deviceName":"Synthetic Mac","limitsConsent":false,"pairing":{"invitationKept":false,"peerFingerprint":null,"state":"acknowledged","transport":"none"},"sharing":{"claude-code-tokens":{"canEnable":false,"enabled":false,"reason":"pairing-unavailable","token":null},"codex-limits":{"canEnable":false,"enabled":false,"reason":"pairing-unavailable","token":null}},"skin":{"bundled":["sage","almanac","instrument","amber-crt"],"current":"sage","custom":[]},"sources":{"activity":true,"claude":false,"codex":true,"quota":false,"wispr":false},"startup":false,"version":1}]
    """#
    let expected = try! JSONSerialization.jsonObject(with: Data(expectedShapes.utf8)) as! [[String: Any]]
    for (value, fixture) in zip(bridgeSyntheticStatusShapes(), expected) {
        precondition(try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) ==
            JSONSerialization.data(withJSONObject: fixture, options: [.sortedKeys]))
    }
    let planted = ["NODE_OPTIONS", "PYTHONPATH", "PYTHONHOME", "DYLD_INSERT_LIBRARIES", "UV_THREADPOOL_SIZE",
                   "OPENSSL_CONF", "SSL_CERT_FILE", "CLAUDE_CONFIG_DIR", "CODEX_HOME"]
    let originalEnvironment = ProcessInfo.processInfo.environment
    for key in planted { setenv(key, "synthetic-value", 1) }
    let childEnvironment = collectorChildEnvironment()
    for key in planted.prefix(7) { precondition(childEnvironment[key] == nil) }
    for key in planted.suffix(2) { precondition(childEnvironment[key] == "synthetic-value") }
    for key in planted {
        if let value = originalEnvironment[key] { setenv(key, value, 1) } else { unsetenv(key) }
    }
    MainActor.assumeIsolated {
        let document = UUID()
        var session = false
        var blocked = false
        var modal = false
        let admission = BridgeAdmission(modalOpen: { modal }) { (session, blocked) }
        var started: [Int] = []
        var results: [Int: BridgeResult] = [:]
        var completions: [Int: (BridgeCode, Any?) -> Void] = [:]
        @MainActor func submit(_ id: Int, _ action: String, document: UUID = document) {
            admission.submit(id: id, action: action, document: document, run: { completion in
                started.append(id)
                completions[id] = completion
            }, reply: { results[id] = $0 })
        }
        modal = true
        submit(80, "set-skin")
        submit(81, "status")
        submit(82, "pairing-cancel")
        precondition(results[80]?.code == .busy && started == [81, 82])
        completions[81]?(.done, nil)
        completions[82]?(.done, nil)
        modal = false
        started.removeAll()
        submit(1, "refresh")
        submit(2, "refresh")
        precondition(results[2]?.code == .busy)
        submit(1, "set-skin")
        precondition(results[1]?.code == .refused)
        submit(1, "status")
        precondition(results[1]?.code == .refused)
        admission.dialogOpen = true
        submit(3, "status")
        submit(4, "pairing-cancel")
        precondition(started == [1, 3, 4])
        submit(5, "set-skin")
        submit(6, "export-data")
        precondition(results[5]?.code == .busy && results[6]?.code == .busy)
        completions[3]?(.done, nil)
        completions[4]?(.done, nil)
        admission.dialogOpen = false
        for (offset, action) in ["set-skin", "export-data", "set-source", "set-startup", "check-updates"].enumerated() {
            submit(10 + offset, action)
        }
        precondition(started == [1, 3, 4] && results[14]?.code == .busy)
        submit(15, "set-skin")
        submit(10, "status")
        precondition(results[15]?.code == .busy && results[10]?.code == .refused)
        completions[1]?(.done, nil)
        for id in 10...13 {
            precondition(started.last == id)
            completions[id]?(.done, nil)
        }
        session = true
        for (offset, action) in ["refresh", "set-sharing", "pairing-disconnect", "pairing-repair-prepare"].enumerated() {
            submit(20 + offset, action)
            precondition(results[20 + offset]?.code == .busy)
        }
        submit(24, "set-skin")
        precondition(started.last == 24)
        completions[24]?(.done, nil)
        session = false
        blocked = true
        for (offset, action) in ["pairing-identity-create", "pairing-host-start", "pairing-host-confirm", "pairing-join-claim", "pairing-join-confirm"].enumerated() {
            submit(30 + offset, action)
            precondition(results[30 + offset]?.code == .busy)
        }
        submit(35, "pairing-cancel")
        submit(36, "pairing-copy-invitation")
        precondition(started.suffix(2) == [35, 36])
        completions[35]?(.done, nil)
        completions[36]?(.done, nil)
        blocked = false
        submit(40, "set-skin")
        submit(41, "refresh")
        submit(42, "set-startup")
        session = true
        completions[40]?(.done, nil)
        precondition(results[41]?.code == .busy && started.last == 42)
        completions[42]?(.done, nil)
        session = false
        submit(50, "set-skin")
        submit(51, "refresh")
        submit(52, "status")
        admission.drop(document: document)
        completions[50]?(.done, "synthetic")
        completions[52]?(.done, "synthetic")
        precondition(results[50] == nil && results[51] == nil && results[52] == nil && !started.contains(51))
        submit(50, "refresh", document: UUID())
        precondition(started.last == 50)
        completions[50]?(.done, nil)
        completions[50]?(.done, nil)
    }
    for code in [BridgeCode.done, .refused, .busy, .cancelled, .unavailable] {
        let detail = BridgeResult(id: 1, code: code, value: nil).detail
        precondition(Set(detail.keys) == ["id", "ok", "code"])
        precondition(detail["ok"] as? Bool == (code == .done))
        precondition(detail["id"] as? Int == 1 && detail["code"] as? String == code.rawValue)
        let withValue = BridgeResult(id: 1, code: code, value: NSNull()).detail
        precondition(Set(withValue.keys) == ["id", "ok", "code", "value"] && withValue["value"] is NSNull)
    }
    let files = FileManager.default
    let root = files.temporaryDirectory.appendingPathComponent("observatory-bridge-" + UUID().uuidString)
    try! files.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? files.removeItem(at: root) }
    func folder() -> URL {
        let path = root.appendingPathComponent(UUID().uuidString)
        try! files.createDirectory(at: path, withIntermediateDirectories: true)
        return path
    }
    func put(_ object: [String: Any], _ file: URL) {
        try! JSONSerialization.data(withJSONObject: object).write(to: file)
    }
    func refuses(_ operation: () throws -> Void) {
        do { try operation(); preconditionFailure("Unsafe settings write accepted") } catch {}
    }
    let viewer = folder()
    let viewerFile = viewer.appendingPathComponent("viewer.json")
    precondition(ViewerSettingsFile.read(runtime: viewer) == ("sage", "system"))
    try! ViewerSettingsFile.write(runtime: viewer, skin: "almanac", appearance: "dark")
    precondition(ViewerSettingsFile.read(runtime: viewer) == ("almanac", "dark"))
    precondition((try! files.attributesOfItem(atPath: viewerFile.path))[.posixPermissions] as? Int == 0o600)
    put(["skin": "almanac", "appearance": "dark", "extra": true], viewerFile)
    precondition(ViewerSettingsFile.read(runtime: viewer) == ("sage", "system"))
    try! Data(repeating: 32, count: 2000).write(to: viewerFile)
    precondition(BridgeSettingsFile.read(viewerFile) == nil)
    precondition(ViewerSettingsFile.read(runtime: viewer) == ("sage", "system"))
    for skin in ["Almanac", "../sage"] {
        put(["skin": skin, "appearance": "dark"], viewerFile)
        precondition(ViewerSettingsFile.read(runtime: viewer).skin == "sage")
    }
    let fifo = root.appendingPathComponent("fifo.json")
    precondition(mkfifo(fifo.path, 0o600) == 0)
    precondition(BridgeSettingsFile.read(fifo) == nil)
    let linked = folder()
    let target = root.appendingPathComponent("target.json")
    put(["skin": "almanac", "appearance": "dark"], target)
    let targetData = try! Data(contentsOf: target)
    try! files.createSymbolicLink(at: linked.appendingPathComponent("viewer.json"), withDestinationURL: target)
    precondition(ViewerSettingsFile.read(runtime: linked) == ("sage", "system"))
    refuses { try ViewerSettingsFile.write(runtime: linked, skin: "sage", appearance: "system") }
    precondition(try! Data(contentsOf: target) == targetData)
    let absent = folder()
    precondition(ViewerSettingsFile.migrate(runtime: absent, storedSkin: nil, storedAppearance: nil))
    precondition(!files.fileExists(atPath: absent.appendingPathComponent("viewer.json").path))
    precondition(ViewerSettingsFile.migrate(runtime: absent, storedSkin: "amber-crt", storedAppearance: "dark"))
    precondition(ViewerSettingsFile.read(runtime: absent) == ("amber-crt", "dark"))
    precondition(ViewerSettingsFile.migrate(runtime: absent, storedSkin: "sage", storedAppearance: "light"))
    precondition(ViewerSettingsFile.read(runtime: absent) == ("amber-crt", "dark"))
    let invalid = folder()
    precondition(ViewerSettingsFile.migrate(runtime: invalid, storedSkin: "x", storedAppearance: "auto"))
    precondition(ViewerSettingsFile.read(runtime: invalid) == ("sage", "system"))
    let suiteName = "observatory-synthetic-migration-" + UUID().uuidString
    let defaults = UserDefaults(suiteName: suiteName)!
    defer { defaults.removePersistentDomain(forName: suiteName) }
    let migration = folder()
    defaults.set("almanac", forKey: "observatorySkin")
    defaults.set("dark", forKey: "observatoryAppearance")
    defaults.set(true, forKey: "observatoryViewerSettingsMigrated")
    WebViewerPreferences.migrateIfNeeded(runtime: migration, defaults: defaults)
    precondition(!files.fileExists(atPath: migration.appendingPathComponent("viewer.json").path))
    precondition(defaults.string(forKey: "observatorySkin") == "almanac")
    precondition(defaults.string(forKey: "observatoryAppearance") == "dark")
    defaults.set(false, forKey: "observatoryViewerSettingsMigrated")
    WebViewerPreferences.migrateIfNeeded(runtime: migration, defaults: defaults)
    precondition(ViewerSettingsFile.read(runtime: migration) == ("almanac", "dark"))
    precondition(defaults.object(forKey: "observatorySkin") == nil)
    precondition(defaults.string(forKey: "observatoryAppearance") == "dark")
    precondition(defaults.bool(forKey: "observatoryViewerSettingsMigrated"))
    let device = folder()
    let deviceFile = device.appendingPathComponent("device.json")
    try! DeviceNameFile.write(runtime: device, name: "Studio")
    precondition(DeviceNameFile.read(runtime: device) == "Studio")
    precondition((try! files.attributesOfItem(atPath: deviceFile.path))[.posixPermissions] as? Int == 0o600)
    try! DeviceNameFile.write(runtime: device, name: nil)
    precondition(!files.fileExists(atPath: deviceFile.path))
    for name in ["Studio/Desk", String(repeating: "😀", count: 17), " Studio"] {
        put(["name": name], deviceFile)
        precondition(DeviceNameFile.read(runtime: device) == nil)
        refuses { try DeviceNameFile.write(runtime: device, name: name) }
    }
    try! files.createSymbolicLink(at: linked.appendingPathComponent("device.json"), withDestinationURL: deviceFile)
    precondition(DeviceNameFile.read(runtime: linked) == nil)
    refuses { try DeviceNameFile.write(runtime: linked, name: "Studio") }
    refuses { try DeviceNameFile.write(runtime: linked, name: nil) }
    let directory = folder()
    for name in ["device.json", "viewer.json"] {
        try! files.createDirectory(at: directory.appendingPathComponent(name), withIntermediateDirectories: true)
    }
    refuses { try DeviceNameFile.write(runtime: directory, name: nil) }
    refuses { try ViewerSettingsFile.write(runtime: directory, skin: "sage", appearance: "system") }
    let dangling = folder()
    for name in ["device.json", "viewer.json"] {
        try! files.createSymbolicLink(at: dangling.appendingPathComponent(name), withDestinationURL: root.appendingPathComponent("missing"))
    }
    refuses { try DeviceNameFile.write(runtime: dangling, name: "Studio") }
    refuses { try ViewerSettingsFile.write(runtime: dangling, skin: "sage", appearance: "system") }

    let unavailable = QuotaSharingStatus(version: 1, enabled: false, canEnable: false, reason: "pairing-unavailable", token: nil)
    let input = BridgeStatusInput(appVersion: "1.0-test", appBuild: 1,
        sources: ["activity": true, "codex": true, "claude": false, "wispr": false, "quota": false],
        skin: "sage", customSkins: [], deviceName: nil, startup: false, appearance: "system", limitsConsent: false, collectionPaused: false,
        pairingState: "idle", peerFingerprint: nil, transport: "none", invitationKept: false,
        sharing: ["codex-limits": unavailable, "claude-code-tokens": unavailable])
    let status = BridgeStatusInput.bridgeStatusValue(input)!
    precondition(Set(status.keys) == Set(BridgeContract.status["fields"].strings) && status.count == BridgeContract.status["fields"].items.count)
    precondition(status["collectionPaused"] as? Bool == false)
    precondition(status["deviceName"] is NSNull)
    func keys(_ object: Any?, _ expected: Set<String>) { precondition(Set((object as! [String: Any]).keys) == expected) }
    keys(status["app"], ["version", "build"])
    keys(status["sources"], ["activity", "codex", "claude", "wispr", "quota"])
    keys(status["skin"], ["current", "bundled", "custom"])
    keys(status["pairing"], ["state", "peerFingerprint", "transport", "invitationKept"])
    keys(status["sharing"], ["codex-limits", "claude-code-tokens"])
    for value in (status["sharing"] as! [String: Any]).values { keys(value, ["enabled", "canEnable", "reason", "token"]) }
    func invalidStatus(_ change: (inout BridgeStatusInput) -> Void) {
        var changed = input
        change(&changed)
        precondition(BridgeStatusInput.bridgeStatusValue(changed) == nil)
    }
    invalidStatus { $0.pairingState = "waiting"; $0.peerFingerprint = String(repeating: "a", count: 64) }
    invalidStatus { $0.appearance = "auto" }
    invalidStatus { $0.customSkins = (0..<33).map { "Custom \($0)" } }
    invalidStatus { $0.sharing["codex-limits"] = QuotaSharingStatus(version: 1, enabled: false, canEnable: false, reason: "source-unavailable", token: nil) }
    invalidStatus { $0.sharing["claude-code-tokens"] = QuotaSharingStatus(version: 1, enabled: false, canEnable: false, reason: "account-unavailable", token: nil) }
    invalidStatus { $0.appVersion = "a\n" }
    invalidStatus { $0.appVersion = String(repeating: "a", count: 33) }
    invalidStatus { $0.appBuild = -1 }
    invalidStatus { $0.sources.removeValue(forKey: "quota") }
    invalidStatus { $0.transport = "http" }
    invalidStatus { $0.pairingState = "paired-ish" }
    invalidStatus { $0.pairingState = "confirming"; $0.peerFingerprint = String(repeating: "A", count: 64) }
    invalidStatus { $0.customSkins = ["../sage"] }
    invalidStatus { $0.customSkins = ["Sage"] }
    invalidStatus { $0.skin = "missing" }
    invalidStatus { $0.deviceName = " Studio" }
    invalidStatus { $0.sharing["codex-limits"] = QuotaSharingStatus(version: 1, enabled: false, canEnable: true, reason: "ready", token: nil) }
    var custom = input
    custom.customSkins = ["Custom"]
    custom.skin = "Custom"
    custom.pairingState = "confirming"
    custom.peerFingerprint = String(repeating: "a", count: 64)
    precondition(BridgeStatusInput.bridgeStatusValue(custom) != nil)
    precondition(BridgeStatusInput.pairingState(controlStatus: "hosting") == "waiting")
    precondition(BridgeStatusInput.pairingState(controlStatus: "confirming") == "confirming")
    precondition(BridgeStatusInput.pairingState(controlStatus: "paired-ish") == "unavailable")
    for text in ["{\"id\":1,\"id\":2,\"action\":\"status\",\"args\":{}}", String(repeating: " ", count: 4097), "not JSON"] {
        guard case .ignore = BridgeContract.validate(text as NSString) else { preconditionFailure("Invalid message was not ignored") }
    }
    for action in ["unknown"] {
        let text = "{\"id\":3,\"action\":\"\(action)\",\"args\":{}}" as NSString
        guard case .refused(let id) = BridgeContract.validate(text), id == 3 else { preconditionFailure("Reserved action accepted") }
    }
    print("Bridge self-tests passed")
}
