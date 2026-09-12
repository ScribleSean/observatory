import Foundation
import Darwin

enum PairingMaintenance {
    static func disconnect(runtime: URL, resources: URL) async throws {
        try await Task.detached(priority: .userInitiated) {
            try runDisconnect(runtime: runtime, resources: resources)
        }.value
    }

    // Run off the main actor. Only the bundled CLI owns private-state writes.
    static func runDisconnect(runtime: URL, resources: URL) throws {
        try runOperation(runtime: runtime, resources: resources, repair: false)
    }

    static func prepareRepair(runtime: URL, resources: URL) async throws {
        try await Task.detached(priority: .userInitiated) {
            try runPrepareRepair(runtime: runtime, resources: resources)
        }.value
    }

    static func runPrepareRepair(runtime: URL, resources: URL) throws {
        try runOperation(runtime: runtime, resources: resources, repair: true)
    }

    private static func runOperation(runtime: URL, resources: URL, repair: Bool) throws {
        let values = try runtime.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        guard values.isDirectory == true, values.isSymbolicLink != true else { throw CocoaError(.fileWriteNoPermission) }
        let node = resources.appendingPathComponent("Runtime/node/bin/node")
        let script = resources.appendingPathComponent(repair ? "Collector/scripts/peer-repair.mjs" : "Collector/scripts/peer-revocation.mjs")
        guard FileManager.default.isExecutableFile(atPath: node.path),
              FileManager.default.fileExists(atPath: script.path) else { throw CocoaError(.fileReadNoSuchFile) }
        // Foundation rewrites /private/var to /var even after resolving links.
        // The private-state validator requires the filesystem's real path.
        guard let resolved = realpath(runtime.path, nil) else { throw CocoaError(.fileReadNoSuchFile) }
        defer { free(resolved) }
        let canonicalRuntime = String(cString: resolved)
        let process = Process()
        process.executableURL = node
        process.arguments = [script.path, "--runtime", canonicalRuntime, repair ? "--confirm-local-retirement" : "--revoke"]
        process.currentDirectoryURL = runtime
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run()
        let timeout = DispatchWorkItem {
            // Terminate only this owned process. The CLI starts no Mac helpers.
            if process.isRunning { kill(process.processIdentifier, SIGKILL) }
        }
        DispatchQueue.global().asyncAfter(deadline: .now() + 20, execute: timeout)
        process.waitUntilExit()
        timeout.cancel()
        guard process.terminationReason == .exit, process.terminationStatus == 0 else {
            throw CocoaError(.fileWriteUnknown)
        }
    }
}
