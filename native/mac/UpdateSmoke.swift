import AppKit
import Sparkle

@main
struct MacUpdateSmoke {
    @MainActor static func main() {
        MacUpdateTrust.selfTest()
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
