import Foundation
import Darwin

struct ArchiveChart: Decodable {
    let version: Int
    let width: Int
    let height: Int
    let from: Double
    let to: Double
    let encoding: String
    let pixels: String
    let scanned: Int
    let observations: Int
    let gaps: Int
    let segments: Int
    let firstAt: Double?
    let lastAt: Double?
    let minUsed: Double?
    let maxUsed: Double?

    func validatedMask() throws -> Data {
        guard version == 1, (2...1024).contains(width), (2...160).contains(height),
              from.isFinite, to.isFinite, from >= 0, to > from, to <= 8_640_000_000_000_000,
              encoding == "ink-mask-u8", pixels.utf8.count <= 218_456,
              scanned >= 0, observations >= 0, observations <= scanned,
              gaps >= 0, gaps <= observations, segments >= 0, segments <= observations,
              let mask = Data(base64Encoded: pixels), mask.count == width * height,
              mask.allSatisfy({ $0 <= 3 }) else { throw CocoaError(.fileReadCorruptFile) }
        if observations == 0 {
            guard firstAt == nil, lastAt == nil, minUsed == nil, maxUsed == nil, mask.allSatisfy({ $0 == 0 }) else { throw CocoaError(.fileReadCorruptFile) }
        } else {
            guard let firstAt, let lastAt, firstAt >= from, lastAt <= to, firstAt <= lastAt,
                  let minUsed, let maxUsed, minUsed >= 0, maxUsed <= 100, minUsed <= maxUsed,
                  mask.contains(3) else { throw CocoaError(.fileReadCorruptFile) }
        }
        return mask
    }

}

struct ArchiveAccount: Decodable {
    let scope: String
    let records: Int
    let firstAt: Double
    let lastAt: Double
    let current: Bool
}
struct ArchiveCursor: Codable { let at: Double; let id: Int }
struct ArchiveWindow: Decodable {
    let bucket: String
    let window: String
    let remainingPercent: Double
    let resetsAt: String?
}
struct ArchiveReading: Decodable {
    let checkedAt: String
    let windows: [ArchiveWindow]?
    let status: String?
    let startDate: String?
    let tokens: Int?
}

struct ArchiveReply: Decodable {
    let version: Int
    let accounts: [ArchiveAccount]?
    let records: [ArchiveReading]?
    let chart: ArchiveChart?
    let storageBytes: Int?
    let storageLimitBytes: Int?
    // Catalogue and reading cursors have different shapes.
    let next: ArchiveNext?
    enum ArchiveNext: Decodable {
        case account(String), page(ArchiveCursor)
        init(from decoder: Decoder) throws {
            let value = try decoder.singleValueContainer()
            if let scope = try? value.decode(String.self) { self = .account(scope) }
            else { self = .page(try value.decode(ArchiveCursor.self)) }
        }
    }
    static func parse(_ data: Data) throws -> ArchiveReply {
        guard data.count <= 600_000 else { throw CocoaError(.fileReadTooLarge) }
        let value = try JSONDecoder().decode(Self.self, from: data)
        guard value.version == 1, [value.accounts != nil, value.records != nil, value.chart != nil].filter({ $0 }).count == 1,
              (value.accounts?.count ?? 0) <= 100, (value.records?.count ?? 0) <= 200 else { throw CocoaError(.fileReadCorruptFile) }
        let hex: (String) -> Bool = { $0.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil }
        if let accounts = value.accounts {
            guard accounts.allSatisfy({ hex($0.scope) && $0.records > 0 && $0.firstAt >= 0 && $0.lastAt >= $0.firstAt }),
                  Set(accounts.map(\.scope)).count == accounts.count,
                  let bytes = value.storageBytes, bytes >= 0, value.storageLimitBytes == 8 * 1024 * 1024 * 1024 else { throw CocoaError(.fileReadCorruptFile) }
            if let next = value.next {
                guard case .account(let scope) = next, hex(scope) else { throw CocoaError(.fileReadCorruptFile) }
            }
        }
        if let records = value.records {
            guard records.allSatisfy({ parseDate($0.checkedAt) != nil }) else { throw CocoaError(.fileReadCorruptFile) }
            if let next = value.next {
                guard case .page(let cursor) = next, cursor.id > 0, cursor.at >= 0, cursor.at.isFinite else { throw CocoaError(.fileReadCorruptFile) }
            }
        }
        if let chart = value.chart {
            guard value.next == nil else { throw CocoaError(.fileReadCorruptFile) }
            _ = try chart.validatedMask()
        }
        return value
    }
}
enum QuotaArchiveProcess {
    static func run(runtime: URL, request: [String: Any]) async throws -> ArchiveReply {
        let inputData = try JSONSerialization.data(withJSONObject: request)
        guard inputData.count <= 2048, let resources = Bundle.main.resourceURL else { throw CocoaError(.fileReadCorruptFile) }
        return try await Task.detached(priority: .userInitiated) {
            let values = try runtime.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
            guard values.isDirectory == true, values.isSymbolicLink != true,
                  let canonical = realpath(runtime.path, nil) else { throw CocoaError(.fileReadNoSuchFile) }
            defer { free(canonical) }
            let node = resources.appendingPathComponent("Runtime/node/bin/node")
            let script = resources.appendingPathComponent("Collector/scripts/quota-archive-control.mjs")
            let process = Process(), input = Pipe(), output = Pipe()
            process.environment = collectorChildEnvironment()
            process.executableURL = node
            process.arguments = [script.path, "--runtime", String(cString: canonical)]
            process.standardInput = input; process.standardOutput = output; process.standardError = FileHandle.nullDevice
            try process.run()
            let timeout = DispatchWorkItem { if process.isRunning { kill(process.processIdentifier, SIGKILL) } }
            DispatchQueue.global().asyncAfter(deadline: .now() + 20, execute: timeout)
            defer { timeout.cancel() }
            do {
                try input.fileHandleForWriting.write(contentsOf: inputData)
                try input.fileHandleForWriting.close()
                var data = Data()
                while let chunk = try output.fileHandleForReading.read(upToCount: 8192), !chunk.isEmpty {
                    data.append(chunk)
                    guard data.count <= 600_000 else { throw CocoaError(.fileReadTooLarge) }
                }
                process.waitUntilExit()
                guard process.terminationReason == .exit, process.terminationStatus == 0 else { throw CocoaError(.fileReadUnknown) }
                return try ArchiveReply.parse(data)
            } catch {
                if process.isRunning { kill(process.processIdentifier, SIGKILL) }
                process.waitUntilExit()
                throw error
            }
        }.value
    }
}
