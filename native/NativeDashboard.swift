import SwiftUI
import Charts
import UniformTypeIdentifiers

@MainActor
final class NativeDashboardSelection: ObservableObject {
    static let sections = [("allowances", "Allowances", "gauge.with.dots.needle.50percent"),
                           ("activity", "Activity", "waveform.path"), ("tokens", "Tokens", "square.stack.3d.up"),
                           ("dictation", "Dictation", "mic"),
                           ("sources", "Sources", "externaldrive.connected.to.line.below"), ("settings", "Settings", "gearshape")]
    @Published var section = "allowances"
}

// Native dashboard. It consumes the existing sanitized
// snapshot and never sums overlapping device records or reads raw source files.
struct NativeDashboard: View {
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
    private var displayedSnapshot: Snapshot? { archivedSnapshot ?? store.snapshot }
    private let sections = NativeDashboardSelection.sections

    var body: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 10) {
                Label { Text("Observatory") } icon: { Image(nsImage: telescopeImage(template: true)).resizable().scaledToFit().frame(width: 24, height: 24) }
                    .font(ObservatoryTheme.font(19, weight: .semibold)).padding(.bottom, 24)
                ForEach(sections, id: \.0) { item in
                    Button { selection.section = item.0 } label: {
                        Label(item.1, systemImage: item.2)
                            .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 12).frame(height: 44)
                            .foregroundStyle(selection.section == item.0 ? ObservatoryTheme.text : ObservatoryTheme.muted)
                            .background(selection.section == item.0 ? ObservatoryTheme.surface : .clear, in: RoundedRectangle(cornerRadius: 14))
                    }.buttonStyle(.plain).accessibilityAddTraits(selection.section == item.0 ? .isSelected : [])
                }
                Spacer()
                Button { appearance = appearance == "dark" ? "light" : "dark" } label: {
                    Label(appearance == "dark" ? "Light mode" : "Dark mode", systemImage: appearance == "dark" ? "sun.max" : "moon")
                }
            }.padding(20).frame(width: 200)
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(sections.first(where: { $0.0 == selection.section })?.1 ?? "Activity")
                                .font(ObservatoryTheme.font(22, weight: .semibold)).tracking(-0.7)
                            Text(archivedSnapshot == nil ? store.freshness : "Saved snapshot. Not live data.")
                                .foregroundStyle(archivedSnapshot != nil || store.stale ? .orange : .secondary)
                        }
                        Spacer()
                        Button(action: openArchive) { Image(systemName: "clock.arrow.circlepath") }
                            .help("Open saved snapshot").accessibilityLabel("Open saved snapshot")
                        Button { store.refresh() } label: { Label("Refresh", systemImage: "arrow.clockwise") }
                            .disabled(store.refreshing || archivedSnapshot != nil)
                    }
                    if archivedSnapshot != nil {
                        Button("Return to live data") { archivedSnapshot = nil; selectedDate = "" }
                    }
                    if let archive = archivedSnapshot {
                        Text("Recorded: \(text(archive.object["collectedAt"])). Read-only. Live collection continues separately. This snapshot is not added to current totals.")
                            .font(.callout).foregroundStyle(.secondary)
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
                        Text("Observed on this Mac").font(ObservatoryTheme.font(19, weight: .semibold)).tracking(0.6)
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
                            ContentUnavailableView("No account connected", systemImage: "gauge.with.dots.needle.50percent",
                                description: Text("Enable an available account source in local source settings. Saved token records are separate from account limits."))
                        }
                        if let peer = displayedSnapshot?.object["peerQuota"] as? JSONObject,
                           ["Mac", "Windows"].contains(text(peer["host"])) {
                            Text("Shared from \(text(peer["host"]))").font(.headline)
                            Text("Received: \(text(peer["receivedAt"])). Separate account observation, never added to this Mac's totals.")
                                .font(.callout).foregroundStyle(.secondary)
                            GroupBox { QuotaPanel(quota: peer, dashboard: true).padding(12) }
                        } else {
                            Text("No shared account history. Enable allowance sharing on both paired devices to receive it.")
                                .font(.callout).foregroundStyle(.secondary)
                        }
                    } else if selection.section == "sources" {
                        sourceList
                    } else if selection.section == "dictation" {
                        NativeDictation(snapshot: displayedSnapshot)
                    } else {
                        dailyHistory
                    }
                    Text("Provider account management and unified account-history sync are still being developed.")
                        .font(.caption).foregroundStyle(.secondary)
                }.padding(28).frame(maxWidth: 1100, alignment: .leading).frame(maxWidth: .infinity)
            }
        }
        .font(ObservatoryTheme.font()).foregroundStyle(ObservatoryTheme.text)
        .tint(ObservatoryTheme.sage).background(ObservatoryTheme.background)
        .groupBoxStyle(ObservatoryGroupBoxStyle()).buttonStyle(ObservatoryButtonStyle())
        .preferredColorScheme(appearance == "dark" ? .dark : .light)
        .onChange(of: host) { selectedDate = "" }
        .sheet(isPresented: $quotaHistoryOpen) { NativeQuotaArchive(runtime: store.runtime) }
        .onChange(of: selection.section) { selectedDate = "" }
        .alert("Snapshot could not be opened", isPresented: $archiveError) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("Choose a saved Observatory JSON snapshot, no larger than 16 MB. Links, invalid files and changing files are rejected. Your current view and saved data were not changed.")
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
                    Picker("Recorded date", selection: Binding(get: { anchor }, set: { selectedDate = $0 })) {
                        ForEach(Array(days.enumerated()), id: \.offset) { _, day in Text(text(day["date"])).tag(text(day["date"])) }
                    }
                }
            }
            if key == "activity", let archive = displayedSnapshot?.activityArchive(host: host) {
                Text("Saved activity history. Last source check: \(text(archive["latestReadStatus"])).")
                    .font(.callout).foregroundStyle(.secondary)
                Text(text(archive["trackingMessage"], fallback: "Tracking freshness is unknown for this saved snapshot."))
                    .font(.callout).foregroundStyle(text(archive["trackingStatus"]) == "stale" ? Color.orange : ObservatoryTheme.muted)
                if let through = parseDate(archive["trackingThrough"]) {
                    Text("Last tracking coverage: \(through.formatted(date: .abbreviated, time: .shortened))")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if let at = parseDate(archive["asOf"]) {
                    Text("Last successful collection: \(at.formatted(date: .abbreviated, time: .shortened))")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            if days.isEmpty {
                ContentUnavailableView("No verified records", systemImage: "chart.bar",
                    description: Text("This source is unavailable or has no saved records. Missing data is unknown, not zero."))
            } else {
                HStack {
                    Text(key == "tokens" ? formatted(number(chosen?[field]), compact: true) : "\(formatted(number(chosen?[field]).map { $0 / 60 })) min")
                        .font(.system(size: 38, weight: .semibold, design: .rounded)).monospacedDigit()
                    Spacer()
                }
                Text("\(text(selected.first?["date"])) to \(text(selected.last?["date"])), \(selected.count) recorded dates. Missing dates are not filled with zeros.")
                    .font(.callout).foregroundStyle(.secondary)
                Text("Selected recorded days (up to 30 shown)").font(.headline)
                Chart {
                    ForEach(Array(selected.suffix(30).enumerated()), id: \.offset) { _, day in
                        if let value = number(day[field]) {
                            BarMark(x: .value("Recorded day", text(day["date"])), y: .value(key == "tokens" ? "Tokens" : "Minutes", key == "tokens" ? value : value / 60))
                        }
                    }
                }.foregroundStyle(key == "tokens" ? ObservatoryTheme.purple : ObservatoryTheme.sage)
                    .frame(height: 220).modifier(ObservatoryCard()).accessibilityLabel("Up to 30 recorded days. Missing dates are not zero.")
                Text(key == "tokens" ? "Saved log tokens, not subscription charges. Combined totals require verified deduplication."
                    : "Recorded foreground time, not attention. Combined activity counts device overlap once. WSL activity belongs to Windows.")
                    .font(.callout).foregroundStyle(.secondary)
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
            Text("Saved execution records").font(.headline)
            Text("\(receipts.count) handoff receipts · \(receipts.filter { text($0["status"]) == "failed" }.count) saved failures. Not a live agent monitor.")
                .font(.callout).foregroundStyle(.secondary)
            Text("Newest receipt: \(latest.map { $0.formatted(date: .abbreviated, time: .shortened) } ?? "Unknown"). Source: \(text((displayedSnapshot?.object["agentSource"] as? JSONObject)?["status"])).")
                .font(.caption).foregroundStyle(.secondary)
            if let help = receiptSourceHelp(displayedSnapshot?.object["agentSource"] as? JSONObject) {
                Label(help, systemImage: "exclamationmark.circle")
                    .font(.callout).foregroundStyle(ObservatoryTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            DisclosureGroup("Execution details: receipts, benchmarks and tool requests") {
                NativeAgentUsage(snapshot: displayedSnapshot).padding(.top, 8)
            }
            ForEach(["activity", "tokens", "settings", "dictation"], id: \.self) { key in
                GroupBox(key.capitalized) {
                    VStack(alignment: .leading, spacing: 10) {
                        let sources = rows(displayedSnapshot?.object[key])
                        if sources.isEmpty { Text("No source records").foregroundStyle(.secondary) }
                        ForEach(Array(sources.enumerated()), id: \.offset) { _, source in
                            LabeledContent(text(source["host"]) + " · " + text(source["source"], fallback: key), value: text(source["status"]))
                        }
                    }.padding(8).frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }
}
