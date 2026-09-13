import SwiftUI

struct ObservatoryPanel: View {
    @ObservedObject var store: ObservatoryStore
    @State private var host = "Mac"
    let open: (String) -> Void
    let settings: () -> Void
    var panelWidth: CGFloat = 370
    var compact = false
    private let accent = Color(red: 245/255, green: 245/255, blue: 245/255)

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Image(nsImage: telescopeImage()).resizable().scaledToFit().frame(width: 28, height: 28)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Observatory").font(.system(size: 15, weight: .semibold))
                    Text(store.refreshing ? "Refreshing sources…" : store.freshness)
                        .font(.system(size: 12)).foregroundStyle(store.stale ? .orange : .secondary)
                }
                Spacer()
                Button(action: { store.refresh() }) {
                    Image(systemName: "arrow.clockwise").font(.system(size: 14))
                }.buttonStyle(.plain).disabled(store.refreshing).help("Refresh sources")
                    .accessibilityLabel("Refresh sources")
            }

            if let snapshot = store.snapshot {
                if let quota = snapshot.object["quota"] as? JSONObject, text(quota["status"]) != "not-connected" {
                    let windows = visibleQuotaWindows(quota["windows"])
                    if !windows.isEmpty {
                        VStack(spacing: 10) {
                            HStack {
                                Text("ALLOWANCE").font(.system(size: 11, weight: .semibold))
                                Spacer()
                                Text(text(quota["status"]) == "stale" ? "saved reading" : "remaining").font(.system(size: 11))
                            }.foregroundStyle(.secondary)
                            ForEach(Array(windows.prefix(compact ? 1 : 2).enumerated()), id: \.offset) { _, window in
                                allowance(window)
                            }
                        }.padding(12)
                        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
                    }
                }
                Picker("Source host", selection: $host) {
                    ForEach(["All", "Mac", "Windows", "Ubuntu"], id: \.self) { Text($0).tag($0) }
                }.pickerStyle(.segmented)

                VStack(spacing: 0) {
                    let activity = snapshot.latest("activity", host: host)
                    stat("Active time", icon: "waveform.path", value: minutes(number(activity?["seconds"])),
                         date: text(activity?["date"], fallback: "No retained records") + (host == "All" ? " · Mac + Windows" : ""), target: "activity")
                    Divider().opacity(0.35).padding(.leading, 39)
                    let tokens = snapshot.latest("tokens", host: host)
                    stat("Tokens", icon: "square.stack.3d.up", value: formatted(number(tokens?["totalTokens"]), compact: true),
                         date: text(tokens?["date"], fallback: host == "All" ? "Combined total unavailable" : "No retained records"), target: "tokens")
                    if !compact {
                    Divider().opacity(0.35).padding(.leading, 39)
                    let wispr = snapshot.latest("dictation", host: host, source: "Wispr Flow")
                    let covered = number(wispr?["audioRecords"]) ?? 0
                    let partial = covered < (number(wispr?["transcriptions"]) ?? 0)
                    if host == "All" {
                        stat("Wispr audio", icon: "waveform", value: "By device",
                             date: "Synced records can overlap", target: "dictation")
                    } else {
                        stat("Wispr audio", icon: "waveform", value: covered > 0 ? minutes(number(wispr?["audioSeconds"])) : "Unknown",
                             date: text(wispr?["date"], fallback: "No retained records") + (partial ? " · partial" : ""), target: "dictation")
                    }
                    }
                }
                if host == "All" {
                    Text("Tokens include Mac, Windows and Ubuntu. WSL activity is part of Windows screen time.")
                        .font(.system(size: 11)).foregroundStyle(.secondary)
                }
                let counts = snapshot.sourceCounts
                HStack(spacing: 6) {
                    Circle().fill(counts.read == counts.total && !store.stale ? accent : .orange).frame(width: 5, height: 5)
                    Text("\(counts.read) of \(counts.total) sources read").font(.system(size: 12)).foregroundStyle(.secondary)
                    Spacer()
                    if store.lastAttempt == "failed" || store.lastAttempt == "runtime-unavailable" {
                        Text("Refresh failed").font(.system(size: 12)).foregroundStyle(.orange)
                    }
                }
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Your workspace, at a glance.").font(.system(size: 16, weight: .medium))
                    Text("Waiting for the first local snapshot. Sources refresh automatically while this Mac is awake.")
                        .font(.system(size: 13)).foregroundStyle(.secondary)
                }.padding(.vertical, 20)
            }
            HStack {
                Button(action: { open("allowances") }) {
                    HStack { Text("Open Observatory"); Spacer(); Image(systemName: "arrow.up.right") }
                        .font(.system(size: 13, weight: .medium)).padding(.horizontal, 13).padding(.vertical, 11)
                        .foregroundStyle(accent)
                        .modifier(ObservatoryGlassControl())
                }.buttonStyle(.plain)
                Button(action: settings) { Image(systemName: "gearshape").frame(width: 34, height: 36) }
                    .buttonStyle(.plain).foregroundStyle(.secondary).accessibilityLabel("Observatory settings")
            }
        }
        .padding(14).frame(width: panelWidth)
        .preferredColorScheme(.dark)
    }

    private func minutes(_ seconds: Double?) -> String {
        guard let seconds else { return "Unknown" }
        if seconds >= 3600 { return "\(Int(seconds / 3600))h \(Int(seconds.truncatingRemainder(dividingBy: 3600) / 60))m" }
        return "\(formatted(seconds / 60)) min"
    }

    private func stat(_ title: String, icon: String, value: String, date: String, target: String) -> some View {
        Button(action: { open(target) }) {
            HStack(spacing: 12) {
                Image(systemName: icon).font(.system(size: 17)).foregroundStyle(.secondary).frame(width: 27)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(.system(size: 13, weight: .medium))
                    Text(date).font(.system(size: 11)).foregroundStyle(.secondary)
                }
                Spacer()
                Text(value).font(.system(size: 19, weight: .medium, design: .rounded)).monospacedDigit()
            }.padding(.vertical, 8).contentShape(Rectangle())
        }.buttonStyle(.plain)
    }

    private func allowance(_ window: JSONObject) -> some View {
        let remaining = number(window["remainingPercent"]).flatMap { $0 <= 100 ? $0 : nil }
        return HStack(spacing: 12) {
            ZStack {
                Circle().stroke(.white.opacity(0.1), lineWidth: 3)
                Circle().trim(from: 0, to: (remaining ?? 0) / 100)
                    .stroke(accent, style: StrokeStyle(lineWidth: 3, lineCap: .round)).rotationEffect(.degrees(-90))
            }.frame(width: 29, height: 29).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(text(window["bucket"])).font(.system(size: 12, weight: .medium)).lineLimit(1)
                Text(number(window["durationMinutes"]).map { $0 >= 1440 ? "\(formatted($0 / 1440))-day window" : "\(formatted($0 / 60))-hour window" } ?? text(window["window"]))
                    .font(.system(size: 11)).foregroundStyle(.secondary)
            }
            Spacer()
            Text(remaining.map { "\(formatted($0))%" } ?? "Unknown").font(.system(size: 17, weight: .medium, design: .rounded))
        }
        .help(parseDate(window["resetsAt"]).map { "Resets \($0.formatted(date: .abbreviated, time: .shortened))" } ?? "Reset time unknown")
    }
}
