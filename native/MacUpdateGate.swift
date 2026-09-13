import Foundation

enum MacUpdateGate {
    static func isBlocked(bundle: URL) -> Bool {
        let lock = bundle.deletingLastPathComponent().appendingPathComponent(".observatory-install.lock")
        do {
            _ = try FileManager.default.attributesOfItem(atPath: lock.path)
            return true
        } catch CocoaError.fileReadNoSuchFile {
            return false
        } catch {
            return true
        }
    }
}
