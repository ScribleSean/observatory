import Foundation
import Darwin

enum TailscaleReadiness {
    private struct Response: Decodable {
        let version: Int
        let status: String
        let peerReachability: String
    }
    static let messages = [
        "not-installed": "Tailscale was not found. Install it only if you want the optional VPN connection path.",
        "needs-login": "Sign in through Tailscale, then check again.",
        "needs-device-approval": "This device needs approval from its Tailscale network administrator.",
        "stopped": "Tailscale is stopped. Connect through Tailscale, then check again.",
        "starting": "Tailscale is starting. Check again shortly.",
        "other-user": "Tailscale is in use by another system user.",
        "running": "Tailscale is running. Observatory peer reachability has not been checked.",
        "offline": "Tailscale reports this device offline. Check its connection.",
        "unavailable": "Tailscale status could not be read. No network settings were changed.",
        "unsupported": "This platform is not supported by the readiness check."
    ]

    static func parse(_ data: Data) throws -> String {
        messages[try status(data)]!
    }

    static func status(_ data: Data) throws -> String {
        guard data.count <= 4096,
              let value = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(value.keys) == Set(["version", "status", "peerReachability"]) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        let response = try JSONDecoder().decode(Response.self, from: data)
        guard response.version == 1, response.peerReachability == "not-checked", messages[response.status] != nil else {
            throw CocoaError(.fileReadCorruptFile)
        }
        return response.status
    }

    static func read(resources: URL) async throws -> String {
        messages[try await readStatus(resources: resources)]!
    }

    static func readStatus(resources: URL) async throws -> String {
        try await Task.detached(priority: .utility) {
            let node = resources.appendingPathComponent("Runtime/node/bin/node")
            let script = resources.appendingPathComponent("Collector/scripts/tailscale-status.mjs")
            guard FileManager.default.isExecutableFile(atPath: node.path), FileManager.default.fileExists(atPath: script.path) else {
                throw CocoaError(.fileReadNoSuchFile)
            }
            let process = Process(), output = Pipe()
            process.environment = bridgeChildEnvironment()
            process.executableURL = node
            process.arguments = [script.path]
            process.currentDirectoryURL = resources
            process.standardInput = FileHandle.nullDevice
            process.standardOutput = output
            process.standardError = FileHandle.nullDevice
            try process.run()
            let timeout = DispatchWorkItem { if process.isRunning { kill(process.processIdentifier, SIGKILL) } }
            DispatchQueue.global().asyncAfter(deadline: .now() + 12, execute: timeout)
            defer { timeout.cancel() }
            let data = output.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            guard process.terminationReason == .exit, process.terminationStatus == 0 else { throw CocoaError(.fileReadUnknown) }
            return try status(data)
        }.value
    }
}
