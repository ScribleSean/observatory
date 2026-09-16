import AppKit
import Sparkle

@main
struct MacUpdateSmoke {
    @MainActor static func main() {
        MacUpdateTrust.selfTest()
        if CommandLine.arguments.count == 3 {
            do {
                let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
                let info = try PropertyListSerialization.propertyList(from: data, format: nil) as! [String: Any]
                let trust = try MacUpdateTrust(info: info)
                precondition(trust.publicKey == CommandLine.arguments[2])
                print("PASS: Generated release plist matches native trust validation.")
            } catch { preconditionFailure("Generated release configuration was rejected: \(error)") }
        } else { precondition(CommandLine.arguments.count == 1) }
        var invoked = false
        let controller = MacUpdateController { invoked = true; return true }
        precondition(controller.responds(to: #selector(SPUUpdaterDelegate.feedURLString(for:))))
        precondition(controller.responds(to: #selector(SPUUpdaterDelegate.updaterShouldPromptForPermissionToCheck(forUpdates:))))
        precondition(controller.responds(to: NSSelectorFromString("updater:mayPerformUpdateCheck:error:")))
        do { try controller.check(); preconditionFailure("Missing trust was accepted") }
        catch { precondition((error as NSError).domain == "ObservatoryUpdates"); precondition((error as NSError).code == 1) }
        precondition(!invoked)
        print("PASS: Mac update trust rejects invalid configuration before readiness or Sparkle initialization.")
    }
}
