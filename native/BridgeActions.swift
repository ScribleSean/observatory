import AppKit
import CoreFoundation
import Darwin
import ServiceManagement
import UniformTypeIdentifiers

func bridgeChildEnvironment() -> [String: String] {
    // Use an allowlist so loader, Node, OpenSSL and libuv variables never reach a child.
    let inherited = ProcessInfo.processInfo.environment
    var environment = ["PATH": "/usr/bin:/bin:/usr/sbin:/sbin"]
    for key in ["HOME", "USER", "LOGNAME", "LANG", "TMPDIR"] { environment[key] = inherited[key] }
    return environment
}

func collectorChildEnvironment() -> [String: String] {
    ProcessInfo.processInfo.environment.filter { key, _ in
        !["NODE_", "PYTHON", "DYLD_", "UV_"].contains(where: key.hasPrefix) &&
            !["OPENSSL_CONF", "OPENSSL_MODULES", "SSL_CERT_FILE", "SSL_CERT_DIR", "LD_PRELOAD"].contains(key)
    }
}

func bridgePairingFiles(runtime: URL) -> (state: String, transport: String) {
    func exists(_ file: URL) throws -> Bool {
        var info = stat()
        if lstat(file.path, &info) == 0 { return true }
        if errno == ENOENT { return false }
        throw CocoaError(.fileReadNoPermission)
    }
    do {
        let folder = runtime.appendingPathComponent("private-sync")
        guard try exists(folder) else { return ("unpaired", "none") }
        if try exists(folder.appendingPathComponent("revoked")) { return ("unpaired", "none") }
        if try exists(folder.appendingPathComponent("tls-trust.json")) { return ("paired", "tls") }
        if try exists(folder.appendingPathComponent("pairing.json")) { return ("paired", "ssh") }
        return ("unpaired", "none")
    } catch { return ("unavailable", "none") }
}

struct BridgeSharingChoice: Decodable {
    let version: Int
    let chosen: Bool
    let channels: [String: String]
    static let unavailable = BridgeSharingChoice(version: 1, chosen: false,
        channels: ["codex-limits": "unavailable", "claude-code-tokens": "unavailable"])
    var valid: Bool {
        version == 1 && Set(channels.keys) == ["codex-limits", "claude-code-tokens"] &&
            channels.values.allSatisfy { BridgeContract.values["sharingChoiceState"].strings.contains($0) }
    }
    var value: [String: Any] { ["chosen": chosen, "channels": channels] }
    static func parse(_ data: Data) throws -> BridgeSharingChoice {
        guard data.count <= 4096, let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(object.keys) == ["version", "chosen", "channels"] else { throw CocoaError(.fileReadCorruptFile) }
        let value = try JSONDecoder().decode(Self.self, from: data)
        guard value.valid else { throw CocoaError(.fileReadCorruptFile) }
        return value
    }
}

