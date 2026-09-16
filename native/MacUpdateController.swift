import AppKit
#if canImport(Sparkle)
import Sparkle
#endif

@MainActor
final class MacUpdateController: NSObject {
    private let ready: () -> Bool
    #if canImport(Sparkle)
    private var controller: SPUStandardUpdaterController?
    #endif

    init(ready: @escaping () -> Bool) { self.ready = ready; super.init() }

    func check() throws {
        _ = try MacUpdateTrust(info: Bundle.main.infoDictionary ?? [:])
        guard ready() else {
            throw NSError(domain: "ObservatoryUpdates", code: 2, userInfo: [NSLocalizedDescriptionKey:
                "Wait for the current collection or pairing operation to finish before checking for updates."])
        }
        #if canImport(Sparkle)
        if controller == nil {
            let value = SPUStandardUpdaterController(startingUpdater: false, updaterDelegate: self, userDriverDelegate: nil)
            value.updater.automaticallyChecksForUpdates = false
            value.updater.automaticallyDownloadsUpdates = false
            value.updater.sendsSystemProfile = false
            try value.updater.start()
            controller = value
        }
        if let updater = controller?.updater, updater.canCheckForUpdates { updater.checkForUpdates() }
        #else
        throw NSError(domain: "ObservatoryUpdates", code: 3, userInfo: [NSLocalizedDescriptionKey:
            "This build does not include the verified updater framework."])
        #endif
    }
}

#if canImport(Sparkle)
extension MacUpdateController: SPUUpdaterDelegate {
    func feedURLString(for updater: SPUUpdater) -> String? { MacUpdateTrust.feed }
    func updaterShouldPromptForPermissionToCheck(forUpdates updater: SPUUpdater) -> Bool { false }
    func updater(_ updater: SPUUpdater, mayPerform updateCheck: SPUUpdateCheck) throws {
        guard updateCheck == .updates, ready() else {
            throw NSError(domain: "ObservatoryUpdates", code: 4, userInfo: [NSLocalizedDescriptionKey:
                "Only an available, user-requested update check is permitted."])
        }
    }
}
#endif
