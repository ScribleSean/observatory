import SwiftUI
import Charts
import UniformTypeIdentifiers

@MainActor
final class NativeDashboardSelection: ObservableObject {
    static let sections = [("allowances", "Allowances", "gauge.with.dots.needle.50percent"),
                           ("activity", "Activity", "waveform.path"), ("tokens", "Tokens", "square.stack.3d.up"),
                           ("dictation", "Dictation", "mic"),
                           ("agents", "Agents", "rectangle.stack.person.crop"),
                           ("sources", "Source health", "externaldrive.connected.to.line.below"), ("settings", "Settings", "gearshape")]
    @Published var section = "allowances"
    @Published var navigationRequest = 0
    @Published var textScale: Double = 1
    @Published var previewAppearance: String?
}

// Native dashboard. It consumes the existing sanitized
// snapshot and never sums overlapping device records or reads raw source files.
struct NativeDashboard: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ObservedObject var store: ObservatoryStore
    @ObservedObject var selection: NativeDashboardSelection
    let settingsActions: NativeSettingsActions
    @State private var host = "Mac"
    @State private var selectedDate = ""
    @State private var period = "day"
    @State private var archivedSnapshot: Snapshot?
    @State private var archiveError = false
    @State private var quotaHistoryOpen = false
    @AppStorage("observatoryAppearance") private var appearance = "dark"
    init(store: ObservatoryStore, selection: NativeDashboardSelection, settingsActions: NativeSettingsActions,
         initialPeriod: String = "day") {
        self.store = store; self.selection = selection; self.settingsActions = settingsActions
        _period = State(initialValue: initialPeriod)
    }
    private var displayedAppearance: String { settingsActions.preview ? (selection.previewAppearance ?? appearance) : appearance }
    private func toggleAppearance() {
        let next = displayedAppearance == "dark" ? "light" : "dark"
        if settingsActions.preview { selection.previewAppearance = next } else { appearance = next }
    }
    private var displayedSnapshot: Snapshot? { archivedSnapshot ?? store.snapshot }
    private let sections = NativeDashboardSelection.sections

    var body: some View {
        let layout = selection.textScale > 1.25 ? AnyLayout(VStackLayout(spacing: 0)) : AnyLayout(HStackLayout(spacing: 0))
        layout {
            if selection.textScale > 1.25 {
                HStack {
                ObservatoryPopup(title: "Dashboard section", labels: sections.map(\.1), values: sections.map(\.0), selection: $selection.section)
                Button { toggleAppearance() } label: {
                    Image(systemName: displayedAppearance == "dark" ? "sun.max" : "moon")
                }.accessibilityLabel(displayedAppearance == "dark" ? "Light mode" : "Dark mode")
                }.padding(16)
            } else {
            VStack(alignment: .leading, spacing: 10) {
                Label { Text("Observatory") } icon: { Image(nsImage: telescopeImage(template: true)).resizable().scaledToFit().frame(width: 24, height: 24) }
                    .observatoryFont(ObservatoryTheme.sectionSize, weight: .semibold).padding(.bottom, 24)
                ForEach(sections, id: \.0) { item in
                    Button { selection.section = item.0 } label: {
                        Label(item.1, systemImage: item.2)
                            .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 12).frame(height: 44)
                            .foregroundStyle(selection.section == item.0 ? ObservatoryTheme.text : ObservatoryTheme.muted)
                            .background(selection.section == item.0 ? ObservatoryTheme.surface : .clear, in: RoundedRectangle(cornerRadius: 14))
                    }.buttonStyle(.plain).accessibilityAddTraits(selection.section == item.0 ? .isSelected : [])
                }
                Spacer()
                Button { toggleAppearance() } label: {
                    Label(displayedAppearance == "dark" ? "Light mode" : "Dark mode", systemImage: displayedAppearance == "dark" ? "sun.max" : "moon")
                }
            }.padding(20).frame(width: 200 * selection.textScale)
            }
            VStack(spacing: 0) {
            dashboardHeader.padding(24).fixedSize(horizontal: false, vertical: true)
            ScrollViewReader { scroll in
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    if let message = store.pairingPauseMessage {
                        VStack(alignment: .leading, spacing: 8) {
                            Label("Collection paused", systemImage: "pause.circle")
                            Text(message).observatoryFont(.callout)
                            Button("Review pairing in Settings") { selection.section = "settings" }
                        }.foregroundStyle(.orange).accessibilityElement(children: .contain)
                    }
                    if archivedSnapshot != nil {
                        Button("Return to live data") { archivedSnapshot = nil; selectedDate = "" }
                    }
                    if let archive = archivedSnapshot {
                        Text("Recorded: \(text(archive.object["collectedAt"])). Read-only. Live collection continues separately. This snapshot is not added to current totals.")
                            .observatoryFont(.callout).foregroundStyle(.secondary)
                    }
                    if selection.section == "settings" {
                        if archivedSnapshot == nil {
                            NativeSettings(store: store, actions: settingsActions)
                        } else {
                            Text("Return to live data to change settings. Archived settings cannot be applied from this view.")
                        }
                    } else if selection.section == "allowances" {
                        if archivedSnapshot == nil {
                            ObservatoryAdaptiveRow {
                                Button("Browse saved history") { quotaHistoryOpen = true }
                                    .disabled(settingsActions.preview || store.shuttingDown || store.pairingMaintenance)
                                Text("All retained allowance readings").observatoryFont(.callout).foregroundStyle(ObservatoryTheme.muted)
                            }
                        }
                        Text("Observed on this Mac").observatoryFont(ObservatoryTheme.sectionSize, weight: .semibold).tracking(ObservatoryTheme.sectionTracking)
                        if let quota = displayedSnapshot?.object["quota"] as? JSONObject, text(quota["status"]) != "not-connected" {
                            let windows = visibleQuotaWindows(quota["windows"])
                            let columns = windows.count == 1 ? [GridItem(.flexible())] : [GridItem(.adaptive(minimum: 420), spacing: 18)]
                            if windows.isEmpty {
                                QuotaPanel(quota: quota, dashboard: true).modifier(ObservatoryCard())
                            }
                            LazyVGrid(columns: columns, alignment: .leading, spacing: 18) {
                                ForEach(Array(windows.enumerated()), id: \.offset) { _, window in
                                    QuotaPanel(quota: quota.merging(["windows": [window]]) { _, new in new }, dashboard: true)
                                        .modifier(ObservatoryCard())
                                }
                            }
                        } else {
                            ObservatoryEmptyState(title: "No account connected", systemImage: "gauge.with.dots.needle.50percent",
                                message: "Enable an available account source in local source settings. Saved token records are separate from account limits.")
                        }
                        if let peer = displayedSnapshot?.object["peerQuota"] as? JSONObject,
                           ["Mac", "Windows"].contains(text(peer["host"])) {
                            Text("Shared from \(text(peer["host"]))").observatoryFont(.headline)
                            Text("Received: \(text(peer["receivedAt"])). Separate account observation, never added to this Mac's totals.")
                                .observatoryFont(.callout).foregroundStyle(.secondary)
                            GroupBox { QuotaPanel(quota: peer, dashboard: true).padding(12) }
                        } else {
                            Text("No shared account history. Enable allowance sharing on both paired devices to receive it.")
                                .observatoryFont(.callout).foregroundStyle(.secondary)
                        }
                    } else if selection.section == "agents" {
                        VStack(alignment: .leading, spacing: 14) {
                            Text("Saved execution records, not a live agent monitor. Missing records are not zero usage.")
                                .foregroundStyle(ObservatoryTheme.muted)
                            if let help = receiptSourceHelp(displayedSnapshot?.object["agentSource"] as? JSONObject) {
                                Text(help).foregroundStyle(ObservatoryTheme.muted)
                            }
                            Button("Review collection settings") { selection.section = "settings" }
                            NativeAgentUsage(snapshot: displayedSnapshot)
                        }
                    } else if selection.section == "sources" {
                        sourceList
                    } else if selection.section == "dictation" {
                        NativeDictation(snapshot: displayedSnapshot)
                    } else {
                        dailyHistory
                    }
                    if selection.section == "settings" {
                        Text("Provider account management and unified account-history sync are still being developed.")
                            .observatoryFont(.caption).foregroundStyle(.secondary)
                    }
                }.padding(28).frame(maxWidth: 1100, alignment: .leading).frame(maxWidth: .infinity).id("dashboard-top")
            }
            .onChange(of: selection.section) { scroll.scrollTo("dashboard-top", anchor: .top) }
            .onChange(of: selection.navigationRequest) { scroll.scrollTo("dashboard-top", anchor: .top) }
            }
            }
        }
        .observatoryFont().foregroundStyle(ObservatoryTheme.text)
        .tint(ObservatoryTheme.sage).background(ObservatoryTheme.background)
        .groupBoxStyle(ObservatoryGroupBoxStyle()).buttonStyle(ObservatoryButtonStyle())
        .environment(\.observatoryTextScale, selection.textScale)
        .preferredColorScheme(displayedAppearance == "dark" ? .dark : .light)
        .onChange(of: host) { selectedDate = "" }
        .sheet(isPresented: $quotaHistoryOpen) {
            NativeQuotaArchive(runtime: store.runtime).environment(\.observatoryTextScale, selection.textScale)
        }
        .onChange(of: selection.section) { selectedDate = "" }
        .alert("Snapshot could not be opened", isPresented: $archiveError) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("Choose a saved Observatory JSON snapshot, no larger than 16 MB. Links, invalid files and changing files are rejected. Your current view and saved data were not changed.")
        }
    }

    private var dashboardHeader: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 16) {
                dashboardTitle.fixedSize(horizontal: true, vertical: false)
                Spacer()
                dashboardActions.fixedSize(horizontal: true, vertical: false)
            }
            VStack(alignment: .leading, spacing: 12) {
                dashboardTitle
                dashboardActions
            }
        }
    }

    private var dashboardTitle: some View {
        VStack(alignment: .leading, spacing: 4) {
                Text(sections.first(where: { $0.0 == selection.section })?.1 ?? "Allowances")
                    .observatoryFont(ObservatoryTheme.titleSize, weight: .semibold).tracking(ObservatoryTheme.titleTracking)
                Text(archivedSnapshot == nil ? store.freshness : "Saved snapshot. Not live data.")
                    .foregroundStyle(archivedSnapshot != nil || store.stale ? .orange : .secondary)
        }
    }

    private var dashboardActions: some View {
            ObservatoryAdaptiveRow {
                Button { selection.section = "settings"; selection.navigationRequest += 1 } label: { Label("Devices", systemImage: "laptopcomputer.and.iphone").fixedSize() }
                    .help("Review device pairing in Settings")
                Button(action: openArchive) { Image(systemName: "clock.arrow.circlepath") }
                    .help("Open saved snapshot").accessibilityLabel("Open saved snapshot")
                Button { store.refresh() } label: { Label("Refresh", systemImage: "arrow.clockwise").fixedSize() }
                    .disabled(store.refreshing || archivedSnapshot != nil)
            }
    }

    private func openArchive() {
        let panel = NSOpenPanel()
        panel.title = "Open saved Observatory snapshot"
        panel.allowedContentTypes = [.json]
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.begin { response in
            guard response == .OK, let url = panel.url else { return }
            do {
                let snapshot = try SnapshotArchive.read(url)
                archivedSnapshot = snapshot
                selectedDate = ""
            } catch { archiveError = true }
        }
    }

    private var dailyHistory: some View {
        let key = selection.section == "tokens" ? "tokens" : "activity"
        let field = key == "tokens" ? "totalTokens" : "seconds"
        let days = displayedSnapshot?.recordedDays(key, host: host) ?? []
        let anchor = text(days.first(where: { text($0["date"]) == selectedDate })?["date"] ?? days.last?["date"])
        let selected = nativePeriodDays(days, period: period, anchor: anchor)
        let chosen = nativePeriodSummary(selected, kind: key)
        let chartDays = Array(selected.suffix(30))
        let axisDates = chartDays.enumerated().compactMap { index, day in
            index == 0 || index == chartDays.count - 1 || (selection.textScale <= 1.25 && index == chartDays.count / 2)
                ? text(day["date"]) : nil
        }
        return VStack(alignment: .leading, spacing: 18) {
            ObservatoryFilterRow(title: "Device") {
                ObservatorySegments(title: "Device", labels: ["All", "Mac", "Windows", "Ubuntu"],
                    values: ["All", "Mac", "Windows", "Ubuntu"], selection: $host)
            }
            ObservatoryFilterRow(title: "Period") {
                ObservatorySegments(title: "Period", labels: ["Day", "Week", "All retained"],
                    values: ["day", "week", "all"], selection: $period)
            }
            if period != "all", !days.isEmpty {
                ObservatoryFilterRow(title: period == "week" ? "Week ending" : "Recorded day") {
                    ObservatoryPopup(title: "Recorded date", labels: days.map { text($0["date"]) }, values: days.map { text($0["date"]) },
                        selection: Binding(get: { anchor }, set: { selectedDate = $0 }))
                }
            }
            if key == "activity", let archive = displayedSnapshot?.activityArchive(host: host) {
                Text(text(archive["latestReadStatus"]) != "ok"
                    ? "Saved activity · source unavailable"
                    : text(archive["trackingStatus"]) == "recent"
                        ? "Saved activity · recent tracking coverage"
                        : text(archive["trackingStatus"]) == "stale"
                            ? "Saved activity · tracking is not current"
                            : "Saved activity · tracking freshness unknown")
                    .observatoryFont(.callout).foregroundStyle(ObservatoryTheme.muted)
                DisclosureGroup("Tracking details and help") {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(text(archive["trackingMessage"], fallback: "Tracking freshness is unknown for this saved snapshot."))
                            .observatoryFont(.callout).foregroundStyle(ObservatoryTheme.muted)
                        if let through = parseDate(archive["trackingThrough"]) {
                            Text("Last tracking coverage: \(through.formatted(date: .abbreviated, time: .shortened))")
                                .observatoryFont(.caption).foregroundStyle(ObservatoryTheme.muted)
                        }
                        if let at = parseDate(archive["asOf"]) {
                            Text("Last successful collection: \(at.formatted(date: .abbreviated, time: .shortened))")
                                .observatoryFont(.caption).foregroundStyle(ObservatoryTheme.muted)
                        }
                        if !days.isEmpty && text(archive["latestReadStatus"]) != "ok" { ActivityWatchHelp() }
                    }.padding(.top, 8)
                }
            }
            if days.isEmpty {
                ObservatoryEmptyState(title: "No verified records", systemImage: "chart.bar",
                    message: "This source is unavailable or has no saved records. Missing data is unknown, not zero.")
                if key == "activity" { ActivityWatchHelp() }
            } else {
                VStack(alignment: .leading, spacing: 16) {
                    Text(key == "tokens" ? "SAVED CODEX LOG TOKENS" : "FOREGROUND TIME")
                        .observatoryFont(.callout).foregroundStyle(ObservatoryTheme.muted)
                    HStack {
                        Text(key == "tokens" ? formatted(number(chosen?[field]), compact: true) : formattedDuration(number(chosen?[field])))
                            .observatoryFont(ObservatoryTheme.metricSize, weight: .semibold).monospacedDigit()
                        Spacer()
                    }
                    Text("\(text(selected.first?["date"])) to \(text(selected.last?["date"])) · \(selected.count) recorded \(selected.count == 1 ? "date" : "dates")")
                        .observatoryFont(.callout).foregroundStyle(ObservatoryTheme.muted)
                    Chart {
                        ForEach(Array(chartDays.enumerated()), id: \.offset) { _, day in
                            if let value = number(day[field]) {
                                BarMark(x: .value("Recorded day", text(day["date"])), y: .value(key == "tokens" ? "Tokens" : "Minutes", key == "tokens" ? value : value / 60), width: chartDays.count > 10 ? .ratio(0.8) : .fixed(40))
                                    .cornerRadius(4)
                            }
                        }
                    }.foregroundStyle(LinearGradient(colors: [ObservatoryTheme.sage, ObservatoryTheme.sage.opacity(0.8)], startPoint: .top, endPoint: .bottom))
                        .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: period)
                        .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: host)
                        .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: selectedDate)
                        .chartXAxis { AxisMarks(values: axisDates) { axis in
                            AxisTick()
                            AxisValueLabel(centered: chartDays.count == 1,
                                           anchor: chartDays.count == 1 ? .top : axis.as(String.self) == axisDates.last ? .topTrailing : .topLeading,
                                           collisionResolution: .greedy) {
                                if let date = axis.as(String.self) {
                                    Text(String(date.suffix(5)).replacingOccurrences(of: "-", with: "/"))
                                        .font(ObservatoryTheme.font(ObservatoryTheme.chartLabelSize * selection.textScale))
                                        .fixedSize()
                                }
                            }
                        } }
                        .chartYAxis { AxisMarks(values: .automatic(desiredCount: 4)) { axis in
                            AxisGridLine()
                            AxisValueLabel {
                                if let value = axis.as(Double.self) {
                                    Text(key == "tokens" ? formatted(value, compact: true) : "\(formatted(value)) min")
                                        .font(ObservatoryTheme.font(ObservatoryTheme.chartLabelSize * selection.textScale))
                                }
                            }
                        } }
                        .frame(height: 220 * selection.textScale).accessibilityLabel("Up to 30 recorded days. Missing dates are not zero.")
                    Text("Up to 30 recorded days shown. Missing dates are not filled with zeros.")
                        .observatoryFont(.callout).foregroundStyle(ObservatoryTheme.muted)
                }.frame(maxWidth: .infinity, alignment: .leading).modifier(ObservatoryCard())
                Text(key == "tokens" ? "Recorded Codex requests only. Saved log tokens are not subscription charges. Combined totals require verified deduplication."
                    : "Recorded foreground time, not attention. Combined activity counts device overlap once. WSL activity belongs to Windows.")
                    .observatoryFont(.callout).foregroundStyle(ObservatoryTheme.muted)
                if key == "tokens", let chosen {
                    NativeTokenDetails(day: chosen, recordedDays: selected, snapshot: displayedSnapshot, host: host)
                } else if let chosen {
                    NativeActivityDetails(day: chosen, showHours: period == "day")
                }
            }
        }
    }

    private var sourceList: some View {
        VStack(alignment: .leading, spacing: 14) {
            let receipts = rows(displayedSnapshot?.object["agents"])
            let latest = receipts.compactMap { parseDate($0["recordedAt"]) }.max()
            Text("Saved execution records").observatoryFont(.headline)
            Text("\(receipts.count) handoff receipts · \(receipts.filter { text($0["status"]) == "failed" }.count) saved failures. Not a live agent monitor.")
                .observatoryFont(.callout).foregroundStyle(.secondary)
            Text("Newest receipt: \(latest.map { $0.formatted(date: .abbreviated, time: .shortened) } ?? "Unknown"). Source: \(text((displayedSnapshot?.object["agentSource"] as? JSONObject)?["status"])).")
                .observatoryFont(.caption).foregroundStyle(.secondary)
            if let help = receiptSourceHelp(displayedSnapshot?.object["agentSource"] as? JSONObject) {
                Label(help, systemImage: "exclamationmark.circle")
                    .observatoryFont(.callout).foregroundStyle(ObservatoryTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Button("View Agents") { selection.section = "agents" }
            GroupBox("Provider token sources") {
                VStack(alignment: .leading, spacing: 10) {
                    codexProviderRow
                    providerTokenRow(name: "Claude Code", source: rows(displayedSnapshot?.object["providerTokenSources"]).first { text($0["provider"]) == "claude-code" }, fallback: "Unknown · enable local Claude Code request collection")
                    providerTokenRow(name: "ChatGPT", source: nil, fallback: "Unknown · no connected personal token export")
                    providerTokenRow(name: "Cursor", source: nil, fallback: "Unknown · no connected personal token export")
                    providerTokenRow(name: "Antigravity", source: nil, fallback: "Unknown · no connected personal token export")
                }.padding(8).frame(maxWidth: .infinity, alignment: .leading)
            }
            ForEach(["activity", "tokens", "settings", "dictation", "quota", "localModel", "agentSource"], id: \.self) { key in
                GroupBox(["quota": "Allowances", "localModel": "Local benchmarks", "agentSource": "Agent receipts", "settings": "Tool activity"][key] ?? key.capitalized) {
                    VStack(alignment: .leading, spacing: 10) {
                        let sources = nativeDashboardSources(displayedSnapshot?.object[key], key: key)
                        if sources.isEmpty { Text("No source records").foregroundStyle(.secondary) }
                        ForEach(Array(sources.enumerated()), id: \.offset) { _, source in
                            ObservatoryValueRow(text(source["host"]) + " · " + text(source["source"], fallback: key), value: text(source["status"]))
                            ObservatoryValueRow("Last checked", value: parseDate(source["checkedAt"]).map { $0.formatted(date: .abbreviated, time: .shortened) } ?? "Unknown")
                        }
                    }.padding(8).frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }

    private var codexProviderRow: some View {
        let count = rows(displayedSnapshot?.object["tokens"]).filter { text($0["status"]) == "ok" }.count
        return VStack(alignment: .leading, spacing: 3) {
            ObservatoryValueRow("Codex", value: count == 0 ? "Unknown · no recorded device source" : "\(count) configured \(count == 1 ? "device" : "devices")")
            Text("Recorded Codex requests. HAPI and Happy relay records use the same native log store.")
                .observatoryFont(.caption).foregroundStyle(ObservatoryTheme.muted)
        }
    }

    @ViewBuilder private func providerTokenRow(name: String, source: JSONObject?, fallback: String) -> some View {
        if let source, text(source["status"]) == "ok", let summary = providerTokenSummary(source) {
            let dates = summary.dates
            ObservatoryValueRow(name, value: "Recorded local requests · \(formatted(summary.total, compact: true)) tokens")
            Text("\(dates.first!.formatted(date: .abbreviated, time: .omitted)) to \(dates.last!.formatted(date: .abbreviated, time: .omitted)) · \(text(source["scope"], fallback: "Local device only"))")
                .observatoryFont(.caption).foregroundStyle(ObservatoryTheme.muted)
            Text("Last checked: \(parseDate(source["checkedAt"]).map { $0.formatted(date: .abbreviated, time: .shortened) } ?? "Unknown")")
                .observatoryFont(.caption).foregroundStyle(ObservatoryTheme.muted)
        } else if let source {
            ObservatoryValueRow(name, value: providerSourceStatus(source))
            Text("Last checked: \(parseDate(source["checkedAt"]).map { $0.formatted(date: .abbreviated, time: .shortened) } ?? "Unknown")")
                .observatoryFont(.caption).foregroundStyle(ObservatoryTheme.muted)
        } else {
            ObservatoryValueRow(name, value: fallback)
        }
    }

    private func providerSourceStatus(_ source: JSONObject) -> String {
        switch text(source["status"]) {
        case "not-connected": return "Collection off"
        case "unavailable": return "Unknown"
        default: return "Unknown"
        }
    }

    private func providerTokenSummary(_ source: JSONObject) -> (total: Double, dates: [Date])? {
        let limit = 9_007_199_254_740_991.0
        let days = rows(source["days"])
        guard !days.isEmpty else { return nil }
        var total = 0.0, dates: [Date] = []
        for day in days {
            guard let value = number(day["totalTokens"]), value <= limit,
                  let date = ISO8601DateFormatter().date(from: text(day["date"]) + "T00:00:00Z"),
                  total <= limit - value else { return nil }
            total += value; dates.append(date)
        }
        return (total, dates.sorted())
    }
}

func nativeDashboardSources(_ value: Any?, key: String) -> [JSONObject] {
    let sources = (value as? JSONObject).map { [$0] } ?? rows(value)
    return sources.filter { key != "dictation" || text($0["source"]).lowercased() != "typewhisper" }
}
