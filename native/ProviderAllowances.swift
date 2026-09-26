import SwiftUI

func antigravityPoolLabel(_ id: String, index: Int) -> String {
    return "Allowance \(index + 1)"
}

func antigravitySourceStatus(_ source: JSONObject?, now: Date) -> String {
    let state = text(source?["status"], fallback: "not-connected")
    if state == "not-connected" { return "Collection off" }
    guard state == "ok" else { return "Unknown" }
    guard let checked = parseDate(source?["checkedAt"]), now.timeIntervalSince(checked) >= 0,
          now.timeIntervalSince(checked) < 600 else { return "Saved reading" }
    return "Latest reading"
}

struct AntigravityAllowancePanel: View {
    let source: JSONObject?
    var now = Date()
    private var state: String { text(source?["status"], fallback: "not-connected") }
    private var guidance: String {
        if state == "not-connected" { return "Enable Antigravity allowance monitoring in Settings." }
        if state == "unsupported" { return "The installed Antigravity CLI returned an unsupported format." }
        if state != "ok" { return "Open the installed Antigravity CLI to check its sign-in, then refresh sources." }
        if antigravitySourceStatus(source, now: now) == "Saved reading" { return "This is a saved observation. Refresh sources for current limits." }
        return "Checks run with full source collection, normally every five minutes."
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ObservatoryValueRow("Antigravity", value: antigravitySourceStatus(source, now: now))
            Text("Current provider limits. Token history is not connected.").observatoryFont(.callout).foregroundStyle(ObservatoryTheme.muted)
            Text(guidance).observatoryFont(.callout).foregroundStyle(ObservatoryTheme.muted)
            ObservatoryValueRow("Last checked", value: parseDate(source?["checkedAt"]).map { $0.formatted(date: .abbreviated, time: .shortened) } ?? "Unknown")
            if state == "ok" {
                ForEach(Array(rows(source?["windows"]).enumerated()), id: \.offset) { index, window in
                    if let percent = number(window["remainingPercent"]), percent <= 100,
                       ["5h", "weekly"].contains(text(window["window"])), let reset = parseDate(window["resetsAt"]) {
                        let label = text(window["window"]) == "5h" ? "5-hour window" : "Weekly window"
                        ObservatoryValueRow(antigravityPoolLabel(text(window["bucket"]), index: index) + " · " + label,
                                            value: "\(formatted(percent))% observed remaining")
                        ProgressView(value: percent, total: 100).tint(ObservatoryTheme.sage)
                            .accessibilityLabel(label + " observed allowance remaining")
                        Text("Reset: \(reset.formatted(date: .abbreviated, time: .shortened))").observatoryFont(.callout)
                        if reset <= now { Text("Reset time reached. Refresh sources for a new reading.").observatoryFont(.callout).foregroundStyle(ObservatoryTheme.muted) }
                    }
                }
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}
