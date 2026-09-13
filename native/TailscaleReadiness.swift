import SwiftUI
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
        guard data.count <= 4096,
              let value = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(value.keys) == Set(["version", "status", "peerReachability"]) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        let response = try JSONDecoder().decode(Response.self, from: data)
        guard response.version == 1, response.peerReachability == "not-checked", let message = messages[response.status] else {
            throw CocoaError(.fileReadCorruptFile)
        }
        return message
    }

    static func read(resources: URL) async throws -> String {
        try await Task.detached(priority: .utility) {
            let node = resources.appendingPathComponent("Runtime/node/bin/node")
            let script = resources.appendingPathComponent("Collector/scripts/tailscale-status.mjs")
            guard FileManager.default.isExecutableFile(atPath: node.path), FileManager.default.fileExists(atPath: script.path) else {
                throw CocoaError(.fileReadNoSuchFile)
            }
            let process = Process(), output = Pipe()
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
            return try parse(data)
        }.value
    }
}

struct TailscaleReadinessView: View {
    let enabled: Bool
    @State private var checking = false
    @State private var message = "Optional VPN connection. Tailscale has not been checked."

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(message).font(.callout)
            HStack {
                Button(checking ? "Checking Tailscale…" : "Check Tailscale") {
                    checking = true
                    Task { @MainActor in
                        defer { checking = false }
                        do {
                            guard let resources = Bundle.main.resourceURL else { throw CocoaError(.fileReadNoSuchFile) }
                            message = try await TailscaleReadiness.read(resources: resources)
                        } catch { message = TailscaleReadiness.messages["unavailable"]! }
                    }
                }.disabled(checking || !enabled)
                Link("Tailscale setup guide", destination: URL(string: "https://tailscale.com/docs/install")!)
                    .disabled(!enabled)
            }
            Text("Sign in through Tailscale. This check does not pair devices, enable SSH or change sharing consent. Local-network code pairing is still being developed.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }
}
