import SwiftUI
import Charts
import UniformTypeIdentifiers

@MainActor
final class NativeDashboardSelection: ObservableObject {
    static let sections = [("allowances", "Allowances", "gauge.with.dots.needle.50percent"),
                           ("activity", "Activity", "waveform.path"), ("tokens", "Tokens", "square.stack.3d.up"),
                           ("dictation", "Dictation", "mic"),
                           ("agents", "Agents", "rectangle.stack.person.crop"),
                           ("sources", "Sources", "externaldrive.connected.to.line.below"), ("settings", "Settings", "gearshape")]
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
                    .observatoryFont(19, weight: .semibold).padding(.bottom, 24)
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
                        if archivedSnapshot == nil && !settingsActions.preview {
                            Button("Browse saved allowance history") { quotaHistoryOpen = true }
                                .disabled(store.shuttingDown || store.pairingMaintenance)
                        }
                        Text("Observed on this Mac").observatoryFont(19, weight: .semibold).tracking(0.6)
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
                    Text("Provider account management and unified account-history sync are still being developed.")
                        .observatoryFont(.caption).foregroundStyle(.secondary)
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
        ObservatoryAdaptiveRow {
            VStack(alignment: .leading, spacing: 4) {
                Text(sections.first(where: { $0.0 == selection.section })?.1 ?? "Allowances")
                    .observatoryFont(22, weight: .semibold).tracking(-0.7)
                Text(archivedSnapshot == nil ? store.freshness : "Saved snapshot. Not live data.")
                    .foregroundStyle(archivedSnapshot != nil || store.stale ? .orange : .secondary)
            }
            Spacer()
            HStack {
                Button { selection.section = "settings"; selection.navigationRequest += 1 } label: { Label("Devices", systemImage: "laptopcomputer.and.iphone") }
                    .help("Review device pairing in Settings")
                Button(action: openArchive) { Image(systemName: "clock.arrow.circlepath") }
                    .help("Open saved snapshot").accessibilityLabel("Open saved snapshot")
                Button { store.refresh() } label: { Label("Refresh", systemImage: "arrow.clockwise") }
                    .disabled(store.refreshing || archivedSnapshot != nil)
            }
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
                Text("Saved activity history. Last source check: \(text(archive["latestReadStatus"])).")
                    .observatoryFont(.callout).foregroundStyle(.secondary)
                if !days.isEmpty && text(archive["latestReadStatus"]) != "ok" { ActivityWatchHelp() }
                Text(text(archive["trackingMessage"], fallback: "Tracking freshness is unknown for this saved snapshot."))
                    .observatoryFont(.callout).foregroundStyle(text(archive["trackingStatus"]) == "stale" ? Color.orange : ObservatoryTheme.muted)
                if let through = parseDate(archive["trackingThrough"]) {
                    Text("Last tracking coverage: \(through.formatted(date: .abbreviated, time: .shortened))")
                        .observatoryFont(.caption).foregroundStyle(.secondary)
                }
                if let at = parseDate(archive["asOf"]) {
                    Text("Last successful collection: \(at.formatted(date: .abbreviated, time: .shortened))")
                        .observatoryFont(.caption).foregroundStyle(.secondary)
                }
            }
            if days.isEmpty {
                ObservatoryEmptyState(title: "No verified records", systemImage: "chart.bar",
                    message: "This source is unavailable or has no saved records. Missing data is unknown, not zero.")
                if key == "activity" { ActivityWatchHelp() }
            } else {
                HStack {
                    Text(key == "tokens" ? formatted(number(chosen?[field]), compact: true) : "\(formatted(number(chosen?[field]).map { $0 / 60 })) min")
                        .observatoryFont(38, weight: .semibold, design: .rounded).monospacedDigit()
                    Spacer()
                }
                Text("\(text(selected.first?["date"])) to \(text(selected.last?["date"])), \(selected.count) recorded dates. Missing dates are not filled with zeros.")
                    .observatoryFont(.callout).foregroundStyle(.secondary)
                Text("Selected recorded days (up to 30 shown)").observatoryFont(.headline)
                Chart {
                    ForEach(Array(selected.suffix(30).enumerated()), id: \.offset) { _, day in
                        if let value = number(day[field]) {
                            BarMark(x: .value("Recorded day", text(day["date"])), y: .value(key == "tokens" ? "Tokens" : "Minutes", key == "tokens" ? value : value / 60), width: .fixed(40))
                                .cornerRadius(4)
                        }
                    }
                }.foregroundStyle(ObservatoryTheme.sage)
                    .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: period)
                    .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: host)
                    .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: selectedDate)
                    .chartXAxis { AxisMarks(values: .automatic(desiredCount: 3)) {
                        AxisTick(); AxisValueLabel().font(ObservatoryTheme.font(11 * selection.textScale))
                    } }
                    .chartYAxis { AxisMarks(values: .automatic(desiredCount: 4)) { axis in
                        AxisGridLine()
                        AxisValueLabel {
                            if let value = axis.as(Double.self) {
                                Text(formatted(value, compact: true)).font(ObservatoryTheme.font(11 * selection.textScale))
                            }
                        }
                    } }
                    .frame(height: 220 * selection.textScale).modifier(ObservatoryCard()).accessibilityLabel("Up to 30 recorded days. Missing dates are not zero.")
                Text(key == "tokens" ? "Saved log tokens, not subscription charges. Combined totals require verified deduplication."
                    : "Recorded foreground time, not attention. Combined activity counts device overlap once. WSL activity belongs to Windows.")
                    .observatoryFont(.callout).foregroundStyle(.secondary)
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
}

func nativeDashboardSources(_ value: Any?, key: String) -> [JSONObject] {
    let sources = (value as? JSONObject).map { [$0] } ?? rows(value)
    return sources.filter { key != "dictation" || text($0["source"]).lowercased() != "typewhisper" }
}
