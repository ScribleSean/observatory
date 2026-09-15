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
