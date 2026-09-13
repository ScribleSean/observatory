import Foundation
import Darwin

struct TLSSetupReply: Decodable {
    let id: Int
    let status: String
    let invitation: String?
    let peerCertificateSha256: String?

    static func selfTest() {
        precondition((try? parse(Data("{\"id\":1,\"status\":\"idle\",\"peerCertificateSha256\":null}".utf8)))?.status == "idle")
        for invalid in ["{}", "{\"id\":true,\"status\":\"idle\"}", "{\"id\":1,\"status\":\"hosting\"}",
                        "{\"id\":1,\"status\":\"paired\"}", "{\"id\":1,\"status\":\"idle\",\"key\":\"private\"}"] {
            precondition((try? parse(Data(invalid.utf8))) == nil)
        }
    }

    static func parse(_ data: Data) throws -> TLSSetupReply {
        guard data.count <= 8192,
              let fields = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(fields.keys).isSubset(of: ["id", "status", "invitation", "peerCertificateSha256"]) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        let reply = try JSONDecoder().decode(TLSSetupReply.self, from: data)
        guard reply.id > 0, ["idle", "working", "waiting", "confirming", "inactive", "hosting", "cancelled",
            "configuration-ready", "awaiting-confirmation", "local-ready", "acknowledged", "unavailable"].contains(reply.status),
              (reply.status == "hosting") == (reply.invitation != nil) else { throw CocoaError(.fileReadCorruptFile) }
        if let invitation = reply.invitation {
            guard invitation.utf8.count <= 2048, invitation.hasPrefix("observatory-pair:v1:") else {
                throw CocoaError(.fileReadCorruptFile)
            }
        }
        if let fingerprint = reply.peerCertificateSha256 {
            guard fingerprint.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else {
                throw CocoaError(.fileReadCorruptFile)
            }
        }
        return reply
    }
}

// Owned by one native setup window. Commands and invitations use private pipes,
// never shell arguments, webview messages, logs or a local HTTP endpoint.
final class TLSSetupProcess {
    typealias Completion = (Result<TLSSetupReply, Error>) -> Void
    private let process = Process(), input = Pipe(), output = Pipe()
    private let queue = DispatchQueue(label: "Observatory.TLSSetup")
    private let writer = DispatchQueue(label: "Observatory.TLSSetup.Write")
    private var pending: [Int: Completion] = [:]
    private var buffer = Data()
    private var nextID = 1
    private var closed = false
    var isRunning: Bool { process.isRunning }

    convenience init(runtime: URL, resources: URL) throws {
        try self.init(runtime: runtime, node: resources.appendingPathComponent("Runtime/node/bin/node"),
                      script: resources.appendingPathComponent("Collector/scripts/peer-tls-control.mjs"))
    }

    init(runtime: URL, node: URL, script: URL) throws {
        guard runtime.isFileURL, node.isFileURL, script.isFileURL,
              FileManager.default.isExecutableFile(atPath: node.path),
              FileManager.default.fileExists(atPath: script.path),
              let resolved = realpath(runtime.path, nil) else { throw CocoaError(.fileReadNoSuchFile) }
        defer { free(resolved) }
        process.executableURL = node
        process.arguments = [script.path, "--runtime", String(cString: resolved)]
        process.currentDirectoryURL = URL(fileURLWithPath: String(cString: resolved), isDirectory: true)
        var environment = ProcessInfo.processInfo.environment
        for key in ["NODE_OPTIONS", "NODE_EXTRA_CA_CERTS", "NODE_PATH"] { environment.removeValue(forKey: key) }
        process.environment = environment
        process.standardInput = input
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        try process.run()
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            self?.queue.async { [weak self] in self?.received(data) }
        }
        process.terminationHandler = { [weak self] _ in
            self?.queue.async { [weak self] in self?.stop() }
        }
    }

    func send(_ command: [String: Any], completion: @escaping Completion) {
        queue.async { [self] in
            guard !closed, process.isRunning, pending.count < 8, nextID <= 512 else {
                DispatchQueue.main.async { completion(.failure(CocoaError(.fileReadUnknown))) }; return
            }
            let id = nextID
            do {
                var data = try JSONSerialization.data(withJSONObject: ["id": id, "command": command])
                guard data.count <= 8192 else { throw CocoaError(.fileReadTooLarge) }
                data.append(10)
                nextID += 1
                pending[id] = completion
                queue.asyncAfter(deadline: .now() + 45) { [weak self] in
                    guard let self, self.pending[id] != nil else { return }
                    self.stop()
                }
                let bytes = data
                writer.async { [weak self] in
                    guard let self else { return }
                    do { try self.input.fileHandleForWriting.write(contentsOf: bytes) }
                    catch { self.queue.async { [weak self] in self?.stop() } }
                }
            } catch {
                if pending[id] != nil { stop() }
                else { DispatchQueue.main.async { completion(.failure(CocoaError(.fileWriteUnknown))) } }
            }
        }
    }

    func close() { queue.async { [weak self] in self?.stop() } }

    private func received(_ data: Data) {
        guard !closed else { return }
        guard !data.isEmpty, buffer.count + data.count <= 16384 else { stop(); return }
        buffer.append(data)
        while let end = buffer.firstIndex(of: 10) {
            let frame = Data(buffer[..<end])
            buffer.removeSubrange(...end)
            do {
                let reply = try TLSSetupReply.parse(frame)
                guard let completion = pending.removeValue(forKey: reply.id) else { stop(); return }
                DispatchQueue.main.async { completion(.success(reply)) }
            } catch { stop(); return }
        }
    }

    private func stop() {
        guard !closed else { return }
        closed = true
        if process.isRunning {
            process.terminate()
            let child = process
            DispatchQueue.global().asyncAfter(deadline: .now() + 2) {
                if child.isRunning { kill(child.processIdentifier, SIGKILL) }
            }
        }
        output.fileHandleForReading.readabilityHandler = nil
        try? input.fileHandleForWriting.close()
        try? output.fileHandleForReading.close()
        buffer.removeAll(keepingCapacity: false)
        let callbacks = Array(pending.values)
        pending.removeAll()
        for completion in callbacks { DispatchQueue.main.async { completion(.failure(CocoaError(.fileReadUnknown))) } }
    }

    deinit {
        output.fileHandleForReading.readabilityHandler = nil
        try? input.fileHandleForWriting.close()
        try? output.fileHandleForReading.close()
        if process.isRunning { process.terminate() }
    }
}
