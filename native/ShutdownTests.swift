import AppKit
import Foundation
import Combine

@MainActor
func testShutdownDrain() async throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("observatory-shutdown-" + UUID().uuidString)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
    defer { try? FileManager.default.removeItem(at: root) }
    let store = ObservatoryStore(runtime: root, collectionAllowed: false)
    var pauseChanges: [Bool] = []
    let pauseSubscription = store.$collectionPausedForPairing.sink { pauseChanges.append($0) }
    store.snapshot = Snapshot(object: ["schema": 2, "collectedAt": "2026-09-15T00:00:00Z"])
    precondition(store.pairingPauseMessage == nil)
    store.collectionPausedForPairing = true
    store.refresh()
    precondition(store.lastAttempt == "pairing-paused" && !store.refreshing)
    precondition(store.pairingPauseMessage?.contains("Saved snapshot unchanged") == true)
    precondition(text(store.snapshot?.object["collectedAt"]) == "2026-09-15T00:00:00Z")
    store.collectionPausedForPairing = false
    precondition(store.pairingPauseMessage == nil)
    precondition(pauseChanges == [false, true, false])
    pauseSubscription.cancel()
    let reopened = ObservatoryStore(runtime: root, collectionAllowed: false)
    precondition(!reopened.collectionPausedForPairing && reopened.pairingPauseMessage == nil)
    store.pairingMaintenance = true
    let before = store.lastAttempt
    let wait = Task { @MainActor in await store.drainForQuit(timeout: 1) }
    try await Task.sleep(nanoseconds: 100_000_000)
    precondition(store.shuttingDown)
    store.refresh()
    precondition(store.lastAttempt == before)
    store.pairingMaintenance = false
    let complete = await wait.value
    precondition(complete && store.shuttingDown)

    let other = ObservatoryStore(runtime: root, collectionAllowed: false)
    other.pairingMaintenance = true
    let timedOut = await other.drainForQuit(timeout: 0.05)
    precondition(!timedOut && !other.shuttingDown && other.pairingMaintenance)
    other.pairingMaintenance = false
    let retry = await other.drainForQuit(timeout: 1)
    precondition(retry && other.shuttingDown)
    let healthRoot = root.appendingPathComponent("health")
    let pending = ObservatoryStore(runtime: healthRoot)
    let current = Snapshot(object: ["schema": 2, "collectedAt": "2026-09-17T12:00:00Z",
                                    "tokens": [["status": "ok"]]])
    pending.now = parseDate("2026-09-17T12:00:01Z")!; pending.snapshot = current
    precondition(pending.collectionBlockReason == "Setup required" && !pending.sourceHealthIsCurrent)
    try FirstRunSetup.complete(sources: Dictionary(uniqueKeysWithValues: CollectorConfiguration.defaults.keys.map { ($0, false) }), runtime: healthRoot)
    let health = ObservatoryStore(runtime: healthRoot)
    health.now = pending.now; health.snapshot = current
    precondition(health.sourceHealthIsCurrent)
    health.collectionPausedForPairing = true; precondition(!health.sourceHealthIsCurrent)
    health.collectionPausedForPairing = false; health.pairingMaintenance = true
    precondition(!health.sourceHealthIsCurrent)
    health.pairingMaintenance = false; health.now = health.now.addingTimeInterval(901)
    precondition(!health.sourceHealthIsCurrent)
    health.now = parseDate("2026-09-17T11:59:59Z")!; precondition(!health.sourceHealthIsCurrent)
    health.now = pending.now; health.snapshot = Snapshot(object: ["schema": 2, "collectedAt": "2026-09-17T12:00:00Z"])
    precondition(!health.sourceHealthIsCurrent)
    let disabled = ObservatoryStore(runtime: healthRoot, collectionAllowed: false)
    disabled.now = pending.now; disabled.snapshot = current
    precondition(disabled.collectionBlockReason == "Collection disabled" && !disabled.sourceHealthIsCurrent)
    testModalChildDrain(root: root)
}

@MainActor
private func testModalChildDrain(root: URL) {
    // Exercise the production child completion path while only the modal loop runs.
    let collecting = ObservatoryStore(runtime: root, collectionAllowed: false)
    let child = Process()
    child.executableURL = URL(fileURLWithPath: "/bin/sleep")
    child.arguments = ["0.2"]
    collecting.startCollection(child)
    precondition(collecting.refreshing && child.isRunning)
    var drained: Bool?
    collecting.drainForQuit(timeout: 2) { drained = $0 }
    precondition(drained == nil && collecting.shuttingDown)
    let deadline = Date().addingTimeInterval(3)
    while drained == nil && Date() < deadline {
        RunLoop.main.run(mode: .modalPanel, before: Date().addingTimeInterval(0.05))
    }
    precondition(drained == true && !collecting.refreshing && !child.isRunning)
}
