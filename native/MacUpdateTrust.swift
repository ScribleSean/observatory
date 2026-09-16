import Foundation
import CoreFoundation

struct MacUpdateTrust {
    static let feed = "https://scriblesean.github.io/observatory/updates/macos-arm64.xml"
    let publicKey: String

    init(info: [String: Any]) throws {
        guard info["SUFeedURL"] as? String == Self.feed,
              let key = info["SUPublicEDKey"] as? String,
              let bytes = Data(base64Encoded: key), bytes.count == 32,
              bytes.base64EncodedString() == key, bytes.contains(where: { $0 != 0 }),
              ["SUEnableAutomaticChecks", "SUAutomaticallyUpdate", "SUAllowsAutomaticUpdates", "SUSendProfileInfo"].allSatisfy({ name in
                  guard let value = info[name] as? NSNumber else { return false }
                  return CFGetTypeID(value) == CFBooleanGetTypeID() && !value.boolValue
              }) else {
            throw NSError(domain: "ObservatoryUpdates", code: 1, userInfo: [NSLocalizedDescriptionKey:
                "Updates are not available in this build. Release verification is still in progress."])
        }
        publicKey = key
    }

    static func selfTest() {
        let key = Data(repeating: 1, count: 32).base64EncodedString()
        let good: [String: Any] = ["SUFeedURL": feed, "SUPublicEDKey": key,
            "SUEnableAutomaticChecks": false, "SUAutomaticallyUpdate": false,
            "SUAllowsAutomaticUpdates": false, "SUSendProfileInfo": false]
        precondition((try? MacUpdateTrust(info: good))?.publicKey == key)
        for (field, value) in [("SUFeedURL", "https://example.invalid/feed" as Any),
            ("SUPublicEDKey", key + " "), ("SUPublicEDKey", Data(repeating: 0, count: 32).base64EncodedString()),
            ("SUEnableAutomaticChecks", true), ("SUAutomaticallyUpdate", true),
            ("SUAllowsAutomaticUpdates", true), ("SUSendProfileInfo", true), ("SUSendProfileInfo", "false")] {
            var invalid = good; invalid[field] = value
            precondition((try? MacUpdateTrust(info: invalid)) == nil)
        }
        precondition((try? MacUpdateTrust(info: [:])) == nil)
    }
}
