import AppKit
import Combine
import Foundation

@MainActor
final class ObservatoryStore: ObservableObject {
    @Published var snapshot: Snapshot?
    @Published var refreshing = false
    @Published private(set) var shuttingDown = false
    @Published var lastAttempt = ""
    @Published var now = Date()
    let runtime: URL
    let collectionAllowed: Bool
    private(set) var localCollection = false
    private(set) var setupRequired = false
    @Published var pairingMaintenance = false
    @Published var collectionPausedForPairing = false
    var pairingPauseMessage: String? {
        collectionPausedForPairing ? "Collection paused for this app session. Saved snapshot unchanged. Retry pairing, disconnect or repair in Settings, or quit and reopen Observatory." : nil
    }
    private var process: Process?
    private var trustedSync: TrustedSyncProcess?
    private var pollTimer: Timer?
    private var refreshTimer: Timer?
    private var nextAllowanceAttemptUptime: TimeInterval = 0
    var onSnapshot: (() -> Void)?

    init(runtime: URL, collectionAllowed: Bool = true) {
        self.runtime = runtime
        self.collectionAllowed = collectionAllowed
        do {
            setupRequired = try FirstRunSetup.prepare(runtime: runtime)
            localCollection = try CollectorConfiguration.prepare(runtime: runtime)
        }
        catch { setupRequired = true; lastAttempt = "configuration-unavailable" }
        reload()
    }

    func start() {
        ensureTrustedSync()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.ensureTrustedSync(); self?.reload(); self?.refreshAllowancesIfDue() }
        }
        pollTimer?.tolerance = 5
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.refresh() }
        }
        refreshTimer?.tolerance = 30
        NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification,
            object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.refresh() }
        }
        if snapshot?.collectedAt.map({ Date().timeIntervalSince($0) < 300 }) != true { refresh() }
    }

    var freshness: String {
        guard let date = snapshot?.collectedAt else { return "Waiting for first snapshot" }
        let minutes = max(0, Int(now.timeIntervalSince(date) / 60))
        if minutes < 1 { return "Updated just now" }
        if minutes < 60 { return "Updated \(minutes)m ago" }
        return "Updated \(minutes / 60)h ago"
    }
    var stale: Bool { snapshot?.collectedAt.map { now.timeIntervalSince($0) > 900 } ?? true }

    func reload() {
        now = Date()
        if let object = readObject(runtime.appendingPathComponent("public/local/usage.json")),
           number(object["schema"]) == 2, parseDate(object["collectedAt"]) != nil {
            snapshot = Snapshot(object: object)
            onSnapshot?()
        }
        let status = readObject(runtime.appendingPathComponent("public/local/collector.json"))
        lastAttempt = text(status?["state"], fallback: "not-started")
    }

    func refreshAllowancesIfDue() {
        guard collectionAllowed, !shuttingDown, process == nil, !pairingMaintenance, !collectionPausedForPairing,
              ProcessInfo.processInfo.systemUptime >= nextAllowanceAttemptUptime,
              (try? CollectorConfiguration.read(runtime: runtime)["quota"]) == true,
              allowanceRefreshDue(snapshot?.object["quota"] as? JSONObject, now: Date()) else { return }
        nextAllowanceAttemptUptime = ProcessInfo.processInfo.systemUptime + 60
        refresh(quotaOnly: true)
    }

    func refresh(quotaOnly: Bool = false) {
        guard !shuttingDown else { return }
        guard !collectionPausedForPairing else { lastAttempt = "pairing-paused"; return }
        guard collectionAllowed else { lastAttempt = "preview-collection-disabled"; return }
        guard (try? FirstRunSetup.required(runtime: runtime)) == false else { lastAttempt = "setup-required"; return }
        guard process == nil, !pairingMaintenance else { return }
        ensureTrustedSync()
        guard let resources = Bundle.main.resourceURL,
              let local = try? CollectorConfiguration.prepare(runtime: runtime),
              let launch = try? CollectorConfiguration.launch(runtime: runtime, resources: resources, local: local, quotaOnly: quotaOnly) else {
            lastAttempt = "runtime-unavailable"
            return
        }
        localCollection = local
        let task = Process()
        task.executableURL = launch.executable
        task.arguments = launch.arguments
        task.currentDirectoryURL = runtime
        startCollection(task)
    }

    private func ensureTrustedSync() {
        guard !shuttingDown else { return }
        guard collectionAllowed, !pairingMaintenance, !collectionPausedForPairing,
              (try? FirstRunSetup.required(runtime: runtime)) == false,
              FileManager.default.fileExists(atPath: runtime.appendingPathComponent("private-sync/tls-trust.json").path),
              let resources = Bundle.main.resourceURL else { trustedSync?.requestStop(); return }
        if trustedSync == nil { trustedSync = TrustedSyncProcess(runtime: runtime, resources: resources) }
        trustedSync?.resume()
        trustedSync?.ensureStarted()
    }

    func startCollection(_ task: Process) {
        guard !shuttingDown, process == nil else { return }
        task.standardOutput = FileHandle.nullDevice
        task.standardError = FileHandle.nullDevice
        task.terminationHandler = { [weak self] _ in
            guard let self else { return }
            RunLoop.main.perform(inModes: [.default, .modalPanel, .eventTracking]) {
                MainActor.assumeIsolated {
                    self.process = nil
                    self.refreshing = false
                    self.reload()
                }
            }
        }
        do {
            try task.run()
            process = task
            refreshing = true
        } catch { lastAttempt = "failed" }
    }

    func drainForQuit(timeout: TimeInterval = 260, completion: @escaping (Bool) -> Void) {
        guard timeout > 0, timeout <= 300, !shuttingDown else { completion(false); return }
        shuttingDown = true
        trustedSync?.requestStop()
        let deadline = ProcessInfo.processInfo.systemUptime + timeout
        let timer = Timer(timeInterval: 0.05, repeats: true) { [weak self] timer in
            MainActor.assumeIsolated {
                guard let self else { timer.invalidate(); completion(false); return }
                if self.process == nil && !self.refreshing && !self.pairingMaintenance && self.trustedSync?.running != true {
                    timer.invalidate()
                    completion(true)
                } else if ProcessInfo.processInfo.systemUptime >= deadline {
                    timer.invalidate()
                    self.shuttingDown = false
                    self.trustedSync?.resume()
                    completion(false)
                }
            }
        }
        // AppKit delayed termination uses its modal run loop, not only the main queue.
        RunLoop.main.add(timer, forMode: .common)
        RunLoop.main.add(timer, forMode: .modalPanel)
    }

    func drainForQuit(timeout: TimeInterval) async -> Bool {
        await withCheckedContinuation { continuation in
            drainForQuit(timeout: timeout) { continuation.resume(returning: $0) }
        }
    }

    func stop() {
        trustedSync?.requestStop()
        pollTimer?.invalidate()
        refreshTimer?.invalidate()
        // The runner catches termination and stops only its own collection process group.
        process?.terminate()
    }
}

func allowanceRefreshDue(_ quota: JSONObject?, now: Date) -> Bool {
    guard let deadline = parseDate(quota?["nextAttemptAt"]) else { return false }
    return deadline <= now
}