func bridgePairingStatus(runtime: URL, now: Date = Date()) -> String {
    let file = runtime.appendingPathComponent("pairing-status.json")
    func valid(_ info: stat) -> Bool {
        (info.st_mode & S_IFMT) == S_IFREG && info.st_size >= 0 && info.st_size <= 1024 &&
            info.st_nlink == 1 && info.st_mode & 0o077 == 0 && info.st_uid == getuid()
    }
    func same(_ a: stat, _ b: stat) -> Bool {
        a.st_dev == b.st_dev && a.st_ino == b.st_ino && a.st_size == b.st_size &&
            a.st_mtimespec.tv_sec == b.st_mtimespec.tv_sec && a.st_mtimespec.tv_nsec == b.st_mtimespec.tv_nsec &&
            a.st_ctimespec.tv_sec == b.st_ctimespec.tv_sec && a.st_ctimespec.tv_nsec == b.st_ctimespec.tv_nsec &&
            a.st_mode == b.st_mode && a.st_nlink == b.st_nlink && a.st_uid == b.st_uid
    }
    var before = stat(), opened = stat(), after = stat(), named = stat()
    guard lstat(file.path, &before) == 0, valid(before) else { return "unavailable" }
    let descriptor = open(file.path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
    guard descriptor >= 0 else { return "unavailable" }
    defer { _ = Darwin.close(descriptor) }
    guard fstat(descriptor, &opened) == 0, valid(opened), same(before, opened) else { return "unavailable" }
    var bytes = [UInt8](repeating: 0, count: 1025)
    var count: Int
    repeat { count = bytes.withUnsafeMutableBytes { Darwin.read(descriptor, $0.baseAddress!, $0.count) } }
    while count < 0 && errno == EINTR
    guard count == before.st_size, count <= 1024,
          fstat(descriptor, &after) == 0, valid(after), same(before, after),
          lstat(file.path, &named) == 0, valid(named), same(before, named),
          let text = String(bytes: bytes.prefix(count), encoding: .utf8),
          let object = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
          Set(object.keys) == ["version", "state", "checkedAt"],
          let version = object["version"] as? NSNumber, CFGetTypeID(version) != CFBooleanGetTypeID(), version == 1,
          let state = object["state"] as? String,
          ["unpaired", "revoked", "establishing-trust", "active-sync", "sync-stale", "unavailable"].contains(state),
          let checkedAt = object["checkedAt"] as? String else { return "unavailable" }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    var date = formatter.date(from: checkedAt)
    if date == nil { formatter.formatOptions = [.withInternetDateTime]; date = formatter.date(from: checkedAt) }
    guard let date, now.timeIntervalSince(date) <= 120, now.timeIntervalSince(date) >= -60 else { return "unavailable" }
    return state
}

func bridgeStoredPairingState(runtime: URL, fallback: String) -> String {
    bridgeReportedPairingState(sessionState: nil, maintenance: false, identityState: nil, paused: false,
        fileState: bridgePairingStatus(runtime: runtime), fallback: fallback)
}

func bridgeReportedPairingState(sessionState: String?, maintenance: Bool, identityState: String?, paused: Bool, fileState: String, fallback: String) -> String {
    if let sessionState { return sessionState }
    if maintenance { return fallback }
    if let identityState { return identityState }
    if paused { return fallback }
    return fileState == "unavailable" ? fallback : fileState
}

@MainActor
func bridgeSessionPairingState(session: BridgePairingSession?, maintenance: Bool, identityState: String?, paused: Bool, fileState: String, fallback: String) -> String {
    let visible = session?.defaultsOnly == true ? nil : session
    return bridgeReportedPairingState(sessionState: visible?.state,
        maintenance: maintenance && session?.defaultsOnly != true, identityState: identityState, paused: paused,
        fileState: fileState, fallback: fallback)
}

@MainActor
func bridgeStatusPairing(session: BridgePairingSession?, maintenance: Bool, paused: Bool, identityState: String?, fileState: String,
                         fallback: (state: String, transport: String)) -> (state: String, transport: String) {
    let state = bridgeSessionPairingState(session: session, maintenance: maintenance, identityState: identityState,
        paused: paused, fileState: fileState, fallback: fallback.state)
    return (state, state == identityState ? "none" : fallback.transport)
}

@MainActor
func bridgePairingStartBusy(action: String, session: BridgePairingSession?) -> Bool {
    session != nil && (action == "pairing-host-defaults" || session?.defaultsOnly == true)
}

struct BridgePairingIdentity {
    private(set) var state: String?
    mutating func sessionBegan(action: String) {
        if action != "pairing-host-defaults" { state = nil }
    }
    mutating func finished(action: String, code: BridgeCode, missingIdentity: String?) {
        if ["pairing-host-start", "pairing-join-claim"].contains(action), let missingIdentity { state = missingIdentity }
        if action == "pairing-identity-create", code == .done { state = nil }
    }
}

@MainActor
final class BridgePairingSession {
    private let bridge: DirectPairingBridge
    private let ended: (Bool) -> Void
    private var timer: Timer?
    private var expiry: Timer?
    private var pending: [UUID: (TLSSetupReply?) -> Void] = [:]
    private(set) var missingIdentity: String?
    private(set) var closed = false
    private(set) var defaultsOnly = false
    private(set) var state = "working"
    private(set) var invitation: String?
    private(set) var address: String?
    private(set) var port: Int?
    private(set) var fingerprint: String?
    private(set) var peerAddress: String?
    private var peerClaim: String?
    private var sharingApproved = false
    private let confirmSharing: () -> BridgeCode

    init(factory: () throws -> DirectPairingBridge, pollInterval: TimeInterval = 2,
         limit: TimeInterval = 600, confirmSharing: @escaping () -> BridgeCode = { .cancelled }, ended: @escaping (Bool) -> Void) throws {
        bridge = try factory()
        self.ended = ended
        self.confirmSharing = confirmSharing
        timer = Timer(timeInterval: pollInterval, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.poll() }
        }
        expiry = Timer(timeInterval: limit, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.end() }
        }
        for timer in [timer, expiry].compactMap({ $0 }) {
            RunLoop.main.add(timer, forMode: .common)
            RunLoop.main.add(timer, forMode: .modalPanel)
        }
    }

    func end() {
        guard !closed else { return }
        closed = true
        timer?.invalidate(); expiry?.invalidate()
        timer = nil; expiry = nil
        invitation = nil; address = nil; port = nil; fingerprint = nil
        peerAddress = nil; peerClaim = nil; sharingApproved = false
        let callbacks = Array(pending.values)
        pending.removeAll()
        if let process = bridge as? TLSSetupProcess {
            process.closeAndWait { [ended] stopped in ended(stopped) }
        } else { bridge.close(); ended(true) }
        for callback in callbacks { callback(nil) }
    }

    private func send(_ command: [String: Any], identity: Bool = false, completion: @escaping (TLSSetupReply?) -> Void) {
        guard !closed else { completion(nil); return }
        let ticket = UUID()
        pending[ticket] = completion
        let receive: TLSSetupProcess.Completion = { [weak self] result in
            MainActor.assumeIsolated {
                guard let self, !self.closed, let callback = self.pending.removeValue(forKey: ticket) else { return }
                guard case .success(let reply) = result else { self.end(); callback(nil); return }
                if command["action"] as? String != "pending-peer", command["action"] as? String != "host-defaults",
                   command["action"] as? String != "identity-status" {
                    self.state = BridgeStatusInput.pairingState(controlStatus: reply.status)
                    self.fingerprint = reply.status == "confirming" ? reply.peerCertificateSha256 : nil
                    if let fingerprint = self.fingerprint, fingerprint != self.peerClaim {
                        self.peerAddress = nil
                    }
                }
                callback(reply)
            }
        }
        if identity { bridge.prepareIdentity(storageConsent: true, completion: receive) }
        else { bridge.send(command, completion: receive) }
    }

    func poll() {
        guard !closed, pending.isEmpty else { return }
        send(["action": "status"]) { [weak self] reply in
            guard let self else { return }
            if reply == nil || ["acknowledged", "unavailable", "inactive", "cancelled"].contains(reply!.status) { self.end(); return }
            if reply?.status == "confirming", let claim = self.fingerprint, self.peerClaim != claim {
                self.peerClaim = claim
                self.peerAddress = nil
                self.send(["action": "pending-peer"]) { [weak self] reply in
                    guard let self, !self.closed, self.peerClaim == claim else { return }
                    self.peerAddress = reply?.peerAddress.flatMap { BridgeContract.address($0) ? $0 : nil }
                }
            }
        }
    }

    func copyInvitation(write: (String) -> Bool) -> BridgeCode {
        guard !closed, let invitation else { return .unavailable }
        return write(invitation) ? .done : .unavailable
    }

    func perform(action: String, args: [String: BridgeValue], identityOnly: Bool = false,
                 completion: @escaping (BridgeCode, Any?) -> Void) {
        func string(_ key: String) -> String { if case .string(let value) = args[key] { return value }; return "" }
        func integer(_ key: String) -> Int { if case .integer(let value) = args[key] { return value }; return 0 }
        if action == "pairing-peer-address" {
            completion(.done, ["peerAddress": peerAddress as Any? ?? NSNull()]); return
        }
        guard !closed else { completion(.unavailable, nil); return }
        let sharing = args["sharing"] == .bool(true)
        if ["pairing-host-confirm", "pairing-join-confirm"].contains(action), sharing, !sharingApproved {
            let code = confirmSharing()
            guard code == .done else { completion(code, nil); return }
            guard !closed else { completion(.unavailable, nil); return }
            sharingApproved = true
        }
        var command: [String: Any]
        switch action {
        case "pairing-host-defaults": command = ["action": "host-defaults"]
        case "pairing-identity-create": command = [:]
        case "pairing-host-start": command = ["action": "host-start", "address": string("address"), "port": 0]
        case "pairing-host-confirm":
            guard let address, let port else { completion(.unavailable, nil); return }
            command = ["action": "host-confirm", "peerCertificateSha256": string("fingerprint"),
                       "localEndpoint": ["kind": "tls", "address": address, "port": port],
                       "peerEndpoint": ["kind": "tls", "address": string("peerAddress"), "port": integer("peerPort")], "sharing": sharing]
        case "pairing-join-claim": command = ["action": "join-claim", "invitation": string("invitation")]
        case "pairing-join-confirm": command = ["action": "join-confirm", "sharing": sharing]
        case "pairing-cancel": command = ["action": "cancel"]
        default: completion(.refused, nil); return
        }
        let keptAddress = string("address"), keptPort = integer("port")
        if action == "pairing-host-defaults", identityOnly { defaultsOnly = true }
        let receive: (TLSSetupReply?) -> Void = { [weak self] reply in
            guard let self else { completion(.unavailable, nil); return }
            if action == "pairing-cancel" { self.end(); completion(.done, nil); return }
            guard let reply else { completion(.unavailable, nil); return }
            var code: BridgeCode = .unavailable
            var value: Any?
            switch action {
            case "pairing-host-defaults":
                if reply.status == "ready", reply.port == 43128,
                   reply.address.map(BridgeContract.address) ?? true,
                   (reply.address == nil) == (reply.portAvailable == nil) {
                    code = .done
                    value = ["address": reply.address as Any? ?? NSNull(), "port": 43128,
                             "portAvailable": reply.portAvailable as Any? ?? NSNull()]
                }
                if identityOnly { self.end() }
            case "pairing-identity-create":
                if reply.status == "identity-ready" { code = .done }
                if identityOnly || code != .done { self.end() }
            case "pairing-host-start":
                if reply.status == "hosting", let invitation = reply.invitation {
                    self.invitation = invitation; self.address = keptAddress; self.port = keptPort
                    code = .done; value = ["invitation": invitation]
                } else { self.end() }
            case "pairing-host-confirm":
                if ["configuration-ready", "acknowledged"].contains(reply.status) { code = .done }
                if code != .done || reply.status == "acknowledged" { self.end() }
            case "pairing-join-claim":
                if reply.status == "awaiting-confirmation" { code = .done } else { self.end() }
            case "pairing-join-confirm":
                if reply.status == "acknowledged" { code = .done; self.end() }
                else if reply.status == "local-ready" { code = .done }
                else if reply.status != "awaiting-confirmation" { self.end() }
            default: break
            }
            completion(code, value)
        }
        if ["pairing-host-start", "pairing-join-claim"].contains(action) {
            send(["action": "identity-status"]) { [weak self] reply in
                guard let self, let reply, !self.closed else { completion(.unavailable, nil); return }
                guard reply.status == "identity-ready" else {
                    self.missingIdentity = ["identity-required", "identity-recovery-required"].contains(reply.status) ? reply.status : nil
                    self.end()
                    completion(.unavailable, nil)
                    return
                }
                self.send(command, completion: receive)
            }
        } else { send(command, identity: action == "pairing-identity-create", completion: receive) }
    }
}

private func bridgeRun(resources: URL, runtime: URL, script: String, arguments: [String],
                       timeout: TimeInterval, capture: Bool = true, inputData: Data? = nil) async throws -> Data {
    try await Task.detached(priority: .utility) {
        let values = try runtime.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        guard values.isDirectory == true, values.isSymbolicLink != true,
              let resolved = realpath(runtime.path, nil) else { throw CocoaError(.fileReadNoPermission) }
        defer { free(resolved) }
        let node = resources.appendingPathComponent("Runtime/node/bin/node")
        let file = resources.appendingPathComponent("Collector/scripts/" + script)
        guard FileManager.default.isExecutableFile(atPath: node.path), FileManager.default.fileExists(atPath: file.path) else {
            throw CocoaError(.fileReadNoSuchFile)
        }
        let process = Process(), output = Pipe(), input = Pipe()
        process.environment = bridgeChildEnvironment()
        process.executableURL = node
        process.arguments = [file.path] + arguments.map { $0 == "<runtime>" ? String(cString: resolved) : $0 }
        process.currentDirectoryURL = runtime
        process.standardInput = inputData == nil ? FileHandle.nullDevice : input
        process.standardOutput = capture ? output : FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run()
        let deadline = DispatchWorkItem { if process.isRunning { kill(process.processIdentifier, SIGKILL) } }
        DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: deadline)
        defer {
            deadline.cancel()
            try? input.fileHandleForWriting.close()
            try? output.fileHandleForReading.close()
            if process.isRunning { kill(process.processIdentifier, SIGKILL); process.waitUntilExit() }
        }
        if let inputData {
            try input.fileHandleForWriting.write(contentsOf: inputData)
            try input.fileHandleForWriting.close()
        }
        var data = Data()
        if capture {
            while true {
                let chunk = output.fileHandleForReading.readData(ofLength: min(4096, 4097 - data.count))
                if chunk.isEmpty { break }
                data.append(chunk)
                if data.count > 4096 {
                    if process.isRunning { kill(process.processIdentifier, SIGKILL) }
                    process.waitUntilExit()
                    throw CocoaError(.fileReadTooLarge)
                }
            }
        }
        process.waitUntilExit()
        guard process.terminationReason == .exit, process.terminationStatus == 0 else { throw CocoaError(.fileReadUnknown) }
        return data
    }.value
}

// The switch shows only the consent.json marker because the separately installed status line bridge keeps consent given after the switch is turned off.
private func bridgeSwitchConsent(_ data: Data) throws -> Bool {
    guard data.count <= 4096, let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          Set(object.keys) == ["given", "consentMarker", "statusLine"],
          object.values.allSatisfy({ ($0 as? NSNumber).map { CFGetTypeID($0) == CFBooleanGetTypeID() } == true }),
          let consentMarker = object["consentMarker"] as? Bool else { throw CocoaError(.fileReadCorruptFile) }
    return consentMarker
}

