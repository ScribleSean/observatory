import Foundation
import AppKit
import Darwin

// Diagnostic fault fixtures only. The integration check uses unchanged helpers.
@main
struct PairingProcessDiagnosticsTests {
    static func main() throws {
        let files = FileManager.default
        let root = files.temporaryDirectory.appendingPathComponent("pairing-diagnostics-\(UUID().uuidString)")
        try files.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? files.removeItem(at: root) }
        let resources = root.appendingPathComponent("resources")
        let scripts = resources.appendingPathComponent("Collector/scripts")
        let bin = resources.appendingPathComponent("Runtime/node/bin")
        let runtime = root.appendingPathComponent("runtime")
        for directory in [scripts, bin, runtime] {
            try files.createDirectory(at: directory, withIntermediateDirectories: true)
        }
        try files.createSymbolicLink(at: bin.appendingPathComponent("node"),
            withDestinationURL: URL(fileURLWithPath: CommandLine.arguments[1]))
        let operations: [() throws -> Void] = [
            { _ = try PairingSetup.readStatus(runtime: runtime, resources: resources) },
            { try PairingMaintenance.runDisconnect(runtime: runtime, resources: resources) },
            { try PairingMaintenance.runPrepareRepair(runtime: runtime, resources: resources) }
        ]
        let failures: [(String, Process.TerminationReason, Int32)] = [
            ("process.kill(process.pid, 'SIGTERM');", .uncaughtSignal, SIGTERM),
            ("process.exit(23);", .exit, 23)
        ]
        for (body, reason, status) in failures {
            for script in ["peer-setup.mjs", "peer-revocation.mjs", "peer-repair.mjs"] {
                try Data(("process.stderr.write('FICTIONAL_PRIVATE_CANARY\\n'); " + body + "\n").utf8)
                    .write(to: scripts.appendingPathComponent(script))
            }
            for operation in operations {
                do {
                    try operation()
                    fatalError("Expected child failure")
                } catch {
                    let failure = error as NSError
                    precondition(failure.domain == NSCocoaErrorDomain && failure.code == 512)
                    precondition(failure.userInfo["childReason"] as? Int == reason.rawValue,
                        "Missing child termination reason")
                    precondition(failure.userInfo["childStatus"] as? Int32 == status,
                        "Missing child exit status")
                    precondition((failure.userInfo["childElapsedMilliseconds"] as? Int ?? -1) >= 0,
                        "Missing child elapsed time")
                    precondition(Set(failure.userInfo.keys) == Set(["childReason", "childStatus", "childElapsedMilliseconds"]))
                }
            }
        }
        for script in ["peer-setup.mjs", "peer-revocation.mjs", "peer-repair.mjs"] {
            try Data("process.stdout.write('{\"status\":\"unpaired\",\"request\":null}');\n".utf8)
                .write(to: scripts.appendingPathComponent(script))
        }
        for operation in operations { try operation() }
        print("pairing-diagnostics exit=0 cases=9")
        // The real packaged CLI must reject fictional wrong-type quota storage.
        // No pairing is configured. All state belongs to this fresh runtime.
        let realResources = URL(fileURLWithPath: CommandLine.arguments[2])
        let realRuntime = root.appendingPathComponent("real-runtime")
        try files.createDirectory(at: realRuntime, withIntermediateDirectories: false,
                                  attributes: [.posixPermissions: 0o700])
        let before = try PairingSetup.readStatus(runtime: realRuntime, resources: realResources)
        precondition(before.status == .unpaired && before.request == nil)
        try Data("FICTIONAL_PRIVATE_CANARY".utf8).write(to: realRuntime.appendingPathComponent("private-quota"))
        do {
            try PairingMaintenance.runDisconnect(runtime: realRuntime, resources: realResources)
            fatalError("Expected real helper refusal")
        } catch {
            let failure = error as NSError
            precondition(failure.code == 512 && failure.domain == NSCocoaErrorDomain)
            precondition(failure.userInfo["childReason"] as? Int == Process.TerminationReason.exit.rawValue)
            precondition(failure.userInfo["childStatus"] as? Int32 == 1)
            precondition((failure.userInfo["childElapsedMilliseconds"] as? Int ?? -1) >= 0)
            precondition(Set(failure.userInfo.keys) == Set(["childReason", "childStatus", "childElapsedMilliseconds"]))
        }
        precondition(files.fileExists(atPath: realRuntime.appendingPathComponent("private-sync/revoked").path))
        print("pairing-real-helper-refusal code=512 child_reason=1 child_status=1")
    }
}
