import SwiftUI
import Charts

struct QuotaHistoryPoint: Identifiable {
    let id: Int
    let at: Date
    let used: Double
    let segment: Int
}

func quotaHistoryPoints(_ history: [JSONObject], bucket: String, window: String) -> [QuotaHistoryPoint] {
    var result: [QuotaHistoryPoint] = []
    var previous: (at: Date, used: Double, reset: String)?
    var segment = 0
    for sample in history {
        guard let at = parseDate(sample["checkedAt"]),
              let row = rows(sample["windows"]).first(where: { text($0["bucket"]) == bucket && text($0["window"]) == window }),
              let remaining = number(row["remainingPercent"]), remaining <= 100 else {
            previous = nil; segment += 1; continue
        }
        let used = 100 - remaining
        let reset = text(row["resetsAt"])
        if let previous, at.timeIntervalSince(previous.at) > 600 || at <= previous.at || used < previous.used || reset != previous.reset { segment += 1 }
        result.append(QuotaHistoryPoint(id: result.count, at: at, used: used, segment: segment))
        previous = (at, used, reset)
    }
    return result
}

struct QuotaPanel: View {
    let quota: JSONObject
    @State private var selected = ""
    private var windows: [JSONObject] { visibleQuotaWindows(quota["windows"]) }
    private var chosen: JSONObject? { windows.first(where: { key($0) == selected }) ?? windows.first }
    private func key(_ row: JSONObject) -> String { text(row["bucket"]) + ":" + text(row["window"]) }
    private func label(_ row: JSONObject) -> String {
        let duration = number(row["durationMinutes"]).map { value in
            value >= 1440 ? "\(formatted(value / 1440))d" : value >= 60 ? "\(formatted(value / 60))h" : "\(formatted(value))m"
        } ?? text(row["window"])
        return "\(text(row["bucket"])) · \(duration)"
    }
    private var statusLabel: String {
        if text(quota["latestReadStatus"]) == "waiting" { return "Waiting for the next permitted usage check." }
        switch text(quota["status"]) {
        case "ok": return "Latest reading"
        case "stale": return "Saved reading"
        case "needs-auth": return "Sign in through Codex, then refresh."
        case "unsupported": return "This Codex client or account does not report limits."
        default: return "Limits unavailable. Check Codex or try again later."
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("ACCOUNT USAGE").font(.system(size: 11, weight: .semibold)).tracking(1.3)
                Spacer()
                if let at = parseDate(quota["checkedAt"]) {
                    Text(at, style: .relative).font(.system(size: 11)).help("Time since the last successful limit read")
                }
            }.foregroundStyle(.secondary)
            Text(statusLabel).font(.system(size: 11)).foregroundStyle(text(quota["status"]) == "ok" ? Color.secondary : Color.orange)
            ForEach(Array(windows.enumerated()), id: \.offset) { _, row in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(label(row)).font(.system(size: 12, weight: .medium))
                        Spacer()
                        Text("\(formatted(number(row["remainingPercent"])))% left").font(.system(size: 12)).monospacedDigit()
                    }
                    ProgressView(value: number(row["remainingPercent"]) ?? 0, total: 100).tint(.accentColor)
                    Text(parseDate(row["resetsAt"]).map { "Resets \($0.formatted(date: .abbreviated, time: .shortened))" } ?? "Reset time unknown")
                        .font(.system(size: 10)).foregroundStyle(.secondary)
                    TimelineView(.periodic(from: .now, by: 30)) { context in
                        Text(quotaPaceText(quota, window: row, now: context.date))
                            .font(.system(size: 11)).foregroundStyle(.secondary)
                    }
                }.accessibilityElement(children: .combine)
            }
            if let chosen {
                Picker("Limit history", selection: Binding(get: { key(chosen) }, set: { selected = $0 })) {
                    ForEach(Array(windows.enumerated()), id: \.offset) { _, row in Text(label(row)).tag(key(row)) }
                }.labelsHidden().accessibilityLabel("Limit history window")
                let points = quotaHistoryPoints(rows(quota["history"]), bucket: text(chosen["bucket"]), window: text(chosen["window"]))
                Text("Allowance used · 24h to last read").font(.system(size: 11)).foregroundStyle(.secondary)
                if !points.isEmpty {
                    Chart(points) { point in
                        LineMark(x: .value("Time", point.at), y: .value("Used percent", point.used), series: .value("Reading segment", point.segment))
                            .foregroundStyle(Color.accentColor)
                        PointMark(x: .value("Time", point.at), y: .value("Used percent", point.used)).symbolSize(8).foregroundStyle(Color.accentColor)
                            .accessibilityHidden(true)
                    }
                    .chartYScale(domain: 0...100)
                    .chartXScale(domain: (points.last!.at.addingTimeInterval(-86400))...points.last!.at)
                    .chartXAxis {
                        AxisMarks(values: .automatic(desiredCount: 3)) {
                            AxisGridLine()
                            AxisTick()
                            AxisValueLabel(format: .dateTime.hour(.defaultDigits(amPM: .abbreviated)))
                        }
                    }
                    .chartYAxis { AxisMarks(values: [0, 50, 100]) }
                    .frame(height: 85)
                    .accessibilityLabel("Allowance history. Gaps and resets are separate segments.")
                } else {
                    Text("History begins with the first successful reading.").font(.system(size: 11)).foregroundStyle(.secondary)
                }
            }
            let daily = Array(rows(quota["dailyUsageBuckets"]).suffix(14))
            if !daily.isEmpty {
                Text("Account tokens · recent daily totals").font(.system(size: 11)).foregroundStyle(.secondary)
                Chart(Array(daily.enumerated()), id: \.offset) { _, day in
                    if let date = parseDate(text(day["startDate"]) + "T00:00:00Z"), let tokens = number(day["tokens"]) {
                        BarMark(x: .value("Day", date, unit: .day), y: .value("Tokens", tokens)).foregroundStyle(Color.accentColor.opacity(0.65))
                    }
                }
                .chartXAxis { AxisMarks(values: .automatic(desiredCount: 3)) }
                .chartYAxis { AxisMarks(values: .automatic(desiredCount: 3)) }
                .environment(\.timeZone, TimeZone(secondsFromGMT: 0)!)
                .frame(height: 75)
                .accessibilityLabel("Daily account token totals. Missing days are unknown, not zero.")
            }
            Text("Account-wide readings, not a device sum. Tokens and allowance use different units. Daily totals may lag.")
                .font(.system(size: 10)).foregroundStyle(.secondary)
        }
        .padding(15).background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 16))
    }
}

func quotaPaceText(_ quota: JSONObject, window: JSONObject, now: Date) -> String {
    guard text(quota["status"]) == "ok", let at = parseDate(quota["checkedAt"]),
          now.timeIntervalSince(at) >= 0, now.timeIntervalSince(at) < 600 else {
        return "Estimate unavailable until a fresh reading."
    }
    guard let pace = rows(quota["pace"]).first(where: {
        text($0["bucket"]) == text(window["bucket"]) && text($0["window"]) == text(window["window"])
    }), text(pace["asOf"]) == text(quota["checkedAt"]), let summary = pace["summary"] as? String else {
        return "Not enough recent history to estimate time left."
    }
    return summary
}
