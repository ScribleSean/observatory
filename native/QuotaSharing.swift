import Foundation
import Darwin

struct QuotaSharingStatus: Decodable {
    let version: Int
    let enabled: Bool
    let canEnable: Bool
    let reason: String
    let token: String?

    static func parse(_ data: Data) throws -> QuotaSharingStatus {
        guard data.count <= 4096,
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(object.keys) == Set(["version", "enabled", "canEnable", "reason", "token"]) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        let value = try JSONDecoder().decode(QuotaSharingStatus.self, from: data)
        guard value.version == 1, ["ready", "account-unavailable", "pairing-unavailable"].contains(value.reason),
              value.canEnable ? value.reason == "ready" && value.token?.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil : value.token == nil else {
            throw CocoaError(.fileReadCorruptFile)
        }
        return value
    }
}

enum QuotaSharing {
    static func run(runtime: URL, resources: URL, action: String, token: String?) async throws -> QuotaSharingStatus {
        try await Task.detached(priority: .userInitiated) {
            guard ["status", "enable", "disable"].contains(action),
                  action == "enable" ? token?.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil : token == nil else {
                throw CocoaError(.fileReadCorruptFile)
            }
            let values = try runtime.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
            guard values.isDirectory == true, values.isSymbolicLink != true,
                  let resolved = realpath(runtime.path, nil) else { throw CocoaError(.fileReadNoSuchFile) }
            defer { free(resolved) }
            let node = resources.appendingPathComponent("Runtime/node/bin/node")
            let script = resources.appendingPathComponent("Collector/scripts/quota-sharing-control.mjs")
            guard FileManager.default.isExecutableFile(atPath: node.path), FileManager.default.fileExists(atPath: script.path) else {
                throw CocoaError(.fileReadNoSuchFile)
            }
            var request: [String: Any] = ["action": action]
            if let token { request["token"] = token }
            let process = Process(), input = Pipe(), output = Pipe()
            process.executableURL = node
            process.arguments = [script.path, "--runtime", String(cString: resolved)]
            process.currentDirectoryURL = runtime
            process.standardInput = input
            process.standardOutput = output
            process.standardError = FileHandle.nullDevice
            try process.run()
            let timeout = DispatchWorkItem { if process.isRunning { kill(process.processIdentifier, SIGKILL) } }
            DispatchQueue.global().asyncAfter(deadline: .now() + 20, execute: timeout)
            defer { timeout.cancel() }
            do {
                try input.fileHandleForWriting.write(contentsOf: JSONSerialization.data(withJSONObject: request))
                try input.fileHandleForWriting.close()
                let data = output.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                guard process.terminationReason == .exit, process.terminationStatus == 0 else { throw CocoaError(.fileWriteUnknown) }
                return try QuotaSharingStatus.parse(data)
            } catch {
                if process.isRunning { kill(process.processIdentifier, SIGKILL) }
                process.waitUntilExit()
                throw error
            }
        }.value
    }
}
