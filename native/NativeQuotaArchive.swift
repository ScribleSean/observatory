import SwiftUI
import Darwin

struct ArchiveAccount: Decodable, Identifiable {
    let scope: String
    let records: Int
    let firstAt: Double
    let lastAt: Double
    let current: Bool
    var id: String { scope }
}
struct ArchiveCursor: Codable { let at: Double; let id: Int }
struct ArchiveWindow: Decodable {
    let bucket: String
    let window: String
    let remainingPercent: Double
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
        guard value.version == 1, (value.accounts != nil) != (value.records != nil),
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

struct ArchiveRequestFence {
    private var generation = UUID()
    mutating func begin() -> UUID { generation = UUID(); return generation }
    mutating func invalidate() { generation = UUID() }
    func accepts(_ request: UUID) -> Bool { generation == request }
}

struct NativeQuotaArchive: View {
    let runtime: URL
    @Environment(\.dismiss) private var dismiss
    @State private var accounts: [ArchiveAccount] = []
    @State private var accountNext: String?
    @State private var scope = ""
    @State private var kind = "observation"
    @State private var from = Calendar.current.date(byAdding: .day, value: -30, to: Date()) ?? Date()
    @State private var to = Date()
    @State private var readings: [ArchiveReading] = []
    @State private var next: ArchiveCursor?
    @State private var busy = false
    @State private var requests = ArchiveRequestFence()
    @State private var message = "Choose a saved account and date range, then load history."
    @State private var storage = ""
    private var invalidDates: Bool { Calendar.current.startOfDay(for: from) > Calendar.current.startOfDay(for: to) }
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Text("Saved allowance history").font(ObservatoryTheme.font(22, weight: .semibold)).tracking(-0.7)
                Spacer(); Button("Done") { dismiss() }
            }
            Text("This Mac only. Historical records are not live readings or combined-device totals.").foregroundStyle(ObservatoryTheme.muted)
            HStack {
                Picker("Account", selection: $scope) {
                    Text("Select account").tag("")
                    ForEach(Array(accounts.enumerated()), id: \.element.id) { index, account in
                        Text("Saved account \(index + 1)\(account.current ? " (current)" : "")").tag(account.scope)
                    }
                }
                Button("More accounts") { loadAccounts(after: accountNext) }.disabled(accountNext == nil || busy)
                Button("First accounts") { loadAccounts(after: nil) }.disabled(busy)
            }
            if let account = accounts.first(where: { $0.scope == scope }) {
                Text("\(account.records.formatted()) saved records · \(Date(timeIntervalSince1970: account.firstAt / 1000).formatted(date: .abbreviated, time: .omitted)) to \(Date(timeIntervalSince1970: account.lastAt / 1000).formatted(date: .abbreviated, time: .omitted))")
                    .font(.caption).foregroundStyle(ObservatoryTheme.muted)
            }
            Text("Account names are not stored. Groups remain separate even after monitoring is disabled.").font(.caption).foregroundStyle(ObservatoryTheme.muted)
            HStack {
                DatePicker("From", selection: $from, displayedComponents: .date)
                DatePicker("Through", selection: $to, displayedComponents: .date)
                Picker("Records", selection: $kind) {
                    Text("Allowance readings").tag("observation")
                    Text("Reported daily tokens").tag("daily")
                    Text("Collection checks").tag("poll")
                }
            }
            HStack {
                Button("Load history") { loadPage(after: nil) }.disabled(scope.isEmpty || busy || invalidDates)
                Button("Next page") { loadPage(after: next) }.disabled(next == nil || busy)
                if busy { ProgressView().controlSize(.small) }
                Text(storage).font(.caption).foregroundStyle(ObservatoryTheme.muted)
            }
            Text(message).font(.callout).accessibilityLabel(message)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    ForEach(Array(readings.enumerated()), id: \.offset) { _, row in
                        VStack(alignment: .leading, spacing: 5) {
                            Text(row.checkedAt).font(.caption).foregroundStyle(ObservatoryTheme.muted)
                            if let windows = row.windows {
                                ForEach(Array(windows.enumerated()), id: \.offset) { _, window in
                                    Text("\(window.bucket) · \(window.window): \(window.remainingPercent, specifier: "%.1f")% remaining")
                                }
                            } else if let tokens = row.tokens, let day = row.startDate {
                                Text("\(day): \(tokens.formatted()) reported tokens")
                            } else { Text(row.status ?? "Unknown collection result") }
                        }.frame(maxWidth: .infinity, alignment: .leading).modifier(ObservatoryCard())
                    }
                }
            }
            Text("Times are recorded in UTC. Filters use local calendar days. Missing readings are not zero. Revised daily reports are separate evidence and must not be added together.")
                .font(.caption).foregroundStyle(ObservatoryTheme.muted)
        }.padding(24).frame(minWidth: 760, minHeight: 540)
            .font(ObservatoryTheme.font()).foregroundStyle(ObservatoryTheme.text)
            .background(ObservatoryTheme.background).buttonStyle(ObservatoryButtonStyle())
            .task { loadAccounts(after: nil) }
            .onChange(of: scope) { clearPage() }.onChange(of: kind) { clearPage() }
            .onChange(of: from) { clearPage() }.onChange(of: to) { clearPage() }
            .onDisappear { requests.invalidate() }
    }
    private func clearPage() {
        requests.invalidate()
        readings = []; next = nil
        message = invalidDates ? "Choose a From date on or before Through." : "Load history for the selected filters."
    }
    private func loadAccounts(after: String?) {
        guard !busy else { return }; busy = true
        let generation = requests.begin()
        Task { @MainActor in
            defer { busy = false }
            do {
                var request: [String: Any] = ["action": "accounts"]
                if let after { request["after"] = after }
                let reply = try await QuotaArchiveProcess.run(runtime: runtime, request: request)
                guard requests.accepts(generation) else { return }
                accounts = reply.accounts ?? []
                scope = ""
                if case .account(let value) = reply.next { accountNext = value } else { accountNext = nil }
                storage = ByteCountFormatter.string(fromByteCount: Int64(reply.storageBytes ?? 0), countStyle: .file) + " local database (8 GiB limit)"
                if accounts.isEmpty { message = "No saved allowance history on this Mac." }
            } catch {
                guard requests.accepts(generation) else { return }
                message = "History could not be read. Saved data was not deleted."
            }
        }
    }
    private func loadPage(after: ArchiveCursor?) {
        guard !busy, !scope.isEmpty, !invalidDates else { return }
        let calendar = Calendar.current
        let start = calendar.startOfDay(for: from)
        guard let end = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: to)) else { return }
        var request: [String: Any] = ["action": "page", "scope": scope, "kind": kind,
            "from": max(0, Int64(start.timeIntervalSince1970 * 1000)), "to": Int64(end.timeIntervalSince1970 * 1000) - 1]
        if let after { request["after"] = ["at": after.at, "id": after.id] }
        busy = true
        let generation = requests.begin()
        Task { @MainActor in
            defer { busy = false }
            do {
                let reply = try await QuotaArchiveProcess.run(runtime: runtime, request: request)
                guard requests.accepts(generation) else { return }
                readings = reply.records ?? []
                if case .page(let value) = reply.next { next = value } else { next = nil }
                message = readings.isEmpty ? "No records in this range. Missing data is not zero usage." : "\(readings.count) records on this page, oldest first.\(next == nil ? " End of range." : " More records available.")"
            } catch {
                guard requests.accepts(generation) else { return }
                readings = []; next = nil; message = "History could not be read. Saved data was not deleted."
            }
        }
    }
}
