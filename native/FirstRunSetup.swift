import Foundation
import CoreFoundation
import Darwin

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
    static func markComplete(runtime: URL) throws -> Bool {
        guard try required(runtime: runtime) else { return false }
        _ = try CollectorConfiguration.read(runtime: runtime)
        try write(completed: true, runtime: runtime)
        return true
    }
    private static func write(completed: Bool, runtime: URL) throws {
        let target = file(runtime)
        func checkTarget() throws {
            var info = stat()
            if lstat(target.path, &info) == 0 {
                guard info.st_mode & S_IFMT == S_IFREG, info.st_size <= 4096 else {
                    throw CocoaError(.fileWriteNoPermission)
                }
            } else if errno != ENOENT { throw CocoaError(.fileWriteNoPermission) }
        }
        try checkTarget()
        let temporary = runtime.appendingPathComponent(".setup-state-" + UUID().uuidString)
        let descriptor = open(temporary.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
        guard descriptor >= 0 else { throw CocoaError(.fileWriteNoPermission) }
        var closed = false
        defer {
            if !closed { close(descriptor) }
            unlink(temporary.path)
        }
        guard fchmod(descriptor, 0o600) == 0 else { throw CocoaError(.fileWriteNoPermission) }
        let data = Data((completed ? #"{"completed":true,"version":1}"# : #"{"completed":false,"version":1}"#).utf8)
        try data.withUnsafeBytes { bytes in
            var offset = 0
            while offset < bytes.count {
                let count = Darwin.write(descriptor, bytes.baseAddress!.advanced(by: offset), bytes.count - offset)
                if count < 0 && errno == EINTR { continue }
                guard count > 0 else { throw CocoaError(.fileWriteUnknown) }
                offset += count
            }
        }
        guard fsync(descriptor) == 0 else { throw CocoaError(.fileWriteUnknown) }
        let result = close(descriptor)
        closed = true
        guard result == 0 else { throw CocoaError(.fileWriteUnknown) }
        try checkTarget()
        guard rename(temporary.path, target.path) == 0 else { throw CocoaError(.fileWriteUnknown) }
    }
}
