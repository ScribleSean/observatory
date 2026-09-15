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
    let resetsAt: String?
}
struct ArchiveReading: Decodable {
    let checkedAt: String
    let windows: [ArchiveWindow]?
    let status: String?
    let startDate: String?
    let tokens: Int?
}

func archiveChartQuota(_ readings: [ArchiveReading]) -> JSONObject {
    var windows: [String: JSONObject] = [:]
    let history: [JSONObject] = readings.map { reading in
        let values: [JSONObject] = (reading.windows ?? []).map { window in
            var value: JSONObject = ["bucket": window.bucket, "window": window.window, "remainingPercent": window.remainingPercent]
            if let reset = window.resetsAt { value["resetsAt"] = reset }
            windows[window.bucket + ":" + window.window] = value
            return value
        }
        return ["checkedAt": reading.checkedAt, "windows": values]
    }
    return ["history": history, "windows": windows.keys.sorted().compactMap { windows[$0] },
            "checkedAt": readings.last?.checkedAt ?? "", "status": "stale"]
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
    @State private var chartReadings: [ArchiveReading] = []
    @State private var fullChart: ArchiveChart?
    @State private var fullChartWindow = ""
    @State private var fullPeriod = "All retained"
    @State private var fullWindow: JSONObject?
    @State private var next: ArchiveCursor?
    @State private var busy = false
    @State private var requests = ArchiveRequestFence()
    @State private var message = "Choose a saved account and date range, then load history."
    @State private var storage = ""
    private var invalidDates: Bool { Calendar.current.startOfDay(for: from) > Calendar.current.startOfDay(for: to) }
    var body: some View {
        ScrollView {
        VStack(alignment: .leading, spacing: 18) {
            ObservatoryAdaptiveRow {
                Text("Saved allowance history").observatoryFont(22, weight: .semibold).tracking(-0.7)
                Spacer(); Button("Done") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            Text("This Mac only. Historical records are not live readings or combined-device totals.").foregroundStyle(ObservatoryTheme.muted)
            ObservatoryAdaptiveRow {
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
                    .observatoryFont(.caption).foregroundStyle(ObservatoryTheme.muted)
            }
            Text("Account names are not stored. Groups remain separate even after monitoring is disabled.").observatoryFont(.caption).foregroundStyle(ObservatoryTheme.muted)
            ObservatoryAdaptiveRow {
                Button("All saved dates") {
                    if let account = accounts.first(where: { $0.scope == scope }) {
                        from = Date(timeIntervalSince1970: account.firstAt / 1000)
                        to = Date(timeIntervalSince1970: account.lastAt / 1000)
                    }
                }.disabled(scope.isEmpty || busy)
                DatePicker("From", selection: $from, displayedComponents: .date)
                DatePicker("Through", selection: $to, displayedComponents: .date)
                Picker("Records", selection: $kind) {
                    Text("Allowance readings").tag("observation")
                    Text("Reported daily tokens").tag("daily")
                    Text("Collection checks").tag("poll")
                }
            }
            ObservatoryAdaptiveRow {
                Button("Load history") { loadPage(after: nil) }
                    .keyboardShortcut(.return, modifiers: .command)
                    .help("Load history (Command-Return)")
                    .disabled(scope.isEmpty || busy || invalidDates)
                Button("Next page") { loadPage(after: next) }
                    .keyboardShortcut(.rightArrow, modifiers: .command)
                    .help("Next page (Command-Right Arrow)")
                    .disabled(next == nil || busy || chartReadings.count >= 10000)
                if busy { ProgressView().controlSize(.small) }
                Text(storage).observatoryFont(.caption).foregroundStyle(ObservatoryTheme.muted)
            }
            Text(message).observatoryFont(.callout).accessibilityLabel(message)
            if let fullChart {
                ObservatorySegments(title: "Period", labels: ["Day", "Week", "All retained"], values: ["Day", "Week", "All retained"],
                    selection: Binding(get: { fullPeriod }, set: { value in
                        fullPeriod = value
                        if let fullWindow { loadFullChart(window: fullWindow) }
                    })).disabled(busy)
                Text("Day and Week end on the Through date. All retained uses the selected archive range.")
                    .observatoryFont(12).foregroundStyle(ObservatoryTheme.muted)
                ArchiveChartView(chart: fullChart, windowLabel: fullChartWindow)
            }
            if kind == "observation" && !chartReadings.isEmpty {
                ForEach(Array(rows(archiveChartQuota(chartReadings)["windows"]).enumerated()), id: \.offset) { _, window in
                    Button("Full-range graph · \(text(window["bucket"])) \(text(window["window"]))") { loadFullChart(window: window) }
                        .disabled(busy || invalidDates)
                }
              if fullChart == nil {
                Text(next == nil ? "Loaded history for the selected dates" : chartReadings.count >= 10000 ? "Partial history. Preview limit reached. Choose a narrower date range to inspect more detail." : "Partial history. Load the next page to extend coverage.")
                    .observatoryFont(.callout).foregroundStyle(ObservatoryTheme.muted)
                QuotaPanel(quota: archiveChartQuota(chartReadings), dashboard: true, historyOnly: true)
                    .modifier(ObservatoryCard())
              }
            }
            Group {
                LazyVStack(alignment: .leading, spacing: 12) {
                    ForEach(Array(readings.enumerated()), id: \.offset) { _, row in
                        VStack(alignment: .leading, spacing: 5) {
                            Text(row.checkedAt).observatoryFont(.caption).foregroundStyle(ObservatoryTheme.muted)
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
                .observatoryFont(.caption).foregroundStyle(ObservatoryTheme.muted)
        }.padding(24)
        }.frame(width: 720, height: 500)
            .observatoryFont().foregroundStyle(ObservatoryTheme.text)
            .background(ObservatoryTheme.background).buttonStyle(ObservatoryButtonStyle())
            .task { loadAccounts(after: nil) }
            .onChange(of: scope) { clearPage() }.onChange(of: kind) { clearPage() }
            .onChange(of: from) { clearPage() }.onChange(of: to) { clearPage() }
            .onDisappear { requests.invalidate() }
    }
    private func clearPage() {
        requests.invalidate()
        readings = []; chartReadings = []; fullChart = nil; fullWindow = nil; fullPeriod = "All retained"; next = nil
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
    private func loadFullChart(window: JSONObject) {
        guard !busy, !scope.isEmpty, !invalidDates else { return }
        let anchor = Calendar.current.startOfDay(for: to)
        let start = fullPeriod == "Day" ? anchor : fullPeriod == "Week" ? Calendar.current.date(byAdding: .day, value: -6, to: anchor)! : Calendar.current.startOfDay(for: from)
        guard let end = Calendar.current.date(byAdding: .day, value: 1, to: Calendar.current.startOfDay(for: to)) else { return }
        let request: JSONObject = ["action": "chart", "scope": scope, "bucket": text(window["bucket"]), "window": text(window["window"]),
            "from": max(0, Int64(start.timeIntervalSince1970 * 1000)), "to": Int64(end.timeIntervalSince1970 * 1000) - 1]
        busy = true; fullChart = nil
        let generation = requests.begin()
        message = "Rendering the full selected range. Raw record pages remain separate."
        Task { @MainActor in
            defer { busy = false }
            do {
                let reply = try await QuotaArchiveProcess.run(runtime: runtime, request: request)
                guard requests.accepts(generation) else { return }
                guard let chart = reply.chart,
                      chart.matchesRange(from: Double(max(0, Int64(start.timeIntervalSince1970 * 1000))), to: Double(Int64(end.timeIntervalSince1970 * 1000) - 1)) else {
                    throw CocoaError(.fileReadCorruptFile)
                }
                fullChart = chart
                fullWindow = window
                fullChartWindow = text(window["bucket"]) + " · " + text(window["window"])
                message = "Full selected range rendered. No observation-count preview limit."
            } catch {
                guard requests.accepts(generation) else { return }
                message = "Full-range graph could not be rendered. Saved history was not changed."
            }
        }
    }
    private func loadPage(after: ArchiveCursor?) {
        guard !busy, !scope.isEmpty, !invalidDates else { return }
        let calendar = Calendar.current
        let start = calendar.startOfDay(for: from)
        guard let end = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: to)) else { return }
        var request: [String: Any] = ["action": "page", "scope": scope, "kind": kind == "observation" ? "timeline" : kind,
            "from": max(0, Int64(start.timeIntervalSince1970 * 1000)), "to": Int64(end.timeIntervalSince1970 * 1000) - 1]
        if let after { request["after"] = ["at": after.at, "id": after.id] }
        let pageRequest = request
        busy = true
        let generation = requests.begin()
        Task { @MainActor in
            defer { busy = false }
            do {
                let reply = try await QuotaArchiveProcess.run(runtime: runtime, request: pageRequest)
                guard requests.accepts(generation) else { return }
                readings = reply.records ?? []
                if after == nil { chartReadings = []; fullChart = nil }
                if kind == "observation" { chartReadings.append(contentsOf: readings) }
                if case .page(let value) = reply.next { next = value } else { next = nil }
                message = readings.isEmpty ? "No records in this range. Missing data is not zero usage." : "\(readings.count) records on this page, oldest first.\(next == nil ? " End of range." : " More records available.")"
                if kind == "observation", fullChart == nil,
                   let window = rows(archiveChartQuota(chartReadings)["windows"]).first {
                    message = "Records loaded. Rendering the full selected range…"
                    do {
                        let anchor = Calendar.current.startOfDay(for: to)
                        let chartStart = fullPeriod == "Day" ? anchor : fullPeriod == "Week" ? Calendar.current.date(byAdding: .day, value: -6, to: anchor)! : start
                        let chartFrom = max(0, Int64(chartStart.timeIntervalSince1970 * 1000))
                        let chartRequest: JSONObject = ["action": "chart", "scope": pageRequest["scope"]!,
                            "from": chartFrom, "to": pageRequest["to"]!,
                            "bucket": text(window["bucket"]), "window": text(window["window"])]
                        let chartReply = try await QuotaArchiveProcess.run(runtime: runtime, request: chartRequest)
                        guard requests.accepts(generation) else { return }
                        guard let chart = chartReply.chart,
                              chart.matchesRange(from: Double(chartFrom), to: Double(Int64(end.timeIntervalSince1970 * 1000) - 1)) else {
                            throw CocoaError(.fileReadCorruptFile)
                        }
                        fullChart = chart
                        fullWindow = window
                        fullChartWindow = text(window["bucket"]) + " · " + text(window["window"])
                        message = "Full selected range rendered. Raw records remain paginated."
                    } catch {
                        guard requests.accepts(generation) else { return }
                        message = "Records loaded. Full-range graph could not be rendered. Try its graph button again."
                    }
                }
            } catch {
                guard requests.accepts(generation) else { return }
                readings = []; chartReadings = []; next = nil; message = "History could not be read. Saved data was not deleted."
            }
        }
    }
}
