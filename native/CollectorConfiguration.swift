import Foundation
import CoreFoundation

struct CollectorLaunch {
    let executable: URL
    let arguments: [String]
}

enum CollectorConfiguration {
    static let defaults = ["activity": true, "codex": true, "claude": false, "wispr": false, "quota": false, "receipts": false, "benchmarks": false]

    static func validate(_ object: JSONObject) throws -> [String: Bool] {
        var result = defaults
        for (key, value) in object {
            guard defaults[key] != nil || key == "typewhisper", let value = value as? NSNumber,
                  CFGetTypeID(value) == CFBooleanGetTypeID() else {
                throw CocoaError(.fileReadCorruptFile)
            }
            // Read old settings without re-enabling or saving the retired source.
            if defaults[key] != nil { result[key] = value.boolValue }
        }
        return result
    }

    static func prepare(runtime: URL) throws -> Bool {
        let files = FileManager.default
        try files.createDirectory(at: runtime, withIntermediateDirectories: true,
                                  attributes: [.posixPermissions: 0o700])
        let values = try runtime.resourceValues(forKeys: [.isSymbolicLinkKey, .isDirectoryKey])
        guard values.isDirectory == true, values.isSymbolicLink != true else { throw CocoaError(.fileWriteNoPermission) }
        let local = runtime.appendingPathComponent("collector.config.json")
        if files.fileExists(atPath: local.path) {
            _ = try read(runtime: runtime)
            return true
        }
        // Existing configured previews retain their cross-device collector.
        if files.fileExists(atPath: runtime.appendingPathComponent("local.config.json").path) { return false }
        try save(defaults, runtime: runtime)
        return true
    }

    static func read(runtime: URL) throws -> [String: Bool] {
        let file = runtime.appendingPathComponent("collector.config.json")
        let values = try file.resourceValues(forKeys: [.isSymbolicLinkKey, .isRegularFileKey, .fileSizeKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true,
              (values.fileSize ?? 4097) <= 4096,
              let object = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? JSONObject else {
            throw CocoaError(.fileReadCorruptFile)
        }
        return try validate(object)
    }

    static func save(_ sources: [String: Bool], runtime: URL) throws {
        let checked = try validate(sources)
        let data = try JSONSerialization.data(withJSONObject: checked, options: [.sortedKeys])
        let file = runtime.appendingPathComponent("collector.config.json")
        if FileManager.default.fileExists(atPath: file.path) { _ = try read(runtime: runtime) }
        try data.write(to: file, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    }

    // Optimistic conflict detection for settings loaded into an editor. This
    // does not claim an interprocess compare-and-swap transaction.
    static func saveIfUnchanged(_ sources: [String: Bool], expected: [String: Bool], runtime: URL) throws -> Bool {
        let checked = try validate(sources)
        let baseline = try validate(expected)
        guard try read(runtime: runtime) == baseline else { return false }
        try save(checked, runtime: runtime)
        return true
    }

    static func launch(runtime: URL, resources: URL, local: Bool, quotaOnly: Bool = false) throws -> CollectorLaunch {
        if quotaOnly && !local { throw CocoaError(.featureUnsupported) }
        if local {
            _ = try read(runtime: runtime)
            let python = resources.appendingPathComponent("Runtime/python/bin/python3")
            let node = resources.appendingPathComponent("Runtime/node/bin/node")
            let scripts = resources.appendingPathComponent("Collector/scripts")
            guard FileManager.default.isExecutableFile(atPath: python.path),
                  FileManager.default.isExecutableFile(atPath: node.path) else { throw CocoaError(.fileReadNoSuchFile) }
            return CollectorLaunch(executable: python, arguments: ["-I", "-B", scripts.appendingPathComponent("run-collector.py").path,
                "--runtime", runtime.path, "--collector", scripts.appendingPathComponent("collect-mac.mjs").path,
                "--node", node.path, "--python", python.path, "--interval", "300"] + (quotaOnly ? ["--quota-only"] : []))
        }
        guard let config = readObject(runtime.appendingPathComponent("native-runtime.json")),
              let python = config["python"] as? String, let node = config["node"] as? String,
              python.hasPrefix("/"), node.hasPrefix("/"),
              FileManager.default.isExecutableFile(atPath: python),
              FileManager.default.isExecutableFile(atPath: node) else { throw CocoaError(.fileReadNoSuchFile) }
        return CollectorLaunch(executable: URL(fileURLWithPath: python), arguments: [
            runtime.appendingPathComponent("scripts/run-collector.py").path, "--node", node, "--interval", "300"])
    }
}
