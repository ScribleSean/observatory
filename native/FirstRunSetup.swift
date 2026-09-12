import Foundation
import CoreFoundation

enum FirstRunSetup {
    private static func file(_ runtime: URL) -> URL { runtime.appendingPathComponent("setup-state.json") }
    static func required(runtime: URL) throws -> Bool {
        let target = file(runtime)
        if (try? FileManager.default.destinationOfSymbolicLink(atPath: target.path)) != nil { throw CocoaError(.fileReadNoPermission) }
        guard FileManager.default.fileExists(atPath: target.path) else {
            return !FileManager.default.fileExists(atPath: runtime.appendingPathComponent("collector.config.json").path)
                && !FileManager.default.fileExists(atPath: runtime.appendingPathComponent("local.config.json").path)
        }
        let info = try target.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        guard info.isRegularFile == true, info.isSymbolicLink != true, (info.fileSize ?? 4097) <= 4096,
              let object = try JSONSerialization.jsonObject(with: Data(contentsOf: target)) as? JSONObject,
              Set(object.keys) == ["version", "completed"], number(object["version"]) == 1,
              let completed = object["completed"] as? NSNumber, CFGetTypeID(completed) == CFBooleanGetTypeID() else {
            throw CocoaError(.fileReadCorruptFile)
        }
        return !completed.boolValue
    }
    static func prepare(runtime: URL) throws -> Bool {
        try FileManager.default.createDirectory(at: runtime, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let info = try runtime.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        guard info.isDirectory == true, info.isSymbolicLink != true else { throw CocoaError(.fileWriteNoPermission) }
        let pending = try required(runtime: runtime)
        if pending && !FileManager.default.fileExists(atPath: file(runtime).path) {
            // Persist the pending gate before creating collection settings. A
            // restart during setup must not silently opt the user into collection.
            try write(completed: false, runtime: runtime)
            try CollectorConfiguration.save(Dictionary(uniqueKeysWithValues: CollectorConfiguration.defaults.keys.map { ($0, false) }), runtime: runtime)
        }
        return pending
    }
    static func complete(sources: [String: Bool], runtime: URL) throws {
        guard Set(sources.keys) == Set(CollectorConfiguration.defaults.keys) else { throw CocoaError(.fileReadCorruptFile) }
        guard try required(runtime: runtime) else { throw CocoaError(.fileWriteNoPermission) }
        try CollectorConfiguration.save(sources, runtime: runtime)
        try write(completed: true, runtime: runtime)
    }
    private static func write(completed: Bool, runtime: URL) throws {
        let data = try JSONSerialization.data(withJSONObject: ["version": 1, "completed": completed])
        try data.write(to: file(runtime), options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file(runtime).path)
    }
}