@MainActor
private final class BridgeCache<Value> {
    private var readAt: TimeInterval?
    private var value: Value?
    private var pending: Task<Value?, Never>?
    private var revision = 0
    func set(_ value: Value?) { revision += 1; self.value = value; readAt = ProcessInfo.processInfo.systemUptime }
    func read(_ fetch: @escaping @MainActor () async -> Value?) async -> Value? {
        if let pending { _ = await pending.value; return value }
        if let readAt, ProcessInfo.processInfo.systemUptime - readAt < Double(BridgeContract.limits["cacheRefreshSeconds"].number) { return value }
        let generation = revision
        let task = Task { [self] in
            let result = await fetch()
            if generation == revision { set(result) }
            return value
        }
        pending = task
        _ = await task.value
        pending = nil
        return value
    }
}

struct MacBridgeHooks {
    var openDashboard: (String) -> Void
    var checkForUpdates: () -> Bool
    var directPairingOpen: () -> Bool
    var applyViewerPreferences: (String, String?) -> Void
}

private final class BridgeSaveDelegate: NSObject, NSOpenSavePanelDelegate {
    func panel(_ sender: Any, validate url: URL) throws {
        var info = stat()
        if lstat(url.path, &info) == 0 || errno != ENOENT { throw CocoaError(.fileWriteFileExists) }
    }
}

@MainActor
final class MacBridgeHost: BridgeHost {
    private let store: ObservatoryStore
    private let resources: URL?
    private let preview: Bool
    private let isolatedRuntime: Bool
    private let handler: BridgeHandler
    private let hooks: MacBridgeHooks
    private let pairingControl: (() throws -> DirectPairingBridge)?
    private var pairingIdentity = BridgePairingIdentity()
    private var session: BridgePairingSession?
    private var operationRunning = false
    private var documentGeneration = 0
    private let quotaSharing = BridgeCache<QuotaSharingStatus>()
    private let tokenSharing = BridgeCache<QuotaSharingStatus>()
    private let sharingChoice = BridgeCache<BridgeSharingChoice>()
    private let consent = BridgeCache<Bool>()
    private let tailscale = BridgeCache<String>()
    var reportedPairing: (state: String, transport: String) {
        bridgeStatusPairing(session: session, maintenance: store.pairingMaintenance, paused: store.collectionPausedForPairing,
            identityState: pairingIdentity.state, fileState: bridgePairingStatus(runtime: store.runtime),
            fallback: bridgePairingFiles(runtime: store.runtime))
    }
    var sessionOpen: Bool { session != nil }
    var pairingBlocked: Bool {
        store.refreshing || (store.pairingMaintenance && session?.closed != false) || hooks.directPairingOpen() || operationRunning
    }
    init(store: ObservatoryStore, resources: URL?, preview: Bool, handler: BridgeHandler, hooks: MacBridgeHooks, isolatedRuntime: Bool = false, pairingControl: (() throws -> DirectPairingBridge)? = nil) {
        self.pairingControl = pairingControl
        self.isolatedRuntime = isolatedRuntime
        self.store = store; self.resources = resources; self.preview = preview; self.handler = handler; self.hooks = hooks
    }
    func documentEnded() { documentGeneration += 1; session?.end() }

    private func confirm(_ title: String, _ text: String, _ buttons: [String], second: Bool = false) -> BridgeCode {
        let generation = documentGeneration
        handler.beginNativeDialog()
        defer { handler.endNativeDialog() }
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = title; alert.informativeText = text
        for button in buttons { alert.addButton(withTitle: button) }
        guard NSApp.modalWindow == nil else { return .busy }
        let response = alert.runModal()
        return generation == documentGeneration && response == (second ? .alertSecondButtonReturn : .alertFirstButtonReturn) ? .done : .cancelled
    }

    private func confirmSharing() -> BridgeCode {
        confirm("Share usage records?", "Share these usage records with the paired device? Enable sharing there separately. Credentials stay on their owning device.", ["Enable sharing", "Cancel"])
    }

    private func beginSession() throws -> BridgePairingSession {
        if let session { return session }
        let factory: () throws -> DirectPairingBridge
        if let pairingControl { factory = pairingControl }
        else {
            guard let resources else { throw CocoaError(.fileReadNoSuchFile) }
            factory = { try TLSSetupProcess(runtime: self.store.runtime, resources: resources) }
        }
        let created = try BridgePairingSession(factory: factory,
            confirmSharing: { [weak self] in self?.confirmSharing() ?? .cancelled }) { [weak self] stopped in
            guard let self else { return }
            if !stopped { self.store.collectionPausedForPairing = true }
            self.store.pairingMaintenance = false
            self.session = nil
        }
        store.pairingMaintenance = true
        session = created
        return created
    }

