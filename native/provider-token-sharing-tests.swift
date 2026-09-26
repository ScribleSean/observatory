import Foundation

enum ProviderTokenSharingTests {
    private static func require(_ condition: Bool) throws {
        guard condition else { throw CocoaError(.fileReadCorruptFile) }
    }

    private static func status(reason: String, canEnable: Bool = false, token: Any = NSNull()) -> [String: Any] {
        ["version": 1, "enabled": false, "canEnable": canEnable, "reason": reason, "token": token]
    }

    static func parseSelfTest() throws {
        let source = try JSONSerialization.data(withJSONObject: status(reason: "source-unavailable"))
        try require(try QuotaSharingStatus.parse(source, channel: .providerTokens).reason == "source-unavailable")
        try require((try? QuotaSharingStatus.parse(source)) == nil)
        let account = try JSONSerialization.data(withJSONObject: status(reason: "account-unavailable"))
        try require(try QuotaSharingStatus.parse(account).reason == "account-unavailable")
        try require((try? QuotaSharingStatus.parse(account, channel: .providerTokens)) == nil)
        let token = String(repeating: "a", count: 64)
        let ready = status(reason: "ready", canEnable: true, token: token)
        let parsed = try QuotaSharingStatus.parse(JSONSerialization.data(withJSONObject: ready), channel: .providerTokens)
        try require(parsed.canEnable && parsed.token == token)

        var extra = ready
        extra["private"] = "must not pass"
        var missing = ready
        missing.removeValue(forKey: "token")
        var wrongVersion = ready
        wrongVersion["version"] = 2
        var wrongType = ready
        wrongType["enabled"] = "false"
        let invalid = [extra, missing, wrongVersion, wrongType,
            status(reason: "unknown"),
            status(reason: "ready", canEnable: true, token: NSNull()),
            status(reason: "source-unavailable", canEnable: true, token: token),
            status(reason: "source-unavailable", token: token),
            status(reason: "ready", canEnable: true, token: token + "\n"),
            status(reason: "ready", canEnable: true, token: String(repeating: "A", count: 64))]
        for object in invalid {
            let data = try JSONSerialization.data(withJSONObject: object)
            try require((try? QuotaSharingStatus.parse(data, channel: .providerTokens)) == nil)
        }
        try require((try? QuotaSharingStatus.parse(Data(repeating: 32, count: 4097), channel: .providerTokens)) == nil)
    }

    // The caller supplies packaged resources. All mutable data belongs to this
    // new, unpaired runtime, never the user's configured runtime.
    static func bridgeSelfTest(resources: URL) async throws {
        try parseSelfTest()
        let runtime = FileManager.default.temporaryDirectory.appendingPathComponent("observatory-provider-token-bridge-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: runtime, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: runtime) }
        let current = try await QuotaSharing.run(runtime: runtime, resources: resources, action: "status", token: nil, channel: .providerTokens)
        try require(!current.enabled && !current.canEnable && current.reason == "pairing-unavailable" && current.token == nil)
        let disabled = try await QuotaSharing.run(runtime: runtime, resources: resources, action: "disable", token: nil, channel: .providerTokens)
        try require(!disabled.enabled && !disabled.canEnable && disabled.reason == "pairing-unavailable")
        var rejected = false
        do {
            _ = try await QuotaSharing.run(runtime: runtime, resources: resources, action: "enable", token: String(repeating: "a", count: 64), channel: .providerTokens)
        } catch { rejected = true }
        try require(rejected)
        try require(!FileManager.default.fileExists(atPath: runtime.appendingPathComponent("private-sync/provider-tokens.sqlite").path))
        try require(!FileManager.default.fileExists(atPath: runtime.appendingPathComponent("private-quota").path))
    }
}
