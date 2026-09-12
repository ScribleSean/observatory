import SwiftUI
import Charts

@MainActor
final class NativeDashboardSelection: ObservableObject {
    @Published var section = "activity"
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
    private let sections = [("activity", "Activity", "waveform.path"), ("tokens", "Tokens", "square.stack.3d.up"),
                            ("allowances", "Allowances", "gauge.with.dots.needle.50percent"), ("agents", "Agents", "point.3.connected.trianglepath.dotted"),
                            ("dictation", "Dictation", "mic"), ("sources", "Sources", "externaldrive.connected.to.line.below"), ("settings", "Settings", "gearshape")]

    var body: some View {
        NavigationSplitView {
            List(selection: $selection.section) {
                ForEach(sections, id: \.0) { item in
                    Label(item.1, systemImage: item.2).tag(item.0)
                }
            }.navigationTitle("Observatory")
                .navigationSplitViewColumnWidth(min: 165, ideal: 195, max: 240)
        } detail: {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(sections.first(where: { $0.0 == selection.section })?.1 ?? "Activity").font(.largeTitle.bold())
                            Text(store.freshness).foregroundStyle(store.stale ? .orange : .secondary)
                        }
                        Spacer()
                        Button { store.refresh() } label: { Label("Refresh", systemImage: "arrow.clockwise") }
                            .disabled(store.refreshing)
                    }
                    if selection.section == "settings" {
                        NativeSettings(store: store, actions: settingsActions)
                    } else if selection.section == "allowances" {
                        if let quota = store.snapshot?.object["quota"] as? JSONObject, text(quota["status"]) != "not-connected" {
                            GroupBox { QuotaPanel(quota: quota).padding(12) }
                        } else {
                            ContentUnavailableView("No account connected", systemImage: "gauge.with.dots.needle.50percent",
                                description: Text("Enable an available account source in local source settings. Saved token records are separate from account limits."))
                        }
                    } else if selection.section == "sources" {
                        sourceList
                    } else if selection.section == "dictation" {
                        NativeDictation(snapshot: store.snapshot)
                    } else if selection.section == "agents" {
                        NativeAgentUsage(snapshot: store.snapshot)
                    } else {
                        dailyHistory
                    }
                    Text("Provider account management and unified account-history sync are still being developed.")
                        .font(.caption).foregroundStyle(.secondary)
                }.padding(28).frame(maxWidth: 1100, alignment: .leading)
            }.background(Color(nsColor: .windowBackgroundColor))
        }
        .onChange(of: host) { selectedDate = "" }
        .onChange(of: selection.section) { selectedDate = "" }
    }

    private var dailyHistory: some View {
        let key = selection.section == "tokens" ? "tokens" : "activity"
        let field = key == "tokens" ? "totalTokens" : "seconds"
        let days = store.snapshot?.recordedDays(key, host: host) ?? []
        let anchor = text(days.first(where: { text($0["date"]) == selectedDate })?["date"] ?? days.last?["date"])
        let selected = nativePeriodDays(days, period: period, anchor: anchor)
        let chosen = nativePeriodSummary(selected, kind: key)
        return VStack(alignment: .leading, spacing: 18) {
            Picker("Device", selection: $host) {
                ForEach(["All", "Mac", "Windows", "Ubuntu"], id: \.self) { Text($0).tag($0) }
            }.pickerStyle(.segmented)
            Picker("Period", selection: $period) {
                Text("Day").tag("day")
                Text("Week").tag("week")
                Text("All retained").tag("all")
            }.pickerStyle(.segmented)
            if key == "activity", let archive = store.snapshot?.activityArchive(host: host) {
                Text("Saved activity history. Last source check: \(text(archive["latestReadStatus"])).")
                    .font(.callout).foregroundStyle(.secondary)
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
                    Picker(period == "week" ? "Week ending" : "Recorded day", selection: Binding(get: { anchor }, set: { selectedDate = $0 })) {
                        ForEach(Array(days.enumerated()), id: \.offset) { _, day in Text(text(day["date"])).tag(text(day["date"])) }
                    }.frame(maxWidth: 210).disabled(period == "all")
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
                }.frame(height: 220).accessibilityLabel("Up to 30 recorded days. Missing dates are not zero.")
                Text(key == "tokens" ? "Saved log tokens, not subscription charges. Combined totals require verified deduplication."
                    : "Recorded foreground time, not attention. Combined activity counts device overlap once. WSL activity belongs to Windows.")
                    .font(.callout).foregroundStyle(.secondary)
                if key == "tokens", let chosen {
                    NativeTokenDetails(day: chosen, recordedDays: selected, snapshot: store.snapshot, host: host)
                } else if let chosen {
                    NativeActivityDetails(day: chosen, showHours: period == "day")
                }
            }
        }
    }

    private var sourceList: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(["activity", "tokens", "settings", "dictation"], id: \.self) { key in
                GroupBox(key.capitalized) {
                    VStack(alignment: .leading, spacing: 10) {
                        let sources = rows(store.snapshot?.object[key])
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