    func perform(action: String, args: [String: BridgeValue], completion: @escaping (BridgeCode, Any?) -> Void) {
        if ["set-source", "set-skin", "set-appearance", "set-device-name", "complete-setup", "export-data"].contains(action),
           store.runtimeIdentityValid?() == false {
            completion(.unavailable, nil)
            return
        }
        if (isolatedRuntime || preview) && ["set-sharing-choice", "pairing-host-defaults", "pairing-peer-address", "pairing-identity-create", "pairing-host-start", "pairing-host-confirm",
            "pairing-join-claim", "pairing-join-confirm", "pairing-copy-invitation", "pairing-cancel",
            "set-sharing", "set-limits-consent", "pairing-disconnect", "pairing-repair-prepare"].contains(action) {
            completion(.unavailable, nil)
            return
        }
        func string(_ key: String) -> String { if case .string(let value) = args[key] { return value }; return "" }
        let enabled = args["enabled"] == .bool(true)
        if action == "pairing-peer-address" {
            completion(.done, ["peerAddress": session?.peerAddress as Any? ?? NSNull()]); return
        }
        if action == "pairing-copy-invitation" {
            guard !preview else { completion(.unavailable, nil); return }
            let code = session?.copyInvitation { invitation in
                NSPasteboard.general.clearContents()
                return NSPasteboard.general.setString(invitation, forType: .string)
            } ?? .unavailable
            completion(code, nil); return
        }
        if action == "pairing-cancel" {
            guard !preview else { completion(.unavailable, nil); return }
            if let session { session.perform(action: action, args: args, completion: completion) }
            else { completion(.done, nil) }
            return
        }
        if ["pairing-host-defaults", "pairing-identity-create", "pairing-host-start", "pairing-host-confirm", "pairing-join-claim", "pairing-join-confirm"].contains(action) {
            if bridgePairingStartBusy(action: action, session: session) {
                completion(.busy, nil)
                return
            }
            guard !isolatedRuntime, !preview, !store.shuttingDown else { completion(.unavailable, nil); return }
            guard !pairingBlocked else { completion(.busy, nil); return }
            if action == "pairing-identity-create" {
                let code = confirm("Create device identity?", "Allow a device identity stored in a permission-restricted file. The key is not stored in Keychain or encrypted separately by Observatory.", ["Allow", "Cancel"])
                guard code == .done else { completion(code, nil); return }
            }
            guard !pairingBlocked, !store.shuttingDown else { completion(.busy, nil); return }
            guard !bridgePairingStartBusy(action: action, session: session) else { completion(.busy, nil); return }
            let identityOnly = ["pairing-identity-create", "pairing-host-defaults"].contains(action) && session == nil
            if session == nil && ["pairing-host-confirm", "pairing-join-confirm"].contains(action) { completion(.unavailable, nil); return }
            do {
                let starting = session == nil
                let current = try beginSession()
                if starting { pairingIdentity.sessionBegan(action: action) }
                current.perform(action: action, args: args, identityOnly: identityOnly) { [self] code, value in
                    pairingIdentity.finished(action: action, code: code, missingIdentity: current.missingIdentity)
                    completion(code, value)
                }
            }
            catch { completion(.unavailable, nil) }
            return
        }
        switch action {
        case "refresh":
            guard !store.refreshing, !sessionOpen else { completion(.busy, nil); return }
            store.refreshLimitsFirst()
            completion(store.refreshing ? .done : .unavailable, nil)
        case "check-updates": completion(!isolatedRuntime && hooks.checkForUpdates() ? .done : .unavailable, nil)
        case "open-dashboard", "open-settings": hooks.openDashboard(action == "open-settings" ? "settings" : string("section")); completion(.done, nil)
        case "set-source":
            do {
                guard try CollectorConfiguration.prepare(runtime: store.runtime) else { completion(.unavailable, nil); return }
                guard !store.refreshing else { completion(.busy, nil); return }
                let current = try CollectorConfiguration.read(runtime: store.runtime), source = string("source")
                guard current[source] != enabled else { completion(.done, nil); return }
                if source == "quota", !enabled, current[source] == true {
                    let code = confirm("Account history", "Turn account monitoring off and clear Observatory's retained account readings on the next collection? Saved log-token history remains.", ["Turn off", "Cancel"])
                    guard code == .done else { completion(code, nil); return }
                }
                guard !store.refreshing else { completion(.busy, nil); return }
                var updated = current; updated[source] = enabled
                guard try CollectorConfiguration.saveIfUnchanged(updated, expected: current, runtime: store.runtime) else { completion(.unavailable, nil); return }
                store.refresh(); completion(.done, nil)
            } catch { completion(.unavailable, nil) }
        case "set-skin", "set-appearance":
            let current = ViewerSettingsFile.read(runtime: store.runtime)
            let skin = action == "set-skin" ? string("skin") : current.skin
            let appearance = action == "set-appearance" ? string("mode") : current.appearance
            guard ViewerSettingsFile.validSkin(skin, customSkins: []) else { completion(.refused, nil); return }
            do {
                try ViewerSettingsFile.write(runtime: store.runtime, skin: skin, appearance: appearance)
                hooks.applyViewerPreferences(skin, WebViewerPreferences.theme(stored: appearance)); completion(.done, nil)
            } catch { completion(.unavailable, nil) }
        case "set-device-name":
            do { try DeviceNameFile.write(runtime: store.runtime, name: args["name"] == .null ? nil : string("name")); completion(.done, nil) }
            catch { completion(.unavailable, nil) }
        case "set-startup":
            guard !isolatedRuntime, !preview else { completion(.unavailable, nil); return }
            do {
                if enabled && SMAppService.mainApp.status != .enabled {
                    UserDefaults.standard.set(true, forKey: "loginItemWanted")
                    try SMAppService.mainApp.register()
                    if SMAppService.mainApp.status == .enabled {
                        UserDefaults.standard.set(false, forKey: "loginItemWanted")
                        UserDefaults.standard.set(Bundle.main.bundlePath, forKey: "loginItemBundlePath")
                    }
                }
                else if !enabled {
                    UserDefaults.standard.set(false, forKey: "loginItemWanted")
                    if SMAppService.mainApp.status != .notRegistered { try SMAppService.mainApp.unregister() }
                }
                let status = SMAppService.mainApp.status
                completion(status != .requiresApproval && (status == .enabled) == enabled ? .done : .unavailable, nil)
            } catch { completion(.unavailable, nil) }
        case "set-limits-consent":
            guard !isolatedRuntime, !preview else { completion(.unavailable, nil); return }
            guard hasConsentScript else { completion(.unavailable, nil); return }
            if enabled {
                let code = confirm("Turn on Claude Code limits?", "Each collection runs Claude Code's own usage command and keeps only the 5-hour and weekly limit percentages and their reset times.", ["Turn on", "Cancel"])
                guard code == .done else { completion(code, nil); return }
            }
            Task {
                do {
                    let value = try await readConsent(arguments: enabled ? ["set", "--consent"] : ["clear"])
                    consent.set(value); completion(value == enabled ? .done : .unavailable, nil)
                } catch { consent.set(nil); completion(.unavailable, nil) }
            }
        case "set-sharing-choice":
            guard !isolatedRuntime, !preview, resources != nil else { completion(.unavailable, nil); return }
            guard !sessionOpen, !store.refreshing, !store.pairingMaintenance, !store.shuttingDown else { completion(.busy, nil); return }
            if enabled {
                let code = confirmSharing()
                guard code == .done else { completion(code, nil); return }
            }
            guard !sessionOpen, !store.refreshing, !store.pairingMaintenance, !store.shuttingDown else { completion(.busy, nil); return }
            operationRunning = true; store.pairingMaintenance = true
            Task {
                var code: BridgeCode = .unavailable
                do {
                    let value = try await runSharingChoice(enabled: enabled)
                    sharingChoice.set(value); code = .done
                } catch { sharingChoice.set(nil) }
                operationRunning = false; store.pairingMaintenance = false
                completion(code, nil)
            }
        case "set-sharing":
            guard !isolatedRuntime, !preview, let resources else { completion(.unavailable, nil); return }
            guard !sessionOpen, !store.refreshing, !store.pairingMaintenance, !store.shuttingDown else { completion(.busy, nil); return }
            if enabled {
                let code = confirmSharing()
                guard code == .done else { completion(code, nil); return }
            }
            guard !sessionOpen, !store.refreshing, !store.pairingMaintenance, !store.shuttingDown else { completion(.busy, nil); return }
            operationRunning = true; store.pairingMaintenance = true
            let channel = string("channel"), token = enabled ? string("token") : nil
            Task {
                var code: BridgeCode = .unavailable
                do {
                    let value = try await QuotaSharing.run(runtime: store.runtime, resources: resources, action: enabled ? "enable" : "disable", token: token,
                                                          channel: channel == "codex-limits" ? .quota : .providerTokens)
                    (channel == "codex-limits" ? quotaSharing : tokenSharing).set(value)
                    if value.enabled == enabled { code = .done }
                } catch { (channel == "codex-limits" ? quotaSharing : tokenSharing).set(nil) }
                operationRunning = false; store.pairingMaintenance = false
                completion(code, nil)
            }
        case "pairing-disconnect", "pairing-repair-prepare": maintenance(repair: action == "pairing-repair-prepare", completion: completion)
        case "tailscale-check":
            Task {
                let value = await tailscale.read { [self] in
                    guard let resources else { return "unavailable" }
                    return (try? await TailscaleReadiness.readStatus(resources: resources)) ?? "unavailable"
                }
                completion(.done, ["status": value ?? "unavailable"])
            }
        case "status":
            Task {
                async let shared = readSharing()
                async let limits = consent.read { [self] in
                    if !hasConsentScript { return false }
                    return try? await readConsent(arguments: ["status"])
                }
                guard let shared = await shared, let limits = await limits,
                      let sources = try? CollectorConfiguration.read(runtime: store.runtime),
                      let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String,
                      let buildText = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String, let build = Int(buildText) else {
                    completion(.unavailable, nil); return
                }
                let viewer = ViewerSettingsFile.read(runtime: store.runtime)
                let paired = reportedPairing
                let visible = session?.defaultsOnly == true ? nil : session
                let input = BridgeStatusInput(appVersion: version, appBuild: build,
                    sources: sources.filter { ["activity", "codex", "claude", "wispr", "quota"].contains($0.key) },
                    skin: viewer.skin, customSkins: [], deviceName: DeviceNameFile.read(runtime: store.runtime),
                    startup: SMAppService.mainApp.status == .enabled, appearance: viewer.appearance, limitsConsent: limits,
                    collectionPaused: store.collectionPausedForPairing || store.pairingMaintenance,
                    pairingState: paired.state, peerFingerprint: visible?.fingerprint,
                    transport: paired.transport, invitationKept: visible?.invitation != nil, sharing: shared.channels, sharingChoice: shared.choice)
                let value = BridgeStatusInput.bridgeStatusValue(input)
                completion(value == nil ? .unavailable : .done, value)
            }
        case "export-data": export(completion: completion)
        case "complete-setup":
            do {
                if try FirstRunSetup.markComplete(runtime: store.runtime) {
                    store.setupCompleted()
                    store.refresh()
                }
                completion(.done, nil)
            } catch { completion(.unavailable, nil) }
        default: completion(.refused, nil)
        }
    }

