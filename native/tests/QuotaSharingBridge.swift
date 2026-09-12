import Foundation

// Run with an explicit test Resources directory containing the bundled Node
// layout and Collector/scripts. Always creates its own empty temporary runtime.
@main
struct QuotaSharingBridgeTest {
    static func main() async throws {
        guard CommandLine.arguments.count == 2, CommandLine.arguments[1].hasPrefix("/") else {
            throw CocoaError(.fileReadCorruptFile)
        }
        let resources = URL(fileURLWithPath: CommandLine.arguments[1])
        let runtime = FileManager.default.temporaryDirectory.appendingPathComponent("observatory-sharing-bridge-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: runtime, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: runtime) }
        let status = try await QuotaSharing.run(runtime: runtime, resources: resources, action: "status", token: nil)
        precondition(!status.enabled && !status.canEnable && status.reason == "pairing-unavailable")
        let disabled = try await QuotaSharing.run(runtime: runtime, resources: resources, action: "disable", token: nil)
        precondition(!disabled.enabled)
        precondition(!FileManager.default.fileExists(atPath: runtime.appendingPathComponent("private-quota").path))
        do {
            _ = try await QuotaSharing.run(runtime: runtime, resources: resources, action: "enable", token: String(repeating: "a", count: 64))
            preconditionFailure("Unpaired sharing was enabled")
        } catch { }
        print("Native Mac sharing bridge passed with isolated data")
    }
}
