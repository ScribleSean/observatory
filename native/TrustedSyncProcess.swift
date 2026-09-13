import Foundation
import Darwin

// The app owns stdin. EOF requests a drain without interrupting record writes.
@MainActor
final class TrustedSyncProcess {
    private let runtime: URL, node: URL, script: URL
    private var process: Process?
    private var input: Pipe?
    private var stopping = false
    var running: Bool { process?.isRunning == true }

    convenience init(runtime: URL, resources: URL) {
        self.init(runtime: runtime, node: resources.appendingPathComponent("Runtime/node/bin/node"),
                  script: resources.appendingPathComponent("Collector/scripts/peer-tls-service.mjs"))
    }
    init(runtime: URL, node: URL, script: URL) { self.runtime = runtime; self.node = node; self.script = script }

    func ensureStarted() {
        guard !stopping, !running, runtime.isFileURL, node.isFileURL, script.isFileURL,
              FileManager.default.isExecutableFile(atPath: node.path),
              FileManager.default.fileExists(atPath: script.path),
              let resolved = realpath(runtime.path, nil) else { return }
        defer { free(resolved) }
        let canonicalRuntime = String(cString: resolved)
        try? input?.fileHandleForWriting.close()
        input = nil; process = nil
        let pipe = Pipe(), child = Process()
        child.executableURL = node
        child.arguments = [script.path, "--runtime", canonicalRuntime]
        child.currentDirectoryURL = URL(fileURLWithPath: canonicalRuntime, isDirectory: true)
        var environment = ProcessInfo.processInfo.environment
        for key in ["NODE_OPTIONS", "NODE_EXTRA_CA_CERTS", "NODE_PATH"] { environment.removeValue(forKey: key) }
        child.environment = environment
        child.standardInput = pipe
        child.standardOutput = FileHandle.nullDevice
        child.standardError = FileHandle.nullDevice
        do { try child.run(); process = child; input = pipe }
        catch { try? pipe.fileHandleForWriting.close() }
    }
    func requestStop() { stopping = true; try? input?.fileHandleForWriting.close() }
    func resume() { stopping = false }

    static func selfTest(node: URL, script: URL) async throws {
        let runtime = FileManager.default.temporaryDirectory.appendingPathComponent("observatory-native-sync-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: runtime, withIntermediateDirectories: true)
        let owner = TrustedSyncProcess(runtime: runtime, node: node, script: script)
        func waitForExit() async throws {
            owner.requestStop()
            let deadline = Date().addingTimeInterval(10)
            while owner.running && Date() < deadline { try await Task.sleep(nanoseconds: 20_000_000) }
            guard !owner.running else { throw CocoaError(.executableRuntimeMismatch) }
        }
        do {
            owner.ensureStarted()
            guard let first = owner.process?.processIdentifier, owner.running else { throw CocoaError(.executableNotLoadable) }
            try await Task.sleep(nanoseconds: 250_000_000)
            guard owner.running else { throw CocoaError(.executableRuntimeMismatch) }
            owner.ensureStarted()
            guard owner.process?.processIdentifier == first else { throw CocoaError(.executableRuntimeMismatch) }
            try await waitForExit()
            owner.ensureStarted()
            guard !owner.running else { throw CocoaError(.executableRuntimeMismatch) }
            owner.resume(); owner.ensureStarted()
            guard owner.running else { throw CocoaError(.executableNotLoadable) }
            try await waitForExit(); try await waitForExit()
            let slowScript = runtime.appendingPathComponent("slow-exit.mjs")
            try "setTimeout(() => process.exit(0), 750);\n".write(to: slowScript, atomically: true, encoding: .utf8)
            let slow = TrustedSyncProcess(runtime: runtime, node: node, script: slowScript)
            slow.ensureStarted()
            let slowID = slow.process?.processIdentifier
            slow.requestStop()
            try await Task.sleep(nanoseconds: 50_000_000)
            let remainedRunning = slow.running
            slow.resume(); slow.ensureStarted()
            let sameOwner = slow.process?.processIdentifier == slowID
            slow.requestStop()
            let deadline = Date().addingTimeInterval(10)
            while slow.running && Date() < deadline { try await Task.sleep(nanoseconds: 20_000_000) }
            guard !slow.running, remainedRunning, sameOwner else { throw CocoaError(.executableRuntimeMismatch) }
            guard !FileManager.default.fileExists(atPath: runtime.appendingPathComponent("private-device-identity").path) else {
                throw CocoaError(.fileWriteUnknown)
            }
            try FileManager.default.removeItem(at: runtime)
        } catch {
            try await waitForExit()
            try? FileManager.default.removeItem(at: runtime)
            throw error
        }
        print("Native sync owner launch, exclusion, graceful exit and restart passed.")
    }
}