    private var hasConsentScript: Bool {
        resources.map { FileManager.default.fileExists(atPath: $0.appendingPathComponent("Collector/scripts/claude-limits-consent.mjs").path) } ?? false
    }
    private func readConsent(arguments: [String]) async throws -> Bool {
        guard let resources else { throw CocoaError(.fileReadNoSuchFile) }
        return try bridgeSwitchConsent(await bridgeRun(resources: resources, runtime: store.runtime, script: "claude-limits-consent.mjs",
                                                arguments: arguments + ["--runtime", "<runtime>"], timeout: 20))
    }
    private func runSharingChoice(enabled: Bool? = nil) async throws -> BridgeSharingChoice {
        guard let resources else { throw CocoaError(.fileReadNoSuchFile) }
        var request: [String: Any] = ["action": "status"]
        if let enabled { request = ["action": "choose", "enabled": enabled] }
        let data = try JSONSerialization.data(withJSONObject: request)
        return try BridgeSharingChoice.parse(await bridgeRun(resources: resources, runtime: store.runtime,
            script: "sharing-choice.mjs", arguments: ["--runtime", "<runtime>"], timeout: 15, inputData: data))
    }
    private func readSharing() async -> (channels: [String: QuotaSharingStatus], choice: BridgeSharingChoice)? {
        async let choice = sharingChoice.read { [self] in try? await runSharingChoice() }
        async let quota = quotaSharing.read { [self] in
            guard let resources else { return nil }
            return try? await QuotaSharing.run(runtime: store.runtime, resources: resources, action: "status", token: nil)
        }
        async let tokens = tokenSharing.read { [self] in
            guard let resources else { return nil }
            return try? await QuotaSharing.run(runtime: store.runtime, resources: resources, action: "status", token: nil, channel: .providerTokens)
        }
        let chosen = await choice ?? .unavailable
        guard let quota = await quota, let tokens = await tokens else { return nil }
        return (["codex-limits": quota, "claude-code-tokens": tokens], chosen)
    }
    private func maintenance(repair: Bool, completion: @escaping (BridgeCode, Any?) -> Void) {
        guard !preview, let resources else { completion(.unavailable, nil); return }
        guard !store.refreshing, !store.pairingMaintenance, !sessionOpen else { completion(.busy, nil); return }
        if !repair && !FileManager.default.fileExists(atPath: store.runtime.appendingPathComponent("private-sync").path) { completion(.unavailable, nil); return }
        let title = repair ? "Prepare pairing repair on this Mac?" : "Disconnect paired device?"
        let text = repair ? "If this Mac has pairing state, disable it and retain a private backup. Otherwise, confirm this Mac is ready for repair. Nothing is deleted or sent. A transfer already in flight may finish. Confirm Prepare pairing repair on Windows separately, then use Pair with Windows here to create fresh credentials. Retirement cannot be undone by this action." : "Disable pairing on this Mac only. Local collection continues and saved data is retained. A transfer already in flight may finish. Disconnect on the other device separately. To reconnect, prepare pairing repair on both devices and pair again from the Mac."
        let code = confirm(title, text, ["Cancel", repair ? "Retain backup and prepare" : "Disconnect on this Mac"], second: true)
        guard code == .done else { completion(code, nil); return }
        store.collectionPausedForPairing = true
        guard !store.refreshing, !store.pairingMaintenance, !sessionOpen else { completion(.busy, nil); return }
        operationRunning = true; store.pairingMaintenance = true
        Task {
            var code: BridgeCode = .unavailable
            do {
                if repair { try await PairingMaintenance.prepareRepair(runtime: store.runtime, resources: resources) }
                else { try await PairingMaintenance.disconnect(runtime: store.runtime, resources: resources) }
                store.collectionPausedForPairing = false; code = .done
            } catch { }
            operationRunning = false; store.pairingMaintenance = false
            store.refresh(); completion(code, nil)
        }
    }
    private func export(completion: @escaping (BridgeCode, Any?) -> Void) {
        let panel = NSSavePanel(), delegate = BridgeSaveDelegate()
        panel.allowedContentTypes = [UTType(filenameExtension: "observatory") ?? .data]
        panel.nameFieldStringValue = "Observatory.observatory"
        panel.canCreateDirectories = true
        panel.delegate = delegate
        let generation = documentGeneration
        handler.beginNativeDialog()
        NSApp.activate(ignoringOtherApps: true)
        guard NSApp.modalWindow == nil else { handler.endNativeDialog(); completion(.busy, nil); return }
        let response = panel.runModal()
        handler.endNativeDialog()
        guard generation == documentGeneration, response == .OK, let url = panel.url else { completion(.cancelled, nil); return }
        guard let resources else { completion(.unavailable, nil); return }
        Task {
            do {
                _ = try await bridgeRun(resources: resources, runtime: store.runtime, script: "observatory-file.mjs",
                    arguments: ["export", "--runtime", "<runtime>", "--out", url.path], timeout: 30, capture: false)
                completion(.done, nil)
            } catch { completion(.unavailable, nil) }
        }
    }
}

private final class BridgeActionFake: DirectPairingBridge {
    var commands: [[String: Any]] = []
    var replies: [Result<TLSSetupReply, Error>] = []
    var closed = 0
    var deferred: [TLSSetupProcess.Completion] = []
    var delay = false
    func send(_ command: [String: Any], completion: @escaping TLSSetupProcess.Completion) {
        commands.append(command)
        if delay { deferred.append(completion); return }
        precondition(!replies.isEmpty)
        completion(replies.removeFirst())
    }
    func prepareIdentity(storageConsent: Bool, completion: @escaping TLSSetupProcess.Completion) {
        precondition(storageConsent)
        send(["action": "identity-create", "storage": "restricted-file", "identity": NSNull()], completion: completion)
    }
    func close() { closed += 1 }
    func reply(_ status: String, invitation: String? = nil, fingerprint: String? = nil) {
        replies.append(.success(TLSSetupReply(id: 1, status: status, invitation: invitation, peerCertificateSha256: fingerprint)))
    }
}

