import Foundation
import Darwin

struct PairingTransport: Codable {
    let kind: String
    let hostAlias: String
    let remoteNode: String
    let remoteScript: String
    let remoteRuntime: String
}

struct PairingSetupRequest: Codable {
    let transport: PairingTransport
    let includeUbuntu: Bool

    func validate() throws {
        let target = transport
        guard target.kind == "ssh-windows",
              target.hostAlias.range(of: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$", options: .regularExpression) != nil else {
            throw CocoaError(.validationMissingMandatoryProperty)
        }
        for value in [target.remoteNode, target.remoteScript, target.remoteRuntime] {
            let components = value.replacingOccurrences(of: "\\", with: "/").components(separatedBy: "/")
            guard value.count <= 1024,
                  value.range(of: "^[A-Za-z]:[\\\\/]", options: .regularExpression) != nil,
                  !value.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }),
                  !value.dropFirst(2).contains(":"), !components.contains(".."), !components.contains(".") else {
                throw CocoaError(.validationMissingMandatoryProperty)
            }
        }
        let node = target.remoteNode.replacingOccurrences(of: "\\", with: "/").components(separatedBy: "/").last
        let script = target.remoteScript.replacingOccurrences(of: "\\", with: "/").components(separatedBy: "/").last
        guard node?.lowercased() == "node.exe", script == "peer-exchange.mjs" else {
            throw CocoaError(.validationMissingMandatoryProperty)
        }
    }
}

struct PairingSetupStatus: Decodable {
    enum State: String, Decodable { case unpaired, pending, paired, needsRepair = "needs-repair" }
    let status: State
    let request: PairingSetupRequest?
}

enum PairingSetup {
    static func status(runtime: URL, resources: URL) async throws -> PairingSetupStatus {
        try await Task.detached(priority: .userInitiated) {
            try readStatus(runtime: runtime, resources: resources)
        }.value
    }

    static func readStatus(runtime: URL, resources: URL) throws -> PairingSetupStatus {
        let result = try JSONDecoder().decode(PairingSetupStatus.self,
            from: run(runtime: runtime, resources: resources, request: nil))
        if result.status == .pending || result.status == .paired {
            guard let request = result.request else { throw CocoaError(.fileReadCorruptFile) }
            try request.validate()
        } else if result.request != nil { throw CocoaError(.fileReadCorruptFile) }
        return result
    }

    static func connect(runtime: URL, resources: URL, request: PairingSetupRequest) async throws {
        try request.validate()
        try await Task.detached(priority: .userInitiated) {
            let data = try run(runtime: runtime, resources: resources, request: request)
            guard let result = try JSONSerialization.jsonObject(with: data) as? [String: String],
                  result == ["status": "paired"] else { throw CocoaError(.fileReadCorruptFile) }
        }.value
    }

    // Off-main-thread, bounded stdin/stdout. All private writes belong to the
    // bundled setup CLI. Nothing passes through a shell or a webview message.
    private static func run(runtime: URL, resources: URL, request: PairingSetupRequest?) throws -> Data {
        let values = try runtime.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        guard values.isDirectory == true, values.isSymbolicLink != true,
              let resolved = realpath(runtime.path, nil) else { throw CocoaError(.fileReadNoSuchFile) }
        defer { free(resolved) }
        let node = resources.appendingPathComponent("Runtime/node/bin/node")
        let script = resources.appendingPathComponent("Collector/scripts/peer-setup.mjs")
        guard FileManager.default.isExecutableFile(atPath: node.path),
              FileManager.default.fileExists(atPath: script.path) else { throw CocoaError(.fileReadNoSuchFile) }
        let input = try request.map { try JSONEncoder().encode($0) } ?? Data()
        guard input.count <= 8192 else { throw CocoaError(.fileReadTooLarge) }
        let process = Process(), stdin = Pipe(), stdout = Pipe()
        process.executableURL = node
        process.arguments = [script.path, "--runtime", String(cString: resolved), request == nil ? "--status" : "--setup"]
        process.currentDirectoryURL = runtime
        process.standardInput = stdin
        process.standardOutput = stdout
        process.standardError = FileHandle.nullDevice
        let startedAt = DispatchTime.now()
        try process.run()
        let timeout = DispatchWorkItem { if process.isRunning { kill(process.processIdentifier, SIGKILL) } }
        DispatchQueue.global().asyncAfter(deadline: .now() + 45, execute: timeout)
        defer {
            timeout.cancel()
            try? stdin.fileHandleForWriting.close()
            try? stdout.fileHandleForReading.close()
            if process.isRunning { kill(process.processIdentifier, SIGKILL) }
            process.waitUntilExit()
        }
        try stdin.fileHandleForWriting.write(contentsOf: input)
        try stdin.fileHandleForWriting.close()
        var output = Data()
        while let chunk = try stdout.fileHandleForReading.read(upToCount: 8193 - output.count), !chunk.isEmpty {
            output.append(chunk)
            guard output.count <= 8192 else { throw CocoaError(.fileReadTooLarge) }
        }
        process.waitUntilExit()
        try PairingProcessDiagnostics.check(process, startedAt: startedAt)
        return output
    }
}