func runBridgeActionSelfTests() {
    MainActor.assumeIsolated {
        let invitation = "observatory-pair:v1:synthetic"
        let fingerprint = String(repeating: "a", count: 64)
        var ended = 0
        let fake = BridgeActionFake()
        let session = try! BridgePairingSession(factory: { fake }, pollInterval: 60, limit: 120) { stopped in
            precondition(stopped); ended += 1
        }
        var code: BridgeCode?
        var value: Any?
        func result(_ result: BridgeCode, _ output: Any?) { code = result; value = output }
        for action in ["pairing-host-start", "pairing-join-claim"] {
            for status in ["identity-required", "identity-recovery-required", "cancelled"] {
                let control = BridgeActionFake()
                let starting = try! BridgePairingSession(factory: { control }, pollInterval: 60) { _ in }
                control.reply(status)
                starting.perform(action: action, args: [:], completion: result)
                precondition(code == .unavailable && value == nil && starting.closed && control.closed == 1)
                precondition(control.commands.count == 1 && NSDictionary(dictionary: control.commands[0]).isEqual(to: ["action": "identity-status"]))
                precondition(starting.missingIdentity == (status == "cancelled" ? nil : status))
            }
            let failed = BridgeActionFake()
            let failing = try! BridgePairingSession(factory: { failed }, pollInterval: 60) { _ in }
            failed.replies.append(.failure(CocoaError(.fileReadUnknown)))
            failing.perform(action: action, args: [:], completion: result)
            precondition(code == .unavailable && value == nil && failing.closed && failing.missingIdentity == nil)
            precondition(failed.commands.count == 1 && NSDictionary(dictionary: failed.commands[0]).isEqual(to: ["action": "identity-status"]))

            let delayed = BridgeActionFake()
            delayed.delay = true
            let probing = try! BridgePairingSession(factory: { delayed }, pollInterval: 60) { _ in }
            probing.perform(action: action, args: [:], completion: result)
            precondition(probing.state == "working" && probing.fingerprint == nil && delayed.commands.count == 1)
            delayed.deferred[0](.success(TLSSetupReply(id: 1, status: "identity-ready", invitation: nil, peerCertificateSha256: fingerprint)))
            precondition(probing.state == "working" && probing.fingerprint == nil && delayed.commands.count == 2)
            probing.end()
            precondition(code == .unavailable && value == nil)

            let cancelled = BridgeActionFake()
            cancelled.delay = true
            let stopped = try! BridgePairingSession(factory: { cancelled }, pollInterval: 60) { _ in }
            stopped.perform(action: action, args: [:], completion: result)
            stopped.end()
            cancelled.deferred[0](.success(TLSSetupReply(id: 1, status: "identity-ready", invitation: nil, peerCertificateSha256: nil)))
            precondition(code == .unavailable && value == nil && cancelled.commands.count == 1)
        }
        for status in ["identity-required", "identity-recovery-required"] {
            for action in ["pairing-host-start", "pairing-join-claim"] {
                var identity = BridgePairingIdentity()
                precondition(identity.state == nil)
                identity.finished(action: action, code: .unavailable, missingIdentity: status)
                precondition(identity.state == status)
                for unrelated in ["pairing-cancel", "pairing-disconnect", "pairing-repair-prepare", "pairing-host-confirm"] {
                    identity.finished(action: unrelated, code: .done, missingIdentity: nil)
                    precondition(identity.state == status)
                }
                identity.sessionBegan(action: "pairing-host-defaults")
                precondition(identity.state == status)
                for code in [BridgeCode.unavailable, .cancelled] {
                    identity.finished(action: "pairing-identity-create", code: code, missingIdentity: nil)
                    precondition(identity.state == status)
                }
                identity.finished(action: action, code: .unavailable, missingIdentity: nil)
                precondition(identity.state == status)
                identity.finished(action: "pairing-identity-create", code: .done, missingIdentity: nil)
                precondition(identity.state == nil)
                for start in ["pairing-host-start", "pairing-join-claim", "pairing-identity-create"] {
                    identity.finished(action: action, code: .unavailable, missingIdentity: status)
                    identity.sessionBegan(action: start)
                    precondition(identity.state == nil)
                }
            }
            for fileState in ["establishing-trust", "active-sync", "sync-stale", "revoked", "unpaired", "unavailable"] {
                for paused in [false, true] {
                    precondition(bridgeReportedPairingState(sessionState: "working", maintenance: true, identityState: status,
                        paused: paused, fileState: fileState, fallback: "paired") == "working")
                    precondition(bridgeReportedPairingState(sessionState: nil, maintenance: true, identityState: status,
                        paused: paused, fileState: fileState, fallback: "paired") == "paired")
                    precondition(bridgeReportedPairingState(sessionState: nil, maintenance: false, identityState: status,
                        paused: paused, fileState: fileState, fallback: "paired") == status)
                    precondition(bridgeReportedPairingState(sessionState: nil, maintenance: false, identityState: nil,
                        paused: paused, fileState: fileState, fallback: "paired") == (paused || fileState == "unavailable" ? "paired" : fileState))
                }
            }
        }
        precondition(session.copyInvitation { _ in preconditionFailure() } == .unavailable)
        fake.reply("identity-ready")
        fake.reply("hosting", invitation: invitation)
        session.perform(action: "pairing-host-start", args: ["address": .string("10.0.0.1"), "port": .integer(43128), "id": .integer(900)], completion: result)
        precondition(code == .done && (value as? [String: String])?["invitation"] == invitation)
        precondition(NSDictionary(dictionary: fake.commands.last!).isEqual(to: ["action": "host-start", "address": "10.0.0.1", "port": 0]))
        precondition(fake.commands.count == 2 && NSDictionary(dictionary: fake.commands[0]).isEqual(to: ["action": "identity-status"]))
        precondition(session.invitation == invitation && session.address == "10.0.0.1" && session.port == 43128)
        precondition(bridgeSessionPairingState(session: session, maintenance: true, identityState: nil, paused: false,
            fileState: "active-sync", fallback: "paired") == "waiting")
        precondition(bridgeSessionPairingState(session: nil, maintenance: true, identityState: nil, paused: false,
            fileState: "active-sync", fallback: "paired") == "paired")
        precondition(session.copyInvitation { $0 == invitation } == .done)
        fake.reply("confirming", fingerprint: fingerprint)
        fake.replies.append(.success(TLSSetupReply(id: 1, status: "confirming", invitation: nil, peerCertificateSha256: nil, peerAddress: "100.64.0.2")))
        session.poll()
        precondition(session.peerAddress == "100.64.0.2")
        precondition(NSDictionary(dictionary: fake.commands.last!).isEqual(to: ["action": "pending-peer"]))
        let afterPeer = fake.commands.count
        fake.reply("confirming", fingerprint: fingerprint); session.poll()
        precondition(fake.commands.count == afterPeer + 1 && session.peerAddress == "100.64.0.2")
        precondition(session.state == "confirming" && session.fingerprint == fingerprint)
        fake.reply("waiting"); session.poll()
        precondition(session.state == "waiting" && session.fingerprint == nil)
        fake.reply("configuration-ready")
        session.perform(action: "pairing-host-confirm", args: ["sharing": .bool(false), "fingerprint": .string(fingerprint), "peerAddress": .string("10.0.0.2"), "peerPort": .integer(43129)], completion: result)
        let expected: [String: Any] = ["action": "host-confirm", "peerCertificateSha256": fingerprint,
            "localEndpoint": ["kind": "tls", "address": "10.0.0.1", "port": 43128],
            "peerEndpoint": ["kind": "tls", "address": "10.0.0.2", "port": 43129], "sharing": false]
        precondition(code == .done && NSDictionary(dictionary: fake.commands.last!).isEqual(to: expected))
        fake.replies.append(.failure(CocoaError(.fileReadUnknown)))
        session.perform(action: "pairing-join-confirm", args: ["sharing": .bool(false)], completion: result)
        precondition(code == .unavailable && session.closed && session.invitation == nil && session.address == nil && session.port == nil && session.fingerprint == nil)
        session.end(); precondition(ended == 1 && fake.closed == 1)
        precondition(fake.commands.allSatisfy { $0["id"] == nil })

        let join = BridgeActionFake()
        let joining = try! BridgePairingSession(factory: { join }, pollInterval: 60) { _ in }
        join.reply("identity-ready")
        join.reply("awaiting-confirmation")
        joining.perform(action: "pairing-join-claim", args: ["invitation": .string(invitation)], completion: result)
        precondition(code == .done && NSDictionary(dictionary: join.commands.last!).isEqual(to: ["action": "join-claim", "invitation": invitation]))
        precondition(join.commands.count == 2 && NSDictionary(dictionary: join.commands[0]).isEqual(to: ["action": "identity-status"]))
        join.reply("local-ready")
        joining.perform(action: "pairing-join-confirm", args: ["sharing": .bool(false)], completion: result)
        precondition(code == .done && !joining.closed)
        join.reply("awaiting-confirmation")
        joining.perform(action: "pairing-join-confirm", args: ["sharing": .bool(false)], completion: result)
        precondition(code == .unavailable && !joining.closed)
        join.reply("acknowledged")
        joining.perform(action: "pairing-join-confirm", args: ["sharing": .bool(false)], completion: result)
        precondition(code == .done && joining.closed && join.closed == 1)
        precondition(NSDictionary(dictionary: join.commands.last!).isEqual(to: ["action": "join-confirm", "sharing": false]))

        for allowed in [false, true] {
            let control = BridgeActionFake()
            var dialogs = 0
            let consentSession = try! BridgePairingSession(factory: { control }, pollInterval: 60, confirmSharing: {
                dialogs += 1
                return allowed ? .done : .cancelled
            }) { _ in }
            for _ in 0..<2 {
                if allowed { control.reply("local-ready") }
                let before = control.commands.count
                consentSession.perform(action: "pairing-join-confirm", args: ["sharing": .bool(true)], completion: result)
                precondition(code == (allowed ? .done : .cancelled))
                precondition(control.commands.count == before + (allowed ? 1 : 0))
                if allowed { precondition(NSDictionary(dictionary: control.commands.last!).isEqual(to: ["action": "join-confirm", "sharing": true])) }
            }
            precondition(dialogs == (allowed ? 1 : 2))
            consentSession.end()
        }
        let hostConsent = BridgeActionFake()
        var hostDialogs = 0
        let hostSession = try! BridgePairingSession(factory: { hostConsent }, pollInterval: 60, confirmSharing: {
            hostDialogs += 1
            return .done
        }) { _ in }
        hostConsent.reply("identity-ready")
        hostConsent.reply("hosting", invitation: invitation)
        hostSession.perform(action: "pairing-host-start", args: ["address": .string("10.0.0.1"), "port": .integer(43128)], completion: result)
        for _ in 0..<2 {
            hostConsent.reply("configuration-ready")
            hostSession.perform(action: "pairing-host-confirm", args: ["sharing": .bool(true), "fingerprint": .string(fingerprint),
                "peerAddress": .string("10.0.0.2"), "peerPort": .integer(43129)], completion: result)
            var sharingExpected = expected
            sharingExpected["sharing"] = true
            precondition(code == .done && NSDictionary(dictionary: hostConsent.commands.last!).isEqual(to: sharingExpected))
        }
        precondition(hostDialogs == 1)
        hostSession.end()

        let startActions = ["pairing-host-defaults", "pairing-identity-create", "pairing-host-start",
                            "pairing-host-confirm", "pairing-join-claim", "pairing-join-confirm"]
        let pendingDefaultsControl = BridgeActionFake()
        pendingDefaultsControl.delay = true
        let pendingDefaults = try! BridgePairingSession(factory: { pendingDefaultsControl }, pollInterval: 60) { _ in }
        pendingDefaults.perform(action: "pairing-host-defaults", args: [:], identityOnly: true, completion: result)
        precondition(pendingDefaults.defaultsOnly && !pendingDefaults.closed && pendingDefaultsControl.deferred.count == 1)
        for action in startActions {
            precondition(bridgePairingStartBusy(action: action, session: pendingDefaults))
            precondition(!bridgePairingStartBusy(action: action, session: nil))
        }
        precondition(pendingDefaultsControl.commands.count == 1 &&
            NSDictionary(dictionary: pendingDefaultsControl.commands[0]).isEqual(to: ["action": "host-defaults"]))
        for state in ["identity-required", "identity-recovery-required"] {
            precondition(bridgeSessionPairingState(session: pendingDefaults, maintenance: true, identityState: state, paused: true,
                fileState: "active-sync", fallback: "paired") == state)
        }
        pendingDefaults.end()

        for valid in [true, false] {
            let control = BridgeActionFake()
            var stopped = false
            let defaults = try! BridgePairingSession(factory: { control }, pollInterval: 60) { stopped = $0 }
            control.replies.append(.success(TLSSetupReply(id: 1, status: "ready", invitation: nil, peerCertificateSha256: nil,
                address: valid ? "100.64.0.1" : "bad", port: 43128, portAvailable: true)))
            defaults.perform(action: "pairing-host-defaults", args: [:], identityOnly: true, completion: result)
            precondition(defaults.defaultsOnly && defaults.state == "working")
            for fileState in ["unavailable", "revoked", "active-sync"] {
                precondition(bridgeSessionPairingState(session: defaults, maintenance: true, identityState: nil, paused: false,
                    fileState: fileState, fallback: "unpaired") == bridgeSessionPairingState(session: nil,
                    maintenance: false, identityState: nil, paused: false, fileState: fileState, fallback: "unpaired"))
            }
            precondition(bridgeSessionPairingState(session: defaults, maintenance: true, identityState: nil, paused: true,
                fileState: "active-sync", fallback: "unpaired") == "unpaired")
            precondition(code == (valid ? .done : .unavailable) && defaults.closed && stopped && control.closed == 1)
            precondition(control.commands.count == 1 && NSDictionary(dictionary: control.commands[0]).isEqual(to: ["action": "host-defaults"]))
            if valid { precondition(NSDictionary(dictionary: value as! [String: Any]).isEqual(to: ["address": "100.64.0.1", "port": 43128, "portAvailable": true])) }
            else { precondition(value == nil) }
        }
        let defaultsControl = BridgeActionFake()
        let existingSession = try! BridgePairingSession(factory: { defaultsControl }, pollInterval: 60) { _ in }
        for action in startActions {
            precondition(bridgePairingStartBusy(action: action, session: existingSession) == (action == "pairing-host-defaults"))
        }
        defaultsControl.replies.append(.success(TLSSetupReply(id: 1, status: "ready", invitation: nil, peerCertificateSha256: nil, port: 43128)))
        let stateBeforeDefaults = existingSession.state
        existingSession.perform(action: "pairing-host-defaults", args: [:], completion: result)
        precondition(existingSession.state == stateBeforeDefaults && !existingSession.defaultsOnly)
        precondition(code == .done && !existingSession.closed)
        precondition(NSDictionary(dictionary: value as! [String: Any]).isEqual(to: ["address": NSNull(), "port": 43128, "portAvailable": NSNull()]))
        defaultsControl.reply("unavailable")
        existingSession.perform(action: "pairing-host-defaults", args: [:], completion: result)
        precondition(code == .unavailable && value == nil && !existingSession.closed && defaultsControl.closed == 0)
        let beforeDecline = defaultsControl.commands.count
        existingSession.perform(action: "pairing-host-confirm", args: ["sharing": .bool(true)], completion: result)
        precondition(code == .cancelled && defaultsControl.commands.count == beforeDecline && !existingSession.closed)
        existingSession.end()

        let cachedControl = BridgeActionFake()
        let cached = try! BridgePairingSession(factory: { cachedControl }, pollInterval: 60) { _ in }
        for (claim, address) in [(fingerprint, "100.64.0.2"), (String(repeating: "b", count: 64), "bad")] {
            cachedControl.reply("confirming", fingerprint: claim)
            cachedControl.replies.append(.success(TLSSetupReply(id: 1, status: "confirming", invitation: nil, peerCertificateSha256: nil, peerAddress: address)))
            cached.poll()
            precondition(cached.peerAddress == (address == "bad" ? nil : address))
        }
        let admission = BridgeAdmission(modalOpen: { true }) { (true, true) }
        admission.dialogOpen = true
        let document = UUID()
        cachedControl.delay = true
        cached.perform(action: "pairing-join-confirm", args: ["sharing": .bool(false)]) { _, _ in }
        let beforeCached = cachedControl.commands.count
        admission.submit(id: 1, action: "pairing-peer-address", document: document, run: { done in
            cached.perform(action: "pairing-peer-address", args: [:], completion: done)
        }, reply: { result in
            precondition(result.code == .done && (result.value as! [String: Any])["peerAddress"] is NSNull)
        })
        precondition(cachedControl.commands.count == beforeCached)
        cached.end()
        precondition(cached.peerAddress == nil)

        let identity = BridgeActionFake()
        let creating = try! BridgePairingSession(factory: { identity }, pollInterval: 60) { _ in }
        identity.reply("identity-ready")
        creating.perform(action: "pairing-identity-create", args: [:], identityOnly: true, completion: result)
        precondition(code == .done && creating.closed && identity.closed == 1)
        precondition(NSDictionary(dictionary: identity.commands.last!).isEqual(to: ["action": "identity-create", "storage": "restricted-file", "identity": NSNull()]))

        let cancel = BridgeActionFake()
        let cancelling = try! BridgePairingSession(factory: { cancel }, pollInterval: 60) { _ in }
        cancel.reply("identity-ready")
        cancel.reply("hosting", invitation: invitation)
        cancelling.perform(action: "pairing-host-start", args: ["address": .string("10.0.0.1"), "port": .integer(43128)], completion: result)
        cancel.delay = true
        var commandFinished = false
        cancelling.perform(action: "pairing-host-confirm", args: ["sharing": .bool(false)]) { code, _ in
            precondition(code == .unavailable); commandFinished = true
        }
        let beforePoll = cancel.commands.count
        cancelling.poll(); precondition(cancel.commands.count == beforePoll)
        cancelling.perform(action: "pairing-cancel", args: [:], completion: result)
        precondition(NSDictionary(dictionary: cancel.commands.last!).isEqual(to: ["action": "cancel"]))
        cancel.deferred.last?(.failure(CocoaError(.fileReadUnknown)))
        precondition(code == .done && cancelling.closed && cancelling.invitation == nil && commandFinished)
        cancel.deferred.first?(.success(TLSSetupReply(id: 1, status: "configuration-ready", invitation: nil, peerCertificateSha256: nil)))
        precondition(cancel.closed == 1)

        let pollFailure = BridgeActionFake()
        let polling = try! BridgePairingSession(factory: { pollFailure }, pollInterval: 60) { _ in }
        pollFailure.replies.append(.failure(CocoaError(.fileReadUnknown)))
        polling.poll(); precondition(polling.closed)
        let pollDone = BridgeActionFake()
        let finishing = try! BridgePairingSession(factory: { pollDone }, pollInterval: 60) { _ in }
        pollDone.reply("acknowledged"); finishing.poll(); precondition(finishing.closed)

        for status in ["inactive", "cancelled"] {
            let control = BridgeActionFake()
            var stopped = false
            let polling = try! BridgePairingSession(factory: { control }, pollInterval: 60) { stopped = $0 }
            control.reply("identity-ready")
            control.reply("hosting", invitation: invitation)
            polling.perform(action: "pairing-host-start", args: ["address": .string("10.0.0.1"), "port": .integer(43128)], completion: result)
            precondition(polling.invitation == invitation)
            control.reply(status)
            polling.poll()
            precondition(polling.closed && polling.invitation == nil && stopped && control.closed == 1)
        }

        let expired = BridgeActionFake()
        let expiring = try! BridgePairingSession(factory: { expired }, pollInterval: 60, limit: 0.01) { _ in }
        let deadline = Date().addingTimeInterval(1)
        while !expiring.closed && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.005)) }
        precondition(expiring.closed && expired.closed == 1)

        let keys = ["NODE_OPTIONS", "OPENSSL_CONF", "NODE_TLS_REJECT_UNAUTHORIZED", "UV_THREADPOOL_SIZE", "DYLD_INSERT_LIBRARIES", "NODE_PATH"]
        let original = ProcessInfo.processInfo.environment
        do {
            for key in keys { setenv(key, "synthetic", 1) }
            defer {
                for key in keys {
                    if let value = original[key] { setenv(key, value, 1) } else { unsetenv(key) }
                }
            }
            let environment = bridgeChildEnvironment()
            for key in keys { precondition(environment[key] == nil) }
            precondition(environment["PATH"] == "/usr/bin:/bin:/usr/sbin:/sbin")
            precondition(Set(environment.keys).isSubset(of: ["PATH", "HOME", "USER", "LOGNAME", "LANG", "TMPDIR"]))
        }

        let runtime = FileManager.default.temporaryDirectory.appendingPathComponent("observatory-bridge-actions-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: runtime) }
        try! FileManager.default.createDirectory(at: runtime, withIntermediateDirectories: true)
        let hooks = MacBridgeHooks(openDashboard: { _ in preconditionFailure() }, checkForUpdates: { preconditionFailure() },
            directPairingOpen: { preconditionFailure() }, applyViewerPreferences: { _, _ in preconditionFailure() })
        let store = ObservatoryStore(runtime: runtime, collectionAllowed: false)
        for (preview, isolated) in [(true, false), (false, true)] {
            let host = MacBridgeHost(store: store, resources: nil, preview: preview, handler: BridgeHandler(), hooks: hooks, isolatedRuntime: isolated)
            for action in ["pairing-host-defaults", "pairing-peer-address", "set-sharing-choice"] {
                var answered = false
                host.perform(action: action, args: ["enabled": .bool(true)]) { code, value in
                    precondition(code == .unavailable && value == nil)
                    answered = true
                }
                precondition(answered && !host.sessionOpen)
            }
        }
        let host = MacBridgeHost(store: store, resources: nil, preview: false, handler: BridgeHandler(), hooks: hooks)
        host.perform(action: "pairing-peer-address", args: [:]) { code, value in
            precondition(code == .done && (value as! [String: Any])["peerAddress"] is NSNull)
        }
        precondition(bridgePairingFiles(runtime: runtime) == ("unpaired", "none"))
        precondition(bridgeReportedPairingState(sessionState: "waiting", maintenance: false, identityState: nil, paused: false,
            fileState: "active-sync", fallback: "paired") == "waiting")
        precondition(bridgeReportedPairingState(sessionState: nil, maintenance: true, identityState: nil, paused: false,
            fileState: "active-sync", fallback: "paired") == "paired")
        precondition(bridgeReportedPairingState(sessionState: nil, maintenance: false, identityState: nil, paused: false,
            fileState: "active-sync", fallback: "paired") == "active-sync")
        precondition(bridgeReportedPairingState(sessionState: nil, maintenance: false, identityState: nil, paused: false,
            fileState: "unavailable", fallback: "paired") == "paired")
        let now = Date()
        let statusFile = runtime.appendingPathComponent("pairing-status.json")
        func putStatus(_ state: String, offset: TimeInterval = 0, extra: Bool = false) {
            var object: [String: Any] = ["version": 1, "state": state,
                "checkedAt": ISO8601DateFormatter().string(from: now.addingTimeInterval(offset))]
            if extra { object["extra"] = true }
            try! JSONSerialization.data(withJSONObject: object).write(to: statusFile)
            precondition(chmod(statusFile.path, 0o600) == 0)
        }
        let pairingHooks = MacBridgeHooks(openDashboard: { _ in preconditionFailure() }, checkForUpdates: { preconditionFailure() },
            directPairingOpen: { false }, applyViewerPreferences: { _, _ in preconditionFailure() })
        for status in ["identity-required", "identity-recovery-required"] {
            for action in ["pairing-host-start", "pairing-join-claim"] {
                var controls: [BridgeActionFake] = []
                var queuedReplies: [Result<TLSSetupReply, Error>] = []
                let pairingHost = MacBridgeHost(store: store, resources: nil, preview: false, handler: BridgeHandler(), hooks: pairingHooks,
                    pairingControl: {
                        let control = BridgeActionFake()
                        control.replies = queuedReplies
                        queuedReplies.removeAll()
                        controls.append(control)
                        return control
                    })
                let args: [String: BridgeValue] = action == "pairing-host-start"
                    ? ["address": .string("10.0.0.1"), "port": .integer(43128)]
                    : ["invitation": .string(invitation)]
                @MainActor func perform(_ action: String, args: [String: BridgeValue] = [:], expected: BridgeCode) {
                    var answered = false
                    pairingHost.perform(action: action, args: args) { code, _ in
                        precondition(!answered && code == expected)
                        answered = true
                    }
                    precondition(answered)
                }
                queuedReplies = [.success(TLSSetupReply(id: 1, status: status, invitation: nil, peerCertificateSha256: nil))]
                perform(action, args: args, expected: .unavailable)
                precondition(!pairingHost.sessionOpen && controls.count == 1)
                precondition(controls[0].commands.count == 1 && NSDictionary(dictionary: controls[0].commands[0]).isEqual(to: ["action": "identity-status"]))
                precondition(pairingHost.reportedPairing == (status, "none"))
                putStatus("active-sync")
                precondition(bridgePairingStatus(runtime: runtime) == "active-sync")
                precondition(pairingHost.reportedPairing.state == status)
                try! FileManager.default.removeItem(at: statusFile)
                perform("pairing-cancel", expected: .done)
                precondition(pairingHost.reportedPairing.state == status)
                queuedReplies = [.success(TLSSetupReply(id: 1, status: "ready", invitation: nil, peerCertificateSha256: nil, address: nil, port: 43128, portAvailable: nil))]
                perform("pairing-host-defaults", expected: .done)
                precondition(!pairingHost.sessionOpen && pairingHost.reportedPairing.state == status)
                queuedReplies = [
                    .success(TLSSetupReply(id: 1, status: "identity-ready", invitation: nil, peerCertificateSha256: nil)),
                    .success(TLSSetupReply(id: 2, status: action == "pairing-host-start" ? "hosting" : "awaiting-confirmation",
                        invitation: action == "pairing-host-start" ? invitation : nil, peerCertificateSha256: nil))
                ]
                perform(action, args: args, expected: .done)
                precondition(pairingHost.sessionOpen && controls.count == 3)
                controls[2].reply("cancelled")
                perform("pairing-cancel", expected: .done)
                precondition(pairingHost.reportedPairing.state == bridgePairingFiles(runtime: runtime).state)
                precondition(pairingHost.reportedPairing.state == "unpaired")
                precondition(!pairingHost.sessionOpen && !store.pairingMaintenance && !store.collectionPausedForPairing)
                precondition(controls.allSatisfy { $0.closed == 1 && $0.replies.isEmpty })
            }
        }
        precondition(bridgePairingStatus(runtime: runtime, now: now) == "unavailable")
        for state in ["unpaired", "revoked", "establishing-trust", "active-sync", "sync-stale", "unavailable"] {
            putStatus(state)
            precondition(bridgePairingStatus(runtime: runtime, now: now) == state)
            precondition(bridgeStoredPairingState(runtime: runtime, fallback: "paired") == (state == "unavailable" ? "paired" : state))
        }
        for offset: TimeInterval in [-121, 62] {
            putStatus("active-sync", offset: offset)
            precondition(bridgePairingStatus(runtime: runtime, now: now) == "unavailable")
        }
        putStatus("active-sync", extra: true)
        precondition(bridgePairingStatus(runtime: runtime, now: now) == "unavailable")
        try! Data(repeating: 32, count: 2000).write(to: statusFile)
        precondition(bridgePairingStatus(runtime: runtime, now: now) == "unavailable")
        putStatus("active-sync")
        precondition(chmod(statusFile.path, 0o644) == 0)
        precondition(bridgePairingStatus(runtime: runtime, now: now) == "unavailable")
        precondition(chmod(statusFile.path, 0o600) == 0)
        let linkedRuntime = runtime.appendingPathComponent("linked")
        try! FileManager.default.createDirectory(at: linkedRuntime, withIntermediateDirectories: true)
        try! FileManager.default.createSymbolicLink(at: linkedRuntime.appendingPathComponent("pairing-status.json"), withDestinationURL: statusFile)
        precondition(bridgePairingStatus(runtime: linkedRuntime, now: now) == "unavailable")
        let hardLink = runtime.appendingPathComponent("hard-link")
        precondition(link(statusFile.path, hardLink.path) == 0)
        precondition(bridgePairingStatus(runtime: runtime, now: now) == "unavailable")
        for text in [
            #"{"version":1,"chosen":true,"channels":{"codex-limits":"on","claude-code-tokens":"waiting-for-reading"}}"#,
            #"{"version":1,"chosen":false,"channels":{"codex-limits":"off","claude-code-tokens":"unavailable"}}"#
        ] { precondition((try? BridgeSharingChoice.parse(Data(text.utf8))) != nil) }
        for text in [
            #"{"version":true,"chosen":true,"channels":{"codex-limits":"on","claude-code-tokens":"off"}}"#,
            #"{"version":1,"chosen":1,"channels":{"codex-limits":"on","claude-code-tokens":"off"}}"#,
            #"{"version":1,"chosen":true,"channels":{"codex-limits":"on"}}"#,
            #"{"version":1,"chosen":true,"channels":{"codex-limits":"bad","claude-code-tokens":"off"}}"#,
            #"{"version":1,"chosen":true,"extra":0,"channels":{"codex-limits":"on","claude-code-tokens":"off"}}"#
        ] { precondition((try? BridgeSharingChoice.parse(Data(text.utf8))) == nil) }
        let folder = runtime.appendingPathComponent("private-sync")
        try! FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false)
        try! Data().write(to: folder.appendingPathComponent("pairing.json"))
        precondition(bridgePairingFiles(runtime: runtime) == ("paired", "ssh"))
        try! Data().write(to: folder.appendingPathComponent("tls-trust.json"))
        precondition(bridgePairingFiles(runtime: runtime) == ("paired", "tls"))
        try! Data().write(to: folder.appendingPathComponent("revoked"))
        precondition(bridgePairingFiles(runtime: runtime) == ("unpaired", "none"))
        precondition((try? bridgeSwitchConsent(Data(#"{"given":true,"consentMarker":false,"statusLine":true}"#.utf8))) == false)
        precondition((try? bridgeSwitchConsent(Data(#"{"given":true,"consentMarker":true,"statusLine":false}"#.utf8))) == true)
        precondition((try? bridgeSwitchConsent(Data(#"{"given":true,"consentMarker":true,"statusLine":true}"#.utf8))) == true)
        precondition((try? bridgeSwitchConsent(Data(#"{"given":false,"consentMarker":false,"statusLine":false}"#.utf8))) == false)
        precondition((try? bridgeSwitchConsent(Data(#"{"given":1,"consentMarker":false,"statusLine":true}"#.utf8))) == nil)
        precondition((try? bridgeSwitchConsent(Data(#"{"given":true,"consentMarker":"yes","statusLine":false}"#.utf8))) == nil)
        precondition((try? bridgeSwitchConsent(Data(#"{"given":true,"consentMarker":true}"#.utf8))) == nil)
        precondition((try? bridgeSwitchConsent(Data(#"{"given":true,"consentMarker":true,"statusLine":false,"extra":true}"#.utf8))) == nil)
        precondition((try? BridgePairingSession(factory: { throw CocoaError(.fileReadUnknown) }, ended: { _ in preconditionFailure() })) == nil)
        var cacheFinished = false
        Task { @MainActor in
            let cache = BridgeCache<Int>()
            var reads = 0
            func fetch() async -> Int? { reads += 1; await Task.yield(); return 7 }
            async let first = cache.read { await fetch() }
            async let second = cache.read { await fetch() }
            let values = await (first, second)
            precondition(values.0 == 7 && values.1 == 7 && reads == 1)
            let cached = await cache.read { reads += 1; return 8 }
            precondition(cached == 7 && reads == 1)
            cache.set(nil)
            let failed = await cache.read { reads += 1; return 8 }
            precondition(failed == nil && reads == 1)
            let updating = BridgeCache<Int>()
            let old = Task { await updating.read { await Task.yield(); updating.set(9); return 7 } }
            let updated = await old.value
            precondition(updated == 9)
            let racing = BridgeCache<Int>()
            var release: CheckedContinuation<Int?, Never>?
            let initial = Task { await racing.read { await withCheckedContinuation { release = $0 } } }
            while release == nil { await Task.yield() }
            racing.set(9)
            let late = Task { await racing.read { preconditionFailure() } }
            await Task.yield()
            release?.resume(returning: 7)
            let raced = await (initial.value, late.value)
            precondition(raced.0 == 9 && raced.1 == 9)
            cacheFinished = true
        }
        let cacheDeadline = Date().addingTimeInterval(2)
        while !cacheFinished && Date() < cacheDeadline { RunLoop.main.run(until: Date().addingTimeInterval(0.005)) }
        precondition(cacheFinished)
        print("Bridge action self-tests passed")
    }
}
